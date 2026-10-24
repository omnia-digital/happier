import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

import { createRunDirs } from '../../src/testkit/runDir';
import { repoRootDir } from '../../src/testkit/paths';
import { createTestAuthMtls } from '../../src/testkit/auth';
import { registerMachineIdentity } from '../../src/testkit/machineIdentity';
import { upsertPlainAccountSettingsV2 } from '../../src/testkit/accountSettings';
import { startServerLight, type StartedServer } from '../../src/testkit/process/serverLight';
import { resolveUiWebBeforeAllTimeoutMs, startUiWeb, type StartedUiWeb } from '../../src/testkit/process/uiWeb';
import { gotoDomContentLoadedWithRetries, normalizeLoopbackBaseUrl } from '../../src/testkit/uiE2e/pageNavigation';
import { startForwardedHeaderProxy } from '../../src/testkit/uiE2e/forwardedHeaderProxy';
import { waitForInitialAppUi } from '../../src/testkit/uiE2e/waitForInitialAppUi';
import { createPlainSession } from '../../src/testkit/uiE2e/sessionFoldersDrag';

const run = createRunDirs({ runLabel: 'ui-e2e-oh66-sidebar-preferences' });
const MACHINE_ID = 'oh66-sidebar-preferences-machine';
const IDENTITY = {
  email: `oh66-sidebar-${run.runId}@example.com`,
  issuer: 'happier-ui-e2e-oh66-sidebar-preferences',
  fingerprint: `oh66-sidebar-${run.runId}`,
} as const;
const SESSION_TITLE = `OH66 preference row ${run.runId}`;

type SidebarMetrics = Readonly<{
  rowHeight: number;
  rowWidth: number;
  titleFontSize: number;
  supportingFontSize: number;
  machineFontSize: number | null;
  groupHeaderFontSizes: readonly number[];
  sidebarHeaderFontSize: number;
  sidebarHeaderColor: string;
  titleFits: boolean;
}>;

async function readSidebarMetrics(page: Page, sessionId: string): Promise<SidebarMetrics> {
  return page.evaluate(({ sessionId, title }) => {
    const row = document.querySelector<HTMLElement>(`[data-testid="session-list-item-${sessionId}"]`);
    const sidebarHeader = document.querySelector<HTMLElement>('[data-testid="desktop-sidebar-title-text"]');
    if (!row || !sidebarHeader) throw new Error('sidebar session row or header is missing');
    const titleNode = Array.from(row.querySelectorAll<HTMLElement>('*'))
      .find((node) => node.children.length === 0 && node.textContent?.trim() === title);
    if (!titleNode) throw new Error('session title is missing from the sidebar row');
    const machine = document.querySelector<HTMLElement>(`[data-testid="session-list-machine-identity-${sessionId}"]`);
    const groupHeaders = Array.from(document.querySelectorAll<HTMLElement>('[data-testid^="session-list-header:"]'));
    const leafTextNodes = Array.from(row.querySelectorAll<HTMLElement>('*'))
      .filter((node) => node.children.length === 0 && Boolean(node.textContent?.trim()))
      .filter((node) => node !== titleNode && !machine?.contains(node));
    const fontSizeForText = (root: HTMLElement | null): number | null => {
      if (!root) return null;
      const leaves = Array.from(root.querySelectorAll<HTMLElement>('*'))
        .filter((node) => node.children.length === 0 && Boolean(node.textContent?.trim()));
      const candidates = leaves.length > 0 ? leaves : [root];
      return Math.max(...candidates.map((node) => Number.parseFloat(getComputedStyle(node).fontSize)));
    };
    const rowBounds = row.getBoundingClientRect();
    const titleBounds = titleNode.getBoundingClientRect();
    const titleStyle = getComputedStyle(titleNode);
    return {
      rowHeight: rowBounds.height,
      rowWidth: rowBounds.width,
      titleFontSize: Number.parseFloat(titleStyle.fontSize),
      supportingFontSize: Math.max(...leafTextNodes.map((node) => Number.parseFloat(getComputedStyle(node).fontSize))),
      machineFontSize: fontSizeForText(machine),
      groupHeaderFontSizes: groupHeaders.map((header) => fontSizeForText(header)).filter((size): size is number => size !== null),
      sidebarHeaderFontSize: Number.parseFloat(getComputedStyle(sidebarHeader).fontSize),
      sidebarHeaderColor: getComputedStyle(sidebarHeader).color,
      titleFits: titleBounds.left >= rowBounds.left && titleBounds.right <= rowBounds.right,
    };
  }, { sessionId, title: SESSION_TITLE });
}

async function selectMenuOption(page: Page, trigger: string, option: string): Promise<void> {
  await page.getByTestId(trigger).click();
  const optionRow = page.getByTestId(`dropdown-option-${option}`);
  await expect(optionRow).toBeVisible({ timeout: 30_000 });
  await optionRow.click();
}

