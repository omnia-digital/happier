import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import * as tar from 'tar';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => ({
  home: '',
  publicKey: '',
  release: { assets: [] as Array<{ name: string; browser_download_url: string }> },
  requests: [] as string[],
  offline: false,
  releaseWait: null as Promise<void> | null,
}));

// Configuration, release HTTP transport and signing authority are external boundaries.
// Resolution, signature verification, extraction, promotion and capability logic stay real.
vi.mock('@/configuration', () => ({
  configuration: {
    get happyHomeDir() { return boundary.home; },
    get logsDir() { return join(boundary.home, 'logs'); },
    get settingsFile() { return join(boundary.home, 'settings.json'); },
    get activeServerDir() { return join(boundary.home, 'servers', 'fixture'); },
    currentCliVersion: '0.2.13-dev.6',
    publicReleaseRing: 'publicdev',
    isDaemonProcess: false,
    memoryMaxTranscriptWindowMessages: 500,
  },
}));
vi.mock('@happier-dev/release-runtime/http', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    requestJson: async ({ url }: { url: string }) => {
      boundary.requests.push(url);
      await boundary.releaseWait;
      if (boundary.offline) throw new Error('offline fixture');
      return boundary.release;
    },
  };
});
vi.mock('@happier-dev/release-runtime/minisign', async (importOriginal) => ({
  ...await importOriginal<typeof import('@happier-dev/release-runtime/minisign')>(),
  get DEFAULT_MINISIGN_PUBLIC_KEY() { return boundary.publicKey; },
}));
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: (path: Parameters<typeof actual.existsSync>[0]) => {
      const normalized = String(path).replaceAll('\\', '/');
      if (normalized.includes('/tools/unpacked/difft')) return false;
      return actual.existsSync(path);
    },
  };
});

import { installableDepCapabilities } from '@/capabilities/registry/installableDeps';
import { createFeatureExtractionPipelineWithFallback } from '@/daemon/memory/deepIndex/embeddings/createLocalTransformersEmbeddingsProvider';
import { registerDifftasticHandler } from '@/rpc/handlers/difftastic';
import { setActiveAccountSettingsSnapshot, resetActiveAccountSettingsSnapshotForTests } from '@/settings/accountSettings/activeAccountSettingsSnapshot';
import { accountSettingsParse } from '@happier-dev/protocol';
import { resolveEmbeddingsProvider } from '@/daemon/memory/deepIndex/embeddings/resolveEmbeddingsProvider';
import { resolveOperationalMemoryEmbeddingsSettings } from '@/daemon/memory/resolveOperationalMemoryEmbeddingsSettings';

function publishAccountSettings(
  settings = accountSettingsParse({}),
  source: 'network' | 'cache' | 'none' = 'cache',
) {
  setActiveAccountSettingsSnapshot({
    source,
    loadedAtMs: Date.now(),
    settingsVersion: 1,
    settingsSecretsReadKeys: [],
    settings,
  });
}

function memoryCapability() {
  const capability = installableDepCapabilities.find((candidate) => candidate.descriptor.id === 'dep.local-embeddings');
  expect(capability, 'Local embeddings must expose explicit installation for offline preparation').toBeDefined();
  return capability!;
}

async function prepareSignedMemoryRelease(kind: 'memory' | 'difftastic' = 'memory') {
  const root = join(boundary.home, 'fixture', kind);
  const entryName = kind === 'memory' ? 'node_modules/@huggingface/transformers/dist/transformers.node.mjs' : 'difft';
  const entry = join(root, entryName);
  await mkdir(dirname(entry), { recursive: true });
  await writeFile(entry, kind === 'memory'
    ? 'export const env = {}; export function pipeline() { return async () => ({ data: new Float32Array([1, 0]), dims: [1, 2] }); }\n'
    : '#!/bin/sh\nprintf "Difftastic acquired fixture\\n"\n');
  await chmod(entry, 0o755);
  const chunks: Buffer[] = [];
  for await (const chunk of tar.c({ cwd: dirname(root), gzip: true }, [kind])) chunks.push(Buffer.from(chunk));
  const bytes = Buffer.concat(chunks);
  const os = process.platform === 'win32' ? 'windows' : process.platform;
  const product = kind === 'memory' ? 'happier-memory-runtime' : 'happier-difftastic';
  const version = '0.2.13-dev.6';
  const archiveName = `${product}-v${version}-${os}-${process.arch}.tar.gz`;
  const checksumName = `checksums-${product}-v${version}.txt`;
  const checksums = `${createHash('sha256').update(bytes).digest('hex')}  ${archiveName}\n`;
  const keys = generateKeyPairSync('ed25519');
  const keyId = Buffer.from('0123456789abcdef', 'hex');
  const publicBytes = Buffer.from(keys.publicKey.export({ format: 'jwk' }).x!, 'base64url');
  boundary.publicKey = `untrusted comment: test key\n${Buffer.concat([Buffer.from('Ed'), keyId, publicBytes]).toString('base64')}\n`;
  const signature = sign(null, Buffer.from(checksums), keys.privateKey);
  const suffix = Buffer.from('test');
  const signedFile = [
    'untrusted comment: test signature',
    Buffer.concat([Buffer.from('Ed'), keyId, signature]).toString('base64'),
    'trusted comment: test',
    sign(null, Buffer.concat([signature, suffix]), keys.privateKey).toString('base64'),
  ].join('\n');
  const asset = (name: string, content: Buffer | string) => ({
    name,
    browser_download_url: `data:application/octet-stream;base64,${Buffer.from(content).toString('base64')}`,
  });
  boundary.release = { assets: [asset(archiveName, bytes), asset(checksumName, checksums), asset(`${checksumName}.minisig`, signedFile)] };
}

