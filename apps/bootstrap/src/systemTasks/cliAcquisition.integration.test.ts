import { execFileSync } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { prepareFirstPartyComponentPayloadFromGitHubRelease } from '@happier-dev/cli-common/firstPartyRuntime';
import { executeSystemTask } from '@happier-dev/cli-common/systemTasks';
import type { CliAcquisitionProgress, DoctorSnapshotDaemonStatus, SystemTaskEvent } from '@happier-dev/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { acquireManagedLocalFirstPartyComponentCommand } from './localFirstPartyCommand.js';
import { createHsetupSystemTaskRegistry } from './registry.js';

const VERSION = '0.2.13';
const ARCHIVE = `happier-v${VERSION}-${process.platform}-${process.arch}.tar.gz`;
const CHECKSUMS = `checksums-happier-v${VERSION}.txt`;
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  vi.restoreAllMocks();
  syncBuiltinESMExports();
  vi.unstubAllEnvs();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function createReleaseFixture({ useReleaseSourceOverride = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'hsetup-acquisition-test-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const payload = join(root, 'payload');
  await mkdir(payload);
  const daemonStatus = {
    server: { activeServerId: 'cloud', serverUrl: 'https://relay.example.test', localServerUrl: null,
      publicServerUrl: 'https://relay.example.test', webappUrl: 'https://app.example.test', comparableKey: 'relay.example.test' },
    daemon: { running: false, pid: null, httpPort: null }, service: { installed: false, running: false },
    auth: { authenticated: false, machineRegistered: false, machineId: null, needsAuth: true, accountId: null },
  } satisfies DoctorSnapshotDaemonStatus;
  // A real executable at the process boundary; all installation and task internals stay real.
  await writeFile(join(payload, 'happier'), `#!${process.execPath}
if (process.argv.includes('--version')) console.log('${VERSION}');
else console.log(JSON.stringify(${JSON.stringify(daemonStatus)}));
`);
  await chmod(join(payload, 'happier'), 0o755);
  const archivePath = join(root, ARCHIVE);
  execFileSync('tar', ['-czf', archivePath, '-C', root, 'payload']);
  const archive = await readFile(archivePath);
  const checksums = Buffer.from(`${createHash('sha256').update(archive).digest('hex')} ${ARCHIVE}\n`);
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const keyId = Buffer.from('0123456789abcdef', 'hex');
  const publicBytes = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  const minisignPubkeyFile = `untrusted comment: test key\n${Buffer.concat([Buffer.from('Ed'), keyId, publicBytes]).toString('base64')}\n`;
  const signature = sign(null, checksums, privateKey);
  const signatureFile = Buffer.from([
    'untrusted comment: test signature',
    Buffer.concat([Buffer.from('Ed'), keyId, signature]).toString('base64'),
    'trusted comment: test',
    sign(null, Buffer.concat([signature, Buffer.from('test')]), privateKey).toString('base64'),
    '',
  ].join('\n'));
  const bodies = new Map([[ARCHIVE, archive], [CHECKSUMS, checksums], [`${CHECKSUMS}.minisig`, signatureFile]]);
  let downloadStatus = 200;
  let archiveRequests = 0;
  let holdArchive = false;
  let releaseArchive: (() => void) | undefined;
  let baseUrl = '';
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url ?? '/', baseUrl).pathname;
    if (pathname.startsWith('/repos/')) {
      res.end(JSON.stringify({ assets: [...bodies.keys()].map((name) => ({
        name, browser_download_url: `${baseUrl.replace('http://', 'http://fixture-user:fixture-password@')}/${name}?token=fixture-secret`,
      })) }));
      return;
    }
    const name = pathname.slice(1);
    const bytes = bodies.get(name);
    if (!bytes) { res.writeHead(404).end(); return; }
    if (downloadStatus !== 200) { res.writeHead(downloadStatus).end(); return; }
    if (name === ARCHIVE) {
      archiveRequests += 1;
      res.setHeader('content-length', bytes.length);
      if (holdArchive) {
        res.write(bytes.subarray(0, 10));
        releaseArchive = () => res.end(bytes.subarray(10));
        return;
      }
    }
    res.end(bytes);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture address');
  baseUrl = `http://127.0.0.1:${address.port}`;
  cleanups.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });
  if (useReleaseSourceOverride) {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('HAPPIER_FIRST_PARTY_RELEASE_API_BASE_URL', baseUrl);
  } else {
    // Redirect only the network boundary. GitHub parsing, download, verification and extraction run normally.
    vi.spyOn(https, 'request').mockImplementation((url, options, callback) => {
      const parsed = new URL(String(url));
      if (parsed.hostname !== 'api.github.com') throw new Error(`Unexpected external request: ${parsed.origin}`);
      return http.request(`${baseUrl}${parsed.pathname}`, options, callback);
    });
    syncBuiltinESMExports();
  }
  const processEnv: NodeJS.ProcessEnv = { ...process.env, HOME: root, USERPROFILE: root, HAPPIER_HOME_DIR: join(root, 'home'), HAPPIER_STACK_REPO_DIR: root, HAPPIER_MINISIGN_PUBKEY: minisignPubkeyFile, PATH: '' };
  delete processEnv.HAPPIER_BOOTSTRAP_CLI_PATH;
  delete processEnv.HAPPIER_BOOTSTRAP_HAPPIER_PATH;
  return {
    root, archive, minisignPubkeyFile, processEnv,
    failDownload: () => { downloadStatus = 403; },
    holdArchive: () => { holdArchive = true; },
    releaseArchive: () => releaseArchive?.(),
    archiveRequests: () => archiveRequests,
  };
}

