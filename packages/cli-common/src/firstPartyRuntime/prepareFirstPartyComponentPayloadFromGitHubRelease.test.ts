import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const {
  fetchGitHubReleaseByTagMock,
} = vi.hoisted(() => ({
  fetchGitHubReleaseByTagMock: vi.fn(),
}));

vi.mock('@happier-dev/release-runtime/github', () => ({
  fetchGitHubReleaseByTag: fetchGitHubReleaseByTagMock,
}));

import {
  normalizeReleaseAssetArch,
  prepareFirstPartyComponentPayloadFromGitHubRelease,
} from './prepareFirstPartyComponentPayloadFromGitHubRelease';

// Lookup failures still need configured publisher trust before acquisition can reach GitHub.
const { publicKey: lookupFixtureKey } = generateKeyPairSync('ed25519');
const lookupMinisignPubkeyFile = `untrusted comment: lookup fixture\n${Buffer.concat([
  Buffer.from('Ed'), Buffer.alloc(8), Buffer.from(lookupFixtureKey.export({ format: 'jwk' }).x!, 'base64url'),
]).toString('base64')}\n`;

describe('normalizeReleaseAssetArch', () => {
  it.each([
    ['aarch64', 'arm64'],
    ['arm64', 'arm64'],
    ['amd64', 'x64'],
    ['x86_64', 'x64'],
  ] as const)('normalizes %s to %s', (input, expected) => {
    expect(normalizeReleaseAssetArch(input)).toBe(expected);
  });

  it('rejects unsupported architectures', () => {
    expect(() => normalizeReleaseAssetArch('sparc')).toThrow(/unsupported/i);
  });
});

describe('prepareFirstPartyComponentPayloadFromGitHubRelease', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('does not suggest a GitHub token when the release exists but its assets are incomplete', async () => {
    fetchGitHubReleaseByTagMock.mockResolvedValue({ assets: [] });

    const error = await prepareFirstPartyComponentPayloadFromGitHubRelease({
      componentId: 'happier-cli',
      channel: 'preview',
      os: 'darwin',
      arch: 'arm64',
      artifactSource: {
        kind: 'github-release',
        githubRepo: 'happier-dev/happier',
        githubToken: '',
      },
    }).then(
      () => null,
      (cause: unknown) => cause,
    );

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('missing checksums');
    expect((error as Error).message).not.toContain('No GitHub token was configured');
  });

  it('still suggests a GitHub token when release lookup itself returns 404', async () => {
    const notFound = new Error('Not Found');
    Reflect.set(notFound, 'status', 404);
    fetchGitHubReleaseByTagMock.mockRejectedValue(notFound);

    const error = await prepareFirstPartyComponentPayloadFromGitHubRelease({
      componentId: 'happier-cli',
      channel: 'preview',
      os: 'darwin',
      arch: 'arm64',
      minisignPubkeyFile: lookupMinisignPubkeyFile,
      artifactSource: {
        kind: 'github-release',
        githubRepo: 'acme/private-happier',
        githubToken: '',
      },
    }).then(
      () => null,
      (cause: unknown) => cause,
    );

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('No GitHub token was configured');
  });
});

describe('optional runtime release pinning', () => {
  it('extracts only the exact authenticated component and rejects tampered archives and signatures', async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'component-release-fixture-'));
    const componentId = 'happier-difftastic';
    const versionId = '0.2.12-preview.1';
    const archiveName = `${componentId}-v${versionId}-linux-x64.tar.gz`;
    const checksumsName = `checksums-${componentId}-v${versionId}.txt`;
    try {
      await mkdir(join(scratch, 'payload'));
      await writeFile(join(scratch, 'payload', 'difft'), 'signed fixture executable');
      execFileSync('tar', ['-czf', join(scratch, archiveName), '-C', scratch, 'payload']);
      const archive = await readFile(join(scratch, archiveName));
      const checksums = `${createHash('sha256').update(archive).digest('hex')}  ${archiveName}\n`;
      // Exercise the real verifier with an ephemeral publisher key; only the GitHub API is mocked.
      const { publicKey, privateKey } = generateKeyPairSync('ed25519');
      const keyId = Buffer.from('0123456789abcdef', 'hex');
      const rawKey = Buffer.from(publicKey.export({ format: 'jwk' }).x!, 'base64url');
      const minisignPubkeyFile = `untrusted comment: fixture\n${Buffer.concat([Buffer.from('Ed'), keyId, rawKey]).toString('base64')}\n`;
      const signature = sign(null, Buffer.from(checksums), privateKey);
      const globalSignature = sign(null, Buffer.concat([signature, Buffer.from('fixture')]), privateKey);
      const sigFile = `untrusted comment: fixture\n${Buffer.concat([Buffer.from('Ed'), keyId, signature]).toString('base64')}\ntrusted comment: fixture\n${globalSignature.toString('base64')}\n`;
      const setAssets = (bytes: Buffer, signatureText = sigFile) => fetchGitHubReleaseByTagMock.mockResolvedValue({ assets: [
        { name: archiveName, browser_download_url: `data:application/octet-stream;base64,${bytes.toString('base64')}` },
        { name: checksumsName, browser_download_url: `data:text/plain,${encodeURIComponent(checksums)}` },
        { name: `${checksumsName}.minisig`, browser_download_url: `data:text/plain,${encodeURIComponent(signatureText)}` },
      ] });
      const params = { componentId, versionId, channel: 'preview', os: 'linux', arch: 'x64', minisignPubkeyFile } as const;
      setAssets(archive);
      const prepared = await prepareFirstPartyComponentPayloadFromGitHubRelease(params);
      try {
        expect(prepared.versionId).toBe(versionId);
        expect(await readFile(join(prepared.payloadRoot, 'difft'), 'utf8')).toBe('signed fixture executable');
      } finally {
        await prepared.cleanup();
      }
      setAssets(Buffer.from('tampered'));
      await expect(prepareFirstPartyComponentPayloadFromGitHubRelease(params)).rejects.toThrow(/checksum verification failed/i);
      setAssets(archive, 'tampered');
      await expect(prepareFirstPartyComponentPayloadFromGitHubRelease(params)).rejects.toThrow(/signature verification failed/i);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it.each(['happier-memory-runtime', 'happier-difftastic'] as const)('pins %s to the exact CLI tag and rejects different asset versions', async (componentId) => {
    const version = '0.2.12-preview.2';
    fetchGitHubReleaseByTagMock.mockResolvedValue({ assets: [
      `checksums-${componentId}-v${version}.txt`,
      `checksums-${componentId}-v${version}.txt.minisig`,
      `${componentId}-v${version}-linux-x64.tar.gz`,
    ].map((name) => ({ name, browser_download_url: 'data:text/plain,invalid-signature' })) });
    await expect(prepareFirstPartyComponentPayloadFromGitHubRelease({
      componentId, channel: 'preview', versionId: '0.2.12-preview.1', os: 'linux', arch: 'x64',
      minisignPubkeyFile: lookupMinisignPubkeyFile,
    })).rejects.toThrow(/version.*0\.2\.12-preview\.1.*0\.2\.12-preview\.2/i);
    expect(fetchGitHubReleaseByTagMock).toHaveBeenCalledWith(expect.objectContaining({ tag: 'cli-v0.2.12-preview.1' }));
  });
});
