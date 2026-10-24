import { test, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { accountSettingsParse, deriveSettingsSecretsKeyV1, encryptSecretStringV1 } from '@happier-dev/protocol';
import { createRunDirs } from '../../src/testkit/runDir';
import { startServerLight, type StartedServer } from '../../src/testkit/process/serverLight';
import { startUiWeb, type StartedUiWeb } from '../../src/testkit/process/uiWeb';
import { type StartedDaemon } from '../../src/testkit/daemon/daemon';
import { authenticateAndStartDaemon } from '../../src/testkit/uiE2e/authenticateAndStartDaemon';
import { gotoDomContentLoadedWithRetries, normalizeLoopbackBaseUrl } from '../../src/testkit/uiE2e/pageNavigation';
import { upsertEncryptedAccountSettingsV2 } from '../../src/testkit/accountSettings';
import { createSessionWithCiphertexts, fetchSessionV2, patchSessionMetadataWithRetry } from '../../src/testkit/sessions';
import { encryptLegacyBase64, decryptLegacyBase64 } from '../../src/testkit/messageCrypto';
import { repoRootDir } from '../../src/testkit/paths';
import { readUiE2eScopedAccountSettings } from '../../src/testkit/uiE2e/scopedAccountSettingsStorage';
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
        ui = await startUiWeb({ testDir: suiteDir, env: { ...process.env, EXPO_PUBLIC_HAPPY_SERVER_URL: server.baseUrl, EXPO_PUBLIC_HAPPY_STORAGE_SCOPE: `oh60-${run.runId}`, HAPPIER_E2E_UI_WEB_EXPORT_NAMESPACE: 'oh60-status-organization' } });
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
                return (await createSessionWithCiphertexts({ baseUrl: server!.baseUrl, token: access.token, metadataCiphertextBase64: encryptLegacyBase64(metadata, secret) })).sessionId;
            };
            const idle = await seed('OH60 QA idle', 1);
            const working = await seed('OH60 QA working', 2);
            const testing = await seed('OH60 Testing', 3);
            const production = await seed('OH60 Production', 4);
            const unavailable = await seed('OH60 Unavailable', 5);
            const noTicket = await seed('OH60 No ticket');
            for (let index = 0; index < 16; index++) await seed('OH60 unlinked filler ' + index);
            const publish = async (sessionId: string, thinking: boolean) => {
                const { socket } = await createMachineBoundSessionScopedSocketCollector({ baseUrl: server!.baseUrl, token: access.token, sessionId, plainMachine: true });
                publishers.push(socket); socket.connect();
                await waitFor(async () => socket.isConnected(), { timeoutMs: 20_000, context: 'connect isolated status publisher' });
                const alive = () => socket.emit('session-alive', { sid: sessionId, time: Date.now(), thinking });
                alive(); keepAlives.push(setInterval(alive, 15_000));
                await waitFor(async () => (await fetchSessionV2(server!.baseUrl, access.token, sessionId)).active, { timeoutMs: 20_000, context: 'live fixture runtime' });
                return socket;
            };
            const idlePublisher = await publish(idle, false);
            const workingPublisher = await publish(working, true);
            await publish(testing, false); await publish(production, false); await publish(unavailable, false);
            await gotoDomContentLoadedWithRetries(page, baseUrl, 120_000);
            const choose = async (id: string) => {
                await page.getByTestId('session-list-ordering-menu-trigger').first().click();
                await page.getByTestId(id).click();
            };
            const row = (id: string) => page.getByTestId('session-list-item-' + id);
            const visibleIds = () => page.locator('[data-testid^="session-list-item-"]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-testid')!.slice('session-list-item-'.length)));
            const position = async (id: string) => (await visibleIds()).indexOf(id);
            await expect(page.getByTestId('session-list-ordering-menu-trigger').first()).toBeVisible({ timeout: 120_000 });
            // This oldest linked row is outside the viewport before status organization demands it.
            await expect(row(idle)).toHaveCount(0);
            expect((await readFile(readLog, 'utf8')).split('\n')).not.toContain('DEV-1');
            await choose('session-list-status-group-ticket');
            await expect(page.getByText('Q/A - Dev', { exact: true }).first()).toBeVisible({ timeout: 60_000 });
            await expect(row(idle)).toBeVisible({ timeout: 60_000 });
            expect((await readFile(readLog, 'utf8')).split('\n')).toContain('DEV-1');
            await choose('session-list-status-sort-agent');
            await expect.poll(async () => (await position(working)) < (await position(idle))).toBe(true);
            await expect(page.getByTestId('session-row-status-' + working + '-working')).toBeVisible();
            const statusHeaders = page.locator('[data-testid^="session-list-header:status-view:"]');
            await expect(statusHeaders.filter({ hasText: 'Q/A - Dev' }).first()).toContainText('linear · fixture · delivery');
            await expect.poll(async () => (await position(testing)) < (await position(production))).toBe(true);
            await expect(page.getByText('Status unavailable', { exact: true }).first()).toBeVisible();
            // Actual settings owner persisted only the override; the saved Created choice survives.
            await expect.poll(async () => (await readUiE2eScopedAccountSettings({ page })).sessionListStatusSortV1).toBe('agent');
            expect((await readUiE2eScopedAccountSettings({ page })).sessionListOrderingModeV1).toBe('created');
            await row(idle).click();
            await expect(page).toHaveURL(new RegExp('/session/' + idle));
            await expect(page.getByTestId('session-ticket-header-status')).toContainText('Q/A - Dev');
            await page.screenshot({ path: testInfo.outputPath('oh60-ticket-groups-agent-sort.png') });
            await choose('session-list-status-group-agent');
            await expect(statusHeaders.filter({ hasText: 'working...' }).first()).toBeVisible();
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
            await page.getByTestId('session-ticket-open').focus();
            await page.keyboard.press('Alt+ArrowDown');
            await expect(page).toHaveURL(new RegExp('/session/' + next));
            await row(idle).click();
            await page.reload();
            await expect(page.getByTestId('session-ticket-header-status')).toContainText('Ready for Prod', { timeout: 120_000 });
            await expect(statusHeaders.filter({ hasText: 'Ready for Prod' }).first()).toBeVisible();
            expect((await readUiE2eScopedAccountSettings({ page })).sessionListStatusSortV1).toBe('agent');
            await page.setViewportSize({ width: 760, height: 900 });
            await page.screenshot({ path: testInfo.outputPath('oh60-compact-status-organization.png') });
            await page.setViewportSize({ width: 1360, height: 900 });
            await choose('session-view-machine');
            await expect(statusHeaders).toHaveCount(0);
            await choose('session-list-status-group-ticket');
            await choose('session-list-status-group-none');
            await expect(page.locator('[data-testid^="session-list-header:machine-view:"]').first()).toBeVisible();
            const ids = await visibleIds(); expect(new Set(ids).size).toBe(ids.length);
            const persisted = await fetchSessionV2(server.baseUrl, access.token, idle);
            expect(decryptLegacyBase64(persisted.metadata, secret)).toMatchObject({ unknownOldCliField: { keep: 'preserved' }, sessionTicketV1: { ticket: { key: 'DEV-1' } } });
            // Keep publisher handles live until after the visible assertions and fixture teardown.
            expect(idlePublisher.isConnected() && workingPublisher.isConnected()).toBe(true);
        } catch (error) { throw appendBrowserDiagnostics(error, diagnostics()); }
    });
});
