import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { delimiter, dirname, join, resolve } from 'node:path';

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
import { fakeClaudeFixturePath } from '../../src/testkit/fakeClaude';
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
}>): NodeJS.ProcessEnv {
  // Pass only the test toolchain and disposable Home into the CLI process.
  // In particular, provider credentials and native provider homes are not inherited.
  const systemPath = process.platform === 'win32'
    ? [dirname(process.execPath), process.env.SystemRoot ? join(process.env.SystemRoot, 'System32') : '']
    : [dirname(process.execPath), '/usr/bin', '/bin'];
  const yarnName = process.platform === 'win32' ? 'yarn.cmd' : 'yarn';
  const yarnDir = (process.env.PATH ?? '').split(delimiter).find((path) => existsSync(join(path, yarnName)));
  return {
    PATH: [...systemPath, yarnDir].filter(Boolean).join(delimiter),
    ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
    ...(process.env.HAPPIER_BUN_PATH ? { HAPPIER_BUN_PATH: process.env.HAPPIER_BUN_PATH } : {}),
    HOME: params.cliHomeDir,
    USERPROFILE: params.cliHomeDir,
    HAPPIER_HOME_DIR: params.cliHomeDir,
    HAPPIER_SERVER_URL: params.serverUrl,
    HAPPIER_WEBAPP_URL: params.uiBaseUrl,
    HAPPIER_DAEMON_SERVICE_USER_HOME_DIR: params.cliHomeDir,
    HAPPIER_DAEMON_SERVICE_HAPPIER_HOME_DIR: params.cliHomeDir,
    HAPPIER_CLAUDE_CONFIG_DIR: resolve(join(params.cliHomeDir, 'claude')),
    CLAUDE_CONFIG_DIR: resolve(join(params.cliHomeDir, 'claude')),
    HAPPIER_CLAUDE_PATH: fakeClaudeFixturePath(),
    HAPPIER_E2E_FAKE_CLAUDE_LOG: params.fakeClaudeLogPath,
    HAPPIER_E2E_PROVIDER_USE_CLI_SOURCE_ENTRYPOINT: '1',
    HAPPIER_CLI_DAEMON_INTEGRATION_BOOTSTRAP_AUTH: '0',
    HAPPIER_DISABLE_CAFFEINATE: '1',
    HAPPIER_VARIANT: 'dev',
    CI: '1',
  };
}

test.describe('ui e2e: New Session targets a foreign Home', () => {
  test.describe.configure({ mode: 'serial' });

  const suiteDir = run.testDir('new-session-foreign-home-launch-suite');
  const cliHomeDir = resolve(join(suiteDir, 'cli-home-b'));
  const browseDir = resolve(join(suiteDir, 'only-on-b'));
  const fakeClaudeLogPath = resolve(join(suiteDir, 'fake-claude-b.jsonl'));

  let serverA: StartedServer | null = null;
  let serverB: StartedServer | null = null;
  let ui: StartedUiWeb | null = null;
  let daemonB: StartedDaemon | null = null;

  test.beforeAll(async () => {
    const uiEnv = {
      ...process.env,
      EXPO_PUBLIC_DEBUG: '1',
      EXPO_PUBLIC_HAPPY_STORAGE_SCOPE: `e2e-oh64-foreign-${run.runId}`,
      HAPPIER_E2E_UI_WEB_MODE: 'metro',
      HAPPIER_E2E_PROVIDER_USE_CLI_SOURCE_ENTRYPOINT: '1',
    };
    test.setTimeout(resolveUiWebBeforeAllTimeoutMs(uiEnv));
    await mkdir(cliHomeDir, { recursive: true });
    await mkdir(browseDir, { recursive: true });
    serverA = await startServerLight({ testDir: resolve(join(suiteDir, 'server-a')), dbProvider: 'sqlite' });
    serverB = await startServerLight({ testDir: resolve(join(suiteDir, 'server-b')), dbProvider: 'sqlite' });
    ui = await startUiWeb({
      testDir: suiteDir,
      env: { ...uiEnv, EXPO_PUBLIC_HAPPY_SERVER_URL: serverA.baseUrl },
    });
  });

  test.afterAll(async () => {
    await daemonB?.stop().catch(() => {});
    await ui?.stop().catch(() => {});
    await serverB?.stop().catch(() => {});
    await serverA?.stop().catch(() => {});
  });

  test('selects B while viewing A and browses a B-only directory', async ({ page }) => {
    test.setTimeout(360_000);
    if (!serverA || !serverB || !ui) throw new Error('Missing isolated E2E fixtures');
    const uiBaseUrl = ui.baseUrl;
    await page.setViewportSize({ width: 1440, height: 900 });

    await gotoDomContentLoadedWithRetries(page, uiBaseUrl, 180_000);
    await ensureAccountReadyForConnect({ page, timeoutMs: 120_000 });
    const serverAId = serverIdFromUrl(serverA.baseUrl);

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
    const cliEnv = isolatedCliEnv({ cliHomeDir, fakeClaudeLogPath, serverUrl: serverB.baseUrl, uiBaseUrl });
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

    await gotoDomContentLoadedWithRetries(page, `${uiBaseUrl}/server`, 120_000);
    await page.getByTestId(`saved-server-switch-${serverAId}`).click();
    await gotoDomContentLoadedWithRetries(page, `${uiBaseUrl}/server`, 120_000);
    await page.getByText('Add Relay Group', { exact: true }).click();
    const groupName = page.getByPlaceholder('My Relay Group');
    await groupName.fill('OH64 A+B');
    await groupName.locator('..').getByText('OH64 B', { exact: true }).click();
    await groupName.locator('..').getByRole('button', { name: 'Save group' }).click();

    await enableEnhancedSessionWizard({ page, baseUrl: uiBaseUrl });
    await gotoDomContentLoadedWithRetries(page, `${uiBaseUrl}/new`, 120_000);
    await page.getByTestId('agent-input-machine-chip').click();
    const machineBOption = page.locator(
      `[data-testid="new-session-machine-option:${machineBId}"], [data-testid="new-session-machine:${machineBId}"]`,
    );
    await expect(machineBOption).toBeVisible({ timeout: 120_000 });
    await machineBOption.click();

    await page.getByTestId('agent-input-path-chip').click();
    const pathPopover = page.getByTestId('agent-input-content-popover');
    await expect(pathPopover.getByTestId('path-selection-list:open-tree-browser')).toBeVisible();
    await pathPopover.getByTestId('path-selection-list:header:input').fill(`${suiteDir}/`);
    await expect(pathPopover.getByTestId(`path-selection-list:path-root:option:in-folder:${browseDir}`)).toBeVisible();
  });
});
