import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { expect, it } from 'vitest';

import { createIsolatedCliTestEnv, sanitizeCliTestEnv } from './cliTestEnv';

it('isolates fixture CLI runs from the parent session input and stack directory', () => {
  const inheritedEnv = Object.freeze({
    PATH: '/usr/bin',
    HAPPIER_DAEMON_PENDING_FIRST_INPUT: JSON.stringify({ text: 'parent session', localId: 'parent-input' }),
    HAPPIER_STACK_INVOKED_CWD: '/parent/workspace',
  });

  expect(sanitizeCliTestEnv(inheritedEnv)).toEqual({ PATH: '/usr/bin' });
});

it('passes only isolated Home and required OS toolchain to a real child process', () => {
  const fixtureDir = mkdtempSync(join(tmpdir(), 'happier-cli-env-'));
  try {
    const yarnDir = join(fixtureDir, 'yarn-bin');
    const homeDir = join(fixtureDir, 'home');
    const yarnName = process.platform === 'win32' ? 'yarn.cmd' : 'yarn';
    mkdirSync(yarnDir);
    mkdirSync(homeDir);
    writeFileSync(join(yarnDir, yarnName), 'fixture');
    const env = createIsolatedCliTestEnv({
      homeDir,
      processEnv: {
        PATH: [yarnDir, join(fixtureDir, 'provider-bin')].join(delimiter),
        USER: 'fixture-user',
        TMPDIR: fixtureDir,
        TMP: fixtureDir,
        TEMP: fixtureDir,
        ANTHROPIC_API_KEY: 'must-not-pass',
        CLAUDE_CONFIG_DIR: join(fixtureDir, 'real-provider-home'),
        HAPPIER_ACTIVE_SERVER_ID: 'real-server',
      },
    });
    expect(env.PATH?.split(delimiter)).toContain(yarnDir);
    expect(env.PATH?.split(delimiter)).toContain(dirname(process.execPath));
    expect(env.PATH?.split(delimiter)).not.toContain(join(fixtureDir, 'provider-bin'));
    expect(env.HOME).toBe(homeDir);
    expect(env.HAPPIER_HOME_DIR).toBe(homeDir);
    expect(env.TMPDIR).toBe(fixtureDir);
    expect(env.TMP).toBe(fixtureDir);
    expect(env.TEMP).toBe(fixtureDir);
    const child = spawnSync(process.execPath, ['-e', 'process.stdout.write(JSON.stringify(Object.keys(process.env).sort()))'], {
      env,
      encoding: 'utf8',
    });
    expect(child.status).toBe(0);
    const childKeys = JSON.parse(child.stdout) as string[];
    expect(childKeys).toContain('HAPPIER_HOME_DIR');
    expect(childKeys).not.toContain('ANTHROPIC_API_KEY');
    expect(childKeys).not.toContain('CLAUDE_CONFIG_DIR');
    expect(childKeys).not.toContain('HAPPIER_ACTIVE_SERVER_ID');
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
});
