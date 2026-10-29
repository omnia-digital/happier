import { type Page } from '@playwright/test';

import { startTestDaemon, type StartedDaemon } from '../daemon/daemon';
import { approveTerminalConnect } from './approveTerminalConnect';
import { startCliAuthLoginForTerminalConnect } from './cliTerminalConnect';
import { acknowledgeTerminalConnectSuccessIfPresent } from './acknowledgeTerminalConnectSuccessIfPresent';
import { gotoCommittedWithRetries, gotoDomContentLoadedWithPathFallback } from './pageNavigation';
import { ensureAccountReadyForConnect } from './ensureAccountReadyForConnect';
import { waitForInitialAppUi } from './waitForInitialAppUi';

export async function authenticateAndStartDaemon(params: Readonly<{
  page: Page;
  testDir: string;
  cliHomeDir: string;
  serverUrl: string;
  cliServerUrl?: string;
  uiBaseUrl: string;
  createAccount?: boolean;
  accountReadyTimeoutMs?: number;
  allowStoredCredentialsWithoutReady?: boolean;
  beforeTerminalConnect?: (page: Page) => Promise<void>;
  initialUiGotoTimeoutMs?: number;
  initialUiReadyTimeoutMs?: number;
  terminalConnectUrlTimeoutMs?: number;
  daemonStartupTimeoutMs?: number;
  extraEnv?: NodeJS.ProcessEnv;
  /** Opt out of runner env inheritance for fixtures that probe CLI/provider auth. */
  inheritProcessEnv?: boolean;
}>): Promise<StartedDaemon> {
  const cliServerUrl = params.cliServerUrl ?? params.serverUrl;
  const inheritedEnv = params.inheritProcessEnv === false ? {} : process.env;
  await gotoCommittedWithRetries(params.page, params.uiBaseUrl, params.initialUiGotoTimeoutMs);
  await waitForInitialAppUi({
    page: params.page,
    timeoutMs: params.initialUiReadyTimeoutMs,
    reloadOnFailure: false,
  });
  try {
    await ensureAccountReadyForConnect({
      page: params.page,
      timeoutMs: params.accountReadyTimeoutMs ?? 120_000,
      clickCreateAccount: params.createAccount !== false,
    });
  } catch (error) {
    const hasStoredCredentials = params.allowStoredCredentialsWithoutReady === true
      && await params.page.evaluate(() => {
        for (let index = 0; index < localStorage.length; index += 1) {
          const key = localStorage.key(index);
          if (!key?.startsWith('auth_credentials')) continue;
          const raw = localStorage.getItem(key);
          if (!raw) continue;
          try {
            const parsed = JSON.parse(raw) as { token?: unknown };
            if (typeof parsed.token === 'string' && parsed.token.trim()) return true;
          } catch {
            // Keep scanning; a malformed unrelated server scope is not enough.
          }
        }
        return false;
      });
    if (!hasStoredCredentials) throw error;
  }

  await params.beforeTerminalConnect?.(params.page);

  const cliLogin = await startCliAuthLoginForTerminalConnect({
    testDir: params.testDir,
    cliHomeDir: params.cliHomeDir,
    serverUrl: cliServerUrl,
    webappUrl: params.uiBaseUrl,
    connectUrlTimeoutMs: params.terminalConnectUrlTimeoutMs,
    env: {
      ...inheritedEnv,
      ...(params.extraEnv ?? {}),
      CI: '1',
      HAPPIER_DISABLE_CAFFEINATE: '1',
      HAPPIER_VARIANT: 'dev',
      HAPPIER_E2E_PROVIDER_USE_CLI_SOURCE_ENTRYPOINT: '1',
    },
  });

  try {
    await gotoDomContentLoadedWithPathFallback(params.page, cliLogin.connectUrl, '/terminal/connect', 90_000);
    await approveTerminalConnect({ page: params.page });
    await cliLogin.waitForSuccess();
    await acknowledgeTerminalConnectSuccessIfPresent(params.page);
  } finally {
    await cliLogin.stop().catch(() => {});
  }

  return await startTestDaemon({
    testDir: params.testDir,
    happyHomeDir: params.cliHomeDir,
    startupTimeoutMs: params.daemonStartupTimeoutMs,
    env: {
      ...inheritedEnv,
      ...(params.extraEnv ?? {}),
      CI: '1',
      HAPPIER_HOME_DIR: params.cliHomeDir,
      HAPPIER_SERVER_URL: cliServerUrl,
      HAPPIER_WEBAPP_URL: params.uiBaseUrl,
      HAPPIER_DISABLE_CAFFEINATE: '1',
      HAPPIER_VARIANT: 'dev',
      HAPPIER_E2E_PROVIDER_USE_CLI_SOURCE_ENTRYPOINT: '1',
    },
  });
}
