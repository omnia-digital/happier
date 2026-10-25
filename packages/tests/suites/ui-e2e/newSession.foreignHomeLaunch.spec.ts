import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { createRunDirs } from '../../src/testkit/runDir';
import { startServerLight, type StartedServer } from '../../src/testkit/process/serverLight';
import { resolveUiWebBeforeAllTimeoutMs, startUiWeb, type StartedUiWeb } from '../../src/testkit/process/uiWeb';
import { startCliAuthLoginForTerminalConnect } from '../../src/testkit/uiE2e/cliTerminalConnect';
import { approveTerminalConnect } from '../../src/testkit/uiE2e/approveTerminalConnect';
import { acknowledgeTerminalConnectSuccessIfPresent } from '../../src/testkit/uiE2e/acknowledgeTerminalConnectSuccessIfPresent';
import { startTestDaemon } from '../../src/testkit/daemon/daemon';
import { waitForDaemonMachineIdFromCliSettings } from '../../src/testkit/uiE2e/daemonMachineId';
import { ensureAccountReadyForConnect } from '../../src/testkit/uiE2e/ensureAccountReadyForConnect';
import { enableEnhancedSessionWizard } from '../../src/testkit/uiE2e/enableEnhancedSessionWizard';
import { gotoDomContentLoadedWithRetries } from '../../src/testkit/uiE2e/pageNavigation';
import { fakeClaudeFixturePath, waitForFakeClaudeInvocation, waitForFakeClaudeUserText } from '../../src/testkit/fakeClaude';
import { createIsolatedCliTestEnv } from '../../src/testkit/process/cliTestEnv';
import { createTempPathBin, type TempPathBin } from '../../src/testkit/fs/tempPathBin';
import { installFakeSecurityCli } from '../../src/testkit/process/fakeSecurityCli';
import { parseRpcCallFrame } from '../../src/testkit/uiE2e/desktopSetup/relayMachineRpcTap';
import type { StartedDaemon } from '../../src/testkit/daemon/daemon';

const run = createRunDirs({ runLabel: 'ui-e2e' });

function serverIdFromUrl(serverUrl: string): string {
  const url = new URL(serverUrl);
  return `${url.hostname.toLowerCase()}${url.port ? `-${url.port}` : ''}`.replace(/[^a-z0-9._-]/g, '_');
}

function isolatedCliEnv(params: Readonly<{
  cliHomeDir: string;
  fakeClaudeLogPath: string;
  serverUrl: string;
  uiBaseUrl: string;
  securityBin: TempPathBin;
}>): NodeJS.ProcessEnv {
  return params.securityBin.extendEnv({
    ...createIsolatedCliTestEnv({ homeDir: params.cliHomeDir }),
    HAPPIER_SERVER_URL: params.serverUrl,
    HAPPIER_WEBAPP_URL: params.uiBaseUrl,
    HAPPIER_CLAUDE_CONFIG_DIR: resolve(join(params.cliHomeDir, 'claude')),
    CLAUDE_CONFIG_DIR: resolve(join(params.cliHomeDir, 'claude')),
    HAPPIER_CLAUDE_PATH: fakeClaudeFixturePath(),
    HAPPIER_E2E_FAKE_CLAUDE_LOG: params.fakeClaudeLogPath,
    HAPPIER_E2E_PROVIDER_USE_CLI_SOURCE_ENTRYPOINT: '1',
    HAPPIER_DISABLE_CAFFEINATE: '1',
    HAPPIER_VARIANT: 'dev',
  });
}

