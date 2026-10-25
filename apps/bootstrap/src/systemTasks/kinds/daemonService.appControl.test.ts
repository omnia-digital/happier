import { mkdtempSync, rmSync } from 'node:fs';
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

import { installManagedCliFixture } from '../localHappierCliFixture.js';
import {
  createDaemonServiceAutostartSetHandler,
  createDaemonServiceRelayDisconnectHandler,
  createDaemonServiceStartHandler,
  createDaemonServiceStopHandler,
  createDaemonServiceStatusHandler,
} from './daemonService.js';

// Mirrors what `happier daemon status --json` prints for a stopped service: a daemon that never
// started reports no version and no service label, and the CLI omits those keys rather than
// sending nulls.
const STOPPED_STATUS_JSON = {
  server: {
    activeServerId: 'custom',
    serverUrl: 'https://relay.example.test',
    localServerUrl: null,
    publicServerUrl: 'https://relay.example.test',
    webappUrl: 'https://app.example.test',
    comparableKey: 'https://relay.example.test',
  },
  daemon: { running: false, pid: null, httpPort: null, serviceManaged: null, serviceLabel: null },
  service: { installed: true, running: false, targetMode: 'default-following', autostart: 'on-demand' },
  auth: {
    authenticated: true,
    machineRegistered: true,
    machineId: 'machine-b',
    needsAuth: false,
    accountId: 'acct_b',
    credentialState: 'valid',
    validatedAccountId: 'acct_b',
  },
};

const PARAMS = { target: { kind: 'local' }, channel: 'stable', surface: 'desktop.ui', mode: 'user' };

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

function commandArgs(callIndex: number): readonly string[] {
  return cliJsonResponseMock.mock.calls[callIndex]?.[0]?.args ?? [];
}