function useFixtureEnvironment(env: NodeJS.ProcessEnv) {
  for (const name of ['HOME', 'USERPROFILE', 'HAPPIER_HOME_DIR', 'HAPPIER_STACK_REPO_DIR', 'HAPPIER_MINISIGN_PUBKEY', 'HAPPIER_BOOTSTRAP_CLI_PATH', 'HAPPIER_BOOTSTRAP_HAPPIER_PATH', 'PATH']) {
    vi.stubEnv(name, env[name]);
  }
}

async function runStatus(events: SystemTaskEvent[]) {
  return await executeSystemTask({
    spec: { protocolVersion: 1, kind: 'daemon.service.status.v1', params: { target: { kind: 'local' }, releaseRing: 'stable' } },
    taskId: 'acquisition-integration',
    registry: createHsetupSystemTaskRegistry(),
    emitEvent: (event) => { events.push(event); },
  });
}

// The executable fixture and tar producer use POSIX host tools; Windows transport/unit coverage is separate.
describe.skipIf(process.platform === 'win32')('CLI acquisition through real release and task owners', () => {
  it('reports transfer before completion, installs the signed payload, then inspects the managed CLI without downloading again', async () => {
    const fixture = await createReleaseFixture({ useReleaseSourceOverride: true });
    fixture.holdArchive();
    const progress: CliAcquisitionProgress[] = [];
    let settled = false;
    const acquisition = acquireManagedLocalFirstPartyComponentCommand({
      componentId: 'happier-cli', releaseRing: 'stable', processEnv: fixture.processEnv,
      onProgress: (event) => { progress.push(event); },
    }, {
      preparePayload: (params) => prepareFirstPartyComponentPayloadFromGitHubRelease({
        ...params, minisignPubkeyFile: fixture.minisignPubkeyFile,
      }),
    }).finally(() => { settled = true; });
    try {
      await vi.waitFor(() => expect(progress).toContainEqual({ phase: 'downloading', receivedBytes: 10, totalBytes: fixture.archive.length }));
      expect(settled).toBe(false);
    } finally {
      fixture.releaseArchive();
      await acquisition.catch(() => undefined);
    }
    const installed = await acquisition;
    expect(installed.provenance).toBe('managed');
    expect(existsSync(installed.command)).toBe(true);
    expect([...new Set(progress.map((event) => event.phase))]).toEqual([
      'resolvingRelease', 'downloading', 'verifying', 'unpacking', 'installing', 'finalizing',
    ]);
    useFixtureEnvironment(fixture.processEnv);
    const events: SystemTaskEvent[] = [];
    const statusResult = await runStatus(events);
    expect(statusResult, JSON.stringify(statusResult)).toMatchObject({ ok: true, data: {
      needsAuth: true, acquisition: { provenance: 'managed', version: VERSION, command: installed.command },
    } });
    expect(fixture.archiveRequests()).toBe(1);
    expect(events.filter((event) => event.type === 'cli.acquisition.progress').map((event) => event.data)).toEqual([
      { phase: 'checkingCli' }, { phase: 'checkingDaemon' },
    ]);
  });

  it('preserves the download failure phase and safe diagnostic through the task result and events', async () => {
    const fixture = await createReleaseFixture();
    fixture.failDownload();
    useFixtureEnvironment(fixture.processEnv);
    const events: SystemTaskEvent[] = [];
    const result = await runStatus(events);
    expect(result, JSON.stringify(result)).toMatchObject({ ok: false, error: { code: 'cli_acquisition_downloading_failed' } });
    expect(events).toContainEqual(expect.objectContaining({
      type: 'cli.acquisition.progress', stepId: 'setup.thisComputer.ensureCli',
      data: { phase: 'downloading', failure: { cause: 'HTTP_403' } },
    }));
    expect(JSON.stringify({ result, events })).not.toContain('fixture-secret');
    expect(JSON.stringify({ result, events })).not.toContain('fixture-password');
    expect(JSON.stringify(result)).toContain('403');
  });

  it('aborts an in-flight archive transfer and removes its scratch payload without installing', async () => {
    const fixture = await createReleaseFixture();
    fixture.holdArchive();
    vi.stubEnv('TMPDIR', fixture.root);
    const controller = new AbortController();
    const progress: CliAcquisitionProgress[] = [];
    const preparation = acquireManagedLocalFirstPartyComponentCommand({
      componentId: 'happier-cli', releaseRing: 'stable', processEnv: fixture.processEnv,
      signal: controller.signal,
      onProgress: (event) => { progress.push(event); },
    }, {
      preparePayload: (params) => prepareFirstPartyComponentPayloadFromGitHubRelease({
        ...params, minisignPubkeyFile: fixture.minisignPubkeyFile,
      }),
    });
    const rejection = expect(preparation).rejects.toMatchObject({ name: 'AbortError' });
    try {
      await vi.waitFor(() => expect(progress.some((event) => event.phase === 'downloading' && event.receivedBytes === 10)).toBe(true));
      expect((await readdir(fixture.root)).filter((name) => name.startsWith('happier-first-party-'))).toHaveLength(1);
    } finally {
      controller.abort();
    }
    await rejection;
    expect((await readdir(fixture.root)).filter((name) => name.startsWith('happier-first-party-'))).toEqual([]);
    expect(existsSync(join(fixture.root, 'home'))).toBe(false);
    expect(progress.some((event) => event.phase === 'installing')).toBe(false);
  });
});
