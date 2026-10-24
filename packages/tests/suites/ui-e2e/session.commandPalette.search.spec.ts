import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { createTestAuthMtls } from '../../src/testkit/auth';
import { upsertPlainAccountSettingsV2 } from '../../src/testkit/accountSettings';
import { registerMachineIdentity } from '../../src/testkit/machineIdentity';
import { startServerLight, type StartedServer } from '../../src/testkit/process/serverLight';
import { resolveUiWebBeforeAllTimeoutMs, startUiWeb, type StartedUiWeb } from '../../src/testkit/process/uiWeb';
import { createRunDirs } from '../../src/testkit/runDir';
import { startForwardedHeaderProxy } from '../../src/testkit/uiE2e/forwardedHeaderProxy';
import { gotoDomContentLoadedWithRetries, normalizeLoopbackBaseUrl } from '../../src/testkit/uiE2e/pageNavigation';
import { readUiE2eScopedAccountSettings } from '../../src/testkit/uiE2e/scopedAccountSettingsStorage';
import { createPlainSession } from '../../src/testkit/uiE2e/sessionFoldersDrag';
import { waitForInitialAppUi } from '../../src/testkit/uiE2e/waitForInitialAppUi';
import { encodePlainMachineStoredContent, MACHINE_PLAIN_DATA_KEY_MARKER } from '@happier-dev/protocol';

const run = createRunDirs({ runLabel: 'ui-e2e-oh56-command-palette-search' });
const identity = {
  email: `oh56-${run.runId}@example.com`, issuer: 'happier-ui-e2e-oh56', fingerprint: `oh56-${run.runId}`,
};

