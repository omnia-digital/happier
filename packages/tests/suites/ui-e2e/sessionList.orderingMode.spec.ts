import { test, expect, type Page } from '@playwright/test';
import { encodePlainMachineStoredContent, MACHINE_PLAIN_DATA_KEY_MARKER } from '@happier-dev/protocol';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { patchPlainAccountSettingsV2, upsertPlainAccountSettingsV2 } from '../../src/testkit/accountSettings';
import { createTestAuthMtls } from '../../src/testkit/auth';
import { registerMachineIdentity } from '../../src/testkit/machineIdentity';
import { repoRootDir } from '../../src/testkit/paths';
import { startServerLight, type StartedServer } from '../../src/testkit/process/serverLight';
import { resolveUiWebBeforeAllTimeoutMs, startUiWeb, type StartedUiWeb } from '../../src/testkit/process/uiWeb';
import { createRunDirs } from '../../src/testkit/runDir';
import { startForwardedHeaderProxy } from '../../src/testkit/uiE2e/forwardedHeaderProxy';
import { gotoDomContentLoadedWithRetries, normalizeLoopbackBaseUrl } from '../../src/testkit/uiE2e/pageNavigation';
import { readUiE2eLocalSettings } from '../../src/testkit/uiE2e/localSettingsStorage';
import {
  createPlainSession,
  readSessionFolderDragSettings,
  readVisibleSessionRowOrder,
  resolveCanonicalServerIdForUi,
  sessionOrderKey,
} from '../../src/testkit/uiE2e/sessionFoldersDrag';
import {
  buildSessionOrganizationImportRequestFromFolderSettings,
  importSessionOrganization,
  setSessionOrganizationPin,
} from '../../src/testkit/uiE2e/sessionOrganization';
import { waitForInitialAppUi } from '../../src/testkit/uiE2e/waitForInitialAppUi';

const run = createRunDirs({ runLabel: 'ui-e2e-session-list-ordering-mode' });

const SEEDED_MACHINE_ID = 'seeded-session-list-ordering-machine';
const IDENTITY_HEADERS = {
  email: `session-list-ordering-${run.runId}@example.com`,
  issuer: 'happier-ui-e2e-session-list-ordering',
  fingerprint: `session-list-ordering-${run.runId}`,
} as const;

const SESSION_CREATE_TIMESTAMP_SEPARATION_MS = 35;
async function pauseForDistinctCreatedAt(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, SESSION_CREATE_TIMESTAMP_SEPARATION_MS));
}

async function selectOrderingMode(page: Page, mode: 'custom' | 'created' | 'updated'): Promise<void> {
  await page.getByTestId('session-list-ordering-menu-trigger').first().click();
  const option = page.getByTestId(`session-list-ordering-mode-${mode}`);
  await expect(option).toHaveCount(1, { timeout: 60_000 });
  await option.click();
}

async function waitForVisibleSessionOrder(page: Page, sessionIds: readonly string[]): Promise<string[]> {
  const expectedIds = new Set(sessionIds);
  await expect.poll(async () => {
    const visible = await readVisibleSessionRowOrder(page);
    return visible.filter((id) => expectedIds.has(id));
  }, { timeout: 120_000 }).toHaveLength(sessionIds.length);

  const visible = await readVisibleSessionRowOrder(page);
  return visible.filter((id) => expectedIds.has(id));
}

async function readFirstProjectGroupKey(page: Page): Promise<string> {
  const testId = await page.locator('[data-testid^="session-list-project-header:"]').first().getAttribute('data-testid');
  const prefix = 'session-list-project-header:';
  if (!testId?.startsWith(prefix)) throw new Error('missing session list project header testID');
  return testId.slice(prefix.length);
}

async function expectVisibleSessionOrder(page: Page, orderedSessionIds: readonly string[]): Promise<void> {
  const expectedIds = new Set(orderedSessionIds);
  await expect.poll(async () => {
    const visible = await readVisibleSessionRowOrder(page);
    return visible.filter((id) => expectedIds.has(id));
  }, { timeout: 120_000 }).toEqual([...orderedSessionIds]);
}

