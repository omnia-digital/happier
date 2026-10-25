import { test, expect, type Page } from '@playwright/test';
import { encodePlainMachineStoredContent, MACHINE_PLAIN_DATA_KEY_MARKER } from '@happier-dev/protocol';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { upsertPlainAccountSettingsV2 } from '../../src/testkit/accountSettings';
import { createTestAuthMtls } from '../../src/testkit/auth';
import { registerMachineIdentity } from '../../src/testkit/machineIdentity';
import { startServerLight, type StartedServer } from '../../src/testkit/process/serverLight';
import { resolveUiWebBeforeAllTimeoutMs, startUiWeb, type StartedUiWeb } from '../../src/testkit/process/uiWeb';
import { createRunDirs } from '../../src/testkit/runDir';
import { createMachineScopedSocketCollector, type SocketCollector } from '../../src/testkit/socketClient';
import { startForwardedHeaderProxy } from '../../src/testkit/uiE2e/forwardedHeaderProxy';
import { gotoDomContentLoadedWithRetries, normalizeLoopbackBaseUrl } from '../../src/testkit/uiE2e/pageNavigation';
import { readUiE2eLocalSettings } from '../../src/testkit/uiE2e/localSettingsStorage';
import { createPlainSession, dragSessionToTarget, readVisibleSessionRowOrder, readSessionFolderDragSettings, resolveCanonicalServerIdForUi } from '../../src/testkit/uiE2e/sessionFoldersDrag';
import { waitForInitialAppUi } from '../../src/testkit/uiE2e/waitForInitialAppUi';
import { appendBrowserDiagnostics, collectBrowserDiagnostics } from '../../src/testkit/uiE2e/browserDiagnostics';

