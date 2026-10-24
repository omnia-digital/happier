import { test, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
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
import { collectBrowserDiagnostics, appendBrowserDiagnostics } from '../../src/testkit/uiE2e/browserDiagnostics';

const run = createRunDirs({ runLabel: 'ui-e2e' });
test.describe('session ticket link/read/status via isolated opt-in reader', () => {
    const suiteDir = run.testDir('session-ticket-linking');
    const cliHome = resolve(suiteDir, 'cli-home');
    const providerHome = resolve(suiteDir, 'provider-home');
    const statePath = resolve(suiteDir, 'ticket-state.json');
    let server: StartedServer | null = null;
    let ui: StartedUiWeb | null = null;
    let daemon: StartedDaemon | null = null;
    test.beforeAll(async () => {
        test.setTimeout(900_000);
        await mkdir(cliHome, { recursive: true }); await mkdir(providerHome, { recursive: true });
        await writeFile(statePath, JSON.stringify({ status: 'Q/A - Dev' }));
        server = await startServerLight({ testDir: suiteDir, dbProvider: 'sqlite', extraEnv: { HAPPIER_BUILD_FEATURES_DENY: 'sharing.contentKeys', HAPPIER_FEATURE_AUTH_LOGIN__KEY_CHALLENGE_ENABLED: '1' } });
        ui = await startUiWeb({ testDir: suiteDir, env: { ...process.env, EXPO_PUBLIC_HAPPY_SERVER_URL: server.baseUrl, EXPO_PUBLIC_HAPPY_STORAGE_SCOPE: `oh58-${run.runId}`, HAPPIER_E2E_UI_WEB_EXPORT_NAMESPACE: 'oh58-ticket-ui' } });
    });
    test.afterAll(async () => { await daemon?.stop().catch(() => {}); await ui?.stop().catch(() => {}); await server?.stop().catch(() => {}); });
    test('links, refreshes custom status in header and pinned row, changes/removes, and persists on reload', async ({ page }, testInfo) => {
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
                secrets: [{ id: 'ticket-secret', name: 'Fixture read credential', kind: 'apiKey', encryptedValue: { _isSecretValue: true, encryptedValue: encryptedSecret }, createdAt: 1, updatedAt: 1 }],
                mcpServersSettingsV1: { v: 1, strictMode: true, servers: [{ id: 'fixture-source', name: 'fixture_linear', title: 'Fixture Linear', transport: 'stdio', stdio: { command: process.execPath, args: [resolve(repoRootDir(), 'apps/cli/scripts/fixtures/ticketReaderMcpFixture.mjs')] }, env: { TICKET_FIXTURE_TOKEN: { t: 'savedSecret', secretId: 'ticket-secret' }, TICKET_FIXTURE_STATE: { t: 'literal', v: statePath } }, createdAt: 1, updatedAt: 1 }], bindings: [{ id: 'fixture-binding', serverId: 'fixture-source', enabled: true, target: { t: 'machine', machineId }, createdAt: 1, updatedAt: 1 }] },
            }) });
            const metadata = { path: suiteDir, host: 'Isolated reader', machineId, name: 'OH58 fixture session', version: '0.2.16', unknownOldCliField: { keep: 'preserved' } };
            const { sessionId } = await createSessionWithCiphertexts({ baseUrl: server.baseUrl, token: access.token, metadataCiphertextBase64: encryptLegacyBase64(metadata, secret) });
            await gotoDomContentLoadedWithRetries(page, `${baseUrl}/session/${sessionId}`, 120_000);
            await expect(page.getByTestId('session-ticket-link')).toBeVisible({ timeout: 120_000 });
            await page.getByTestId('session-ticket-link').click();
            await page.getByTestId('session-ticket-url').fill('https://linear.app/fixture/issue/DEV-1');
            await page.getByTestId('session-ticket-sources').click();
            await expect(page.getByTestId('session-ticket-source:fixture-source')).toBeVisible({ timeout: 60_000 });
            await page.getByTestId('session-ticket-read').click();
            await expect(page.getByTestId('session-ticket-resolved')).toContainText('DEV-1', { timeout: 60_000 });
            await page.getByTestId('session-ticket-save').click();
            await expect(page.getByTestId('session-ticket-header-status')).toContainText('Q/A - Dev', { timeout: 60_000 });
            await expect(page.getByTestId(`session-ticket-row-status:${sessionId}`)).toContainText('Q/A - Dev');
            await page.getByTestId(`session-list-item-${sessionId}`).hover();
            await page.getByRole('button', { name: 'Pin session', exact: true }).click();
            await expect(page.getByText('Pinned', { exact: true })).toBeVisible();
            await expect(page.getByTestId(`session-ticket-row-status:${sessionId}`)).toContainText('Q/A - Dev');
            await writeFile(statePath, JSON.stringify({ status: 'Ready for Prod / Stakeholder sign-off' }));
            await page.getByTestId('session-ticket-refresh').click();
            await expect(page.getByTestId('session-ticket-header-status')).toContainText('Ready for Prod / Stakeholder sign-off', { timeout: 60_000 });
            await expect(page.getByTestId(`session-ticket-row-status:${sessionId}`)).toContainText('Ready for Prod / Stakeholder sign-off');
            await page.screenshot({ path: testInfo.outputPath('oh58-linked-status.png') });
            // Canonical web destination is observable without opening a real provider account.
            await page.evaluate(() => { (window as any).__ticketOpened = null; window.open = ((url: string) => { (window as any).__ticketOpened = url; return null; }) as typeof window.open; });
            await page.getByTestId('session-ticket-open').click();
            await expect.poll(() => page.evaluate(() => (window as any).__ticketOpened)).toBe('linear://linear.app/fixture/issue/DEV-1');
            await page.getByTestId('session-ticket-open-web').click();
            await expect.poll(() => page.evaluate(() => (window as any).__ticketOpened)).toBe('https://linear.app/fixture/issue/DEV-1');
            await page.reload();
            await expect(page.getByTestId('session-ticket-open')).toContainText('DEV-1', { timeout: 120_000 });
            const persisted = await fetchSessionV2(server.baseUrl, access.token, sessionId);
            expect(decryptLegacyBase64(persisted.metadata!, secret)).toMatchObject({ unknownOldCliField: { keep: 'preserved' }, sessionTicketV1: { ticket: { key: 'DEV-1' } } });
            await page.getByTestId('session-ticket-change').click();
            await page.getByTestId('session-ticket-url').fill('https://linear.app/fixture/issue/DEV-2');
            await page.getByTestId('session-ticket-read').click();
            await expect(page.getByTestId('session-ticket-resolved')).toContainText('DEV-2', { timeout: 60_000 });
            await page.getByTestId('session-ticket-save').click();
            await expect(page.getByTestId('session-ticket-open')).toContainText('DEV-2');
            await expect(page.getByTestId('session-ticket-header-status')).toContainText('Ready for Prod / Stakeholder sign-off', { timeout: 60_000 });
            await writeFile(statePath, JSON.stringify({ error: '401 invalid credential' }));
            await page.getByTestId('session-ticket-refresh').click();
            await expect(page.getByTestId('session-ticket-header-status')).toContainText('Stale', { timeout: 60_000 });
            await page.setViewportSize({ width: 390, height: 844 });
            await expect(page.getByTestId('session-ticket-open')).toHaveAttribute('aria-label', /DEV-2.*Fixture ticket/);
            await page.screenshot({ path: testInfo.outputPath('oh58-compact-stale.png') });
            await page.getByTestId('session-ticket-change').click();
            // A second real metadata writer changes the association while the editor is open.
            // The stale remove must fail its compare-and-set instead of deleting the newer link.
            const beforeConcurrentChange = await fetchSessionV2(server.baseUrl, access.token, sessionId);
            const beforeMetadata = decryptLegacyBase64(beforeConcurrentChange.metadata, secret) as Record<string, any>;
            const concurrentMetadata = { ...beforeMetadata, sessionTicketV1: { ...beforeMetadata.sessionTicketV1, ticket: { ...beforeMetadata.sessionTicketV1.ticket, key: 'DEV-3', ticketId: 'fixture-DEV-3', url: 'https://linear.app/fixture/issue/DEV-3' } } };
            await patchSessionMetadataWithRetry({ baseUrl: server.baseUrl, token: access.token, sessionId, ciphertext: encryptLegacyBase64(concurrentMetadata, secret), expectedVersion: beforeConcurrentChange.metadataVersion });
            await expect(page.getByTestId('session-ticket-open')).toContainText('DEV-3', { timeout: 60_000 });
            await page.getByTestId('session-ticket-remove').click();
            await expect(page.getByRole('alert')).toContainText('cancelled', { timeout: 60_000 });
            await expect(page.getByTestId('session-ticket-open')).toContainText('DEV-3');
            await page.getByTestId('session-ticket-cancel').click();
            await page.getByTestId('session-ticket-change').click();
            await page.getByTestId('session-ticket-remove').click();
            await expect(page.getByTestId('session-ticket-link')).toBeVisible();
            await page.reload();
            await expect(page.getByTestId('session-ticket-link')).toBeVisible({ timeout: 120_000 });
        } catch (error) { throw appendBrowserDiagnostics(error, diagnostics()); }
    });
});