beforeEach(async () => {
  boundary.home = await mkdtemp(join(tmpdir(), 'happier-optional-runtime-'));
  boundary.requests = [];
  boundary.offline = false;
  boundary.releaseWait = null;
  vi.stubEnv('HAPPIER_HOME_DIR', boundary.home);
  await prepareSignedMemoryRelease();
  await writeFile(join(boundary.home, 'settings.json'), JSON.stringify({ schemaVersion: 1, machineId: 'fixture-machine' }));
});

afterEach(async () => {
  await rm(boundary.home, { recursive: true, force: true });
  vi.unstubAllEnvs();
  resetActiveAccountSettingsSnapshotForTests();
});

describe('optional runtime installation through capabilities', () => {
  it('exposes pending acquisition and shares simultaneous explicit installs', async () => {
    let resume = () => {};
    boundary.releaseWait = new Promise<void>((resolve) => { resume = resolve; });
    const capability = memoryCapability();
    const first = capability.invoke!({ method: 'install' });
    const second = capability.invoke!({ method: 'install' });
    try {
      expect(await capability.detect({ request: { id: 'dep.local-embeddings' }, context: { cliSnapshot: null } })).toMatchObject({ installed: false, runtimeState: 'downloading' });
    } finally {
      resume();
    }
    expect(await first).toMatchObject({ ok: true });
    expect(await second).toMatchObject({ ok: true });
    expect(boundary.requests).toHaveLength(1);
  });
  it('does not acquire a local runtime for disabled or remote embeddings', async () => {
    expect(await resolveEmbeddingsProvider({ settings: null, cacheDir: boundary.home })).toMatchObject({ provider: null, usingFallback: false });
    const settings = resolveOperationalMemoryEmbeddingsSettings({
      mode: 'custom', presetId: 'balanced', blend: { ftsWeight: 0.7, embeddingWeight: 0.3 },
      custom: { kind: 'openai_compatible', baseUrl: 'https://example.test/v1', model: 'fixture', dimensions: null, apiKey: { _isSecretValue: true, value: 'fixture-key' } },
    });
    expect(await resolveEmbeddingsProvider({ settings, cacheDir: boundary.home })).toMatchObject({ runtimeState: 'ready', providerKind: 'openai_compatible' });
    expect(boundary.requests).toEqual([]);
  });
  it('does not acquire during detection, explicitly installs verified bytes, and detects them offline', async () => {
    const capability = memoryCapability();
    const detect = () => capability.detect({ request: { id: 'dep.local-embeddings' }, context: { cliSnapshot: null } });
    expect(await detect()).toMatchObject({ installed: false });
    expect(boundary.requests).toEqual([]);
    const installed = await capability.invoke!({ method: 'install' });
    expect(installed).toMatchObject({ ok: true });
    expect(boundary.requests).toEqual([expect.stringContaining('/releases/tags/cli-v0.2.13-dev.6')]);
    boundary.offline = true;
    const status = await detect();
    expect(status).toMatchObject({ installed: true, installedVersion: '0.2.13-dev.6' });
    expect(boundary.requests).toHaveLength(1);
    expect(status).toHaveProperty('binPath');
    const entry = (status as { binPath: string }).binPath;
    expect(await readFile(entry, 'utf8')).toContain('export function pipeline');
  });

  it('reports acquisition failure and allows explicit retry without publishing an incomplete runtime', async () => {
    const capability = memoryCapability();
    boundary.offline = true;
    expect(await capability.invoke!({ method: 'install' })).toMatchObject({ ok: false, error: { code: 'install-failed' } });
    expect(await capability.detect({ request: { id: 'dep.local-embeddings' }, context: { cliSnapshot: null } })).toMatchObject({ installed: false });
    boundary.offline = false;
    expect(await capability.invoke!({ method: 'install' })).toMatchObject({ ok: true });
  });

  it('acquires the absent local inference runtime on first use and reuses it offline', async () => {
    publishAccountSettings();
    const load = () => createFeatureExtractionPipelineWithFallback({
      modelId: 'fixture/model',
      cacheDir: join(boundary.home, 'models'),
      packageImport: async () => { throw new Error("Cannot find module '@huggingface/transformers'"); },
      runtimeAssetExists: () => false,
      runtimeImport: (moduleUrl) => import(/* @vite-ignore */ moduleUrl),
    });
    const extractor = await load();
    expect(await extractor('query')).toMatchObject({ dims: [1, 2] });
    expect(boundary.requests).toHaveLength(1);
    boundary.offline = true;
    expect(await (await load())('query')).toMatchObject({ dims: [1, 2] });
    expect(boundary.requests).toHaveLength(1);
  });

  it('defers automatic acquisition until policy is available while preserving explicit install and offline reuse', async () => {
    const load = () => createFeatureExtractionPipelineWithFallback({
      modelId: 'fixture/model',
      cacheDir: join(boundary.home, 'models'),
      packageImport: async () => { throw new Error("Cannot find module '@huggingface/transformers'"); },
      runtimeAssetExists: () => false,
      runtimeImport: (moduleUrl) => import(/* @vite-ignore */ moduleUrl),
    });

    await expect(load()).rejects.toThrow(/deferred until account settings are available/);
    expect(boundary.requests).toEqual([]);

    publishAccountSettings(accountSettingsParse({}), 'none');
    await expect(load()).rejects.toThrow(/deferred until account settings are available/);
    expect(boundary.requests).toEqual([]);

    expect(await memoryCapability().invoke!({ method: 'install' })).toMatchObject({ ok: true });
    expect(boundary.requests).toHaveLength(1);

    boundary.offline = true;
    expect(await (await load())('query')).toMatchObject({ dims: [1, 2] });
    expect(boundary.requests).toHaveLength(1);
  });

  it('retries a failed worker epoch once after explicit installation succeeds', async () => {
    vi.doMock('@huggingface/transformers', async () => {
      const { access } = await import('node:fs/promises');
      const { join } = await import('node:path');
      const { resolveFirstPartyVersionInstallPath } = await import('@happier-dev/cli-common/firstPartyRuntime');
      return {
        env: {},
        pipeline: async () => {
          await access(join(
            resolveFirstPartyVersionInstallPath({
              componentId: 'happier-memory-runtime',
              versionId: '0.2.13-dev.6',
              channel: 'publicdev',
              processEnv: { ...process.env, HAPPIER_HOME_DIR: boundary.home },
            }),
            'node_modules',
            '@huggingface',
            'transformers',
            'dist',
            'transformers.node.mjs',
          ));
          return async () => ({ data: new Float32Array([1, 0]), dims: [1, 2] });
        },
      };
    });
    const { writeMemorySettingsToDisk } = await import('@/settings/memorySettings');
    await writeMemorySettingsToDisk({
      v: 1,
      enabled: true,
      indexMode: 'deep',
      embeddings: { mode: 'preset', presetId: 'balanced' },
    });
    const { startMemoryWorker } = await import('@/daemon/memory/memoryWorker');
    const worker = await startMemoryWorker({
      credentials: { token: 't', encryption: { type: 'legacy', secret: new Uint8Array(32).fill(1) } },
      machineId: 'fixture-machine',
      deps: { fetchDecryptedTranscriptPageAfterSeq: async () => [] },
    });
    try {
      await vi.waitFor(() => expect(worker.getEmbeddingsDiagnostics()).toMatchObject({ runtimeState: 'error' }));
      expect(boundary.requests).toEqual([]);

      expect(await memoryCapability().invoke!({ method: 'install' })).toMatchObject({ ok: true });
      expect(boundary.requests).toHaveLength(1);
      await vi.waitFor(() => expect(worker.getEmbeddingsDiagnostics()).toMatchObject({ runtimeState: 'ready', usingFallback: false }));
    } finally {
      worker.stop();
      vi.doUnmock('@huggingface/transformers');
    }
  });

  it('honors the existing machine auto-install opt-out on first inference use', async () => {
    publishAccountSettings(accountSettingsParse({ installablesPolicyByMachineId: { 'fixture-machine': { 'local-embeddings': { autoInstallWhenNeeded: false } } } }));
    await expect(createFeatureExtractionPipelineWithFallback({
      modelId: 'fixture/model', cacheDir: join(boundary.home, 'models'),
      packageImport: async () => { throw new Error("Cannot find module '@huggingface/transformers'"); },
      runtimeAssetExists: () => false,
    })).rejects.toThrow(/install.*machine settings/i);
    expect(boundary.requests).toEqual([]);
  });

  it.skipIf(process.platform === 'win32')('acquires difftastic through its existing RPC and keeps the response usable offline', async () => {
    publishAccountSettings();
    await prepareSignedMemoryRelease('difftastic');
    let invoke: (request: unknown) => unknown = () => { throw new Error('handler missing'); };
    registerDifftasticHandler({ registerHandler: (_name, handler) => { invoke = handler as typeof invoke; } }, boundary.home);
    expect(await invoke({ args: ['--version'] })).toMatchObject({ success: true, exitCode: 0, stdout: 'Difftastic acquired fixture\n' });
    expect(boundary.requests).toHaveLength(1);
    boundary.offline = true;
    expect(await invoke({ args: ['--version'] })).toMatchObject({ success: true, stdout: 'Difftastic acquired fixture\n' });
    expect(boundary.requests).toHaveLength(1);
  });
});