describe('desktop control of the background service', () => {
  beforeEach(async () => {
    const home = mkdtempSync(join(tmpdir(), 'hsetup-app-control-'));
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

  it('stops the background service through the existing service command and returns the re-read state', async () => {
    cliJsonResponseMock.mockResolvedValueOnce(STOPPED_STATUS_JSON);
    cliJsonResponseMock.mockResolvedValueOnce({ entries: [] });
    cliJsonResponseMock.mockResolvedValueOnce({ ok: true });
    cliJsonResponseMock.mockResolvedValueOnce(STOPPED_STATUS_JSON);

    const { result } = await collectResult(createDaemonServiceStopHandler(), PARAMS);

    expect(commandArgs(2)).toEqual(['daemon', 'service', 'stop', '--json']);
    // The answer is a re-read, never the stop command's own success.
    expect(commandArgs(3)).toEqual(['daemon', 'status', '--json']);
    expect(result).toMatchObject({ daemonRunning: false, service: { running: false } });
  });

  it('refuses to report the service stopped while the daemon is still running', async () => {
    const running = {
      ...STOPPED_STATUS_JSON,
      daemon: { ...STOPPED_STATUS_JSON.daemon, running: true },
      service: { ...STOPPED_STATUS_JSON.service, running: true },
    };
    cliJsonResponseMock.mockResolvedValueOnce(running);
    cliJsonResponseMock.mockResolvedValueOnce({ entries: [] });
    cliJsonResponseMock.mockResolvedValueOnce({ ok: true });
    cliJsonResponseMock.mockResolvedValueOnce(running);

    await expect(collectResult(createDaemonServiceStopHandler(), PARAMS)).rejects.toMatchObject({
      code: 'daemon_service_still_running',
    });
  });

  /**
   * The argv is the contract. `--autostart=<at-login|on-demand>` is the flag
   * `apps/cli/src/daemon/service/cli.ts` actually parses; a flag it does not parse would be
   * silently ignored and the toggle would report a change that never happened.
   */
  it('sets the autostart mode through the install command and proves it by re-reading', async () => {
    cliJsonResponseMock.mockResolvedValueOnce(STOPPED_STATUS_JSON);
    cliJsonResponseMock.mockResolvedValueOnce({ entries: [] });
    cliJsonResponseMock.mockResolvedValueOnce({ ok: true });
    cliJsonResponseMock.mockResolvedValueOnce(STOPPED_STATUS_JSON);

    const { result } = await collectResult(createDaemonServiceAutostartSetHandler(), { ...PARAMS, autostart: 'on-demand' });

    expect(commandArgs(2)).toEqual(['daemon', 'service', 'install', '--autostart=on-demand', '--json']);
    expect(result).toMatchObject({ service: { autostart: 'on-demand' } });
  });

  it('restores login start with the same command and the opposite mode', async () => {
    cliJsonResponseMock.mockResolvedValueOnce(STOPPED_STATUS_JSON);
    cliJsonResponseMock.mockResolvedValueOnce({ entries: [] });
    cliJsonResponseMock.mockResolvedValueOnce({ ok: true });
    cliJsonResponseMock.mockResolvedValueOnce({
      ...STOPPED_STATUS_JSON,
      service: { ...STOPPED_STATUS_JSON.service, autostart: 'at-login' },
    });

    const { result } = await collectResult(createDaemonServiceAutostartSetHandler(), { ...PARAMS, autostart: 'at-login' });

    expect(commandArgs(2)).toEqual(['daemon', 'service', 'install', '--autostart=at-login', '--json']);
    expect(result).toMatchObject({ service: { autostart: 'at-login' } });
  });

  it('fails by name when the CLI that answered does not report the autostart mode it was asked to set', async () => {
    cliJsonResponseMock.mockResolvedValueOnce(STOPPED_STATUS_JSON);
    cliJsonResponseMock.mockResolvedValueOnce({ entries: [] });
    cliJsonResponseMock.mockResolvedValueOnce({ ok: true });
    cliJsonResponseMock.mockResolvedValueOnce({
      ...STOPPED_STATUS_JSON,
      service: { installed: true, running: false, targetMode: 'default-following' },
    });

    await expect(
      collectResult(createDaemonServiceAutostartSetHandler(), { ...PARAMS, autostart: 'on-demand' }),
    ).rejects.toMatchObject({ code: 'daemon_service_autostart_unsupported' });
  });

  it('requires an explicit autostart mode rather than defaulting one', async () => {
    await expect(collectResult(createDaemonServiceAutostartSetHandler(), PARAMS)).rejects.toMatchObject({
      code: 'invalid_params',
    });
  });

  it('rejects a boolean autostart param rather than translating it', async () => {
    await expect(
      collectResult(createDaemonServiceAutostartSetHandler(), { ...PARAMS, autostart: true }),
    ).rejects.toMatchObject({ code: 'invalid_params' });
  });

  it('reports an unknown autostart mode as unknown rather than as on-demand', async () => {
    cliJsonResponseMock.mockResolvedValueOnce({
      ...STOPPED_STATUS_JSON,
      service: { installed: true, running: false, targetMode: 'default-following' },
    });

    const { result } = await collectResult(createDaemonServiceStatusHandler(), PARAMS);

    expect(result).toMatchObject({ service: { autostart: null } });
  });
  /**
   * One login-start setting governs every service the app manages: the default-following one and
   * each relay's own pinned service ("connect to this relay too"). Toggling applies it to all,
   * quitting on-demand stops all, and opening the app starts all.
   */
  describe('pinned services follow the one login-start setting', () => {
    type CliCall = Readonly<{ args: readonly string[]; env?: NodeJS.ProcessEnv }>;
    const RUNNING_JSON = {
      ...STOPPED_STATUS_JSON,
      daemon: { running: true, pid: 4321, httpPort: 7777, serviceManaged: true, serviceLabel: 'label', startedWithCliVersion: '0.2.13' },
      service: { ...STOPPED_STATUS_JSON.service, running: true },
      runtimeConvergence: { controlReachable: true, serviceOwnsRunningDaemon: true, machineIdMatches: true, cliVersionMatches: true },
    };

    /** Each service answers with its own state; commands mutate that state the way the CLI would. */
    function answerCli(initial: Readonly<{
      defaultRunning: boolean;
      pinnedRunning: boolean;
      autostart: 'at-login' | 'on-demand';
      /** The pinned service's status read fails (an unreadable definition, a CLI that crashed). */
      pinnedStatusFails?: boolean;
      /** Inventory still lists its definition, but status could not find a running installation. */
      pinnedInstalled?: boolean;
      /** The default-following service is not installed at all. */
      defaultMissing?: boolean;
      /** The pinned service was set up by the user, not by the app (no desktop marker). */
      pinnedUserOwned?: boolean;
      pinnedRelayUrl?: string;
      coexistence?: boolean;
      extraPinned?: boolean;
      mutationFailures?: readonly string[];
      mutationErrorsAfterApply?: readonly string[];
      pinnedNeedsAuth?: boolean;
    }>) {
      const home = process.env.HAPPIER_HOME_DIR;
      const services: Record<string, { running: boolean; autostart: 'at-login' | 'on-demand' | null }> = {
        default: { running: initial.defaultRunning, autostart: initial.autostart },
        'relay-b': { running: initial.pinnedRunning, autostart: initial.autostart },
        'relay-c': { running: initial.pinnedRunning, autostart: initial.autostart },
      };
      cliJsonResponseMock.mockImplementation(async (call: CliCall) => {
        const command = call.args.join(' ');
        const instance = call.env?.HAPPIER_DAEMON_SERVICE_INSTANCE_ID ?? 'default';
        const service = services[instance]!;
        if (command === 'daemon service list --json') {
          return {
            capabilities: { pinnedServiceCoexistence: initial.coexistence ?? true },
            entries: [{
              serverId: 'relay-b',
              activeServerId: 'relay-b',
              relayUrl: initial.pinnedRelayUrl ?? 'https://relay-b.example.test',
              targetMode: 'pinned',
              releaseChannel: 'stable',
              happierHomeDir: home,
              managedBy: initial.pinnedUserOwned ? null : 'desktop',
            }, ...(initial.extraPinned ? [{ serverId: 'relay-c', activeServerId: 'relay-c', relayUrl: 'https://relay-c.example.test', targetMode: 'pinned', releaseChannel: 'stable', happierHomeDir: home, managedBy: 'desktop' }] : [])],
          };
        }
        if (command.startsWith('daemon service ') && initial.mutationFailures?.includes(instance)) {
          return { ok: false, message: `mutation failed for ${instance}` };
        }
        if (command.startsWith('daemon service start')) service.running = true;
        if (command.startsWith('daemon service stop')) service.running = false;
        const autostart = /--autostart=(at-login|on-demand)/.exec(command)?.[1];
        if (autostart === 'at-login' || autostart === 'on-demand') service.autostart = autostart;
        if (command.startsWith('daemon service ') && initial.mutationErrorsAfterApply?.includes(instance)) {
          return { ok: false, message: `command failed after applying ${instance}` };
        }
        if (command !== 'daemon status --json') return { ok: true };
        if (instance !== 'default' && initial.pinnedStatusFails) throw new Error('unreadable service definition');
        const base = service.running ? RUNNING_JSON : STOPPED_STATUS_JSON;
        const installed = instance === 'default' ? !initial.defaultMissing : initial.pinnedInstalled ?? true;
        return {
          ...base,
          auth: { ...base.auth, needsAuth: instance !== 'default' && initial.pinnedNeedsAuth === true },
          service: { ...base.service, installed, running: installed && service.running, autostart: service.autostart, targetMode: instance === 'default' ? 'default-following' : 'pinned' },
          server: instance === 'default' ? base.server : { ...base.server, serverUrl: instance === 'relay-b' ? initial.pinnedRelayUrl ?? 'https://relay-b.example.test' : 'https://relay-c.example.test', publicServerUrl: instance === 'relay-b' ? initial.pinnedRelayUrl ?? 'https://relay-b.example.test' : 'https://relay-c.example.test', comparableKey: null },
        };
      });
      return services;
    }

    function commandsFor(instance: string): string[] {
      return cliJsonResponseMock.mock.calls
        .map(([call]) => call as CliCall)
        .filter((call) => (call.env?.HAPPIER_DAEMON_SERVICE_INSTANCE_ID ?? 'default') === instance)
        .map((call) => call.args.join(' '));
    }

    it('applies the login-start mode to each pinned service and proves it', async () => {
      const services = answerCli({ defaultRunning: true, pinnedRunning: true, autostart: 'at-login' });

      await collectResult(createDaemonServiceAutostartSetHandler(), { ...PARAMS, autostart: 'on-demand' });

      expect(commandsFor('relay-b')).toContain('daemon service install --autostart=on-demand --json');
      expect(services['relay-b']?.autostart).toBe('on-demand');
    });

    it.each(['stop', 'autostart'] as const)('attempts and re-reads every managed service after %s failures, then names all failures', async (action) => {
      const services = answerCli({ defaultRunning: true, pinnedRunning: true, autostart: 'at-login', extraPinned: true, mutationFailures: ['default', 'relay-b'] });
      const handler = action === 'stop' ? createDaemonServiceStopHandler() : createDaemonServiceAutostartSetHandler();
      await expect(collectResult(handler, { ...PARAMS, ...(action === 'autostart' ? { autostart: 'on-demand' } : {}) }))
        .rejects.toMatchObject({ code: 'cli_command_failed', message: expect.stringMatching(/default-following:[\s\S]*https:\/\/relay-b\.example\.test:/) });
      expect(commandsFor('relay-b').filter((command) => command === 'daemon status --json')).toHaveLength(2);
      expect(commandsFor('default')).toContain('daemon status --json');
      expect(action === 'stop' ? services['relay-c']?.running : services['relay-c']?.autostart).toBe(action === 'stop' ? false : 'on-demand');
    });

    it('sets login start on pinned services even when the default service is absent', async () => {
      const services = answerCli({ defaultRunning: false, pinnedRunning: true, autostart: 'at-login', defaultMissing: true });
      const answer = cliJsonResponseMock.getMockImplementation()!;
      cliJsonResponseMock.mockImplementation(async (call: CliCall) => {
        if (!call.env?.HAPPIER_DAEMON_SERVICE_INSTANCE_ID && call.args[2] === 'install') throw new Error('default service absent');
        return answer(call);
      });
      await collectResult(createDaemonServiceAutostartSetHandler(), { ...PARAMS, autostart: 'on-demand' });
      expect(services['relay-b']?.autostart).toBe('on-demand');
    });

    it.each(['stop', 'autostart'] as const)('accepts a confirmed %s change despite an error returned after the command applied it', async (action) => {
      const services = answerCli({ defaultRunning: true, pinnedRunning: true, autostart: 'at-login', mutationErrorsAfterApply: ['default', 'relay-b'] });
      await collectResult(action === 'stop' ? createDaemonServiceStopHandler() : createDaemonServiceAutostartSetHandler(), {
        ...PARAMS, ...(action === 'autostart' ? { autostart: 'on-demand' } : {}),
      });
      expect(action === 'stop' ? services['relay-b']?.running : services['relay-b']?.autostart).toBe(action === 'stop' ? false : 'on-demand');
    });

    it('handles readable managed services when the default status read fails', async () => {
      const services = answerCli({ defaultRunning: true, pinnedRunning: true, autostart: 'on-demand' });
      const answer = cliJsonResponseMock.getMockImplementation()!;
      cliJsonResponseMock.mockImplementation(async (call: CliCall) => {
        if (!call.env?.HAPPIER_DAEMON_SERVICE_INSTANCE_ID && call.args[1] === 'status') throw new Error('default status unavailable');
        return answer(call);
      });
      await expect(collectResult(createDaemonServiceStopHandler(), PARAMS)).rejects.toMatchObject({ message: expect.stringContaining('default-following: default status unavailable') });
      expect(services['relay-b']?.running).toBe(false);
    });

    it('honors cancellation rather than continuing bulk changes after an aborted command', async () => {
      const services = answerCli({ defaultRunning: true, pinnedRunning: true, autostart: 'on-demand' });
      const answer = cliJsonResponseMock.getMockImplementation()!;
      const controller = new AbortController();
      cliJsonResponseMock.mockImplementation(async (call: CliCall) => {
        if (call.args[2] === 'stop') {
          controller.abort(new Error('cancelled by user'));
          throw controller.signal.reason;
        }
        return answer(call);
      });
      const iterator = createDaemonServiceStopHandler()(PARAMS, { signal: controller.signal });
      await iterator.next();
      await expect(iterator.next()).rejects.toThrow('cancelled by user');
      expect(services['relay-b']?.running).toBe(true);
      expect(commandsFor('relay-b')).not.toContain('daemon service stop --json');
    });

    it('stops each running pinned service as the app quits on demand', async () => {
      const services = answerCli({ defaultRunning: true, pinnedRunning: true, autostart: 'on-demand' });

      await collectResult(createDaemonServiceStopHandler(), PARAMS);

      expect(commandsFor('relay-b')).toContain('daemon service stop --json');
      expect(services['relay-b']?.running).toBe(false);
    });

    it('never reads an unreadable pinned inventory as "none": quit-stop and the toggle fail by name (F4/M6)', async () => {
      answerCli({ defaultRunning: true, pinnedRunning: true, autostart: 'on-demand', pinnedStatusFails: true });
      await expect(collectResult(createDaemonServiceStopHandler(), PARAMS)).rejects.toMatchObject({ code: 'pinned_services_unknown' });

      answerCli({ defaultRunning: true, pinnedRunning: true, autostart: 'at-login', pinnedStatusFails: true });
      await expect(collectResult(createDaemonServiceAutostartSetHandler(), { ...PARAMS, autostart: 'on-demand' }))
        .rejects.toMatchObject({ code: 'pinned_services_unknown' });
    });

    it('starts the relay\'s own service even when the default-following one cannot start (M5)', async () => {
      const services = answerCli({ defaultRunning: false, pinnedRunning: false, autostart: 'on-demand', defaultMissing: true });

      const { result } = await collectResult(createDaemonServiceStartHandler(), PARAMS);

      expect(services['relay-b']?.running).toBe(true);
      expect(commandsFor('default')).not.toContain('daemon service start --json');
      expect(result).toMatchObject({
        targets: [
          { target: 'default-following', outcome: 'failed', code: 'daemon_service_not_installed' },
          { target: 'https://relay-b.example.test', outcome: 'started' },
        ],
      });
    });

    it('never starts, stops or rewrites a pinned service the user set up (H2)', async () => {
      const services = answerCli({ defaultRunning: false, pinnedRunning: false, autostart: 'on-demand', pinnedUserOwned: true });
      await collectResult(createDaemonServiceStartHandler(), PARAMS);
      expect(services['relay-b']?.running).toBe(false);

      answerCli({ defaultRunning: true, pinnedRunning: true, autostart: 'on-demand', pinnedUserOwned: true });
      await collectResult(createDaemonServiceStopHandler(), PARAMS);
      await collectResult(createDaemonServiceAutostartSetHandler(), { ...PARAMS, autostart: 'at-login' });
      expect(commandsFor('relay-b').filter((command) => !command.startsWith('daemon status'))).toEqual([]);
    });

    it('disconnects this computer from a relay by uninstalling the app\'s own service for it, proven by a re-read (H3)', async () => {
      answerCli({ defaultRunning: true, pinnedRunning: true, autostart: 'at-login' });
      let uninstalled = false;
      const answer = cliJsonResponseMock.getMockImplementation()!;
      cliJsonResponseMock.mockImplementation(async (call: CliCall) => {
        const command = call.args.join(' ');
        if (command.startsWith('daemon service uninstall')) {
          uninstalled = true;
          return { ok: true, platform: 'linux' };
        }
        if (command === 'daemon service list --json' && uninstalled) return { capabilities: { pinnedServiceCoexistence: true }, entries: [] };
        return await answer(call);
      });

      const { result } = await collectResult(createDaemonServiceRelayDisconnectHandler(), { ...PARAMS, relayUrl: 'https://relay-b.example.test' });

      expect(commandsFor('relay-b')).toContain('daemon service uninstall --instance relay-b --json');
      expect(result).toEqual({ removed: true });
    });

    it('never acquires a CLI to disconnect: with none installed there is nothing the app set up to remove (R10-1)', async () => {
      const emptyHome = mkdtempSync(join(tmpdir(), 'hsetup-disconnect-no-cli-'));
      vi.stubEnv('HOME', emptyHome);
      vi.stubEnv('USERPROFILE', emptyHome);
      vi.stubEnv('HAPPIER_HOME_DIR', emptyHome);
      onTestFinished(() => rmSync(emptyHome, { recursive: true, force: true }));

      const { result } = await collectResult(createDaemonServiceRelayDisconnectHandler(), { ...PARAMS, relayUrl: 'https://relay-b.example.test' });

      expect(result).toEqual({ removed: false });
      expect(cliVersionResponseMock).not.toHaveBeenCalled();
      expect(cliJsonResponseMock).not.toHaveBeenCalled();
    });

    it('has nothing to remove on a CLI too old to list services, and names a real list failure (R10-1)', async () => {
      cliJsonResponseMock.mockImplementation(async () => {
        throw new Error('unknown command: list');
      });
      cliVersionResponseMock.mockReturnValueOnce('0.2.10');
      await expect(collectResult(createDaemonServiceRelayDisconnectHandler(), { ...PARAMS, relayUrl: 'https://relay-b.example.test' }))
        .resolves.toMatchObject({ result: { removed: false } });

      await expect(collectResult(createDaemonServiceRelayDisconnectHandler(), { ...PARAMS, relayUrl: 'https://relay-b.example.test' }))
        .rejects.toMatchObject({ code: 'pinned_services_unknown' });
    });

    it('never uninstalls a relay service the user set up (H3)', async () => {
      answerCli({ defaultRunning: true, pinnedRunning: true, autostart: 'at-login', pinnedUserOwned: true });

      await expect(collectResult(createDaemonServiceRelayDisconnectHandler(), { ...PARAMS, relayUrl: 'https://relay-b.example.test' }))
        .rejects.toMatchObject({ code: 'service_user_owned' });
      expect(commandsFor('relay-b').some((command) => command.startsWith('daemon service uninstall'))).toBe(false);
    });

    it('does not report success when the default-following service failed and nothing was started (N3)', async () => {
      answerCli({ defaultRunning: false, pinnedRunning: true, autostart: 'on-demand', defaultMissing: true });

      await expect(collectResult(createDaemonServiceStartHandler(), PARAMS)).rejects.toMatchObject({ code: 'daemon_service_not_installed' });
    });

    /**
     * R16 — the one owner of "this computer's services, one row per relay": the status result
     * carries the rows (state judged against each relay's own validated account, who manages the
     * service, the actions the app may take), and both the web UI and the native tray render them.
     */
    it('reports one row per relay with its state, its manager and the actions the app may take', async () => {
      answerCli({ defaultRunning: true, pinnedRunning: false, autostart: 'at-login' });
      const { result } = await collectResult(createDaemonServiceStatusHandler(), PARAMS);
      expect(result).toMatchObject({
        pinnedServices: { complete: true },
        runningManagedServiceCount: 1,
        managedServiceAutostart: 'at-login',
        serviceRows: [
          { relayUrl: 'https://relay.example.test', state: 'connected', appManaged: true, serving: 'default-following', actions: ['restart', 'stop'] },
          { relayUrl: 'https://relay-b.example.test', state: 'offline', appManaged: true, serving: 'pinned', actions: ['start'] },
        ],
      });

      answerCli({ defaultRunning: true, pinnedRunning: true, autostart: 'at-login', pinnedUserOwned: true });
      const { result: userOwned } = await collectResult(createDaemonServiceStatusHandler(), PARAMS);
      expect((userOwned as { serviceRows: unknown[] }).serviceRows[1]).toMatchObject({ appManaged: false, actions: [] });
    });

    it('marks the rows incomplete when a service could not be read, and lists no service that is not here', async () => {
      answerCli({ defaultRunning: false, pinnedRunning: true, autostart: 'at-login', pinnedStatusFails: true, defaultMissing: true });
      const { result } = await collectResult(createDaemonServiceStatusHandler(), PARAMS);
      expect(result).toMatchObject({ pinnedServices: { complete: false }, serviceRows: [], runningManagedServiceCount: null, managedServiceAutostart: null });
    });

    it('reports every running managed target even when one relay row hides the default', async () => {
      answerCli({ defaultRunning: true, pinnedRunning: true, autostart: 'on-demand', pinnedRelayUrl: 'https://relay.example.test' });
      const { result } = await collectResult(createDaemonServiceStatusHandler(), { ...PARAMS, relayUrl: 'https://relay.example.test' });
      expect(result).toMatchObject({ runningManagedServiceCount: 2, managedServiceAutostart: 'on-demand', serviceRows: [{ serving: 'pinned' }] });
      expect((result as { serviceRows: unknown[] }).serviceRows).toHaveLength(1);
    });

    it.each(['at-login', null] as const)('reports an unknown managed common mode for a stopped pin declaring %s beside on-demand', async (pinnedMode) => {
      const services = answerCli({ defaultRunning: true, pinnedRunning: false, autostart: 'on-demand' });
      services['relay-b']!.autostart = pinnedMode;
      const { result } = await collectResult(createDaemonServiceStatusHandler(), PARAMS);
      expect(result).toMatchObject({ runningManagedServiceCount: 1, managedServiceAutostart: null, service: { autostart: 'on-demand' } });
    });

    it('reports known zero running targets without erasing stopped targets\' common mode', async () => {
      answerCli({ defaultRunning: false, pinnedRunning: false, autostart: 'on-demand' });
      const { result } = await collectResult(createDaemonServiceStatusHandler(), PARAMS);
      expect(result).toMatchObject({ runningManagedServiceCount: 0, managedServiceAutostart: 'on-demand', pinnedServices: { complete: true } });
    });

    it('uses only installed managed targets for a pinned-only installation and for an empty managed inventory', async () => {
      const services = answerCli({ defaultRunning: true, defaultMissing: true, pinnedRunning: true, autostart: 'on-demand' });
      services.default!.autostart = 'at-login';
      const { result: pinnedOnly } = await collectResult(createDaemonServiceStatusHandler(), PARAMS);
      expect(pinnedOnly).toMatchObject({ runningManagedServiceCount: 1, managedServiceAutostart: 'on-demand', service: { installed: false, autostart: 'at-login' } });

      answerCli({ defaultRunning: true, defaultMissing: true, pinnedRunning: true, autostart: 'at-login', pinnedUserOwned: true });
      const { result: noManagedTargets } = await collectResult(createDaemonServiceStatusHandler(), PARAMS);
      expect(noManagedTargets).toMatchObject({ runningManagedServiceCount: 0, managedServiceAutostart: null, pinnedServices: { complete: true } });
    });

    it.each([false, true])('excludes a user-owned pin from managed aggregates even when unreadable=%s', async (pinnedStatusFails) => {
      const services = answerCli({ defaultRunning: true, pinnedRunning: true, autostart: 'on-demand', pinnedUserOwned: true, pinnedStatusFails });
      services['relay-b']!.autostart = 'at-login';
      const { result } = await collectResult(createDaemonServiceStatusHandler(), PARAMS);
      expect(result).toMatchObject({ runningManagedServiceCount: 1, managedServiceAutostart: 'on-demand', pinnedServices: { complete: !pinnedStatusFails } });
    });

    it.each([false, true])('retains default service visibility without offering actions when inventory listing fails (running=%s)', async (defaultRunning) => {
      answerCli({ defaultRunning, pinnedRunning: true, autostart: 'at-login' });
      const answer = cliJsonResponseMock.getMockImplementation()!;
      cliJsonResponseMock.mockImplementation(async (call: CliCall) => {
        if (call.args.join(' ') === 'daemon service list --json') throw new Error('cannot list service inventory');
        return answer(call);
      });
      const { result } = await collectResult(createDaemonServiceStatusHandler(), PARAMS);
      expect(result).toMatchObject({
        pinnedServices: { complete: false },
        runningManagedServiceCount: null,
        managedServiceAutostart: null,
        serviceRows: [{ relayUrl: 'https://relay.example.test', state: defaultRunning ? 'connected' : 'offline', actions: [] }],
      });
      expect((result as { serviceRows: unknown[] }).serviceRows).toHaveLength(1);
    });

    it('keeps actions for a proven default target when only a different listed pin is unreadable', async () => {
      answerCli({ defaultRunning: true, pinnedRunning: true, autostart: 'at-login', pinnedStatusFails: true });
      const { result } = await collectResult(createDaemonServiceStatusHandler(), PARAMS);
      expect(result).toMatchObject({
        pinnedServices: { complete: false },
        serviceRows: [{ relayUrl: 'https://relay.example.test', actions: ['restart', 'stop'] }],
        runningManagedServiceCount: null,
        managedServiceAutostart: null,
      });
    });

    it('projects readable pinned rows even without the coexistence capability', async () => {
      answerCli({ defaultRunning: true, pinnedRunning: true, autostart: 'at-login', coexistence: false });
      const { result } = await collectResult(createDaemonServiceStatusHandler(), PARAMS);
      expect(result).toMatchObject({ pinnedServices: { complete: true, coexistence: false, services: [{ server: { serverUrl: 'https://relay-b.example.test' } }] } });
      expect((result as { serviceRows: unknown[] }).serviceRows).toHaveLength(2);
    });

    it('designates the installed pinned service on equivalent relay URLs and targets it for actions', async () => {
      const services = answerCli({ defaultRunning: true, pinnedRunning: false, autostart: 'at-login', pinnedRelayUrl: 'https://RELAY.example.test:443/' });
      const { result } = await collectResult(createDaemonServiceStatusHandler(), PARAMS);
      expect(result).toMatchObject({ serviceRows: [{ state: 'offline', serving: 'pinned' }] });
      expect((result as { serviceRows: unknown[] }).serviceRows).toHaveLength(1);
      await collectResult(createDaemonServiceStartHandler(), { ...PARAMS, relayUrl: 'https://relay.example.test' });
      expect(services['relay-b']?.running).toBe(true);
      expect(commandsFor('default')).not.toContain('daemon service start --json');
    });

    it('keeps a listed pinned definition authoritative when its status reports no installation', async () => {
      answerCli({ defaultRunning: true, pinnedRunning: false, autostart: 'at-login', pinnedInstalled: false, pinnedRelayUrl: 'https://relay.example.test' });
      const { result } = await collectResult(createDaemonServiceStatusHandler(), PARAMS);
      expect(result).toMatchObject({ serviceRows: [{ serving: 'pinned', state: 'offline', actions: [] }] });
      await expect(collectResult(createDaemonServiceStartHandler(), { ...PARAMS, relayUrl: 'https://relay.example.test' }))
        .rejects.toMatchObject({ code: 'daemon_service_not_installed' });
      expect(commandsFor('default')).not.toContain('daemon service start --json');
    });

    it.each([false, true])('does not offer start/restart when authentication prevents it (running=%s)', async (pinnedRunning) => {
      answerCli({ defaultRunning: false, pinnedRunning, autostart: 'at-login', pinnedNeedsAuth: true });
      const { result } = await collectResult(createDaemonServiceStatusHandler(), PARAMS);
      expect(result).toMatchObject({ serviceRows: [expect.anything(), { serving: 'pinned', actions: pinnedRunning ? ['stop'] : [] }] });
      await expect(collectResult(createDaemonServiceStartHandler(), { ...PARAMS, relayUrl: 'https://relay-b.example.test' }))
        .rejects.toMatchObject({ code: 'not_authenticated' });
    });

    it('does not lose valid rows when one listed relay URL is malformed', async () => {
      answerCli({ defaultRunning: true, pinnedRunning: false, autostart: 'at-login', pinnedRelayUrl: 'not a relay URL' });
      const { result } = await collectResult(createDaemonServiceStatusHandler(), PARAMS);
      expect(result).toMatchObject({ serviceRows: [{ relayUrl: 'https://relay.example.test', serving: 'default-following' }] });
      expect((result as { serviceRows: unknown[] }).serviceRows).toHaveLength(1);
    });

    it('refuses a user-owned or unreadable pinned winner without falling through to the default', async () => {
      for (const pinnedCase of [{ pinnedUserOwned: true }, { pinnedStatusFails: true }]) {
        answerCli({ defaultRunning: true, pinnedRunning: true, autostart: 'at-login', pinnedRelayUrl: 'https://relay.example.test', ...pinnedCase });
        await expect(collectResult(createDaemonServiceStopHandler(), { ...PARAMS, relayUrl: 'https://relay.example.test' }))
          .rejects.toMatchObject({ code: 'pinnedUserOwned' in pinnedCase ? 'service_user_owned' : 'pinned_services_unknown' });
        expect(commandsFor('default')).not.toContain('daemon service stop --json');
        const { result } = await collectResult(createDaemonServiceStatusHandler(), PARAMS);
        expect((result as { serviceRows: { serving: string; appManaged: boolean }[] }).serviceRows)
          .toEqual('pinnedUserOwned' in pinnedCase ? [expect.objectContaining({ serving: 'pinned', appManaged: false })] : []);
      }
    });

    /**
     * R16 — the tray's per-relay Start / Restart / Stop name one relay: only the service that serves
     * it is touched, whichever kind it is, and a service the user set up is refused by name.
     */
    describe('one relay at a time (the tray rows)', () => {
      it('stops only the named relay\'s own service', async () => {
        const services = answerCli({ defaultRunning: true, pinnedRunning: true, autostart: 'at-login' });

        await collectResult(createDaemonServiceStopHandler(), { ...PARAMS, relayUrl: 'https://relay-b.example.test' });

        expect(services['relay-b']?.running).toBe(false);
        expect(services.default?.running).toBe(true);
        expect(commandsFor('default')).not.toContain('daemon service stop --json');
      });

      it('starts only the named relay\'s own service', async () => {
        const services = answerCli({ defaultRunning: false, pinnedRunning: false, autostart: 'at-login' });

        const { result } = await collectResult(createDaemonServiceStartHandler(), { ...PARAMS, relayUrl: 'https://relay-b.example.test' });

        expect(services['relay-b']?.running).toBe(true);
        expect(services.default?.running).toBe(false);
        expect(result).toMatchObject({ targets: [{ target: 'https://relay-b.example.test', outcome: 'started' }] });
      });

      it('reaches the default-following service through the relay it serves', async () => {
        const services = answerCli({ defaultRunning: true, pinnedRunning: true, autostart: 'at-login' });

        await collectResult(createDaemonServiceStopHandler(), { ...PARAMS, relayUrl: 'https://relay.example.test/' });

        expect(services.default?.running).toBe(false);
        expect(services['relay-b']?.running).toBe(true);
      });

      it('refuses a relay whose service the user set up, and one with no service here', async () => {
        answerCli({ defaultRunning: true, pinnedRunning: true, autostart: 'at-login', pinnedUserOwned: true });
        await expect(collectResult(createDaemonServiceStopHandler(), { ...PARAMS, relayUrl: 'https://relay-b.example.test' }))
          .rejects.toMatchObject({ code: 'service_user_owned' });
        await expect(collectResult(createDaemonServiceStartHandler(), { ...PARAMS, relayUrl: 'https://relay-b.example.test' }))
          .rejects.toMatchObject({ code: 'service_user_owned' });
        expect(commandsFor('relay-b').filter((command) => !command.startsWith('daemon status'))).toEqual([]);

        await expect(collectResult(createDaemonServiceStopHandler(), { ...PARAMS, relayUrl: 'https://nowhere.example.test' }))
          .rejects.toMatchObject({ code: 'daemon_service_not_found' });
      });
    });

    it('starts each stopped pinned service as the app opens', async () => {
      const services = answerCli({ defaultRunning: false, pinnedRunning: false, autostart: 'on-demand' });

      await collectResult(createDaemonServiceStartHandler(), PARAMS);

      expect(commandsFor('relay-b')).toContain('daemon service start --json');
      expect(services['relay-b']?.running).toBe(true);
      expect(services.default?.running).toBe(true);
    });
  });
});