test.describe('ui e2e: New Session targets a foreign Home', () => {
  test.describe.configure({ mode: 'serial' });

  const suiteDir = run.testDir('new-session-foreign-home-launch-suite');
  const cliHomeADir = resolve(join(suiteDir, 'cli-home-a'));
  const cliHomeDir = resolve(join(suiteDir, 'cli-home-b'));
  const favoriteADir = resolve(join(suiteDir, 'favorite-a'));
  const browseDir = resolve(join(suiteDir, 'target-browse'));
  const fakeClaudeLogPath = resolve(join(suiteDir, 'fake-claude-b.jsonl'));

  let serverA: StartedServer | null = null;
  let serverB: StartedServer | null = null;
  let ui: StartedUiWeb | null = null;
  let daemonA: StartedDaemon | null = null;
  let daemonB: StartedDaemon | null = null;
  let securityBin: TempPathBin | null = null;

  test.beforeAll(async () => {
    const uiEnv = {
      ...process.env,
      EXPO_PUBLIC_DEBUG: '1',
      EXPO_PUBLIC_HAPPY_STORAGE_SCOPE: `e2e-oh64-foreign-${run.runId}`,
      HAPPIER_E2E_UI_WEB_MODE: 'export',
      HAPPIER_E2E_UI_WEB_EXPORT_NAMESPACE: `oh64-foreign-${run.runId}`,
      HAPPIER_E2E_PROVIDER_USE_CLI_SOURCE_ENTRYPOINT: '1',
      EXPO_PUBLIC_HAPPIER_SOCKET_FORCE_WEBSOCKET: '1',
    };
    test.setTimeout(resolveUiWebBeforeAllTimeoutMs(uiEnv));
    await mkdir(cliHomeADir, { recursive: true });
    await mkdir(cliHomeDir, { recursive: true });
    await mkdir(favoriteADir, { recursive: true });
    await mkdir(browseDir, { recursive: true });
    securityBin = await createTempPathBin({
      prefix: 'oh64-security-',
      baseDir: suiteDir,
      env: createIsolatedCliTestEnv({ homeDir: cliHomeDir }),
    });
    await installFakeSecurityCli(securityBin);
    serverA = await startServerLight({ testDir: resolve(join(suiteDir, 'server-a')), dbProvider: 'sqlite' });
    serverB = await startServerLight({ testDir: resolve(join(suiteDir, 'server-b')), dbProvider: 'sqlite' });
    ui = await startUiWeb({
      testDir: suiteDir,
      env: { ...uiEnv, EXPO_PUBLIC_HAPPY_SERVER_URL: serverA.baseUrl },
    });
  });

  test.afterAll(async () => {
    await daemonA?.stop().catch(() => {});
    await daemonB?.stop().catch(() => {});
    await ui?.stop().catch(() => {});
    await serverB?.stop().catch(() => {});
    await serverA?.stop().catch(() => {});
    await securityBin?.cleanup().catch(() => {});
  });

  test('routes B directory browse while viewing and initially targeting A', async ({ page }) => {
    test.setTimeout(360_000);
    if (!serverA || !serverB || !ui || !securityBin) throw new Error('Missing isolated E2E fixtures');
    const uiBaseUrl = ui.baseUrl;
    await page.setViewportSize({ width: 1440, height: 900 });
    const observedRpcCalls: Array<Readonly<{ host: string; method: string }>> = [];
    page.on('websocket', (socket) => {
      const host = new URL(socket.url()).host;
      socket.on('framesent', ({ payload }) => {
        const parsed = parseRpcCallFrame(typeof payload === 'string' ? payload : payload.toString('utf8'));
        if (parsed) observedRpcCalls.push({ host, method: parsed.method });
      });
    });

    await gotoDomContentLoadedWithRetries(page, uiBaseUrl, 180_000);
    await ensureAccountReadyForConnect({ page, timeoutMs: 120_000 });
    const serverAId = serverIdFromUrl(serverA.baseUrl);
    const daemonATestDir = resolve(join(suiteDir, 'daemon-a'));
    await mkdir(daemonATestDir, { recursive: true });
    const cliAEnv = isolatedCliEnv({
      cliHomeDir: cliHomeADir,
      fakeClaudeLogPath: resolve(join(suiteDir, 'fake-claude-a.jsonl')),
      serverUrl: serverA.baseUrl,
      uiBaseUrl,
      securityBin,
    });
    const cliALogin = await startCliAuthLoginForTerminalConnect({
      testDir: daemonATestDir,
      cliHomeDir: cliHomeADir,
      serverUrl: serverA.baseUrl,
      webappUrl: uiBaseUrl,
      env: cliAEnv,
    });
    try {
      await page.goto(cliALogin.connectUrl, { waitUntil: 'domcontentloaded' });
      await approveTerminalConnect({ page });
      await cliALogin.waitForSuccess();
      await acknowledgeTerminalConnectSuccessIfPresent(page);
    } finally {
      await cliALogin.stop().catch(() => {});
    }
    daemonA = await startTestDaemon({
      testDir: daemonATestDir,
      happyHomeDir: cliHomeADir,
      env: cliAEnv,
    });
    const machineAId = await waitForDaemonMachineIdFromCliSettings({ cliHomeDir: cliHomeADir });

    await gotoDomContentLoadedWithRetries(page, `${uiBaseUrl}/server`, 120_000);
    await page.getByTestId('server-settings-add-server-toggle').click();
    await page.getByTestId('server-settings-add-url-input').fill(serverB.baseUrl);
    await page.getByTestId('server-settings-add-name-input').fill('OH64 B');
    await page.getByTestId('server-settings-add-confirm').click();
    await expect(page.getByTestId('web-modal-confirm')).toBeVisible();
    await page.getByTestId('web-modal-confirm').click();

    await gotoDomContentLoadedWithRetries(page, uiBaseUrl, 120_000);
    await ensureAccountReadyForConnect({ page, timeoutMs: 120_000 });
    const daemonTestDir = resolve(join(suiteDir, 'daemon-b'));
    await mkdir(daemonTestDir, { recursive: true });
    const cliEnv = isolatedCliEnv({ cliHomeDir, fakeClaudeLogPath, serverUrl: serverB.baseUrl, uiBaseUrl, securityBin });
    const cliLogin = await startCliAuthLoginForTerminalConnect({
      testDir: daemonTestDir,
      cliHomeDir,
      serverUrl: serverB.baseUrl,
      webappUrl: uiBaseUrl,
      env: cliEnv,
    });
    try {
      await page.goto(cliLogin.connectUrl, { waitUntil: 'domcontentloaded' });
      await approveTerminalConnect({ page });
      await cliLogin.waitForSuccess();
      await acknowledgeTerminalConnectSuccessIfPresent(page);
    } finally {
      await cliLogin.stop().catch(() => {});
    }
    daemonB = await startTestDaemon({
      testDir: daemonTestDir,
      happyHomeDir: cliHomeDir,
      env: cliEnv,
    });
    const machineBId = await waitForDaemonMachineIdFromCliSettings({ cliHomeDir });
    expect(machineBId).not.toBe(machineAId);

    await gotoDomContentLoadedWithRetries(page, `${uiBaseUrl}/server`, 120_000);
    await page.getByTestId(`saved-server-switch-${serverAId}`).click();
    await gotoDomContentLoadedWithRetries(page, `${uiBaseUrl}/server`, 120_000);
    await page.getByText('Add Relay Group', { exact: true }).click();
    const groupName = page.getByPlaceholder('My Relay Group');
    await groupName.fill('OH64 A+B');
    await groupName.locator('..').getByText('OH64 B', { exact: true }).click();
    await groupName.locator('..').getByRole('button', { name: 'Save group' }).click();

    await enableEnhancedSessionWizard({ page, baseUrl: uiBaseUrl });
    await gotoDomContentLoadedWithRetries(page, `${uiBaseUrl}/new?spawnServerId=${encodeURIComponent(serverAId)}`, 120_000);
    await expect(page.getByText(new URL(serverA.baseUrl).host, { exact: true }).first()).toBeVisible();
    await expect(page.getByTestId('agent-input-root').getByText(new URL(serverA.baseUrl).host, { exact: true })).toBeVisible();
    await page.getByTestId('agent-input-path-chip').click();
    const pathPopover = page.getByTestId('agent-input-content-popover');
    await pathPopover.getByTestId('path-selection-list:header:input').fill(`${suiteDir}/`);
    const aDirectoryRow = pathPopover.getByTestId(`path-selection-list:path-root:option:in-folder:${favoriteADir}`);
    await expect(aDirectoryRow).toBeVisible();
    await aDirectoryRow.getByRole('button', { name: 'Add to favorites' }).click();
    await expect(pathPopover.getByTestId(`path-selection-list:path-root:option:favorite:${favoriteADir}`)).toBeVisible();
    await pathPopover.getByTestId('path-selection-list:header:input').press('Escape');
    await expect(pathPopover).toHaveCount(0);
    await page.getByTestId('agent-input-machine-chip').click();
    // The active A snapshot must be present; otherwise the active-only selector can
    // temporarily fall back to B's last canonical machine and mask this defect.
    const machinePopover = page.getByTestId('agent-input-content-popover');
    const machineAOption = machinePopover.locator(
      `[data-testid="new-session-machine-option:${machineAId}"], [data-testid="new-session-machine:${machineAId}"]`,
    );
    await expect(machineAOption).toBeVisible({ timeout: 120_000 });
    const machineBOption = machinePopover.locator(
      `[data-testid="new-session-machine-option:${machineBId}"], [data-testid="new-session-machine:${machineBId}"]`,
    );
    await expect(machineBOption).toBeVisible({ timeout: 120_000 });
    await machineBOption.click();
    await expect.poll(() => new URL(page.url()).searchParams.get('spawnServerId')).not.toBe(serverAId);
    const selectedServerBId = new URL(page.url()).searchParams.get('spawnServerId');
    expect(selectedServerBId).toBeTruthy();
    expect(selectedServerBId).not.toBe(serverAId);

    await page.getByTestId('agent-input-path-chip').click();
    await expect(pathPopover.getByTestId('path-selection-list:open-tree-browser')).toBeVisible();
    await expect(pathPopover.getByTestId(`path-selection-list:path-root:option:favorite:${favoriteADir}`)).toHaveCount(0);
    const browseCallStart = observedRpcCalls.length;
    await pathPopover.getByTestId('path-selection-list:header:input').fill(`${suiteDir}/`);
    const bDirectoryRow = pathPopover.getByTestId(`path-selection-list:path-root:option:in-folder:${browseDir}`);
    await expect(bDirectoryRow).toBeVisible();
    await expect.poll(() => observedRpcCalls.slice(browseCallStart).filter((call) => (
      call.method.endsWith(':daemon.filesystem.listDirectory')
    ))).toContainEqual({
      host: new URL(serverB.baseUrl).host,
      method: `${machineBId}:daemon.filesystem.listDirectory`,
    });
    await bDirectoryRow.getByRole('button', { name: 'Add to favorites' }).click();
    await expect(pathPopover.getByTestId(`path-selection-list:path-root:option:favorite:${browseDir}`)).toBeVisible();
    await pathPopover.getByTestId('path-selection-list:header:input').press('Escape');
    await expect(pathPopover).toHaveCount(0);

    await page.reload();
    await page.getByTestId('agent-input-path-chip').click();
    await expect(pathPopover.getByTestId(`path-selection-list:path-root:option:favorite:${browseDir}`)).toBeVisible();
    await expect(pathPopover.getByTestId(`path-selection-list:path-root:option:favorite:${favoriteADir}`)).toHaveCount(0);
    await pathPopover.getByTestId('path-selection-list:header:input').press('Escape');
    await expect(pathPopover).toHaveCount(0);

    await page.getByTestId('agent-input-machine-chip').click();
    await expect(machineAOption).toBeVisible();
    await machineAOption.click();
    await page.getByTestId('agent-input-path-chip').click();
    await expect(pathPopover.getByTestId(`path-selection-list:path-root:option:favorite:${favoriteADir}`)).toBeVisible();
    await expect(pathPopover.getByTestId(`path-selection-list:path-root:option:favorite:${browseDir}`)).toHaveCount(0);
    await pathPopover.getByTestId('path-selection-list:header:input').press('Escape');
    await expect(pathPopover).toHaveCount(0);

    await page.getByTestId('agent-input-machine-chip').click();
    await expect(machineBOption).toBeVisible();
    await machineBOption.click();
    await page.getByTestId('agent-input-path-chip').click();
    const favoriteBRow = pathPopover.getByTestId(`path-selection-list:path-root:option:favorite:${browseDir}`);
    await expect(favoriteBRow).toBeVisible();
    await favoriteBRow.click();
    await expect(pathPopover).toHaveCount(0);
    await expect(page.getByTestId('agent-input-path-chip')).toContainText('target-browse');
    await expect(page.getByText(new URL(serverA.baseUrl).host, { exact: true }).first()).toBeVisible();

    const launchCallStart = observedRpcCalls.length;
    const prompt = `oh64 foreign target ${run.runId}`;
    await page.getByTestId('new-session-composer-input').fill(prompt);
    await expect(page.getByTestId('new-session-composer-send')).toBeEnabled();
    await page.getByTestId('new-session-composer-send').click();
    await expect.poll(() => observedRpcCalls.slice(launchCallStart).filter((call) => (
      call.method.endsWith(':spawn-happy-session.provider-safe.v1')
    )), { timeout: 120_000 }).toContainEqual({
      host: new URL(serverB.baseUrl).host,
      method: `${machineBId}:spawn-happy-session.provider-safe.v1`,
    });
    const invocation = await waitForFakeClaudeInvocation(fakeClaudeLogPath, (event) => (
      event.mode === 'sdk' && event.cwd === browseDir
    ), { timeoutMs: 120_000 });
    expect(invocation.mode).toBe('sdk');
    expect(invocation.cwd).toBe(browseDir);
    await waitForFakeClaudeUserText(fakeClaudeLogPath, (text) => text.includes(prompt), { timeoutMs: 120_000 });
    await page.waitForURL((url) => url.pathname.startsWith('/session/') && url.searchParams.get('serverId') === selectedServerBId, { timeout: 180_000 });
    await expect(page.getByTestId('session-composer-input')).toBeVisible({ timeout: 120_000 });
    await expect(page.locator('[data-testid^="transcript-message-"]:not([data-testid*=":"])')
      .filter({ hasText: 'FAKE_CLAUDE_OK_1' }).first()).toBeVisible({ timeout: 180_000 });
  });
});