test.describe('OH-56 Command+K session title search', () => {
  const suiteDir = run.testDir('command-palette-search');
  let server: StartedServer | null = null;
  let ui: StartedUiWeb | null = null;
  let stopProxy: (() => Promise<void>) | null = null;
  let uiBaseUrl = '';
  let targetSessionId = '';
  let newerSessionId = '';

  test.beforeAll(async () => {
    test.setTimeout(resolveUiWebBeforeAllTimeoutMs(process.env));
    await mkdir(resolve(join(suiteDir, 'cli-home')), { recursive: true });
    server = await startServerLight({
      testDir: suiteDir,
      dbProvider: 'sqlite',
      extraEnv: {
        HAPPIER_BUILD_FEATURES_DENY: 'sharing.contentKeys',
        HAPPIER_FEATURE_AUTH_LOGIN__KEY_CHALLENGE_ENABLED: '0',
        HAPPIER_FEATURE_E2EE__KEYLESS_ACCOUNTS_ENABLED: '1',
        HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY: 'optional',
        HAPPIER_FEATURE_ENCRYPTION__DEFAULT_ACCOUNT_MODE: 'plain',
        HAPPIER_FEATURE_AUTH_MTLS__ENABLED: '1',
        HAPPIER_FEATURE_AUTH_MTLS__MODE: 'forwarded',
        HAPPIER_FEATURE_AUTH_MTLS__TRUST_FORWARDED_HEADERS: '1',
        HAPPIER_FEATURE_AUTH_MTLS__AUTO_PROVISION: '1',
        HAPPIER_FEATURE_AUTH_MTLS__IDENTITY_SOURCE: 'san_email',
        HAPPIER_FEATURE_AUTH_MTLS__ALLOWED_EMAIL_DOMAINS: 'example.com',
        HAPPIER_FEATURE_AUTH_MTLS__ALLOWED_ISSUERS: identity.issuer,
        HAPPIER_FEATURE_AUTH_MTLS__FORWARDED_EMAIL_HEADER: 'x-happier-client-cert-email',
        HAPPIER_FEATURE_AUTH_MTLS__FORWARDED_ISSUER_HEADER: 'x-happier-client-cert-issuer',
        HAPPIER_FEATURE_AUTH_MTLS__FORWARDED_FINGERPRINT_HEADER: 'x-happier-client-cert-sha256',
        HAPPIER_FEATURE_AUTH_UI__AUTO_REDIRECT_ENABLED: '1',
        HAPPIER_FEATURE_AUTH_UI__AUTO_REDIRECT_PROVIDER_ID: 'mtls',
      },
    });
    const proxy = await startForwardedHeaderProxy({
      targetBaseUrl: server.baseUrl,
      identityHeaders: {
        'x-happier-client-cert-email': identity.email,
        'x-happier-client-cert-issuer': identity.issuer,
        'x-happier-client-cert-sha256': identity.fingerprint,
      },
    });
    stopProxy = proxy.stop;
    const { token } = await createTestAuthMtls(server.baseUrl, identity);
    await upsertPlainAccountSettingsV2({
      baseUrl: server.baseUrl,
      token,
      settings: { commandPaletteEnabled: true, keyboardShortcutsV2Enabled: true },
    });
    await registerMachineIdentity({
      baseUrl: server.baseUrl, token, machineId: 'oh56-mac',
      metadata: encodePlainMachineStoredContent({ host: 'oh56-mac', displayName: 'OH56 Mac', platform: 'darwin', homeDir: '/work' }),
      dataEncryptionKey: MACHINE_PLAIN_DATA_KEY_MARKER,
    });
    targetSessionId = await createPlainSession({
      baseUrl: server.baseUrl, token, title: 'Nebula archive research', machineId: 'oh56-mac', rootPath: '/work/older', tagPrefix: 'oh56-old',
    });
    for (let index = 0; index < 52; index += 1) {
      await createPlainSession({
        baseUrl: server.baseUrl, token, title: `Fresh fixture ${index}`, machineId: 'oh56-mac', rootPath: `/work/fresh-${index}`, tagPrefix: 'oh56-fresh',
      });
    }
    newerSessionId = await createPlainSession({
      baseUrl: server.baseUrl, token, title: 'Nebula archive research', machineId: 'oh56-mac', rootPath: '/work/newer', tagPrefix: 'oh56-similar',
    });
    ui = await startUiWeb({
      testDir: suiteDir,
      env: {
        ...process.env,
        EXPO_PUBLIC_DEBUG: '1',
        EXPO_PUBLIC_HAPPY_SERVER_URL: proxy.baseUrl,
        EXPO_PUBLIC_HAPPY_STORAGE_SCOPE: `e2e-oh56-command-palette-${run.runId}`,
        HAPPIER_E2E_UI_WEB_MODE: 'export',
      },
    });
    uiBaseUrl = normalizeLoopbackBaseUrl(ui.baseUrl);
  });

  test.afterAll(async () => {
    test.setTimeout(120_000);
    await ui?.stop().catch(() => {});
    await stopProxy?.().catch(() => {});
    await server?.stop().catch(() => {});
  });

  test('finds an older title beyond the initial 50 and enters the correct scoped conversation', async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoDomContentLoadedWithRetries(page, `${uiBaseUrl}/?happier_hmr=0`, 180_000);
    await waitForInitialAppUi({ page, timeoutMs: 120_000 });
    await expect.poll(async () => {
      const settings = await readUiE2eScopedAccountSettings({ page });
      return settings.commandPaletteEnabled === true && settings.keyboardShortcutsV2Enabled === true;
    }, { timeout: 30_000 }).toBe(true);
    // The keyboard registry binds this command to Alt+K on web to avoid the browser's Mod+K shortcut.
    const shortcut = 'Alt+k';
    await page.keyboard.press(shortcut);
    const input = page.getByPlaceholder('Type a command or search...');
    await expect(input).toBeFocused();
    await input.fill('nEbUlA');
    await expect(page.getByTestId('command-palette:search-scope')).toBeVisible();
    await expect(page.getByText('/work/older', { exact: false })).toBeVisible({ timeout: 120_000 });
    await expect(page.getByText('/work/newer', { exact: false })).toBeVisible();
    await input.fill('no-matching-session-or-command');
    await expect(page.getByText('No commands found')).toBeVisible();
    await input.fill('Settings');
    await expect(page.getByText('Settings', { exact: true })).toBeVisible();
    await input.fill('nEbUlA');
    await expect(page.getByText('/work/older', { exact: false })).toBeVisible();
    await input.press('ArrowDown');
    await input.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/session/${targetSessionId}(?:[/?#]|$)`), { timeout: 120_000 });
    await page.keyboard.press(shortcut);
    await expect(page.getByPlaceholder('Type a command or search...')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByPlaceholder('Type a command or search...')).toHaveCount(0);

    await page.getByTestId(`session-list-item-${newerSessionId}`).click({ button: 'right' });
    await page.getByRole('button', { name: /Rename Session/ }).click();
    const renameInput = page.getByPlaceholder('Enter session name...');
    await expect(renameInput).toBeVisible();
    await renameInput.fill('Nebula renamed in browser');
    await page.getByText('Save', { exact: true }).click();
    await expect(page.getByTestId(`session-list-item-${newerSessionId}`)).toContainText('Nebula renamed in browser');

    await page.keyboard.press(shortcut);
    const renamedQuery = page.getByPlaceholder('Type a command or search...');
    await expect(renamedQuery).toBeFocused();
    await renamedQuery.fill('renamed in browser');
    await expect(page.getByRole('button', { name: /Nebula renamed in browser/ })).toBeVisible();
    await renamedQuery.fill('archive research');
    await expect(page.getByText('/work/newer', { exact: false })).toHaveCount(0);
    await expect(page.getByText('/work/older', { exact: false })).toBeVisible();
  });
});
