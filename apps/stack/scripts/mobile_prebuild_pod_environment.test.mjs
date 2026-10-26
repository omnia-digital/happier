import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { getStackRootFromMeta, runNodeCapture } from './testkit/auth_testkit.mjs';
import { buildStackHarnessEnv, writeFakeBin } from './testkit/core/fake_bin_harness.mjs';
import { createTempFixture } from './testkit/core/temp_fixture.mjs';

for (const clean of [false, true]) {
  test(`mobile iOS prebuild preserves the selected Node environment for CocoaPods (clean=${clean})`, {
    skip: process.platform === 'win32',
  }, async (t) => {
    const fixture = await createTempFixture(t, { prefix: 'hstack-mobile-pod-env-' });
    const rootDir = getStackRootFromMeta(import.meta.url);
    const repoDir = fixture.path('repo');
    const uiDir = join(repoDir, 'apps', 'ui');
    const storageDir = fixture.path('storage');
    const logPath = fixture.path('pod.json');
    await mkdir(join(uiDir, 'node_modules', '.bin'), { recursive: true });
    await mkdir(join(storageDir, 'main'), { recursive: true });
    await writeFile(join(uiDir, 'app.config.js'), 'export default {};\n');
    writeFakeBin({
      root: join(uiDir, 'node_modules'),
      binDirName: '.bin',
      name: 'expo',
      content: `#!/usr/bin/env node
const fs = require('node:fs');
fs.mkdirSync('ios', { recursive: true });
fs.writeFileSync('ios/Podfile.properties.json', JSON.stringify({
  'ios.buildReactNativeFromSource': 'true',
  'ios.deploymentTarget': '16.0',
}));
`,
    });
    writeFakeBin({
      root: fixture.root,
      name: 'pod',
      content: `#!/usr/bin/env node
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const node = execFileSync('node', ['-p', 'process.execPath'], { encoding: 'utf8' }).trim();
fs.writeFileSync(process.env.HAPPIER_TEST_POD_LOG, JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2), node }));
`,
    });
    const poison = writeFakeBin({
      root: fixture.root,
      binDirName: 'login-bin',
      name: 'node',
      content: '#!/bin/sh\necho "login shell selected the wrong Node" >&2\nexit 86\n',
    });
    // A login shell is a genuine external boundary: model its PATH replacement
    // without loading host profiles or reaching the host CocoaPods installation.
    writeFakeBin({
      root: fixture.root,
      name: 'sh',
      content: `#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
const env = { ...process.env };
if (args[0]?.includes('l')) env.PATH = ${JSON.stringify(poison.binDir)} + ':' + env.PATH;
const result = spawnSync('/bin/sh', args.map(arg => arg === '-lc' ? '-c' : arg), { env, stdio: 'inherit' });
process.exit(result.status ?? 1);
`,
    });
    const env = buildStackHarnessEnv({
      binDirs: [fixture.path('bin')],
      extraEnv: {
        HAPPIER_STACK_REPO_DIR: repoDir,
        HAPPIER_STACK_HOME_DIR: fixture.path('home'),
        HAPPIER_STACK_STORAGE_DIR: storageDir,
        HAPPIER_STACK_STACK: 'main',
        HAPPIER_STACK_TAILSCALE_PREFER_PUBLIC_URL: '0',
        HAPPIER_STACK_TAILSCALE_SERVE: '0',
        HAPPIER_STACK_ENV_FILE: fixture.path('nonexistent-env'),
        HAPPIER_TEST_POD_LOG: logPath,
      },
    });
    const result = await runNodeCapture([
      join(rootDir, 'scripts', 'mobile.mjs'),
      '--prebuild', '--platform=ios', '--no-metro', ...(clean ? ['--clean'] : []),
    ], { cwd: rootDir, env });
    assert.equal(result.code, 0, result.stderr);
    const invocation = JSON.parse(await readFile(logPath, 'utf8'));
    assert.equal(invocation.cwd, await realpath(join(uiDir, 'ios')));
    assert.deepEqual(invocation.args, ['install', ...(clean ? ['--repo-update'] : [])]);
    assert.equal(invocation.node, process.execPath);
  });
}
