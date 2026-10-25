import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

const { cliJsonResponseMock, cliVersionResponseMock } = vi.hoisted(() => ({
  cliJsonResponseMock: vi.fn(),
  cliVersionResponseMock: vi.fn<() => string>(),
}));

// Replace only execution at the OS boundary; resolution, JSON parsing and service policy stay real.
vi.mock('../taskRuntime.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../taskRuntime.js')>();
  return {
    ...actual,
    runCommandCapture: async (params: Parameters<typeof actual.runCommandCapture>[0]) => ({
      status: 0,
      stdout: params.args[0] === '--version'
        ? cliVersionResponseMock()
        : JSON.stringify(await cliJsonResponseMock(params)) ?? '',
      stderr: '',
    }),
  };
});

import { writeHappierCliChoice } from '@happier-dev/cli-common/firstPartyRuntime';

import { installManagedCliFixture } from '../localHappierCliFixture.js';
import { createDaemonServiceStartHandler, createDaemonServiceStatusHandler } from './daemonService.js';

const AMBIENT_STATUS_JSON = {
  server: {
    activeServerId: 'custom',
    serverUrl: 'https://relay.example.test',
    localServerUrl: null,
    publicServerUrl: 'https://relay.example.test',
    webappUrl: 'https://relay.example.test',
    comparableKey: 'https://relay.example.test',
  },
  daemon: {
    running: true,
    pid: 4321,
    httpPort: 7777,
    startedWithCliVersion: '0.2.11',
    serviceManaged: true,
    serviceLabel: 'com.happier.cli.daemon.default',
  },
  service: { installed: true, running: true, targetMode: 'default-following' },
  auth: {
    authenticated: true,
    machineRegistered: true,
    machineId: 'machine-b',
    needsAuth: false,
    accountId: 'acct_b',
    credentialState: 'valid',
    validatedAccountId: 'acct_b',
  },
  runtimeConvergence: {
    controlReachable: true,
    serviceOwnsRunningDaemon: true,
    machineIdMatches: false,
    cliVersionMatches: true,
  },
};

async function collectResult(
  handler: (params: unknown, context: Readonly<{ signal: AbortSignal }>) => AsyncGenerator<unknown, unknown, void>,
  params: unknown,
) {
  const iterator = handler(params, { signal: new AbortController().signal });
  const events: unknown[] = [];
  for (;;) {
    const next = await iterator.next();
    if (next.done) {
      return { events, result: next.value };
    }
    events.push(next.value);
  }
}