const run = createRunDirs({ runLabel: 'ui-e2e-session-list-repository' });
const MACHINE_IDS = ['repository-machine-one', 'repository-machine-two'] as const;
const requests: Array<readonly [string, string]> = [];
const sockets: SocketCollector[] = [];
const IDENTITY_HEADERS = {
  email: `repository-${run.runId}@example.com`, issuer: 'happier-ui-e2e-repository', fingerprint: `repository-${run.runId}`,
} as const;
async function selectViewMenu(page: Page, id: string) {
  await page.getByTestId('session-list-ordering-menu-trigger').first().click();
  await page.getByTestId(id).click();
}
async function openRepositoryAssociationChoices(page: Page, headerTitle: string, checkoutPath: string): Promise<string> {
  const header = page.locator('[data-testid^="session-list-project-header:"]').filter({ hasText: headerTitle });
  await expect(header).toHaveCount(1);
  const headerId = await header.getAttribute('data-testid');
  if (!headerId) throw new Error('Missing repository header identity');
  await header.hover();
  await page.getByTestId(headerId.replace('session-list-project-header:', 'session-workspace-menu-trigger:')).click();
  await page.getByTestId('dropdown-option-repository-associate').click();
  const checkout = page.getByTestId(/^dropdown-option-repository-associate_\d+$/).filter({ hasText: checkoutPath });
  await expect(checkout).toHaveCount(1);
  const checkoutId = await checkout.getAttribute('data-testid');
  if (!checkoutId) throw new Error('Missing checkout action identity');
  await checkout.click();
  return checkoutId;
}
test.describe('ui e2e: session list Repository view', () => {
  test.describe.configure({ mode: 'serial' });

  const suiteDir = run.testDir('session-list-repository-suite');
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
    for (const machineId of MACHINE_IDS) {
      await registerMachineIdentity({ baseUrl: server.baseUrl, token, machineId,
        metadata: encodePlainMachineStoredContent({ host: machineId, displayName: machineId, platform: 'darwin', homeDir: '/home' }),
        dataEncryptionKey: MACHINE_PLAIN_DATA_KEY_MARKER,
      });
      const socket = createMachineScopedSocketCollector(server.baseUrl, token, machineId);
      sockets.push(socket);
      socket.connect();
      await expect.poll(() => socket.isConnected(), { timeout: 20_000 }).toBe(true);
      socket.onRpcRequest<{ cwd: string }, unknown>(({ params }) => {
        requests.push([machineId, params.cwd]);
        const remote = params.cwd === '/fork/repo' ? 'https://example.com/fork/repo.git'
          : params.cwd === '/unknown/repo' ? 'git@local-alias:team/repo.git'
          : machineId === MACHINE_IDS[0] ? 'git@example.com:team/repo.git' : 'https://example.com/team/repo.git';
        return { success: true, snapshot: {
          projectKey: params.cwd, fetchedAt: Date.now(),
          repo: { isRepo: true, rootPath: params.cwd, remotes: [{ name: 'origin', fetchUrl: remote }] },
          branch: { head: 'main', upstream: null, ahead: 0, behind: 0, detached: false },
          entries: [], hasConflicts: false, stashCount: 0,
          totals: { includedFiles: 0, pendingFiles: 0, untrackedFiles: 0, includedAdded: 0, includedRemoved: 0, pendingAdded: 0, pendingRemoved: 0 },
        } };
      });
      await socket.rpcRegister(`${machineId}:${RPC_METHODS.SCM_STATUS_SNAPSHOT}`);
    }

    ui = await startUiWeb({
      testDir: suiteDir,
      env: {
        ...process.env,
        EXPO_PUBLIC_DEBUG: '1',
        EXPO_PUBLIC_HAPPY_SERVER_URL: proxy.baseUrl,
        EXPO_PUBLIC_HAPPY_STORAGE_SCOPE: `e2e-session-list-repository-${run.runId}`,
        HAPPIER_E2E_UI_WEB_MODE: 'export',
      },
    });

    uiBaseUrl = normalizeLoopbackBaseUrl(ui.baseUrl);
  });

  test.afterAll(async () => {
    test.setTimeout(120_000);
    for (const socket of sockets) socket.close();
    await ui?.stop().catch(() => {});
    await proxyStop?.().catch(() => {});
    await server?.stop().catch(() => {});
  });

  test('discovers explicitly, preserves cross-checkout drag order, and persists manual association/reset', async ({ page }) => {
    test.setTimeout(240_000);
    if (!server || !uiBaseUrl || !token || !uiServerUrl) throw new Error('missing fixtures');
    const fixtures = [
      ['A', MACHINE_IDS[0], '/projects/repo'], ['A2', MACHINE_IDS[0], '/projects/repo'],
      ['B', MACHINE_IDS[1], '/home/repo'], ['Fork', MACHINE_IDS[1], '/fork/repo'],
      ['Unknown', MACHINE_IDS[1], '/unknown/repo'],
    ] as const;
    const ids: Record<string, string> = {};
    for (const [title, machineId, rootPath] of fixtures) ids[title] = await createPlainSession({
      baseUrl: server.baseUrl, token, title, machineId, rootPath, tagPrefix: 'repository-view',
    });
    await page.setViewportSize({ width: 1440, height: 1100 });
    await gotoDomContentLoadedWithRetries(page, `${uiBaseUrl}/?happier_hmr=0`, 180_000);
    await waitForInitialAppUi({ page, timeoutMs: 120_000 });
    for (const id of Object.values(ids)) await expect(page.getByTestId(`session-list-item-${id}`)).toBeVisible();
    expect(requests).toEqual([]);
    await selectViewMenu(page, 'session-view-repository');
    await expect.poll(() => requests.length, { timeout: 60_000 }).toBe(4);
    expect(requests.filter(([machine, path]) => machine === MACHINE_IDS[0] && path === '/projects/repo')).toHaveLength(1);
    const headers = page.locator('[data-testid^="session-list-project-header:"]');
    await expect(headers).toHaveCount(3);
    await expect(headers.filter({ hasText: 'example.com/team/repo' })).toHaveCount(1);
    await expect(headers.filter({ hasText: 'example.com/fork/repo' })).toHaveCount(1);
    await expect(headers.filter({ hasText: '/unknown/repo' })).toHaveCount(1);
    const preferences = await readUiE2eLocalSettings({ page });
    expect(preferences.sessionListMachineViewV1).toBe('repository');
    expect(Object.keys(preferences.sessionRepositoryAssociationsV1 as object)).toHaveLength(4);

    const desired = [ids.A, ids.B, ids.A2];
    const visibleOrder = async () => (await readVisibleSessionRowOrder(page)).filter(id => desired.includes(id));
    let order = await visibleOrder();
    if (order[0] !== ids.A) {
      expect((await dragSessionToTarget(page, { sessionId: ids.A, targetTestId: `session-list-item-${order[0]}`, targetEdge: 'top' })).ok).toBe(true);
      await expect.poll(async () => (await visibleOrder())[0]).toBe(ids.A);
    }
    order = await visibleOrder();
    if (order[1] !== ids.B) expect((await dragSessionToTarget(page, {
      sessionId: ids.B, targetTestId: `session-list-item-${ids.A2}`, targetEdge: 'top',
    })).ok).toBe(true);
    await expect.poll(visibleOrder).toEqual(desired);
    const serverId = await resolveCanonicalServerIdForUi(uiServerUrl);
    await expect.poll(async () => {
      const saved = await readSessionFolderDragSettings({ baseUrl: server!.baseUrl, token: token!, serverId });
      return Object.entries(saved.sessionListGroupOrderV1).some(([key, values]) => key.startsWith('repository-v1:')
        && JSON.stringify(values.filter(value => desired.some(id => value === `${serverId}:${id}`))) === JSON.stringify(desired.map(id => `${serverId}:${id}`)));
    }).toBe(true);
    await selectViewMenu(page, 'session-view-original');
    await selectViewMenu(page, 'session-view-machine');
    await selectViewMenu(page, 'session-view-repository');
    await expect.poll(visibleOrder).toEqual(desired);
    // Await the explicit selection's discovery before testing the restore boundary.
    await page.getByTestId('session-list-ordering-menu-trigger').first().click();
    await expect(page.getByTestId('session-repository-refresh')).toBeEnabled();
    await page.keyboard.press('Escape');
    const beforeReload = requests.length;
    await gotoDomContentLoadedWithRetries(page, `${uiBaseUrl}/?happier_hmr=0`, 180_000);
    await expect.poll(visibleOrder, { timeout: 60_000 }).toEqual(desired);
    expect(requests.length).toBe(beforeReload);
    await expect(headers.filter({ hasText: 'example.com/fork/repo' })).toHaveCount(1);
    await selectViewMenu(page, 'session-repository-refresh');
    await expect.poll(() => requests.length, { timeout: 60_000 }).toBe(beforeReload + 4);
    await page.getByTestId('session-list-ordering-menu-trigger').first().click();
    await expect(page.getByTestId('session-repository-refresh')).toBeEnabled();
    await page.keyboard.press('Escape');
    const beforeAssociation = requests.length;
    const choicePrefix = await openRepositoryAssociationChoices(page, '/unknown/repo', '/unknown/repo');
    const encodedChoice = encodeURIComponent('example.com/team/repo').replace(/[^a-zA-Z0-9_-]/g, '_');
    await page.getByTestId(`${choicePrefix}_choice_${encodedChoice}`).click();
    await expect(headers).toHaveCount(2);
    await expect(headers.filter({ hasText: 'example.com/fork/repo' })).toHaveCount(1);
    const manualChoice = async () => {
      const local = await readUiE2eLocalSettings({ page });
      return Object.values(local.sessionRepositoryAssociationsV1 as Record<string, { rootPath: string; manual?: { identity: string } }>)
        .find(value => value.rootPath === '/unknown/repo')?.manual?.identity ?? null;
    };
    await expect.poll(manualChoice).toBe('example.com/team/repo');
    await gotoDomContentLoadedWithRetries(page, `${uiBaseUrl}/?happier_hmr=0`, 180_000);
    await expect(headers).toHaveCount(2);
    await expect.poll(manualChoice).toBe('example.com/team/repo');
    expect(requests.length).toBe(beforeAssociation);
    const resetPrefix = await openRepositoryAssociationChoices(page, 'example.com/team/repo', '/unknown/repo');
    await page.getByTestId(`${resetPrefix}_automatic`).click();
    await expect(headers).toHaveCount(3);
    await expect(headers.filter({ hasText: '/unknown/repo' })).toHaveCount(1);
    await expect.poll(manualChoice).toBeNull();
    await gotoDomContentLoadedWithRetries(page, `${uiBaseUrl}/?happier_hmr=0`, 180_000);
    await expect(headers).toHaveCount(3);
    await expect.poll(manualChoice).toBeNull();
    expect(requests.length).toBe(beforeAssociation);
  });

  test('automatically associates a new worktree session with its origin repository', async ({ page }) => {
    test.setTimeout(120_000);
    if (!server || !uiBaseUrl || !token) throw new Error('missing fixtures');
    const diagnostics = collectBrowserDiagnostics({ page });
    try {
      await page.setViewportSize({ width: 1440, height: 1100 });
      await gotoDomContentLoadedWithRetries(page, `${uiBaseUrl}/?happier_hmr=0`, 180_000);
      await waitForInitialAppUi({ page, timeoutMs: 120_000 });
      await selectViewMenu(page, 'session-view-repository');
      const headers = page.locator('[data-testid^="session-list-project-header:"]');
      await expect(headers.filter({ hasText: 'example.com/team/repo' })).toHaveCount(1);
      await page.getByTestId('session-list-ordering-menu-trigger').first().click();
      await expect(page.getByTestId('session-repository-refresh')).toBeEnabled();
      await page.keyboard.press('Escape');
      const headerCount = await headers.count();
      const worktreePath = '/projects/repo/.dev/worktree/new-session';
      const sessionId = await createPlainSession({
        baseUrl: server.baseUrl, token, title: 'New worktree', machineId: MACHINE_IDS[0],
        rootPath: worktreePath, tagPrefix: 'repository-view-arrival',
      });
      await expect(page.getByTestId(`session-list-item-${sessionId}`)).toBeVisible();
      await expect.poll(async () => {
        const local = await readUiE2eLocalSettings({ page });
        return Object.values(local.sessionRepositoryAssociationsV1 as Record<string, { rootPath: string; identity: string | null }>)
          .find(value => value.rootPath === worktreePath)?.identity;
      }).toBe('example.com/team/repo');
      expect(requests.filter(([machineId, path]) => machineId === MACHINE_IDS[0] && path === worktreePath)).toHaveLength(1);
      await expect(headers).toHaveCount(headerCount);
      await expect(headers.filter({ hasText: 'example.com/team/repo' })).toHaveCount(1);
      await expect(headers.filter({ hasText: worktreePath })).toHaveCount(0);
      await page.screenshot({ path: join(suiteDir, 'new-worktree-origin-repository.png') });
    } catch (error) {
      throw appendBrowserDiagnostics(error, diagnostics());
    }
  });
});
