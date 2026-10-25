import { existsSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';

/** The disposable OS/toolchain environment used by UI fixtures that probe CLI auth. */
export function createIsolatedCliTestEnv(params: Readonly<{
  homeDir: string;
  processEnv?: NodeJS.ProcessEnv;
}>): NodeJS.ProcessEnv {
  const source = params.processEnv ?? process.env;
  const yarnName = process.platform === 'win32' ? 'yarn.cmd' : 'yarn';
  const yarnDir = (source.PATH ?? source.Path ?? '').split(delimiter)
    .find((dir) => dir && existsSync(join(dir, yarnName)));
  const systemPaths = process.platform === 'win32'
    ? [join(source.SystemRoot ?? source.WINDIR ?? 'C:\\Windows', 'System32'), source.SystemRoot ?? source.WINDIR ?? 'C:\\Windows']
    : ['/usr/bin', '/bin'];
  return {
    PATH: [dirname(process.execPath), ...(yarnDir ? [yarnDir] : []), ...systemPaths].join(delimiter),
    HOME: params.homeDir,
    USERPROFILE: params.homeDir,
    USER: source.USER ?? 'happier-e2e',
    LOGNAME: source.LOGNAME ?? source.USER ?? 'happier-e2e',
    LANG: source.LANG ?? 'C.UTF-8',
    SHELL: source.SHELL,
    TMPDIR: params.homeDir,
    ...(source.SystemRoot ? { SystemRoot: source.SystemRoot } : {}),
    ...(source.WINDIR ? { WINDIR: source.WINDIR } : {}),
    ...(source.HAPPIER_BUN_PATH ? { HAPPIER_BUN_PATH: source.HAPPIER_BUN_PATH } : {}),
    HAPPIER_HOME_DIR: params.homeDir,
    HAPPIER_DAEMON_SERVICE_USER_HOME_DIR: params.homeDir,
    HAPPIER_DAEMON_SERVICE_HAPPIER_HOME_DIR: params.homeDir,
    HAPPIER_CLI_UPDATE_CHECK: '0',
    HAPPIER_CLI_DAEMON_INTEGRATION_BOOTSTRAP_AUTH: '0',
    CI: '1',
  };
}

export function sanitizeCliTestEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const sanitized = { ...env };
  // Fixtures select their own relay, credential namespace, and working directory.
  // Ambient stack selection takes precedence unless it is removed.
  delete sanitized.HAPPIER_ACTIVE_SERVER_ID;
  delete sanitized.HAPPIER_STACK_INVOKED_CWD;
  delete sanitized.HAPPIER_DAEMON_PENDING_FIRST_INPUT;
  delete sanitized.HAPPIER_DAEMON_SERVICE_INSTANCE_ID;
  delete sanitized.HAPPIER_DAEMON_SERVICE_SERVER_URL;
  return sanitized;
}
