import { mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTempDirSync } from '../src/testkit/fs/tempDir';
import { buildCliDist } from './build.mjs';

const cleanupBoundary = vi.hoisted(() => ({
  attempts: 0,
  failuresRemaining: 0,
  permanentFailure: false,
  targetPath: '',
}));

function maybeThrowCleanupError(path: unknown): void {
  const candidate = String(path);
  const matchesTarget = cleanupBoundary.targetPath
    && (candidate === cleanupBoundary.targetPath || candidate.includes(cleanupBoundary.targetPath));
  if (!matchesTarget) return;

  cleanupBoundary.attempts += 1;
  if (cleanupBoundary.permanentFailure || cleanupBoundary.failuresRemaining > 0) {
    cleanupBoundary.failuresRemaining = Math.max(0, cleanupBoundary.failuresRemaining - 1);
    throw Object.assign(new Error(`ENOTEMPTY: directory not empty, rmdir '${candidate}'`), {
      code: 'ENOTEMPTY',
    });
  }
}

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    rmSync(path: Parameters<typeof actual.rmSync>[0], options?: Parameters<typeof actual.rmSync>[1]) {
      maybeThrowCleanupError(path);
      return actual.rmSync(path, options);
    },
  };
});

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    async rm(path: Parameters<typeof actual.rm>[0], options?: Parameters<typeof actual.rm>[1]) {
      maybeThrowCleanupError(path);
      return await actual.rm(path, options);
    },
  };
});

function writeRuntimeManifest(packageRoot: string): void {
  writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({
    type: 'module',
    module: './dist/index.mjs',
  }), 'utf8');
}

function createSuccessfulBuildOptions(packageRoot: string): Parameters<typeof buildCliDist>[0] {
  return {
    packageRoot,
    skipLock: true,
    env: { ...process.env },
    rmDistImpl: async () => {},
    resolveTypeScriptCliPathImpl: () => '/repo/node_modules/@typescript/native/bin/tsc',
    runTypecheckImpl: () => {},
    runPkgrollBuildImpl: () => {},
    resolveDistRuntimeEntrypointsImpl: () => [],
    finalizeDistImpl: () => {},
  };
}

afterEach(() => {
  cleanupBoundary.attempts = 0;
  cleanupBoundary.failuresRemaining = 0;
  cleanupBoundary.permanentFailure = false;
  cleanupBoundary.targetPath = '';
});

describe('buildCliDist build-owned directory cleanup', () => {
  it('retries a transient ENOTEMPTY while reclaiming an abandoned source generation', async () => {
    const packageRoot = realpathSync.native(createTempDirSync('happier-cli-build-transient-cleanup-'));
    const abandonedSourceDir = join(packageRoot, '.tmp.hstack-cli-build-source.abandoned');
    try {
      writeRuntimeManifest(packageRoot);
      mkdirSync(abandonedSourceDir, { recursive: true });
      writeFileSync(join(abandonedSourceDir, 'partial.ts'), 'abandoned\n', 'utf8');
      cleanupBoundary.targetPath = abandonedSourceDir;
      cleanupBoundary.failuresRemaining = 2;

      await expect(buildCliDist(createSuccessfulBuildOptions(packageRoot))).resolves.toEqual({
        outputDir: join(packageRoot, 'dist'),
        promoted: true,
      });

      expect(cleanupBoundary.attempts).toBe(3);
    } finally {
      cleanupBoundary.targetPath = '';
      rmSync(packageRoot, { recursive: true, force: true });
    }
  });

  it('preserves the build error when source-generation cleanup also fails', async () => {
    const packageRoot = createTempDirSync('happier-cli-build-primary-error-');
    try {
      writeRuntimeManifest(packageRoot);
      mkdirSync(join(packageRoot, 'src'), { recursive: true });
      writeFileSync(join(packageRoot, 'src', 'index.ts'), 'export const runtime = true;\n', 'utf8');
      cleanupBoundary.targetPath = '.tmp.hstack-cli-build-source.';
      cleanupBoundary.permanentFailure = true;

      await expect(buildCliDist({
        ...createSuccessfulBuildOptions(packageRoot),
        runPkgrollBuildImpl: () => {
          throw new Error('pkgroll primary failure');
        },
      })).rejects.toThrow('pkgroll primary failure');

      expect(cleanupBoundary.attempts).toBeGreaterThan(0);
    } finally {
      cleanupBoundary.targetPath = '';
      rmSync(packageRoot, { recursive: true, force: true });
    }
  });
});