describe('daemonService system task handlers', () => {
  beforeEach(async () => {
    const home = mkdtempSync(join(tmpdir(), 'hsetup-daemon-service-'));
    vi.stubEnv('HOME', home);
    vi.stubEnv('USERPROFILE', home);
    vi.stubEnv('HAPPIER_HOME_DIR', home);
    vi.stubEnv('HAPPIER_BOOTSTRAP_CLI_PATH', '');
    vi.stubEnv('HAPPIER_BOOTSTRAP_HAPPIER_PATH', '');
    vi.stubEnv('HAPPIER_STACK_REPO_DIR', join(home, 'elsewhere'));
    vi.stubEnv('PATH', '');
    cliVersionResponseMock.mockReturnValue('0.2.13');
    await installManagedCliFixture({ processEnv: process.env });
    onTestFinished(() => {
      vi.unstubAllEnvs();
      rmSync(home, { recursive: true, force: true });
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('reports acquisition explicitly and carries every ambient daemon fact the CLI emitted', async () => {
    // No stable CLI to adopt: only the app's preview channel is installed.
    const emptyHome = mkdtempSync(join(tmpdir(), 'hsetup-status-channel-'));
    vi.stubEnv('HOME', emptyHome);
    vi.stubEnv('USERPROFILE', emptyHome);
    vi.stubEnv('HAPPIER_HOME_DIR', emptyHome);
    vi.stubEnv('PATH', '');
    const cli = await installManagedCliFixture({ processEnv: process.env, releaseRing: 'preview' });
    onTestFinished(() => {
      vi.unstubAllEnvs();
      rmSync(emptyHome, { recursive: true, force: true });
    });
    cliJsonResponseMock.mockResolvedValueOnce(AMBIENT_STATUS_JSON);
    const handler = createDaemonServiceStatusHandler();

    const { result } = await collectResult(handler, {
      target: { kind: 'local' },
      surface: 'desktop.ui',
      mode: 'user',
      channel: 'preview',
    });

    expect(cliJsonResponseMock.mock.calls[0]?.[0]).toMatchObject({
      args: ['daemon', 'status', '--json'],
      command: cli.command,
      env: { HAPPIER_PUBLIC_RELEASE_CHANNEL: 'preview' },
    });
    expect(result).toEqual({
      serviceInstalled: true,
      daemonRunning: true,
      needsAuth: false,
      machineId: 'machine-b',
      // Which CLI answered, where it came from, the version it reports for itself, and the channel
      // whose CLI it is (D2: the default channel's when that one is installed, else the app's).
      acquisition: { ...cli, channel: 'preview' },
      server: {
        activeServerId: 'custom',
        serverUrl: 'https://relay.example.test',
        publicServerUrl: 'https://relay.example.test',
        localServerUrl: null,
        comparableKey: 'https://relay.example.test',
      },
      auth: {
        authenticated: true,
        machineRegistered: true,
        machineId: 'machine-b',
        needsAuth: false,
        accountId: 'acct_b',
        credentialState: 'valid',
        validatedAccountId: 'acct_b',
        accountLabel: null,
      },
      service: { installed: true, running: true, targetMode: 'default-following', autostart: null },
      daemon: {
        running: true,
        startedWithCliVersion: '0.2.11',
        serviceManaged: true,
        serviceLabel: 'com.happier.cli.daemon.default',
      },
      runtimeConvergence: {
        controlReachable: true,
        serviceOwnsRunningDaemon: true,
        machineIdMatches: false,
        cliVersionMatches: true,
      },
      // R12: nobody was asked and no other CLI exists here.
      cli: { update: null, choice: { mode: null, otherCli: null } },
      // The service list answered nothing readable on a CLI at the setup floor: an unknown
      // inventory, never "no service here" (R10-2).
      pinnedServices: { complete: false, coexistence: false, services: [], unreadable: [] },
      runningManagedServiceCount: null,
      managedServiceAutostart: null,
      // R16: the one list of this computer's services (machine id mismatch: it needs attention).
      serviceRows: [{ relayUrl: 'https://relay.example.test', state: 'needs_attention', appManaged: true, serving: 'default-following', actions: [] }],
    });
  });

  /** R12: which CLI this computer chose, and the copy the person may still want to remove or update. */
  it('reports the computer\'s CLI choice and names the other CLI with the commands that remove or update it', async () => {
    const home = mkdtempSync(join(tmpdir(), 'hsetup-status-cli-choice-'));
    const npmBin = join(home, 'npm-global', 'bin');
    const packageRoot = join(home, 'npm-global', 'lib', 'node_modules', '@happier-dev', 'cli');
    mkdirSync(join(packageRoot, 'bin'), { recursive: true });
    writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({ name: '@happier-dev/cli' }), 'utf8');
    writeFileSync(join(packageRoot, 'bin', 'happier.mjs'), '#!/bin/sh\n', 'utf8');
    chmodSync(join(packageRoot, 'bin', 'happier.mjs'), 0o755);
    mkdirSync(npmBin, { recursive: true });
    symlinkSync(join(packageRoot, 'bin', 'happier.mjs'), join(npmBin, 'happier'));
    vi.stubEnv('HAPPIER_HOME_DIR', join(home, 'happier'));
    vi.stubEnv('PATH', npmBin);
    await installManagedCliFixture({ processEnv: process.env });
    onTestFinished(() => {
      vi.unstubAllEnvs();
      rmSync(home, { recursive: true, force: true });
    });
    const otherCli = {
      command: join(npmBin, 'happier'),
      origin: 'npm',
      removalCommand: 'npm uninstall -g @happier-dev/cli',
      updateCommand: 'npm install -g @happier-dev/cli@latest',
    };

    await writeHappierCliChoice({ choice: { mode: 'managed' }, processEnv: process.env });
    cliJsonResponseMock.mockResolvedValueOnce(AMBIENT_STATUS_JSON);
    const { result: managed } = await collectResult(createDaemonServiceStatusHandler(), { target: { kind: 'local' } });
    expect(managed).toMatchObject({ cli: { choice: { mode: 'managed', otherCli } } });

    await writeHappierCliChoice({ choice: { mode: 'own', command: join(npmBin, 'happier') }, processEnv: process.env });
    cliJsonResponseMock.mockResolvedValueOnce(AMBIENT_STATUS_JSON);
    const { result: own } = await collectResult(createDaemonServiceStatusHandler(), { target: { kind: 'local' } });
    expect(own).toMatchObject({ cli: { choice: { mode: 'own', otherCli } } });
  });

  /** K1: the account label and the CLI's cached update state, with `managed` from the resolver. */
  it('reports the validated account label and the CLI update state of the CLI that answered', async () => {
    cliJsonResponseMock.mockResolvedValueOnce({
      ...AMBIENT_STATUS_JSON,
      auth: { ...AMBIENT_STATUS_JSON.auth, accountLabel: 'bea' },
      cliUpdate: { currentVersion: '0.2.13', latestVersion: '0.2.14', updateAvailable: true },
    });
    const { result } = await collectResult(createDaemonServiceStatusHandler(), {
      target: { kind: 'local' },
      surface: 'desktop.ui',
    });
    expect(result).toMatchObject({
      auth: { accountLabel: 'bea' },
      cli: { update: { currentVersion: '0.2.13', latestVersion: '0.2.14', updateAvailable: true, managed: true } },
    });

    vi.stubEnv('HAPPIER_BOOTSTRAP_CLI_PATH', join(process.env.HAPPIER_HOME_DIR!, 'override-happier'));
    cliJsonResponseMock.mockResolvedValueOnce({
      ...AMBIENT_STATUS_JSON,
      cliUpdate: { currentVersion: '0.2.13', latestVersion: null, updateAvailable: false },
    });
    const { result: overrideResult } = await collectResult(createDaemonServiceStatusHandler(), {
      target: { kind: 'local' },
      surface: 'desktop.ui',
    });
    expect(overrideResult).toMatchObject({
      auth: { accountLabel: null },
      cli: { update: { latestVersion: null, updateAvailable: false, managed: false } },
    });
  });

  it('names a status read that fails on a CLI nobody chose yet as the one-CLI question, not a failure to retry (R12)', async () => {
    const home = mkdtempSync(join(tmpdir(), 'hsetup-status-cli-choice-required-'));
    const npmBin = join(home, 'npm-global', 'bin');
    mkdirSync(npmBin, { recursive: true });
    writeFileSync(join(npmBin, 'happier'), '#!/bin/sh\n', 'utf8');
    chmodSync(join(npmBin, 'happier'), 0o755);
    vi.stubEnv('HAPPIER_HOME_DIR', join(home, 'happier'));
    vi.stubEnv('HAPPIER_STACK_REPO_DIR', join(home, 'elsewhere'));
    vi.stubEnv('HAPPIER_BOOTSTRAP_CLI_PATH', '');
    vi.stubEnv('HAPPIER_BOOTSTRAP_HAPPIER_PATH', '');
    vi.stubEnv('PATH', npmBin);
    onTestFinished(() => {
      vi.unstubAllEnvs();
      rmSync(home, { recursive: true, force: true });
    });
    cliVersionResponseMock.mockReturnValueOnce('');

    await expect(collectResult(createDaemonServiceStatusHandler(), { target: { kind: 'local' } }))
      .rejects.toMatchObject({ code: 'cli_choice_required' });
  });

  it('reports runtimeConvergence as unknown when an older CLI does not emit it', async () => {
    const { runtimeConvergence: _omitted, ...legacyStatus } = AMBIENT_STATUS_JSON;
    cliJsonResponseMock.mockResolvedValueOnce({
      ...legacyStatus,
      auth: { ...legacyStatus.auth, credentialState: undefined, validatedAccountId: undefined },
    });
    const handler = createDaemonServiceStatusHandler();

    const { result } = await collectResult(handler, {
      target: { kind: 'local' },
      surface: 'desktop.ui',
      mode: 'user',
    });

    expect(result).toMatchObject({
      auth: { credentialState: null, validatedAccountId: null },
      runtimeConvergence: null,
    });
  });

  it('fails by field name on a status response with a missing or wrongly typed value', async () => {
    for (const malformed of [
      { path: 'service.installed', value: { ...AMBIENT_STATUS_JSON, service: { running: true } } },
      { path: 'daemon.running', value: { ...AMBIENT_STATUS_JSON, daemon: { ...AMBIENT_STATUS_JSON.daemon, running: 'yes' } } },
      { path: 'auth.needsAuth', value: { ...AMBIENT_STATUS_JSON, auth: { ...AMBIENT_STATUS_JSON.auth, needsAuth: null } } },
      // A string field the hand-written reader used to coerce to "absent": an empty machine id
      // would read as "this computer has no machine" and start a pairing.
      { path: 'auth.machineId', value: { ...AMBIENT_STATUS_JSON, auth: { ...AMBIENT_STATUS_JSON.auth, machineId: '' } } },
    ]) {
      cliJsonResponseMock.mockResolvedValueOnce(malformed.value);
      const handler = createDaemonServiceStatusHandler();

      // Coercing these to `false`/absent would report "no service, no daemon, not authenticated" —
      // the facts that make the app start an installing, re-pairing setup run.
      await expect(collectResult(handler, {
        target: { kind: 'local' },
        surface: 'desktop.ui',
        mode: 'user',
      })).rejects.toMatchObject({
        code: 'invalid_cli_response',
        message: expect.stringContaining(`"${malformed.path}"`),
      });
    }
  });

  /**
   * The service's target mode decides whether the app may move that service on its own. An
   * absent field (an older CLI) and an unreadable one are both "unknown"; a value outside the
   * CLI's vocabulary is corrupt output and must not be coerced into either mode.
   */
  it('projects the service target mode and refuses to guess one', async () => {
    for (const declared of ['default-following', 'pinned'] as const) {
      cliJsonResponseMock.mockResolvedValueOnce({
        ...AMBIENT_STATUS_JSON,
        service: { ...AMBIENT_STATUS_JSON.service, targetMode: declared },
      });
      const { result } = await collectResult(createDaemonServiceStatusHandler(), {
        target: { kind: 'local' },
        surface: 'desktop.ui',
        mode: 'user',
      });
      expect(result).toMatchObject({ service: { installed: true, running: true, targetMode: declared } });
    }

    for (const unknownValue of [undefined, null]) {
      cliJsonResponseMock.mockResolvedValueOnce({
        ...AMBIENT_STATUS_JSON,
        service: { ...AMBIENT_STATUS_JSON.service, targetMode: unknownValue },
      });
      const { result } = await collectResult(createDaemonServiceStatusHandler(), {
        target: { kind: 'local' },
        surface: 'desktop.ui',
        mode: 'user',
      });
      expect(result).toMatchObject({ service: { targetMode: null } });
    }

    for (const malformed of ['default', 'DEFAULT-FOLLOWING', true, 3]) {
      cliJsonResponseMock.mockResolvedValueOnce({
        ...AMBIENT_STATUS_JSON,
        service: { ...AMBIENT_STATUS_JSON.service, targetMode: malformed },
      });
      await expect(collectResult(createDaemonServiceStatusHandler(), {
        target: { kind: 'local' },
        surface: 'desktop.ui',
        mode: 'user',
      })).rejects.toMatchObject({
        code: 'invalid_cli_response',
        message: expect.stringContaining('"service.targetMode"'),
      });
    }
  });

  /**
   * The autostart mode decides whether this computer keeps answering once the app is closed.
   * Absent and `null` are unknown; anything outside the CLI's vocabulary — including the boolean
   * shape an earlier draft of this seam used — is corrupt output and must not be coerced.
   */
  it('projects the service autostart mode and refuses to guess one', async () => {
    for (const declared of ['at-login', 'on-demand'] as const) {
      cliJsonResponseMock.mockResolvedValueOnce({
        ...AMBIENT_STATUS_JSON,
        service: { ...AMBIENT_STATUS_JSON.service, autostart: declared },
      });
      const { result } = await collectResult(createDaemonServiceStatusHandler(), {
        target: { kind: 'local' },
        surface: 'desktop.ui',
        mode: 'user',
      });
      expect(result).toMatchObject({ service: { installed: true, running: true, autostart: declared } });
    }

    for (const unknownValue of [undefined, null]) {
      cliJsonResponseMock.mockResolvedValueOnce({
        ...AMBIENT_STATUS_JSON,
        service: { ...AMBIENT_STATUS_JSON.service, autostart: unknownValue },
      });
      const { result } = await collectResult(createDaemonServiceStatusHandler(), {
        target: { kind: 'local' },
        surface: 'desktop.ui',
        mode: 'user',
      });
      expect(result).toMatchObject({ service: { autostart: null } });
    }

    for (const malformed of [true, false, 'AT-LOGIN', 'login', 1]) {
      cliJsonResponseMock.mockResolvedValueOnce({
        ...AMBIENT_STATUS_JSON,
        service: { ...AMBIENT_STATUS_JSON.service, autostart: malformed },
      });
      await expect(collectResult(createDaemonServiceStatusHandler(), {
        target: { kind: 'local' },
        surface: 'desktop.ui',
        mode: 'user',
      })).rejects.toMatchObject({
        code: 'invalid_cli_response',
        message: expect.stringContaining('"service.autostart"'),
      });
    }
  });

  /**
   * One daemon per relay: a relay this computer also serves has its own pinned service. The status
   * read reports each of this home's pinned services (same ring) through the same `daemon status`
   * owner, scoped to that service, so the app can tell which relays this computer answers on.
   */
  it('reports each pinned service of this Happier home and ring with its own daemon status', async () => {
    const home = mkdtempSync(join(tmpdir(), 'hsetup-status-pinned-'));
    vi.stubEnv('HAPPIER_HOME_DIR', home);
    await installManagedCliFixture({ processEnv: process.env });
    vi.stubEnv('PATH', '');
    // A stack launch pins a service target of its own; it must never leak into these reads.
    vi.stubEnv('HAPPIER_DAEMON_SERVICE_TARGET_MODE', 'pinned');
    vi.stubEnv('HAPPIER_DAEMON_SERVICE_INSTANCE_ID', 'stack-instance');
    onTestFinished(() => {
      vi.unstubAllEnvs();
      cliJsonResponseMock.mockReset();
      rmSync(home, { recursive: true, force: true });
    });
    const pinnedEntry = {
      serverId: 'relay-b',
      activeServerId: 'relay-b',
      relayUrl: 'https://relay-b.example.test',
      targetMode: 'pinned',
      releaseChannel: 'stable',
      happierHomeDir: home,
    };
    cliJsonResponseMock.mockImplementation(async (params: { args: readonly string[]; env?: NodeJS.ProcessEnv }) => {
      if (params.args.join(' ') === 'daemon service list --json') {
        return {
          capabilities: { pinnedServiceCoexistence: true },
          entries: [
            pinnedEntry,
            // Not this computer's to report: the default-following service, another home, another ring.
            { ...pinnedEntry, serverId: 'default', activeServerId: undefined, targetMode: 'default-following' },
            { ...pinnedEntry, serverId: 'relay-c', happierHomeDir: join(home, 'other-home') },
            { ...pinnedEntry, serverId: 'relay-d', releaseChannel: 'preview' },
          ],
        };
      }
      if (params.env?.HAPPIER_DAEMON_SERVICE_TARGET_MODE === 'pinned') {
        return {
          ...AMBIENT_STATUS_JSON,
          server: {
            ...AMBIENT_STATUS_JSON.server,
            activeServerId: params.env.HAPPIER_ACTIVE_SERVER_ID,
            serverUrl: params.env.HAPPIER_SERVER_URL,
            publicServerUrl: params.env.HAPPIER_SERVER_URL,
            comparableKey: 'relay-b.example.test',
          },
          service: { installed: true, running: true, targetMode: 'pinned' },
          auth: { ...AMBIENT_STATUS_JSON.auth, machineId: 'machine-relay-b', validatedAccountId: 'acct_relay_b' },
        };
      }
      return AMBIENT_STATUS_JSON;
    });

    const { result } = await collectResult(createDaemonServiceStatusHandler(), { target: { kind: 'local' } });

    const pinnedStatusCalls = cliJsonResponseMock.mock.calls
      .map(([params]) => params as { args: readonly string[]; env?: NodeJS.ProcessEnv })
      .filter((params) => params.args.join(' ') === 'daemon status --json' && params.env?.HAPPIER_DAEMON_SERVICE_TARGET_MODE === 'pinned');
    expect(pinnedStatusCalls).toHaveLength(1);
    expect(pinnedStatusCalls[0]?.env).toMatchObject({
      HAPPIER_ACTIVE_SERVER_ID: 'relay-b',
      HAPPIER_SERVER_URL: 'https://relay-b.example.test',
      HAPPIER_DAEMON_SERVICE_INSTANCE_ID: 'relay-b',
    });
    expect(result).toMatchObject({
      // The default-following service's facts stay where they always were.
      server: { serverUrl: 'https://relay.example.test' },
      service: { targetMode: 'default-following' },
      pinnedServices: {
        complete: true,
        unreadable: [],
        services: [{
          server: { serverUrl: 'https://relay-b.example.test', comparableKey: 'relay-b.example.test' },
          service: { installed: true, targetMode: 'pinned' },
          auth: { machineId: 'machine-relay-b', validatedAccountId: 'acct_relay_b' },
        }],
      },
    });
    expect((result as { pinnedServices: { services: unknown[] } }).pinnedServices.services).toHaveLength(1);
  });

  /**
   * "Connect to this relay too" needs a CLI whose daemons coexist per relay (start-up reaping and
   * install conflicts scoped to one relay), which is the setup floor. Below it — or with a version
   * nobody can read — the pinned list is unknown, so the app offers nothing that depends on it.
   */
  it('separates a complete inventory from the absent coexistence capability', async () => {
    onTestFinished(() => {
      cliJsonResponseMock.mockReset();
    });
    cliJsonResponseMock.mockImplementation(async (params: { args: readonly string[] }) => (
      params.args.join(' ') === 'daemon service list --json' ? { entries: [] } : AMBIENT_STATUS_JSON
    ));

    const { result } = await collectResult(createDaemonServiceStatusHandler(), { target: { kind: 'local' } });

    expect(result).toMatchObject({ pinnedServices: { complete: true, coexistence: false, services: [], unreadable: [] } });
  });

  it('keeps every readable pinned service and names the unreadable one instead of erasing the list (M6)', async () => {
    const home = mkdtempSync(join(tmpdir(), 'hsetup-status-pinned-partial-'));
    vi.stubEnv('HAPPIER_HOME_DIR', home);
    await installManagedCliFixture({ processEnv: process.env });
    onTestFinished(() => {
      vi.unstubAllEnvs();
      cliJsonResponseMock.mockReset();
      rmSync(home, { recursive: true, force: true });
    });
    const entry = (id: string) => ({ serverId: id, activeServerId: id, relayUrl: `https://${id}.example.test`, targetMode: 'pinned', releaseChannel: 'stable', happierHomeDir: home });
    cliJsonResponseMock.mockImplementation(async (params: { args: readonly string[]; env?: NodeJS.ProcessEnv }) => {
      if (params.args.join(' ') === 'daemon service list --json') {
        return { capabilities: { pinnedServiceCoexistence: true }, entries: [entry('relay-b'), entry('relay-c')] };
      }
      const instance = params.env?.HAPPIER_DAEMON_SERVICE_INSTANCE_ID;
      if (instance === 'relay-c') return { ...AMBIENT_STATUS_JSON, daemon: { running: 'unreadable' } };
      if (instance === 'relay-b') return { ...AMBIENT_STATUS_JSON, server: { ...AMBIENT_STATUS_JSON.server, serverUrl: 'https://relay-b.example.test' } };
      return AMBIENT_STATUS_JSON;
    });

    const { result } = await collectResult(createDaemonServiceStatusHandler(), { target: { kind: 'local' } });

    expect(result).toMatchObject({
      pinnedServices: {
        complete: false,
        services: [{ server: { serverUrl: 'https://relay-b.example.test' } }],
        unreadable: [{ relayUrl: 'https://relay-c.example.test', code: 'invalid_cli_response' }],
      },
    });
  });

  it('reports pinned services as unknown when the CLI cannot list its services', async () => {
    onTestFinished(() => {
      cliJsonResponseMock.mockReset();
    });
    cliJsonResponseMock.mockImplementation(async (params: { args: readonly string[] }) => {
      if (params.args.join(' ') === 'daemon service list --json') {
        throw new Error('unknown command');
      }
      return AMBIENT_STATUS_JSON;
    });

    const { result } = await collectResult(createDaemonServiceStatusHandler(), { target: { kind: 'local' } });

    // `null` is "not known", never "none": the app then offers nothing that depends on it.
    // R10-2 — a CLI at the setup floor always lists; one that could not is an unknown inventory,
    // never "no service here" (and never `null`, which would read as "not applicable").
    expect(result).toMatchObject({ server: { serverUrl: 'https://relay.example.test' }, pinnedServices: { complete: false, services: [], unreadable: [] } });
  });

  it('rejects invalid daemon service params for the status task', async () => {
    const handler = createDaemonServiceStatusHandler();

    await expect(collectResult(handler, null)).rejects.toMatchObject({
      code: 'invalid_params',
    });
  });

  /**
   * A typo'd ring must not silently become `stable`: this task reads — and its siblings start and
   * stop — whichever ring's CLI answers, so the wrong ring is the wrong computer state.
   */
  it('rejects a channel outside the accepted rings instead of falling back to stable', async () => {
    await expect(collectResult(createDaemonServiceStatusHandler(), {
      target: { kind: 'local' },
      surface: 'desktop.ui',
      channel: 'nightly',
    })).rejects.toMatchObject({
      code: 'invalid_params',
      message: expect.stringContaining('stable, preview, dev, publicdev'),
    });
    expect(cliJsonResponseMock).not.toHaveBeenCalled();

    // An absent channel still means the default ring.
    cliJsonResponseMock.mockResolvedValueOnce(AMBIENT_STATUS_JSON);
    const { result } = await collectResult(createDaemonServiceStatusHandler(), {
      target: { kind: 'local' },
      surface: 'desktop.ui',
    });
    expect(result).toMatchObject({ serviceInstalled: true });
    expect(cliJsonResponseMock.mock.calls[0]?.[0]).toMatchObject({ env: { HAPPIER_PUBLIC_RELEASE_CHANNEL: 'stable' } });
  });

  it('rejects daemon service start params that target a non-local machine', async () => {
    const handler = createDaemonServiceStartHandler();

    await expect(collectResult(handler, {
      target: { kind: 'remote' },
      surface: 'desktop.ui',
      mode: 'user',
    })).rejects.toMatchObject({
      code: 'invalid_params',
    });
  });
});