async function reloadAndWaitForImportedOrganizationProjection(params: Readonly<{
  page: Page;
  uiBaseUrl: string;
  projectGroupKey: string;
  orderedSessionIds: readonly string[];
}>): Promise<void> {
  const organizationResponse = params.page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/v2/session-organization')
      && response.request().method() === 'GET'
      && response.status() === 200;
  }, { timeout: 120_000 });

  await gotoDomContentLoadedWithRetries(params.page, `${params.uiBaseUrl}/?happier_hmr=0`, 120_000);
  const response = await organizationResponse;
  const body = await response.json() as {
    snapshot?: {
      version?: unknown;
      orderEntries?: Array<{
        scopeKind?: unknown;
        scopeKey?: unknown;
        itemKind?: unknown;
        itemKey?: unknown;
        sortKey?: unknown;
      }>;
    };
  };
  expect(body.snapshot?.version).toEqual(expect.any(Number));
  const importedOrder = (body.snapshot?.orderEntries ?? [])
    .filter((entry) => entry.scopeKind === 'group'
      && entry.scopeKey === params.projectGroupKey
      && entry.itemKind === 'session'
      && typeof entry.itemKey === 'string')
    .sort((left, right) => String(left.sortKey ?? '').localeCompare(String(right.sortKey ?? '')))
    .map((entry) => entry.itemKey as string)
    .filter((sessionId) => params.orderedSessionIds.includes(sessionId));
  expect(importedOrder).toEqual([...params.orderedSessionIds]);
  await expectVisibleSessionOrder(params.page, params.orderedSessionIds);
}

