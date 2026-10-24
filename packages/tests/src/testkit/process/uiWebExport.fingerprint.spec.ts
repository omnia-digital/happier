import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
const fixtureRoot = vi.hoisted(() => ({ current: '' }));
vi.mock('../paths', () => ({ repoRootDir: () => fixtureRoot.current }));

import { resolveUiWebExportSourceFingerprint } from './uiWebExport';

const roots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'happier-ui-export-fingerprint-'));
  fixtureRoot.current = root;
  roots.push(root);
  await put(root, 'apps/ui/package.json', JSON.stringify({
    name: '@happier-dev/app',
    dependencies: { '@happier-dev/protocol': '0.0.0' },
  }));
  await put(root, 'apps/ui/sources/index.ts', 'export const app = 1;\n');
  await put(root, 'packages/protocol/package.json', JSON.stringify({
    name: '@happier-dev/protocol',
    exports: { '.': './dist/index.js' },
  }));
  await put(root, 'packages/protocol/src/index.ts', 'export const protocol = 1;\n');
  await put(root, 'packages/unrelated/package.json', JSON.stringify({ name: '@happier-dev/unrelated' }));
  await put(root, 'packages/unrelated/src/index.ts', 'export const unrelated = 1;\n');
  return root;
}

async function put(root: string, relativePath: string, contents: string): Promise<void> {
  const path = join(root, relativePath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, 'utf8');
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('UI web export source fingerprint', () => {
  it('invalidates on changed workspace runtime bytes even when size and timestamp remain equal', async () => {
    const root = await makeRoot();
    const path = join(root, 'packages/protocol/src/index.ts');
    const before = resolveUiWebExportSourceFingerprint();
    const original = await readFile(path, 'utf8');
    const timestamps = await stat(path);
    await put(root, 'packages/protocol/src/index.ts', original.replace('= 1', '= 2'));
    await utimes(path, timestamps.atime, timestamps.mtime);
    expect((await stat(path)).size).toBe(timestamps.size);
    expect(resolveUiWebExportSourceFingerprint()).not.toBe(before);
  });

  it('ignores test and unrelated package edits but invalidates on app runtime and config changes', async () => {
    const root = await makeRoot();
    const before = resolveUiWebExportSourceFingerprint();
    await put(root, 'apps/ui/sources/feature.test.ts', 'test("feature", () => {});\n');
    await put(root, 'apps/ui/sources/__tests__/helper.ts', 'export const testHelper = 1;\n');
    await put(root, 'apps/ui/sources/dist/generated.js', 'export const generated = 1;\n');
    await put(root, 'apps/ui/sources/.project/output.js', 'export const output = 1;\n');
    await put(root, 'packages/protocol/src/feature.spec.ts', 'test("protocol", () => {});\n');
    await put(root, 'packages/unrelated/src/index.ts', 'export const unrelated = 2;\n');
    expect(resolveUiWebExportSourceFingerprint()).toBe(before);

    await put(root, 'apps/ui/sources/index.ts', 'export const app = 2;\n');
    const afterApp = resolveUiWebExportSourceFingerprint();
    expect(afterApp).not.toBe(before);
    await put(root, 'apps/ui/app.config.js', 'module.exports = { name: "happier" };\n');
    expect(resolveUiWebExportSourceFingerprint()).not.toBe(afterApp);
  });

  it('tracks workspace manifest and lock changes without requiring optional inputs', async () => {
    const root = await makeRoot();
    const before = resolveUiWebExportSourceFingerprint();
    await put(root, 'packages/protocol/package.json', JSON.stringify({
      name: '@happier-dev/protocol',
      exports: { '.': './dist/changed.js' },
    }));
    const afterManifest = resolveUiWebExportSourceFingerprint();
    expect(afterManifest).not.toBe(before);
    await put(root, 'yarn.lock', 'protocol-dependency@1.0.0:\n  version "1.0.0"\n');
    const afterLock = resolveUiWebExportSourceFingerprint();
    expect(afterLock).not.toBe(afterManifest);
    await put(root, 'packages/release-runtime/releaseRings.cjs', 'module.exports = { ring: "internaldev" };\n');
    const afterReleaseRing = resolveUiWebExportSourceFingerprint();
    expect(afterReleaseRing).not.toBe(afterLock);

    await put(root, 'packages/protocol/package.json', JSON.stringify({
      name: '@happier-dev/protocol',
      exports: { '.': './dist/changed.js' },
      dependencies: { '@happier-dev/agents': '0.0.0' },
    }));
    const whileDependencyMissing = resolveUiWebExportSourceFingerprint();
    expect(whileDependencyMissing).not.toBe(afterReleaseRing);
    await put(root, 'packages/agents/package.json', JSON.stringify({ name: '@happier-dev/agents' }));
    await put(root, 'packages/agents/src/index.ts', 'export const agent = 1;\n');
    const afterDependencyAdded = resolveUiWebExportSourceFingerprint();
    expect(afterDependencyAdded).not.toBe(whileDependencyMissing);
    await put(root, 'packages/agents/src/index.ts', 'export const agent = 2;\n');
    expect(resolveUiWebExportSourceFingerprint()).not.toBe(afterDependencyAdded);
  });
});
