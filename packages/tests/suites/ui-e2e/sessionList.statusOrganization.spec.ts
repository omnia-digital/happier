import { test, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { accountSettingsParse, deriveSettingsSecretsKeyV1, encryptSecretStringV1, sealEncryptedDataKeyEnvelopeV1, SESSION_RUNTIME_ACTIVITY_SNAPSHOT_EVENT, SessionRuntimeActivitySnapshotAckSchema, parseSessionRuntimeActivityProjectionFields } from '@happier-dev/protocol';
import { createRunDirs } from '../../src/testkit/runDir';
import { startServerLight, type StartedServer } from '../../src/testkit/process/serverLight';
import { startUiWeb, type StartedUiWeb } from '../../src/testkit/process/uiWeb';
import { type StartedDaemon } from '../../src/testkit/daemon/daemon';
import { authenticateAndStartDaemon } from '../../src/testkit/uiE2e/authenticateAndStartDaemon';
import { gotoDomContentLoadedWithRetries, normalizeLoopbackBaseUrl } from '../../src/testkit/uiE2e/pageNavigation';
import { upsertEncryptedAccountSettingsV2 } from '../../src/testkit/accountSettings';
import { createSessionWithCiphertexts, fetchSessionV2, fetchSessionsV2 } from '../../src/testkit/sessions';
import { encryptLegacyBase64 } from '../../src/testkit/messageCrypto';
import { encryptDataKeyBase64, decryptDataKeyBase64 } from '../../src/testkit/rpcCrypto';
import { readCliAccessKey } from '../../src/testkit/cliAccessKey';
import { repoRootDir } from '../../src/testkit/paths';
import { readUiE2eScopedAccountSettings } from '../../src/testkit/uiE2e/scopedAccountSettingsStorage';
import { mutateUiE2eLocalSettings, readUiE2eLocalSettings } from '../../src/testkit/uiE2e/localSettingsStorage';
import { createMachineBoundSessionScopedSocketCollector } from '../../src/testkit/sessionSocketBinding';
import type { SocketCollector } from '../../src/testkit/socketClient';
import { fetchJson } from '../../src/testkit/http';
import { waitFor } from '../../src/testkit/timing';
import { collectBrowserDiagnostics, appendBrowserDiagnostics } from '../../src/testkit/uiE2e/browserDiagnostics';

const run = createRunDirs({ runLabel: 'ui-e2e' });
test.describe('independent sidebar Agent Status and Ticket Status organization', () => {
    const suiteDir = run.testDir('status-organization');
    const cliHome = resolve(suiteDir, 'cli-home');
    const providerHome = resolve(suiteDir, 'provider-home');
    const statePath = resolve(suiteDir, 'ticket-state.json');
    let server: StartedServer | null = null;
    let ui: StartedUiWeb | null = null;
    let daemon: StartedDaemon | null = null;
    const publishers: SocketCollector[] = [];
    const keepAlives: ReturnType<typeof setInterval>[] = [];
    const readLog = resolve(suiteDir, 'ticket-reads.log');
    test.beforeAll(async () => {
        test.setTimeout(900_000);
        await mkdir(cliHome, { recursive: true }); await mkdir(providerHome, { recursive: true });
        await writeFile(statePath, JSON.stringify({ tickets: { 'DEV-1': { status: { name: 'Q/A - Dev', position: 20, workflowId: 'delivery' } }, 'DEV-2': { status: { name: 'Q/A - Dev', position: 20, workflowId: 'delivery' } }, 'DEV-3': { status: { name: 'Testing', position: 30, workflowId: 'delivery' } }, 'DEV-4': { status: { name: 'Ready for Prod', position: 40, workflowId: 'delivery' } }, 'DEV-5': { error: '401 invalid credential' } } }));
        await writeFile(readLog, '');
        server = await startServerLight({ testDir: suiteDir, dbProvider: 'sqlite', extraEnv: { HAPPIER_BUILD_FEATURES_DENY: 'sharing.contentKeys', HAPPIER_FEATURE_AUTH_LOGIN__KEY_CHALLENGE_ENABLED: '1' } });
        ui = await startUiWeb({ testDir: suiteDir, env: { ...process.env, EXPO_PUBLIC_HAPPY_SERVER_URL: server.baseUrl, EXPO_PUBLIC_HAPPY_STORAGE_SCOPE: `oh71-${run.runId}`, HAPPIER_E2E_UI_WEB_EXPORT_NAMESPACE: 'oh71-group-sort' } });
    });
    test.afterAll(async () => { keepAlives.forEach(clearInterval); publishers.forEach(socket => socket.close()); await daemon?.stop().catch(() => {}); await ui?.stop().catch(() => {}); await server?.stop().catch(() => {}); });
    test('independently groups/sorts, refreshes live custom status, preserves selection and restores persisted layout', async ({ page }, testInfo) => {
        test.setTimeout(420_000);
        if (!server || !ui) throw new Error('isolated fixtures unavailable');
        const diagnostics = collectBrowserDiagnostics({ page });
        try {
            const baseUrl = normalizeLoopbackBaseUrl(ui.baseUrl);
            await page.setViewportSize({ width: 1360, height: 900 });
            await gotoDomContentLoadedWithRetries(page, baseUrl, 240_000);
            daemon = await authenticateAndStartDaemon({ page, testDir: suiteDir, cliHomeDir: cliHome, serverUrl: server.baseUrl, uiBaseUrl: baseUrl, extraEnv: { HOME: providerHome, TMPDIR: providerHome, CLAUDE_CONFIG_DIR: join(providerHome, 'claude'), HAPPIER_CLAUDE_CONFIG_DIR: join(providerHome, 'claude'), HAPPIER_TICKET_READER_ENABLED: '1', HAPPIER_E2E_CLI_SNAPSHOT_NODE_MODULES_MODE: 'symlink' } });
            // Read only this fixture's generated credentials, never the daily CLI home.
            const access = await page.evaluate(() => {
                const keys = Object.keys(localStorage).filter((key) => key.startsWith('auth_credentials__srv_'));
                if (keys.length !== 1) throw new Error('Expected exactly one isolated fixture Home');
                const credentials = JSON.parse(localStorage.getItem(keys[0]) ?? '{}');
                if (typeof credentials.token !== 'string' || typeof credentials.secret !== 'string') throw new Error('Fixture app encryption credentials missing');
                return { token: credentials.token as string, secret: credentials.secret as string };
            });
            const secret = Uint8Array.from(Buffer.from(access.secret, 'base64url'));
            const cliAccess = await readCliAccessKey(cliHome);
            if (!cliAccess || !('encryption' in cliAccess)) throw new Error('Expected isolated connected CLI recipient credentials');
            const sessionKeys = new Map<string, Uint8Array>();
            const loginOutput = await readFile(join(suiteDir, 'cli.auth.login.stdout.log'), 'utf8');
            const machineId = loginOutput.replaceAll(/\u001b\[[0-9;]*m/g, '').match(/Machine ID:\s*([^\s]+)/)?.[1];
            if (!machineId) throw new Error('fixture machine identity missing');
            const existingSettings = await readUiE2eScopedAccountSettings({ page });
            const encryptedSecret = encryptSecretStringV1('synthetic-read-token', deriveSettingsSecretsKeyV1(secret), (length) => Uint8Array.from(randomBytes(length)));
            await upsertEncryptedAccountSettingsV2({ baseUrl: server.baseUrl, token: access.token, secret, settings: accountSettingsParse({ ...existingSettings,
                sessionListSectionModeV1: 'single', hideInactiveSessions: false, sessionListOrderingModeV1: 'created', sessionListStatusSortV1: 'none', sessionListAttentionPromotionModeV1: 'off', sessionListWorkingPlacementModeV1: 'off',
                secrets: [{ id: 'ticket-secret', name: 'Fixture read credential', kind: 'apiKey', encryptedValue: { _isSecretValue: true, encryptedValue: encryptedSecret }, createdAt: 1, updatedAt: 1 }],
                mcpServersSettingsV1: { v: 1, strictMode: true, servers: [{ id: 'fixture-source', name: 'fixture_linear', title: 'Fixture Linear', transport: 'stdio', stdio: { command: process.execPath, args: [resolve(repoRootDir(), 'apps/cli/scripts/fixtures/ticketReaderMcpFixture.mjs')] }, env: { TICKET_FIXTURE_TOKEN: { t: 'savedSecret', secretId: 'ticket-secret' }, TICKET_FIXTURE_STATE: { t: 'literal', v: statePath }, TICKET_FIXTURE_READ_LOG: { t: 'literal', v: readLog } }, createdAt: 1, updatedAt: 1 }], bindings: [{ id: 'fixture-binding', serverId: 'fixture-source', enabled: true, target: { t: 'machine', machineId }, createdAt: 1, updatedAt: 1 }] },
            }) });
            const seed = async (name: string, ticketNumber?: number) => {
                const key = ticketNumber ? 'DEV-' + ticketNumber : null;
                const metadata = { path: suiteDir, host: 'Isolated reader', machineId, name, version: '0.2.16', unknownOldCliField: { keep: 'preserved' }, ...(key ? { sessionTicketV1: { v: 1, ticket: { v: 1, provider: 'linear', workspaceId: 'fixture', ticketId: 'fixture-' + key, key, title: 'Fixture ticket', url: 'https://linear.app/fixture/issue/' + key }, reader: { machineId, mcpServerId: 'fixture-source', directory: suiteDir } } } : {}) };
                const dataKey = Uint8Array.from(randomBytes(32));
                const envelope = sealEncryptedDataKeyEnvelopeV1({ dataKey, recipientPublicKey: Uint8Array.from(Buffer.from(cliAccess.encryption.publicKey, 'base64')), randomBytes: (length) => Uint8Array.from(randomBytes(length)) });
                const { sessionId } = await createSessionWithCiphertexts({ baseUrl: server!.baseUrl, token: access.token, metadataCiphertextBase64: encryptDataKeyBase64(metadata, dataKey), dataEncryptionKeyBase64: Buffer.from(envelope).toString('base64') });
                sessionKeys.set(sessionId, dataKey);
                return sessionId;
            };
            const noTicket = await seed('OH60 No ticket');
            await seed('Layout anchor');
            await gotoDomContentLoadedWithRetries(page, baseUrl, 120_000);
            await expect(page.getByTestId('session-list-item-' + noTicket)).toBeVisible({ timeout: 120_000 });
            await page.getByTestId('session-list-item-' + noTicket).hover();
            await page.getByRole('button', { name: 'Pin session', exact: true }).click();
            await page.getByText('status-organization', { exact: true }).click();
            // Preserve the user's collapsed original project while the fixture is seeded offline.
            await page.goto('about:blank');
            const idle = await seed('OH60 QA idle', 1);
            const working = await seed('OH60 QA working', 2);
            const testing = await seed('OH60 Testing', 3);
            const production = await seed('OH60 Production', 4);
            const unavailable = await seed('OH60 Unavailable', 5);
            for (let index = 0; index < 32; index++) await seed('Layout filler ' + index);
            const publishActivity = async (socket: SocketCollector, sessionId: string, activeWork: boolean) => {
                const snapshot = { state: activeWork ? 'active' as const : 'idle' as const, activeCount: activeWork ? 1 : 0 };
                const ack = SessionRuntimeActivitySnapshotAckSchema.parse(await socket.emitWithAck(SESSION_RUNTIME_ACTIVITY_SNAPSHOT_EVENT, {
                    sessionId, mutationId: randomUUID(), snapshot,
                }));
                expect(['applied', 'unchanged']).toContain(ack.status);
                const persisted = await fetchJson<{ session: Record<string, unknown> }>(`${server!.baseUrl}/v2/sessions/${sessionId}`, { headers: { Authorization: `Bearer ${access.token}` } });
                expect(persisted.status).toBe(200);
                expect(parseSessionRuntimeActivityProjectionFields(persisted.data.session)).toMatchObject({ kind: 'valid', projection: snapshot });
            };
            const publish = async (sessionId: string, activeWork: boolean) => {
                const { socket } = await createMachineBoundSessionScopedSocketCollector({ baseUrl: server!.baseUrl, token: access.token, sessionId,
                    machineMetadataCiphertext: encryptLegacyBase64({ host: 'OH60 isolated runtime publisher', platform: 'darwin' }, secret) });
                publishers.push(socket); socket.connect();
                await waitFor(async () => socket.isConnected(), { timeoutMs: 20_000, context: 'connect isolated status publisher' });
                // Released alive is reachability only; actual activity uses its acknowledged owner.
                const alive = () => socket.emit('session-alive', { sid: sessionId, time: Date.now(), thinking: false });
                alive(); keepAlives.push(setInterval(alive, 15_000));
                await waitFor(async () => (await fetchSessionV2(server!.baseUrl, access.token, sessionId)).active, { timeoutMs: 20_000, context: 'live fixture runtime' });
                await publishActivity(socket, sessionId, activeWork);
                return socket;
            };
            const idlePublisher = await publish(idle, false);
            const workingPublisher = await publish(working, true);
            await publish(testing, false); await publish(production, false); await publish(unavailable, false);
            const catalog = await fetchSessionsV2(server.baseUrl, access.token, { limit: 50 });
            expect(catalog.sessions).toHaveLength(39);
            expect(catalog.sessions.every(session => typeof session.dataEncryptionKey === 'string')).toBe(true);
            await gotoDomContentLoadedWithRetries(page, baseUrl, 120_000);
            await page.getByTestId('machine-monitoring-toggle').click();
            const choose = async (id: string) => {
                const trigger = id.includes('status-sort-') || id.includes('ordering-mode-') || id.includes('folder-sort-mode-')
                    ? 'session-list-sort-menu-trigger'
                    : 'session-list-group-menu-trigger';
                await page.getByTestId(trigger).first().click();
                await page.getByTestId(id).click();
            };
            const row = (id: string) => page.getByTestId('session-list-item-' + id);
            // Virtualized DOM pools retain hidden/recycled nodes and need not follow visual order.
            const visibleIds = () => page.locator('[data-testid^="session-list-item-"]').evaluateAll(nodes => nodes.map(node => ({
                id: node.getAttribute('data-testid')!.slice('session-list-item-'.length), rect: node.getBoundingClientRect(),
            })).filter(row => row.rect.width > 0 && row.rect.height > 0).sort((left, right) => left.rect.top - right.rect.top).map(row => row.id));
            const position = async (id: string) => (await visibleIds()).indexOf(id);
            await expect(page.getByTestId('session-list-group-menu-trigger').first()).toBeVisible({ timeout: 120_000 });
            await expect(page.getByTestId('session-list-sort-menu-trigger').first()).toBeVisible();
            await expect(row(noTicket)).toBeVisible();
            await expect(page.getByText('Pinned', { exact: true })).toBeVisible();
            // The saved project collapse keeps this ticket row out of view before list demand.
            await expect(row(idle)).not.toBeInViewport();
            expect((await readFile(readLog, 'utf8')).split('\n')).not.toContain('DEV-1');
            await choose('session-list-status-group-ticket');
            await expect(page.getByText('Q/A - Dev', { exact: true }).first()).toBeVisible({ timeout: 60_000 });
            await expect(row(idle)).toBeVisible({ timeout: 60_000 });
            expect((await readFile(readLog, 'utf8')).split('\n')).toContain('DEV-1');
            await choose('session-list-status-sort-agent');
            await expect.poll(async () => (await position(working)) < (await position(idle))).toBe(true);
            await expect(page.getByTestId('session-row-status-' + working + '-working')).toBeVisible({ timeout: 60_000 });
            const statusHeaders = page.locator('[data-testid^="session-list-header:status-view:"]:visible');
            await expect(statusHeaders.filter({ hasText: 'Q/A - Dev' }).first()).toContainText('linear · fixture · delivery');
            await expect.poll(async () => (await position(testing)) < (await position(production))).toBe(true);
            await expect(page.getByText('Status unavailable', { exact: true }).first()).toBeVisible();
            // Actual settings owner persisted only the override; the saved Created choice survives.
            await expect.poll(async () => (await readUiE2eScopedAccountSettings({ page })).sessionListStatusSortV1).toBe('agent');
            expect((await readUiE2eScopedAccountSettings({ page })).sessionListOrderingModeV1).toBe('created');
            await row(idle).click();
            await expect(page).toHaveURL(new RegExp('/session/' + idle));
            await expect(page.getByTestId('session-ticket-header-status')).toContainText('Q/A - Dev');
            await page.getByTestId('session-list-search-trigger').first().click();
            await page.getByTestId('session-list-search-input').first().fill('OH60 QA');
            await expect(row(testing)).toBeHidden();
            await expect(row(idle)).toBeVisible();
            await page.getByTestId('session-list-search-clear').first().click();
            await expect(row(testing)).toBeVisible();
            // Keep every ticket candidate visible while exercising runtime group movement below.
            await page.getByTestId('session-list-search-trigger').first().click();
            await page.getByTestId('session-list-search-input').first().fill('OH60');
            await page.mouse.move(1000, 400);
            await page.screenshot({ path: testInfo.outputPath('oh60-ticket-groups-agent-sort.png') });
            await choose('session-list-status-group-agent');
            await expect(statusHeaders.filter({ hasText: 'working...' }).first()).toBeVisible();
            await publishActivity(workingPublisher, working, false);
            await expect(page.getByTestId('session-row-status-' + working + '-idle')).toBeVisible({ timeout: 60_000 });
            await expect(statusHeaders.filter({ hasText: 'working...' })).toHaveCount(0);
            await expect(page).toHaveURL(new RegExp('/session/' + idle));
            await choose('session-list-status-sort-ticket');
            await expect.poll(async () => (await position(testing)) < (await position(production))).toBe(true);
            await choose('session-list-status-group-none');
            await expect(statusHeaders).toHaveCount(0);
            await choose('session-list-status-group-ticket');
            await choose('session-list-status-sort-agent');
            // A provider change moves the selected session into the new actual custom-status group.
            const changed = JSON.parse(await readFile(statePath, 'utf8'));
            changed.tickets['DEV-1'].status = { name: 'Ready for Prod', position: 40, workflowId: 'delivery' };
            await writeFile(statePath, JSON.stringify(changed));
            await page.getByTestId('session-ticket-refresh').click();
            await expect(page.getByTestId('session-ticket-header-status')).toContainText('Ready for Prod', { timeout: 60_000 });
            await expect(page).toHaveURL(new RegExp('/session/' + idle));
            await expect.poll(async () => (await position(testing)) < (await position(idle))).toBe(true);
            // Keyboard navigation follows the new visible row order after the selected row moves.
            const ordered = await visibleIds(); const next = ordered[ordered.indexOf(idle) + 1];
            if (!next) throw new Error('Expected a next visible fixture session');
            await page.getByTestId('sessions-list-keyboard-zone').first().focus();
            await page.keyboard.press('Alt+ArrowDown');
            await expect(page).toHaveURL(new RegExp('/session/' + next));
            await row(idle).click();
            await page.reload();
            await expect(page.getByTestId('session-ticket-header-status')).toContainText('Ready for Prod', { timeout: 120_000 });
            await expect(statusHeaders.filter({ hasText: 'Ready for Prod' }).first()).toBeVisible();
            expect((await readUiE2eScopedAccountSettings({ page })).sessionListStatusSortV1).toBe('agent');
            await page.setViewportSize({ width: 390, height: 900 });
            await gotoDomContentLoadedWithRetries(page, baseUrl, 120_000);
            await expect(page.getByTestId('machine-monitoring-toggle')).toHaveCount(0);
            await expect(statusHeaders.filter({ hasText: 'Ready for Prod' }).first()).toBeVisible({ timeout: 60_000 });
            await expect(row(unavailable).getByText('Status unavailable', { exact: true })).toBeVisible({ timeout: 60_000 });
            await page.mouse.move(385, 2);
            await page.screenshot({ path: testInfo.outputPath('oh60-compact-status-organization.png') });
            await page.setViewportSize({ width: 1360, height: 900 });
            await gotoDomContentLoadedWithRetries(page, `${baseUrl}/session/${idle}`, 120_000);
            await expect(page.getByTestId('session-ticket-header-status')).toHaveText('Ready for Prod', { timeout: 60_000 });
            await choose('session-view-machine');
            await expect(statusHeaders).toHaveCount(0);
            await choose('session-list-status-group-ticket');
            await choose('session-list-status-group-none');
            await expect(page.locator('[data-testid^="session-list-header:machine-view:"]').first()).toBeVisible();
            await expect(row(noTicket)).toHaveCount(1);
            const ids = await visibleIds(); expect(new Set(ids).size).toBe(ids.length);
            // Flat is a persisted layout choice. It clears only grouping, leaving the chosen sort intact.
            await choose('session-view-flat');
            await expect(page.locator('[data-testid^="session-list-header:machine-view:"]')).toHaveCount(0);
            await expect(statusHeaders).toHaveCount(0);
            await expect.poll(async () => (await readUiE2eLocalSettings({ page })).sessionListMachineViewV1).toBe('flat');
            expect((await readUiE2eScopedAccountSettings({ page })).sessionListStatusSortV1).toBe('agent');
            await page.reload();
            await expect(row(noTicket)).toBeVisible({ timeout: 120_000 });
            expect((await readUiE2eLocalSettings({ page })).sessionListMachineViewV1).toBe('flat');
            expect((await readUiE2eScopedAccountSettings({ page })).sessionListStatusSortV1).toBe('agent');

            // The menu is genuinely taller than the old 320px cap but remains within a short viewport.
            await page.setViewportSize({ width: 1000, height: 420 });
            await gotoDomContentLoadedWithRetries(page, baseUrl, 120_000);
            await expect(page.getByTestId('session-list-group-menu-trigger').first()).toBeVisible({ timeout: 120_000 });
            await page.getByTestId('session-list-group-menu-trigger').first().click();
            await expect(page.getByTestId('session-view-flat')).toBeVisible();
            const groupMenuMetrics = () => page.getByTestId('session-view-flat').evaluate((item) => {
                let scrollHost = item.parentElement;
                while (scrollHost && !(scrollHost.scrollHeight > scrollHost.clientHeight + 8 && /auto|scroll/.test(getComputedStyle(scrollHost).overflowY))) {
                    scrollHost = scrollHost.parentElement;
                }
                if (!scrollHost) throw new Error('Group menu has no scrollable viewport');
                const rect = scrollHost.getBoundingClientRect();
                return { top: rect.top, bottom: rect.bottom, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2,
                    scrollTop: scrollHost.scrollTop, clientHeight: scrollHost.clientHeight, scrollHeight: scrollHost.scrollHeight };
            });
            const initialMenu = await groupMenuMetrics();
            expect(initialMenu.top).toBeGreaterThanOrEqual(8);
            expect(initialMenu.bottom).toBeLessThanOrEqual(412);
            expect(initialMenu.clientHeight).toBeGreaterThan(320);
            await page.mouse.move(initialMenu.x, initialMenu.y);
            await page.mouse.wheel(0, 580);
            await expect.poll(async () => (await groupMenuMetrics()).scrollTop).toBeGreaterThan(0);
            const wheelOffset = (await groupMenuMetrics()).scrollTop;
            await page.screenshot({ path: testInfo.outputPath('oh71-group-menu-short-scrolled.png') });
            // A live session revision must not undo a deliberate wheel position.
            await publishActivity(idlePublisher, idle, true);
            await expect(page.getByTestId('session-row-status-' + idle + '-working')).toBeVisible({ timeout: 60_000 });
            await expect.poll(async () => (await groupMenuMetrics()).scrollTop).toBeGreaterThanOrEqual(wheelOffset);
            // Keyboard navigation can still reach and activate the last option.
            for (let index = 0; index < 12; index++) await page.keyboard.press('ArrowDown');
            await page.keyboard.press('Enter');
            await expect.poll(async () => (await readUiE2eScopedAccountSettings({ page })).hideInactiveSessions).toBe(true);
            await choose('session-view-flat');
            await expect.poll(async () => (await readUiE2eLocalSettings({ page })).sessionListMachineViewV1).toBe('flat');

            // Large text, dark theme and a narrow viewport retain both labeled controls and a bounded menu.
            await mutateUiE2eLocalSettings({ page, settingsPatch: { uiFontScale: 1.3, uiItemDensity: 'compact', themePreference: 'dark' } });
            await page.setViewportSize({ width: 390, height: 420 });
            await page.reload();
            await expect(page.getByTestId('session-list-group-menu-trigger').first()).toBeVisible({ timeout: 120_000 });
            await expect(page.getByTestId('session-list-sort-menu-trigger').first()).toBeVisible();
            await expect(page.getByTestId('session-list-group-menu-trigger').first()).toHaveAttribute('aria-label', 'Group');
            await expect(page.getByTestId('session-list-sort-menu-trigger').first()).toHaveAttribute('aria-label', 'Sort');
            await page.getByTestId('session-list-sort-menu-trigger').first().click();
            await expect(page.getByTestId('session-list-status-sort-agent')).toBeVisible();
            await page.screenshot({ path: testInfo.outputPath('oh71-sort-menu-dark-large-narrow.png') });
            await page.keyboard.press('Escape');
            await expect(page.getByTestId('session-list-status-sort-agent')).toHaveCount(0);
            await page.getByTestId('session-list-group-menu-trigger').first().click();
            await expect(page.getByTestId('session-view-flat')).toBeVisible();
            const narrowMenu = await groupMenuMetrics();
            expect(narrowMenu.top).toBeGreaterThanOrEqual(8);
            expect(narrowMenu.bottom).toBeLessThanOrEqual(412);
            await page.screenshot({ path: testInfo.outputPath('oh71-group-menu-dark-large-narrow.png') });
            const persisted = await fetchSessionV2(server.baseUrl, access.token, idle);
            expect(decryptDataKeyBase64(persisted.metadata, sessionKeys.get(idle)!)).toMatchObject({ unknownOldCliField: { keep: 'preserved' }, sessionTicketV1: { ticket: { key: 'DEV-1' } } });
            // Keep publisher handles live until after the visible assertions and fixture teardown.
            expect(idlePublisher.isConnected() && workingPublisher.isConnected()).toBe(true);
        } catch (error) { throw appendBrowserDiagnostics(error, diagnostics()); }
    });
});
