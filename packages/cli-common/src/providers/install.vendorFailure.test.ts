import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { runCommandCapture } from '../process/index.js';
import { installProviderCli, resolvePlatformFromNodePlatform } from './install.js';

const posixOnly = process.platform === 'win32' ? describe.skip : describe;

posixOnly('failed vendor recipe with a discoverable CLI', () => {
  async function setup() {
    const root = await mkdtemp(join(tmpdir(), 'happier-vendor-failure-'));
    const binDir = join(root, 'bin');
    const cliPath = join(root, 'cli', 'claude');
    await mkdir(binDir, { recursive: true });
    await writeFile(join(binDir, 'bash'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const platform = resolvePlatformFromNodePlatform(process.platform);
    if (!platform) throw new Error('Expected a supported host platform');
    return {
      root,
      cliPath,
      platform,
      env: {
        HAPPIER_HOME_DIR: join(root, 'home'),
        HAPPIER_CLAUDE_PATH: cliPath,
        PATH: `${binDir}:/bin:/usr/bin`,
      },
      async createCli() {
        await mkdir(join(root, 'cli'), { recursive: true });
        await writeFile(cliPath, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
        await chmod(cliPath, 0o755);
      },
    };
  }

  it.each([
    { caseName: 'an existing CLI', preexisting: true, createDuringRecipe: false, shouldRecover: false },
    { caseName: 'a newly available CLI', preexisting: false, createDuringRecipe: true, shouldRecover: true },
    { caseName: 'no CLI', preexisting: false, createDuringRecipe: false, shouldRecover: false },
  ])('$caseName after a failed command', async ({ preexisting, createDuringRecipe, shouldRecover }) => {
    const fixture = await setup();
    try {
      if (preexisting) await fixture.createCli();
      const runCommand = vi.fn<typeof runCommandCapture>(async () => {
        if (createDuringRecipe) await fixture.createCli();
        return { kind: 'exited', status: 137, signal: 'SIGKILL', stdout: '', stderr: 'installer died' };
      });
      const result = await installProviderCli({
        providerId: 'claude',
        platform: fixture.platform,
        env: fixture.env,
        logDir: fixture.root,
        skipIfInstalled: false,
        allowVendorRecipeExecution: true,
        deps: { runCommand },
      });

      expect(runCommand, JSON.stringify(result)).toHaveBeenCalledOnce();
      if (shouldRecover) {
        expect(result).toMatchObject({ ok: true, alreadyInstalled: false });
        expect(await readFile(result.logPath!, 'utf8')).toContain('became available');
      } else {
        expect(result).toMatchObject({ ok: false, errorCode: 'command-failed' });
        if (!result.ok) {
          expect(result.errorMessage).toContain('ran out of memory');
          expect(result.logPath).not.toBeNull();
        }
      }
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it('retains successful forced installs and the default already-installed skip', async () => {
    const fixture = await setup();
    try {
      await fixture.createCli();
      const runCommand = vi.fn<typeof runCommandCapture>(async () => (
        { kind: 'exited', status: 0, signal: null, stdout: '', stderr: '' }
      ));
      const params = {
        providerId: 'claude' as const,
        platform: fixture.platform,
        env: fixture.env,
        logDir: fixture.root,
        allowVendorRecipeExecution: true,
        deps: { runCommand },
      };

      expect(await installProviderCli(params)).toMatchObject({ ok: true, alreadyInstalled: true });
      expect(runCommand).not.toHaveBeenCalled();
      const forced = await installProviderCli({ ...params, skipIfInstalled: false });
      expect(forced, JSON.stringify(forced)).toMatchObject({ ok: true, alreadyInstalled: false });
      expect(runCommand).toHaveBeenCalledOnce();
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
});
