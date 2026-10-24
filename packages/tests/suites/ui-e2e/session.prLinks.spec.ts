import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { createRunDirs } from '../../src/testkit/runDir';
import { startServerLight, type StartedServer } from '../../src/testkit/process/serverLight';
import { startUiWeb, type StartedUiWeb } from '../../src/testkit/process/uiWeb';
import { type StartedDaemon } from '../../src/testkit/daemon/daemon';
import { authenticateAndStartDaemon } from '../../src/testkit/uiE2e/authenticateAndStartDaemon';
import { gotoDomContentLoadedWithRetries, normalizeLoopbackBaseUrl } from '../../src/testkit/uiE2e/pageNavigation';
import { createSessionWithCiphertexts, fetchSessionV2 } from '../../src/testkit/sessions';
import { encryptLegacyBase64, decryptLegacyBase64 } from '../../src/testkit/messageCrypto';
import { appendBrowserDiagnostics, collectBrowserDiagnostics } from '../../src/testkit/uiE2e/browserDiagnostics';

const run = createRunDirs({ runLabel: 'ui-e2e' });
const receipt = (phase: string) => { console.log(`[oh52-pr-links] ${new Date().toISOString()} ${phase}`); };
test.use({ trace: 'on' });

test.describe('session linked pull requests', () => {
    const suiteDir = run.testDir('oh52-pr-links');
    const cliHome = resolve(suiteDir, 'cli-home');
    let server: StartedServer | null = null;
    let ui: StartedUiWeb | null = null;
    let daemon: StartedDaemon | null = null;

    test.beforeAll(async () => {
        test.setTimeout(900_000);
        receipt('setup start');
        await mkdir(cliHome, { recursive: true });
        server = await startServerLight({ testDir: suiteDir, dbProvider: 'sqlite', extraEnv: {
            HAPPIER_BUILD_FEATURES_DENY: 'sharing.contentKeys',
            HAPPIER_FEATURE_AUTH_LOGIN__KEY_CHALLENGE_ENABLED: '1',
        } });
        receipt('isolated server ready');
        ui = await startUiWeb({ testDir: suiteDir, env: {
            ...process.env,
            EXPO_PUBLIC_HAPPY_SERVER_URL: server.baseUrl,
            EXPO_PUBLIC_HAPPY_STORAGE_SCOPE: `oh52-${run.runId}`,
            HAPPIER_E2E_UI_WEB_EXPORT_NAMESPACE: 'oh52-pr-links',
        } });
        receipt('isolated UI ready');
    });
    test.afterAll(async () => {
        receipt('fixture cleanup start');
        await daemon?.stop().catch(() => {});
        receipt('daemon cleanup complete');
        await ui?.stop().catch(() => {});
        receipt('UI cleanup complete');
        await server?.stop().catch(() => {});
        receipt('fixture cleanup complete');
    });

    test('adds, corrects, removes and reloads encrypted cross-repository links', async ({ page }, testInfo) => {
        test.setTimeout(600_000);
        if (!server || !ui) throw new Error('isolated fixtures unavailable');
        const diagnostics = collectBrowserDiagnostics({ page });
        try {
            receipt('test body start');
            const baseUrl = normalizeLoopbackBaseUrl(ui.baseUrl);
            await gotoDomContentLoadedWithRetries(page, baseUrl, 240_000);
            receipt('initial page ready');
            daemon = await authenticateAndStartDaemon({ page, testDir: suiteDir, cliHomeDir: cliHome, serverUrl: server.baseUrl, uiBaseUrl: baseUrl,
                extraEnv: { HOME: cliHome, TMPDIR: cliHome, HAPPIER_E2E_CLI_SNAPSHOT_NODE_MODULES_MODE: 'symlink' },
            });
            receipt('isolated authentication and daemon ready');
            const access = await page.evaluate(() => {
                const keys = Object.keys(localStorage).filter((key) => key.startsWith('auth_credentials__srv_'));
                if (keys.length !== 1) throw new Error('Expected one isolated Home');
                const credentials = JSON.parse(localStorage.getItem(keys[0]) ?? '{}');
                return { token: credentials.token as string, secret: credentials.secret as string };
            });
            const secret = Uint8Array.from(Buffer.from(access.secret, 'base64url'));
            const initialMetadata = { path: suiteDir, host: 'OH52 fixture', name: 'PR links fixture', unknownOldCliField: { keep: 'preserved' } };
            const { sessionId } = await createSessionWithCiphertexts({ baseUrl: server.baseUrl, token: access.token, metadataCiphertextBase64: encryptLegacyBase64(initialMetadata, secret) });
            await gotoDomContentLoadedWithRetries(page, `${baseUrl}/session/${sessionId}/info`, 120_000);
            await expect(page.getByTestId('session-pr-add')).toBeVisible({ timeout: 120_000 });
            receipt('session information ready');

            const add = async (url: string) => {
                await page.getByTestId('session-pr-add').click();
                await page.getByTestId('web-prompt-input').fill(url);
                await page.getByTestId('web-prompt-confirm').click();
            };
            await add('https://github.com/owner/one/pull/7');
            await expect(page.getByTestId('session-pr-link-github-github.com-owner/one-7')).toBeVisible({ timeout: 60_000 });
            receipt('first link rendered');
            await add('https://github.com/owner/two/pull/7');
            await expect(page.getByTestId('session-pr-link-github-github.com-owner/two-7')).toBeVisible({ timeout: 60_000 });
            receipt('second cross-repository link rendered');
            await expect(page.getByTestId('session-pr-link-github-github.com-owner/one-7')).toContainText('Unknown');
            await expect(page.getByTestId('session-pr-link-github-github.com-owner/one-7')).not.toContainText('Unknown · Unknown');
            await page.screenshot({ path: testInfo.outputPath('oh52-two-repositories.png') });
            receipt('two-repository screenshot returned');

            await page.reload();
            await expect(page.getByTestId('session-pr-link-github-github.com-owner/one-7')).toBeVisible({ timeout: 120_000 });
            await expect(page.getByTestId('session-pr-link-github-github.com-owner/two-7')).toBeVisible();
            const persisted = await fetchSessionV2(server.baseUrl, access.token, sessionId);
            const metadata = decryptLegacyBase64(persisted.metadata!, secret) as Record<string, any>;
            expect(metadata.unknownOldCliField).toEqual({ keep: 'preserved' });
            expect(metadata.sessionPullRequestsV1.links).toHaveLength(2);
            expect(metadata.sessionPullRequestsV1.links.map((link: any) => link.repository)).toEqual(['owner/one', 'owner/two']);
            receipt('two-link reload and encrypted metadata verified');

            await page.getByTestId('session-pr-change-github-github.com-owner/one-7').click();
            await page.getByTestId('web-prompt-input').fill('https://gitlab.com/group/other/-/merge_requests/9');
            await page.getByTestId('web-prompt-confirm').click();
            await expect(page.getByTestId('session-pr-link-gitlab-gitlab.com-group/other-9')).toBeVisible({ timeout: 60_000 });
            await expect(page.getByTestId('session-pr-link-github-github.com-owner/one-7')).toHaveCount(0);
            await expect(page.getByTestId('session-pr-link-github-github.com-owner/two-7')).toBeVisible();
            receipt('link correction rendered');

            await page.getByTestId('session-pr-remove-github-github.com-owner/two-7').click();
            await page.getByTestId('web-modal-button-1').click();
            await expect(page.getByTestId('session-pr-link-github-github.com-owner/two-7')).toHaveCount(0);
            receipt('second link removal rendered');
            await page.reload();
            await expect(page.getByTestId('session-pr-link-gitlab-gitlab.com-group/other-9')).toBeVisible({ timeout: 120_000 });
            await expect(page.getByTestId('session-pr-link-github-github.com-owner/two-7')).toHaveCount(0);
            const finalSession = await fetchSessionV2(server.baseUrl, access.token, sessionId);
            const finalMetadata = decryptLegacyBase64(finalSession.metadata!, secret) as Record<string, any>;
            expect(finalMetadata.sessionPullRequestsV1.links).toMatchObject([{ providerKind: 'gitlab', repository: 'group/other', number: 9 }]);
            expect(finalMetadata.unknownOldCliField).toEqual({ keep: 'preserved' });
            receipt('final reload and encrypted metadata verified');
            await test.step('capture corrected link after all persisted metadata assertions', async () => {
                await page.screenshot({ path: testInfo.outputPath('oh52-corrected-link.png') });
            });
            receipt('final screenshot returned');
            receipt('test body complete');
        } catch (error) { throw appendBrowserDiagnostics(error, diagnostics()); }
    });
});