async function openTextSetting(page: Page, label: string, option: string): Promise<void> {
  await page.getByText(label, { exact: true }).click();
  const optionRow = page.getByTestId(`dropdown-option-${option}`);
  await expect(optionRow).toBeVisible({ timeout: 30_000 });
  await optionRow.click();
}

test.describe('ui e2e: OH66 sidebar text size and item density preferences', () => {
  test.describe.configure({ mode: 'serial' });
  const suiteDir = run.testDir('sidebar-preferences-suite');
  let server: StartedServer | null = null;
  let ui: StartedUiWeb | null = null;
  let uiBaseUrl: string | null = null;
  let proxyStop: (() => Promise<void>) | null = null;
  let token: string | null = null;
  let sessionId: string | null = null;

  test.beforeAll(async () => {
    test.setTimeout(resolveUiWebBeforeAllTimeoutMs(process.env));
    await mkdir(suiteDir, { recursive: true });
    server = await startServerLight({
      testDir: suiteDir,
      dbProvider: 'sqlite',
      extraEnv: {
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
        HAPPIER_FEATURE_AUTH_MTLS__ALLOWED_ISSUERS: IDENTITY.issuer,
        HAPPIER_FEATURE_AUTH_MTLS__FORWARDED_EMAIL_HEADER: 'x-happier-client-cert-email',
        HAPPIER_FEATURE_AUTH_MTLS__FORWARDED_ISSUER_HEADER: 'x-happier-client-cert-issuer',
        HAPPIER_FEATURE_AUTH_MTLS__FORWARDED_FINGERPRINT_HEADER: 'x-happier-client-cert-sha256',
        HAPPIER_FEATURE_AUTH_UI__AUTO_REDIRECT_ENABLED: '1',
        HAPPIER_FEATURE_AUTH_UI__AUTO_REDIRECT_PROVIDER_ID: 'mtls',
      },
    });
    const auth = await createTestAuthMtls(server.baseUrl, {
      email: IDENTITY.email,
      issuer: IDENTITY.issuer,
      fingerprint: IDENTITY.fingerprint,
    });
    const proxy = await startForwardedHeaderProxy({
      targetBaseUrl: server.baseUrl,
      identityHeaders: {
        'x-happier-client-cert-email': IDENTITY.email,
        'x-happier-client-cert-issuer': IDENTITY.issuer,
        'x-happier-client-cert-sha256': IDENTITY.fingerprint,
      },
    });
    proxyStop = proxy.stop;
    token = auth.token;
    await upsertPlainAccountSettingsV2({
      baseUrl: server.baseUrl,
      token,
      settings: {
        experiments: true,
        sessionListActiveGroupingV1: 'date',
        sessionListOrderingModeV1: 'custom',
      },
    });
    await registerMachineIdentity({
      baseUrl: server.baseUrl,
      token,
      machineId: MACHINE_ID,
      metadata: 'OH66 Sidebar Machine',
    });
    sessionId = await createPlainSession({
      baseUrl: server.baseUrl,
      token,
      title: SESSION_TITLE,
      rootPath: repoRootDir(),
      machineId: MACHINE_ID,
      tagPrefix: 'oh66-sidebar',
    });
    ui = await startUiWeb({
      testDir: suiteDir,
      env: {
        ...process.env,
        EXPO_PUBLIC_DEBUG: '1',
        EXPO_PUBLIC_HAPPY_SERVER_URL: proxy.baseUrl,
        EXPO_PUBLIC_HAPPY_STORAGE_SCOPE: `e2e-oh66-sidebar-${run.runId}`,
        HAPPIER_E2E_UI_WEB_MODE: 'export',
      },
    });
    uiBaseUrl = normalizeLoopbackBaseUrl(ui.baseUrl);
  });

  test.afterAll(async () => {
    test.setTimeout(120_000);
    await ui?.stop().catch(() => {});
    await proxyStop?.().catch(() => {});
    await server?.stop().catch(() => {});
  });

  test('updates real sidebar typography and row spacing through Preferences and persists after reload', async ({ page }) => {
    test.setTimeout(240_000);
    if (!uiBaseUrl || !sessionId || !token) throw new Error('missing sidebar preference fixtures');

    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoDomContentLoadedWithRetries(page, `${uiBaseUrl}/?happier_hmr=0`, 300_000);
    await waitForInitialAppUi({ page, timeoutMs: 180_000 });
    const row = page.getByTestId(`session-list-item-${sessionId}`);
    await expect(row).toHaveCount(1, { timeout: 120_000 });
    await expect(page.getByTestId(`session-list-machine-identity-${sessionId}`)).toHaveCount(1);
    expect(await page.locator('[data-testid^="session-list-header:"]').count()).toBeGreaterThan(0);

    await gotoDomContentLoadedWithRetries(page, `${uiBaseUrl}/settings/appearance?happier_hmr=0`, 180_000);
    await waitForInitialAppUi({ page, timeoutMs: 120_000 });
    await selectMenuOption(page, 'settings-theme-selector-trigger', 'light');
    await gotoDomContentLoadedWithRetries(page, `${uiBaseUrl}/?happier_hmr=0`, 180_000);
    await expect(row).toHaveCount(1, { timeout: 120_000 });
    const baseline = await readSidebarMetrics(page, sessionId);

    await gotoDomContentLoadedWithRetries(page, `${uiBaseUrl}/settings/appearance?happier_hmr=0`, 180_000);
    await waitForInitialAppUi({ page, timeoutMs: 120_000 });
    await openTextSetting(page, 'Item Density', 'compact');
    await gotoDomContentLoadedWithRetries(page, `${uiBaseUrl}/?happier_hmr=0`, 180_000);
    await expect(row).toHaveCount(1, { timeout: 120_000 });
    const compact = await readSidebarMetrics(page, sessionId);
    expect(compact.rowHeight).toBeLessThan(baseline.rowHeight);

    await page.reload();
    await waitForInitialAppUi({ page, timeoutMs: 120_000 });
    const compactAfterReload = await readSidebarMetrics(page, sessionId);
    expect(compactAfterReload.rowHeight).toBe(compact.rowHeight);

    await gotoDomContentLoadedWithRetries(page, `${uiBaseUrl}/settings/appearance?happier_hmr=0`, 180_000);
    await openTextSetting(page, 'Text Size', 'xxlarge');
    await selectMenuOption(page, 'settings-theme-selector-trigger', 'dark');
    await gotoDomContentLoadedWithRetries(page, `${uiBaseUrl}/?happier_hmr=0`, 180_000);
    await expect(row).toHaveCount(1, { timeout: 120_000 });
    const largerDark = await readSidebarMetrics(page, sessionId);
    expect(largerDark.titleFontSize).toBeGreaterThan(baseline.titleFontSize);
    expect(largerDark.supportingFontSize).toBeGreaterThan(baseline.supportingFontSize);
    expect(largerDark.sidebarHeaderFontSize).toBeGreaterThan(baseline.sidebarHeaderFontSize);
    expect(largerDark.groupHeaderFontSizes).toHaveLength(baseline.groupHeaderFontSizes.length);
    for (const [index, fontSize] of largerDark.groupHeaderFontSizes.entries()) {
      expect(fontSize).toBeGreaterThan(baseline.groupHeaderFontSizes[index]!);
    }
    expect(largerDark.machineFontSize).toBeGreaterThan(baseline.machineFontSize ?? 0);
    expect(largerDark.rowHeight).toBeGreaterThan(compact.rowHeight);
    expect(largerDark.sidebarHeaderColor).not.toBe(baseline.sidebarHeaderColor);

    await page.reload();
    await waitForInitialAppUi({ page, timeoutMs: 120_000 });
    const persisted = await readSidebarMetrics(page, sessionId);
    expect(persisted.titleFontSize).toBe(largerDark.titleFontSize);
    expect(persisted.rowHeight).toBe(largerDark.rowHeight);
    const storedPreferences = await page.evaluate(() => {
      const raw = window.localStorage.getItem('mmkv.default\\local-settings');
      return raw ? JSON.parse(raw) as Record<string, unknown> : {};
    });
    expect(storedPreferences).toMatchObject({ uiFontScale: 1.3, uiItemDensity: 'compact', themePreference: 'dark' });

    await page.setViewportSize({ width: 720, height: 900 });
    const narrow = await readSidebarMetrics(page, sessionId);
    expect(narrow.titleFits).toBe(true);
    expect(narrow.rowWidth).toBeGreaterThan(0);
    await row.hover();
    const moreAction = page.getByTestId('session-item-more-menu');
    await expect(moreAction).toBeVisible();
    const actionBounds = await moreAction.boundingBox();
    const rowBounds = await row.boundingBox();
    expect(actionBounds && rowBounds).toBeTruthy();
    expect(actionBounds!.x + actionBounds!.width).toBeLessThanOrEqual(rowBounds!.x + rowBounds!.width);
    await row.click();
    const selectionRail = page.getByTestId(`session-item-current-indicator-${sessionId}`);
    await expect(selectionRail).toBeVisible();
    const railBounds = await selectionRail.boundingBox();
    const selectedRowBounds = await row.boundingBox();
    expect(railBounds && selectedRowBounds).toBeTruthy();
    expect(Math.abs(railBounds!.height - selectedRowBounds!.height)).toBeLessThanOrEqual(1);
  });
});