test.describe('ui e2e: session list ordering mode', () => {
  test.describe.configure({ mode: 'serial' });

  const suiteDir = run.testDir('session-list-ordering-mode-suite');
  const cliHomeDir = resolve(join(suiteDir, 'cli-home'));

  let server: StartedServer | null = null;
  let ui: StartedUiWeb | null = null;
  let uiBaseUrl: string | null = null;
  let proxyStop: (() => Promise<void>) | null = null;
  let token: string | null = null;
  let uiServerUrl: string | null = null;

  test.beforeAll(async () => {
    test.setTimeout(resolveUiWebBeforeAllTimeoutMs(process.env));
    await mkdir(cliHomeDir, { recursive: true });
    await writeFile(resolve(join(cliHomeDir, 'AGENTS.md')), '# UI e2e fixture\n', 'utf8');

    server = await startServerLight({
      testDir: suiteDir,
      dbProvider: 'sqlite',
      extraEnv: {
        HAPPIER_BUILD_FEATURES_DENY: 'sharing.contentKeys',
        HAPPIER_FEATURE_AUTH_LOGIN__KEY_CHALLENGE_ENABLED: '0',
        HAPPIER_FEATURE_SESSIONS_FOLDERS__ENABLED: '1',

        HAPPIER_FEATURE_E2EE__KEYLESS_ACCOUNTS_ENABLED: '1',
        HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY: 'optional',
        HAPPIER_FEATURE_ENCRYPTION__DEFAULT_ACCOUNT_MODE: 'plain',

        HAPPIER_FEATURE_AUTH_MTLS__ENABLED: '1',
        HAPPIER_FEATURE_AUTH_MTLS__MODE: 'forwarded',
        HAPPIER_FEATURE_AUTH_MTLS__TRUST_FORWARDED_HEADERS: '1',
        HAPPIER_FEATURE_AUTH_MTLS__AUTO_PROVISION: '1',
        HAPPIER_FEATURE_AUTH_MTLS__IDENTITY_SOURCE: 'san_email',
        HAPPIER_FEATURE_AUTH_MTLS__ALLOWED_EMAIL_DOMAINS: 'example.com',
        HAPPIER_FEATURE_AUTH_MTLS__ALLOWED_ISSUERS: IDENTITY_HEADERS.issuer,
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
        'x-happier-client-cert-email': IDENTITY_HEADERS.email,
        'x-happier-client-cert-issuer': IDENTITY_HEADERS.issuer,
        'x-happier-client-cert-sha256': IDENTITY_HEADERS.fingerprint,
      },
    });
    proxyStop = proxy.stop;
    uiServerUrl = proxy.baseUrl;

    const auth = await createTestAuthMtls(server.baseUrl, {
      email: IDENTITY_HEADERS.email,
      issuer: IDENTITY_HEADERS.issuer,
      fingerprint: IDENTITY_HEADERS.fingerprint,
    });
    token = auth.token;
    await upsertPlainAccountSettingsV2({
      baseUrl: server.baseUrl,
      token,
      settings: {
        experiments: true,
        featureToggles: { 'sessions.folders': true },
        sessionFolderViewModeV1: 'tree',
        sessionListActiveGroupingV1: 'project',
        sessionListInactiveGroupingV1: 'project',
        sessionListOrderingModeV1: 'custom',
      },
    });
    await registerMachineIdentity({
      baseUrl: server.baseUrl,
      token,
      machineId: SEEDED_MACHINE_ID,
      metadata: 'session-list-ordering-machine',
    });

    ui = await startUiWeb({
      testDir: suiteDir,
      env: {
        ...process.env,
        EXPO_PUBLIC_DEBUG: '1',
        EXPO_PUBLIC_HAPPY_SERVER_URL: proxy.baseUrl,
        EXPO_PUBLIC_HAPPY_STORAGE_SCOPE: `e2e-session-list-ordering-${run.runId}`,
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

  test('removes an empty date header when its last session is pinned and restores it when unpinned', async ({ page }) => {
    test.setTimeout(240_000);
    if (!server || !uiBaseUrl || !token) throw new Error('missing server/ui fixtures');

    await patchPlainAccountSettingsV2({
      baseUrl: server.baseUrl,
      token,
      settingsPatch: { sessionListInactiveGroupingV1: 'date' },
    });
    const sessionId = await createPlainSession({
      baseUrl: server.baseUrl,
      token,
      title: `last session in date ${run.runId}`,
      rootPath: repoRootDir(),
      machineId: SEEDED_MACHINE_ID,
      tagPrefix: 'session-list-date-visibility',
    });

    const dateHeaders = page.locator('[data-testid^="session-list-header:server:"][data-testid*="day:"]');
    const sessionRow = page.getByTestId(`session-list-item-${sessionId}`);
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoDomContentLoadedWithRetries(page, `${uiBaseUrl}/?happier_hmr=0`, 300_000);
    await waitForInitialAppUi({ page, timeoutMs: 180_000 });
    await expect(sessionRow).toHaveCount(1, { timeout: 120_000 });
    await expect(dateHeaders).toHaveCount(1);

    await setSessionOrganizationPin({
      baseUrl: server.baseUrl,
      token,
      sessionId,
      pinned: true,
    });
    await gotoDomContentLoadedWithRetries(page, `${uiBaseUrl}/?happier_hmr=0`, 180_000);
    await expect(page.getByTestId('session-list-header:pinned-v1')).toHaveCount(1, { timeout: 120_000 });
    await expect(sessionRow).toHaveCount(1);
    await expect(dateHeaders).toHaveCount(0);

    await setSessionOrganizationPin({
      baseUrl: server.baseUrl,
      token,
      sessionId,
      pinned: false,
    });
    await gotoDomContentLoadedWithRetries(page, `${uiBaseUrl}/?happier_hmr=0`, 180_000);
    await expect(dateHeaders).toHaveCount(1, { timeout: 120_000 });
    await expect(sessionRow).toHaveCount(1);
    await patchPlainAccountSettingsV2({
      baseUrl: server.baseUrl,
      token,
      settingsPatch: { sessionListInactiveGroupingV1: 'project' },
    });
  });

  test('switches updated and custom modes without mutating dormant custom order', async ({ page }) => {
    test.setTimeout(180_000);
    if (!server || !uiBaseUrl || !token || !uiServerUrl) throw new Error('missing server/ui fixtures');

    const rootPath = repoRootDir();
    const oldestSessionId = await createPlainSession({
      baseUrl: server.baseUrl,
      token,
      title: `ordering oldest ${run.runId}`,
      rootPath,
      machineId: SEEDED_MACHINE_ID,
      tagPrefix: 'session-list-ordering',
    });
    await pauseForDistinctCreatedAt();
    const middleSessionId = await createPlainSession({
      baseUrl: server.baseUrl,
      token,
      title: `ordering middle ${run.runId}`,
      rootPath,
      machineId: SEEDED_MACHINE_ID,
      tagPrefix: 'session-list-ordering',
    });
    await pauseForDistinctCreatedAt();
    const newestSessionId = await createPlainSession({
      baseUrl: server.baseUrl,
      token,
      title: `ordering newest ${run.runId}`,
      rootPath,
      machineId: SEEDED_MACHINE_ID,
      tagPrefix: 'session-list-ordering',
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoDomContentLoadedWithRetries(page, `${uiBaseUrl}/?happier_hmr=0`, 300_000);
    await waitForInitialAppUi({ page, timeoutMs: 180_000 });

    await expect(page.getByTestId(`session-list-item-${oldestSessionId}`)).toHaveCount(1, { timeout: 120_000 });
    await expect(page.getByTestId(`session-list-item-${middleSessionId}`)).toHaveCount(1, { timeout: 120_000 });
    await expect(page.getByTestId(`session-list-item-${newestSessionId}`)).toHaveCount(1, { timeout: 120_000 });

    await expect(page.locator('[data-testid^="session-list-project-header:"]').first()).toHaveCount(1, { timeout: 120_000 });

    const baselineDateOrder = await waitForVisibleSessionOrder(page, [
      oldestSessionId,
      middleSessionId,
      newestSessionId,
    ]);
    const movedSessionId = baselineDateOrder[baselineDateOrder.length - 1]!;
    const customOrder = [
      movedSessionId,
      ...baselineDateOrder.filter((sessionId) => sessionId !== movedSessionId),
    ];

    const projectGroupKey = await readFirstProjectGroupKey(page);
    const serverId = await resolveCanonicalServerIdForUi(uiServerUrl);
    const customOrderMap = {
      [projectGroupKey]: customOrder.map((sessionId) => sessionOrderKey(serverId, sessionId)),
    };
    await importSessionOrganization({
      baseUrl: server.baseUrl,
      token,
      request: buildSessionOrganizationImportRequestFromFolderSettings({
        serverId,
        sessionFoldersV1: { v: 1, folders: [] },
        sessionListGroupOrderV1: customOrderMap,
      }),
    });
    await reloadAndWaitForImportedOrganizationProjection({
      page,
      uiBaseUrl,
      projectGroupKey,
      orderedSessionIds: customOrder,
    });

    const organizationRouteParams = {
      baseUrl: server.baseUrl,
      token,
      serverId,
    };
    const customOrderSnapshot = (await readSessionFolderDragSettings(organizationRouteParams)).sessionListGroupOrderV1;
    expect(Object.values(customOrderSnapshot).some((keys) => Array.isArray(keys) && keys.length >= 2)).toBe(true);

    await selectOrderingMode(page, 'updated');
    await expectVisibleSessionOrder(page, baselineDateOrder);
    expect((await readSessionFolderDragSettings(organizationRouteParams)).sessionListGroupOrderV1).toEqual(customOrderSnapshot);

    await selectOrderingMode(page, 'custom');
    await expectVisibleSessionOrder(page, customOrder);
    expect((await readSessionFolderDragSettings(organizationRouteParams)).sessionListGroupOrderV1).toEqual(customOrderSnapshot);
  });

  test('keeps the agent logo before the chosen machine icon on pinned and ordinary cards when labels are hidden', async ({ page }) => {
    test.setTimeout(180_000);
    if (!server || !uiBaseUrl || !token || !uiServerUrl) throw new Error('missing server/ui fixtures');

    const machineId = `session-card-machine-${run.runId}`;
    const machineLabel = 'OH54 Studio';
    const registration = await registerMachineIdentity({
      baseUrl: server.baseUrl,
      token,
      machineId,
      metadata: encodePlainMachineStoredContent({
        host: machineLabel,
        platform: 'darwin',
        happyCliVersion: '0.2.16',
        happyHomeDir: cliHomeDir,
        homeDir: resolve(suiteDir),
      }),
      dataEncryptionKey: MACHINE_PLAIN_DATA_KEY_MARKER,
    });
    expect(registration.status).toBe(200);
    await patchPlainAccountSettingsV2({
      baseUrl: server.baseUrl,
      token,
      settingsPatch: { sessionListIdentityDisplay: 'agentLogo' },
    });

    const sessionParams = {
      baseUrl: server.baseUrl,
      token,
      rootPath: repoRootDir(),
      machineId,
      tagPrefix: 'session-card-identity',
    };
    const pinnedSessionId = await createPlainSession({ ...sessionParams, title: `card pinned ${run.runId}` });
    const ordinarySessionId = await createPlainSession({ ...sessionParams, title: `card ordinary ${run.runId}` });
    await importSessionOrganization({
      baseUrl: server.baseUrl,
      token,
      request: {
        pins: [{ sessionId: pinnedSessionId, sortKey: '00000001' }],
        folders: [],
        tags: [],
        tagAssignments: [],
        orderEntries: [],
        labels: [],
      },
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoDomContentLoadedWithRetries(page, `${uiBaseUrl}/?happier_hmr=0`, 300_000);
    await waitForInitialAppUi({ page, timeoutMs: 180_000 });
    await expect(page.getByTestId('session-list-header:pinned-v1')).toHaveCount(1, { timeout: 120_000 });

    async function expectCardIdentityOrder(sessionId: string): Promise<void> {
      const rightIdentity = page.getByTestId(`session-list-right-identity-${sessionId}`);
      const logo = rightIdentity.getByTestId(`session-list-agent-logo-${sessionId}`);
      const machine = rightIdentity.getByTestId(`session-list-machine-identity-${sessionId}`);
      await expect(page.getByTestId(`session-list-agent-logo-${sessionId}`)).toHaveCount(1);
      await expect(logo).toHaveCount(1);
      await expect(machine).toHaveCount(1);
      const logoBox = await logo.boundingBox();
      const machineBox = await machine.boundingBox();
      expect(logoBox && machineBox && logoBox.x < machineBox.x).toBe(true);
    }

    for (const sessionId of [pinnedSessionId, ordinarySessionId]) {
      await expect(page.getByTestId(`session-list-item-${sessionId}`)).toHaveCount(1, { timeout: 120_000 });
      await expectCardIdentityOrder(sessionId);
      await expect(page.getByTestId(`session-list-machine-identity-${sessionId}`)).toContainText(machineLabel);
    }
    const machineIdentity = page.getByTestId(`session-list-machine-identity-${ordinarySessionId}`);
    const defaultGlyph = await machineIdentity.locator('svg').first().evaluate((svg) => svg.innerHTML);

    await gotoDomContentLoadedWithRetries(page, `${uiBaseUrl}/machine/${machineId}?happier_hmr=0`, 180_000);
    await page.getByTestId('machine-display-icon').click();
    await page.getByTestId('dropdown-option-laptop').click();
    const iconPreferenceKey = JSON.stringify([await resolveCanonicalServerIdForUi(uiServerUrl), machineId]);
    await expect.poll(async () => {
      const settings = await readUiE2eLocalSettings({ page });
      return (settings.machineDisplayIconByMachineV1 as Record<string, unknown> | undefined)?.[iconPreferenceKey];
    }).toBe('laptop');

    await gotoDomContentLoadedWithRetries(page, `${uiBaseUrl}/settings/session?happier_hmr=0`, 180_000);
    const labelToggle = page.getByTestId('settings-session-machineLabel-toggle');
    await expect(labelToggle).toHaveAttribute('aria-checked', 'true');
    await page.getByTestId('settings-session-machineLabel-item').click();
    await expect.poll(async () => (await readUiE2eLocalSettings({ page })).sessionListShowMachineLabel).toBe(false);

    await gotoDomContentLoadedWithRetries(page, `${uiBaseUrl}/?happier_hmr=0`, 180_000);
    for (const sessionId of [pinnedSessionId, ordinarySessionId]) {
      await expectCardIdentityOrder(sessionId);
      const identity = page.getByTestId(`session-list-machine-identity-${sessionId}`);
      await expect(identity).toHaveAttribute('aria-label', machineLabel);
      await expect(identity).not.toContainText(machineLabel);
    }
    const chosenGlyph = await machineIdentity.locator('svg').first().evaluate((svg) => svg.innerHTML);
    expect(chosenGlyph).not.toBe(defaultGlyph);
    await expect(page.getByTestId(`session-list-machine-identity-${pinnedSessionId}`).locator('svg').first())
      .toHaveJSProperty('innerHTML', chosenGlyph);
    await machineIdentity.focus();
    await expect(page.getByTestId(`session-list-machine-identity-${ordinarySessionId}-tooltip`)).toContainText(machineLabel);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForInitialAppUi({ page, timeoutMs: 180_000 });
    await expect(machineIdentity).not.toContainText(machineLabel);
    await expect(machineIdentity.locator('svg').first()).toHaveJSProperty('innerHTML', chosenGlyph);
    await expect(page.getByTestId(`session-list-machine-identity-${pinnedSessionId}`).locator('svg').first())
      .toHaveJSProperty('innerHTML', chosenGlyph);
    expect((await readUiE2eLocalSettings({ page })).sessionListShowMachineLabel).toBe(false);
  });

  test('opens a blank Same Setup draft for the clicked row from plus, right-click, and three-dot', async ({ page }) => {
    test.setTimeout(180_000);
    if (!server || !uiBaseUrl || !token) throw new Error('missing server/ui fixtures');

    const machineId = `same-setup-machine-${run.runId}`;
    const rootPath = repoRootDir();
    const registration = await registerMachineIdentity({
      baseUrl: server.baseUrl,
      token,
      machineId,
      metadata: encodePlainMachineStoredContent({
        host: 'same-setup.local',
        platform: 'darwin',
        happyCliVersion: '0.2.16',
        happyHomeDir: cliHomeDir,
        homeDir: resolve(suiteDir),
      }),
      dataEncryptionKey: MACHINE_PLAIN_DATA_KEY_MARKER,
    });
    expect(registration.status).toBe(200);
    const sessionParams = { baseUrl: server.baseUrl, token, rootPath, machineId, tagPrefix: 'same-setup' };
    const selectedSessionId = await createPlainSession({ ...sessionParams, title: `selected ${run.runId}` });
    const clickedSessionId = await createPlainSession({ ...sessionParams, title: `clicked ${run.runId}` });
    const mutatingSessionRequests: string[] = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (/\/v[12]\/sessions(?:\/|$)/.test(url.pathname) && request.method() !== 'GET') {
        mutatingSessionRequests.push(`${request.method()} ${url.pathname}`);
      }
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoDomContentLoadedWithRetries(page, `${uiBaseUrl}/?happier_hmr=0`, 300_000);
    await waitForInitialAppUi({ page, timeoutMs: 180_000 });
    const selectedRow = page.getByTestId(`session-list-item-${selectedSessionId}`);
    const clickedRow = page.getByTestId(`session-list-item-${clickedSessionId}`);
    await expect(selectedRow).toHaveCount(1, { timeout: 120_000 });
    await expect(clickedRow).toHaveCount(1, { timeout: 120_000 });
    await selectedRow.click();
    await page.waitForURL((url) => url.pathname.endsWith(`/session/${selectedSessionId}`));
    await page.mouse.move(1000, 500);

    async function expectBlankDraftAndCancel(): Promise<void> {
      await page.waitForURL((url) => url.pathname.endsWith('/new'), { timeout: 60_000 });
      const route = new URL(page.url());
      expect(route.searchParams.get('machineId')).toBe(machineId);
      expect(route.searchParams.get('directory')).toBe(rootPath);
      expect(route.searchParams.get('dataId')).toEqual(expect.any(String));
      await expect(page.getByTestId('new-session-composer-input')).toHaveValue('', { timeout: 60_000 });
      await page.keyboard.press('Escape');
      await page.waitForURL((url) => !url.pathname.endsWith('/new'), { timeout: 60_000 });
      await expect(clickedRow).toHaveCount(1, { timeout: 60_000 });
      expect(mutatingSessionRequests).toEqual([]);
      await page.mouse.move(1000, 500);
    }

    await clickedRow.hover();
    await clickedRow.getByTestId('session-item-same-setup-action').click();
    await expectBlankDraftAndCancel();

    await clickedRow.click({ button: 'right' });
    await page.getByTestId('dropdown-option-session_sameSetup').click();
    await expectBlankDraftAndCancel();

    await clickedRow.hover();
    await clickedRow.getByTestId('session-item-more-menu').click();
    await page.getByTestId('dropdown-option-session_sameSetup').click();
    await expectBlankDraftAndCancel();
  });
});
