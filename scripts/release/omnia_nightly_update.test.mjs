import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import test from 'node:test';

import {
  APP_NAME,
  BUNDLE_ID,
  MANIFEST_ASSET,
  PRODUCT_NAME,
  RELEASE_AUTHOR,
  SERVER_URL,
  TARBALL_ASSET,
  releaseTagForSha,
} from '../fork/nightly-release-contract.mjs';
import { installAgent, printStatus, runUpdate } from '../fork/omnia-nightly-update.mjs';
import { protectProductionCheckout } from '../fork/production-checkout.mjs';

const skip = process.platform !== 'darwin';
const githubUrl = 'https://github.com/omnia-digital/happier.git';
const api = 'https://api.github.com/repos/omnia-digital/happier';
const HOUR = 3_600_000;
const realGit = spawnSync('which', ['git'], { encoding: 'utf8' }).stdout.trim();
const oldSha = 'f'.repeat(40);

function run(command, args, options) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  assert.equal(result.status, 0, `${command} ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}

function git(cwd, ...args) {
  return run(realGit, args, {
    cwd,
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_OPTIONAL_LOCKS: '0' },
  });
}

function arm64MachO() {
  for (const candidate of ['/opt/homebrew/bin/node', process.execPath]) {
    const archs = spawnSync('lipo', ['-archs', candidate], { encoding: 'utf8' });
    if (archs.status === 0 && archs.stdout.trim().split(/\s+/).includes('arm64')) return candidate;
  }
  throw new Error('No arm64 Mach-O available for the bundle fixture');
}

function makeBundle(appPath, marker, { bundleId = BUNDLE_ID } = {}) {
  mkdirSync(join(appPath, 'Contents', 'MacOS'), { recursive: true });
  mkdirSync(join(appPath, 'Contents', 'Resources'), { recursive: true });
  for (const name of ['happier-desktop', 'hsetup']) {
    copyFileSync(arm64MachO(), join(appPath, 'Contents', 'MacOS', name));
    chmodSync(join(appPath, 'Contents', 'MacOS', name), 0o755);
  }
  writeFileSync(join(appPath, 'Contents', 'Resources', 'marker'), marker);
  writeFileSync(join(appPath, 'Contents', 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>happier-desktop</string>
<key>CFBundleIdentifier</key><string>${bundleId}</string>
<key>CFBundleName</key><string>${PRODUCT_NAME}</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>0.2.18</string>
</dict></plist>
`);
  run('codesign', ['--force', '--deep', '--sign', '-', appPath]);
  return appPath;
}

/** Real git, tar, codesign and filesystem; the session, network and clock are the faked boundary. */
function makeWorld(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'omnia-nightly-')));
  const source = join(root, 'source');
  const remote = join(root, 'origin.git');
  const productionClone = join(root, 'happier-production');
  const devClone = join(root, 'happier-dev');
  const bin = join(root, 'bin');
  mkdirSync(source);
  mkdirSync(bin);
  git(source, 'init', '-b', 'dev');
  git(source, 'config', 'user.name', 'Fixture');
  git(source, 'config', 'user.email', 'fixture@example.invalid');
  writeFileSync(join(source, 'app.txt'), 'base\n');
  git(source, 'add', 'app.txt');
  git(source, '-c', 'commit.gpgsign=false', 'commit', '-m', 'Base');
  git(source, 'branch', 'production');
  git(root, 'clone', '--bare', source, remote);
  git(root, 'clone', '-b', 'production', remote, productionClone);
  git(productionClone, 'remote', 'set-url', 'origin', githubUrl);
  git(root, 'clone', '-b', 'dev', remote, devClone);
  // The Git network is the boundary: fetches go to the local remote, everything else is real.
  writeFileSync(join(bin, 'git'), `#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
if (args[0] === 'fetch') args[1] = ${JSON.stringify(remote)};
const result = spawnSync(${JSON.stringify(realGit)}, args, { stdio: 'inherit' });
process.exit(result.status ?? 1);
`, { mode: 0o755 });
  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}${delimiter}${previousPath}`;
  t.after(() => {
    process.env.PATH = previousPath;
    spawnSync('chflags', ['-R', 'nouchg', root]);
    rmSync(root, { recursive: true, force: true });
  });
  protectProductionCheckout(productionClone);

  const applications = join(root, 'Applications');
  const support = join(root, 'Application Support', 'Omnia Happier');
  mkdirSync(applications);
  const appPath = join(applications, APP_NAME);
  const stateDir = join(support, 'nightly-update');
  const config = {
    appPath,
    stateDir,
    previousBuildsDir: join(support, 'Previous Builds'),
    devClone,
    productionClone,
    launchAgentsDir: join(root, 'LaunchAgents'),
    logPath: join(root, 'Logs', 'omnia-happier-nightly-update.log'),
    nodePath: '/opt/homebrew/bin/node',
    uid: 501,
    scriptPath: join(devClone, 'scripts', 'fork', 'omnia-nightly-update.mjs'),
  };

  const world = {
    root, source, remote, config, appPath, stateDir, devClone, productionClone,
    outgoing: join(stateDir, 'outgoing.app'),
    now: Date.parse('2026-11-05T12:00:00Z'),
    offline: false,
    release: null,
    runs: null,
    assets: new Map(),
    process: null,
    frontmost: false,
    idleMs: HOUR,
    ignoreTerm: false,
    crashMarkers: new Set(),
    alerts: [],
    calls: [],
    signals: [],
    sleeps: [],
    logs: [],
    fetched: [],
  };

  const launch = (mode) => {
    const marker = readFileSync(join(appPath, 'Contents', 'Resources', 'marker'), 'utf8');
    world.process = { pid: 1000 + world.calls.length, marker, mode };
  };

  world.adapter = {
    now: () => world.now,
    sleep: async (ms) => {
      world.sleeps.push(ms);
      world.now += ms;
      if (world.process && world.crashMarkers.has(world.process.marker)) world.process = null;
    },
    log: (line) => world.logs.push(line),
    showDialog: (message) => world.alerts.push(message),
    kill: (pid, signal) => {
      world.signals.push(signal);
      assert.equal(pid, world.process?.pid);
      if (!world.ignoreTerm) world.process = null;
    },
    exec: (command, args) => {
      world.calls.push([command, args]);
      const ok = (out = '') => ({ ok: true, out, err: '' });
      if (command === 'ps') {
        const lines = ['   12 /System/Library/CoreServices/Dock.app/Contents/MacOS/Dock', `   13 ${appPath}/Contents/MacOS/hsetup`];
        if (world.process) lines.push(`${world.process.pid} ${appPath}/Contents/MacOS/happier-desktop`);
        return ok(lines.join('\n'));
      }
      if (command === 'lsappinfo') {
        if (args[0] === 'front') return ok('ASN:front:');
        if (args[0] === 'find') return ok('ASN:0x0-0x1-"Omnia_Happier":');
        if (args.includes('bundleID')) return ok(`bundleID="${world.frontmost ? BUNDLE_ID : 'com.apple.finder'}"`);
        if (args.includes('ApplicationType')) return ok(`type="${world.process?.mode === 'tray' ? 'UIElement' : 'Foreground'}"`);
      }
      if (command === 'ioreg') return ok(`  | |   "HIDIdleTime" = ${world.idleMs * 1_000_000}`);
      if (command === 'open') {
        launch(args.includes('--menu-bar') ? 'tray' : 'window');
        return ok();
      }
      if (command === 'launchctl') return ok();
      throw new Error(`Unexpected command ${command}`);
    },
    fetch: async (url) => {
      world.fetched.push(url);
      if (world.offline) throw new TypeError('fetch failed');
      if (url === `${api}/releases/latest`) {
        return world.release ? Response.json(world.release) : new Response('{}', { status: 404 });
      }
      if (url.startsWith(`${api}/actions/workflows/omnia-production.yml/runs`)) {
        const runs = world.runs ?? [{ id: 1, conclusion: 'success', updated_at: new Date(world.now - HOUR).toISOString() }];
        return Response.json({ workflow_runs: runs });
      }
      const asset = world.assets.get(url);
      return asset ? new Response(asset) : new Response('missing', { status: 404 });
    },
  };

  world.commit = ({ certified = true } = {}) => {
    writeFileSync(join(source, 'app.txt'), `change ${world.assets.size} ${Math.random()}\n`);
    git(source, 'add', 'app.txt');
    git(source, '-c', 'commit.gpgsign=false', 'commit', '-m', 'Change');
    git(source, 'push', remote, 'dev');
    if (certified) git(source, 'push', remote, 'dev:production');
    return git(source, 'rev-parse', 'HEAD');
  };

  /** Publishes a contract-conforming release, with hooks to break one part of it. */
  world.publish = (sha, { bundleId, extraRoot, manifest: manifestOverrides, release: releaseOverrides } = {}) => {
    const build = mkdtempSync(join(root, 'build-'));
    makeBundle(join(build, APP_NAME), sha, { bundleId });
    const entries = [APP_NAME];
    if (extraRoot) {
      writeFileSync(join(build, 'stray'), 'x');
      entries.push('stray');
    }
    const tarball = join(root, `${sha}-${world.fetched.length}.tar.gz`);
    run('tar', ['-czf', tarball, '-C', build, ...entries], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
    const bytes = readFileSync(tarball);
    const manifest = {
      schema: 1,
      sourceSha: sha,
      workflowRunId: 7,
      version: '0.2.18',
      bundleId: BUNDLE_ID,
      productName: PRODUCT_NAME,
      serverUrl: SERVER_URL,
      updatesEnabled: false,
      signature: 'adhoc',
      tarball: TARBALL_ASSET,
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      rustc: 'rustc 1.0.0',
      xcode: 'Xcode 26.5',
      ...manifestOverrides,
    };
    const tarballUrl = `https://assets.invalid/${sha}/${TARBALL_ASSET}`;
    const manifestUrl = `https://assets.invalid/${sha}/${MANIFEST_ASSET}`;
    world.assets.set(tarballUrl, bytes);
    world.assets.set(manifestUrl, JSON.stringify(manifest));
    world.release = {
      tag_name: releaseTagForSha(sha),
      draft: false,
      prerelease: false,
      immutable: true,
      author: { login: RELEASE_AUTHOR },
      assets: [
        { name: TARBALL_ASSET, browser_download_url: tarballUrl },
        { name: MANIFEST_ASSET, browser_download_url: manifestUrl },
      ],
      ...releaseOverrides,
    };
    return tarballUrl;
  };

  world.installApp = (marker, installedSha = marker) => {
    makeBundle(appPath, marker);
    world.writeState({ installedSha });
  };
  world.writeState = (fields) => {
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(join(stateDir, 'state.json'), JSON.stringify(fields));
  };
  world.state = () => JSON.parse(readFileSync(join(stateDir, 'state.json'), 'utf8'));
  world.marker = (app = appPath) => readFileSync(join(app, 'Contents', 'Resources', 'marker'), 'utf8');
  world.running = (mode, marker) => { world.process = { pid: 500, marker, mode }; };
  world.update = () => runUpdate(config, world.adapter);
  world.commands = (command) => world.calls.filter(([name]) => name === command).map(([, args]) => args);
  world.head = (clone) => git(clone, 'rev-parse', 'HEAD');
  world.fetchCount = (url) => world.fetched.filter((seen) => seen === url).length;
  world.rollbacks = () => readdirSync(config.previousBuildsDir).sort();
  return world;
}

function assertNoSwap(world, marker) {
  assert.equal(world.marker(), marker);
  assert.deepEqual(world.signals, []);
  assert.equal(existsSync(world.outgoing), false);
  assert.equal(world.state().installedSha, oldSha);
}

test('no change is a no-op: nothing downloads, quits or alerts', { skip }, async (t) => {
  const world = makeWorld(t);
  const sha = world.commit();
  const tarball = world.publish(sha);
  world.installApp(sha);
  world.running('window', sha);
  await world.update();
  assert.equal(world.fetchCount(tarball), 0);
  assert.deepEqual(world.signals, []);
  assert.deepEqual(world.commands('open'), []);
  assert.deepEqual(world.alerts, []);
  assert.equal(world.state().lastSuccessfulCheckAt, new Date(world.now).toISOString());
});

test('a new release installs in window mode and relaunches in the background', { skip }, async (t) => {
  const world = makeWorld(t);
  const sha = world.commit();
  world.publish(sha);
  world.installApp('old', oldSha);
  world.running('window', 'old');
  await world.update();
  assert.equal(world.marker(), sha);
  assert.deepEqual(world.signals, ['SIGTERM']);
  assert.deepEqual(world.commands('open'), [['-g', '-a', world.appPath]]);
  assert.equal(world.process.marker, sha);
  assert.equal(world.process.mode, 'window');
  assert.ok(world.sleeps.includes(10_000), 'waits out the alive window');
  assert.equal(world.state().installedSha, sha);
  assert.equal(existsSync(world.outgoing), false);
  assert.deepEqual(world.rollbacks(), [`Omnia Happier ${oldSha.slice(0, 12)}.tar.gz`]);
  assert.deepEqual(world.alerts, []);
  assert.equal(world.head(world.devClone), sha);
  assert.equal(world.head(world.productionClone), sha);
});

test('a tray-only app installs even while input is active and relaunches in tray mode without launchd', { skip }, async (t) => {
  const world = makeWorld(t);
  const sha = world.commit();
  world.publish(sha);
  world.installApp('old', oldSha);
  world.running('tray', 'old');
  world.idleMs = 0;
  await world.update();
  assert.equal(world.marker(), sha);
  assert.deepEqual(world.commands('launchctl'), []);
  assert.deepEqual(world.commands('open'), [['-g', '-a', world.appPath, '--args', '--menu-bar']]);
  assert.equal(world.process.mode, 'tray');
});

test('a closed app installs without launching and without an alive check', { skip }, async (t) => {
  const world = makeWorld(t);
  const sha = world.commit();
  world.publish(sha);
  makeBundle(world.appPath, 'old');
  world.idleMs = 0;
  await world.update();
  assert.equal(world.marker(), sha);
  assert.equal(world.process, null);
  assert.deepEqual(world.commands('open'), []);
  assert.deepEqual(world.commands('launchctl'), []);
  assert.deepEqual(world.sleeps, []);
  assert.deepEqual(world.rollbacks(), ['Omnia Happier pre-nightly.tar.gz']);
  assert.equal(world.state().installedSha, sha);
});

test('the rollback tarball holds exactly the previous bundle', { skip }, async (t) => {
  const world = makeWorld(t);
  const sha = world.commit();
  world.publish(sha);
  world.installApp('old', oldSha);
  await world.update();
  const [tarball] = world.rollbacks();
  const unpack = join(world.root, 'unpacked');
  mkdirSync(unpack);
  run('tar', ['-xzf', join(world.config.previousBuildsDir, tarball), '-C', unpack]);
  assert.deepEqual(readdirSync(unpack), [APP_NAME]);
  assert.equal(world.marker(join(unpack, APP_NAME)), 'old');
});

test('deferred while frontmost: clones still refresh, the verified bundle is kept and reused', { skip }, async (t) => {
  const world = makeWorld(t);
  const sha = world.commit();
  const tarball = world.publish(sha);
  world.installApp('old', oldSha);
  world.running('window', 'old');
  world.frontmost = true;
  await world.update();
  assertNoSwap(world, 'old');
  assert.equal(world.head(world.devClone), sha);
  assert.equal(world.head(world.productionClone), sha);
  assert.equal(world.state().deferredSince, new Date(world.now).toISOString());

  await world.update();
  assert.equal(world.fetchCount(tarball), 1, 'second deferred run reuses the staged bundle');

  world.frontmost = false;
  await world.update();
  assert.equal(world.marker(), sha);
  assert.equal(world.fetchCount(tarball), 1, 'install reuses the staged bundle');
  assert.equal(world.state().deferredSince, null);
  assert.deepEqual(world.alerts, []);
});

test('a window with recent input defers, frontmost or not; 15 idle minutes proceed', { skip }, async (t) => {
  const world = makeWorld(t);
  const sha = world.commit();
  world.publish(sha);
  world.installApp('old', oldSha);
  world.running('window', 'old');
  world.idleMs = 15 * 60_000 - 1;
  await world.update();
  assertNoSwap(world, 'old');
  world.idleMs = 15 * 60_000;
  await world.update();
  assert.equal(world.marker(), sha);
});

test('deferral beyond 24 hours alerts once', { skip }, async (t) => {
  const world = makeWorld(t);
  const sha = world.commit();
  world.publish(sha);
  world.installApp('old', oldSha);
  world.running('window', 'old');
  world.idleMs = 0;
  await world.update();
  world.now += 23 * HOUR;
  await world.update();
  assert.deepEqual(world.alerts, []);
  world.now += 2 * HOUR;
  await world.update();
  assert.equal(world.alerts.length, 1);
  assert.match(world.alerts[0], /deferred/i);
  world.now += HOUR;
  await world.update();
  assert.equal(world.alerts.length, 1);
});

const refusals = [
  ['wrong hash', { manifest: { sha256: 'b'.repeat(64) } }],
  ['wrong size', { manifest: { size: 1 } }],
  ['multi-root tarball', { extraRoot: true }],
  ['wrong bundle id inside the tarball', { bundleId: 'com.happier.other' }],
  ['wrong bundle id in the manifest', { manifest: { bundleId: 'com.happier.other' } }],
  ['non-immutable release', { release: { immutable: false } }],
  ['wrong author', { release: { author: { login: 'andorcassian' } } }],
  ['draft release', { release: { draft: true } }],
];

for (const [name, breakage] of refusals) {
  test(`${name} is refused with no swap and one alert`, { skip }, async (t) => {
    const world = makeWorld(t);
    const sha = world.commit();
    world.publish(sha, breakage);
    world.installApp('old', oldSha);
    world.running('window', 'old');
    await world.update();
    assertNoSwap(world, 'old');
    assert.equal(world.process.marker, 'old');
    assert.equal(world.alerts.length, 1, world.alerts.join('; '));
    assert.equal(existsSync(join(world.stateDir, 'staging')), false, 'a refused bundle does not stay on disk');
    await world.update();
    assert.equal(world.alerts.length, 1, 'alert is deduplicated');
  });
}

test('a SHA not on production is refused and does not move the dev clone', { skip }, async (t) => {
  const world = makeWorld(t);
  const before = world.head(world.devClone);
  const sha = world.commit({ certified: false });
  const tarball = world.publish(sha);
  world.installApp('old', oldSha);
  world.running('window', 'old');
  await world.update();
  assertNoSwap(world, 'old');
  assert.equal(world.fetchCount(tarball), 0);
  assert.equal(world.head(world.devClone), before);
  assert.equal(world.alerts.length, 1);
  assert.match(world.alerts[0], /production/);
});

test('a production clone failure blocks the install because ancestry is unproven', { skip }, async (t) => {
  const world = makeWorld(t);
  const sha = world.commit();
  const tarball = world.publish(sha);
  world.installApp('old', oldSha);
  world.config.productionClone = join(world.root, 'missing-clone');
  await world.update();
  assertNoSwap(world, 'old');
  assert.equal(world.fetchCount(tarball), 0);
  assert.equal(world.alerts.length, 1);
  assert.match(world.alerts[0], /production/i);
});

test('a dirty dev clone skips dev only: it alerts, keeps the work and still installs', { skip }, async (t) => {
  const world = makeWorld(t);
  const before = world.head(world.devClone);
  const sha = world.commit();
  world.publish(sha);
  world.installApp('old', oldSha);
  writeFileSync(join(world.devClone, 'untracked.txt'), 'work in progress\n');
  await world.update();
  assert.equal(world.head(world.devClone), before);
  assert.equal(readFileSync(join(world.devClone, 'untracked.txt'), 'utf8'), 'work in progress\n');
  assert.equal(world.head(world.productionClone), sha);
  assert.equal(world.marker(), sha);
  assert.equal(world.alerts.length, 1);
  assert.match(world.alerts[0], /happier-dev/);
});

test('a dev clone on another branch is left alone and diverged history is alerted', { skip }, async (t) => {
  const world = makeWorld(t);
  const sha = world.commit();
  world.publish(sha);
  world.installApp('old', oldSha);
  git(world.devClone, 'switch', '-c', 'side');
  const before = world.head(world.devClone);
  await world.update();
  assert.equal(world.head(world.devClone), before);
  assert.equal(git(world.devClone, 'branch', '--show-current'), 'side');
  assert.equal(world.alerts.length, 1);
  assert.equal(world.marker(), sha);
});

test('crash between the renames restores the old app and relaunches it in its prior mode', { skip }, async (t) => {
  const world = makeWorld(t);
  world.installApp('old', oldSha);
  world.writeState({ installedSha: oldSha, swap: { sha: 'c'.repeat(40), mode: 'tray' } });
  renameSync(world.appPath, world.outgoing);
  world.offline = true;
  await world.update();
  assert.equal(world.marker(), 'old');
  assert.equal(existsSync(world.outgoing), false);
  assert.equal(world.process.marker, 'old');
  assert.equal(world.process.mode, 'tray');
  assert.equal(world.state().swap, null);
});

test('crash between the renames of a closed app restores it without launching', { skip }, async (t) => {
  const world = makeWorld(t);
  world.installApp('old', oldSha);
  world.writeState({ installedSha: oldSha, swap: { sha: 'c'.repeat(40), mode: 'none' } });
  renameSync(world.appPath, world.outgoing);
  world.offline = true;
  await world.update();
  assert.equal(world.marker(), 'old');
  assert.equal(world.process, null);
});

test('crash after the swap but before confirmation finishes the confirmation', { skip }, async (t) => {
  const world = makeWorld(t);
  const sha = world.commit();
  world.installApp('old', oldSha);
  renameSync(world.appPath, world.outgoing);
  makeBundle(world.appPath, sha);
  world.writeState({ installedSha: oldSha, swap: { sha, mode: 'window' } });
  world.offline = true;
  await world.update();
  assert.equal(world.marker(), sha);
  assert.equal(world.process.marker, sha);
  assert.equal(existsSync(world.outgoing), false);
  assert.equal(world.state().installedSha, sha);
});

test('crash after the swap rolls back when the new app will not stay running', { skip }, async (t) => {
  const world = makeWorld(t);
  const sha = world.commit();
  world.installApp('old', oldSha);
  renameSync(world.appPath, world.outgoing);
  makeBundle(world.appPath, sha);
  world.writeState({ installedSha: oldSha, swap: { sha, mode: 'window' } });
  world.crashMarkers.add(sha);
  world.offline = true;
  await world.update();
  assert.equal(world.marker(), 'old');
  assert.equal(world.process.marker, 'old');
  assert.equal(world.state().heldSha, sha);
  assert.equal(world.state().installedSha, oldSha);
});

test('a quit before the swap crash relaunches the untouched app', { skip }, async (t) => {
  const world = makeWorld(t);
  world.installApp('old', oldSha);
  world.writeState({ installedSha: oldSha, swap: { sha: 'c'.repeat(40), mode: 'window' } });
  world.offline = true;
  await world.update();
  assert.equal(world.process.marker, 'old');
  assert.equal(world.state().swap, null);
});

test('a failed alive check rolls back and holds; the next run does not retry but a new SHA does', { skip }, async (t) => {
  const world = makeWorld(t);
  const badSha = world.commit();
  const tarball = world.publish(badSha);
  world.installApp('old', oldSha);
  world.running('window', 'old');
  world.crashMarkers.add(badSha);
  await world.update();
  assert.equal(world.marker(), 'old');
  assert.equal(world.process.marker, 'old');
  assert.equal(world.process.mode, 'window');
  assert.equal(existsSync(world.outgoing), false);
  assert.equal(world.state().heldSha, badSha);
  assert.equal(world.state().installedSha, oldSha);
  assert.equal(world.alerts.length, 1);
  assert.match(world.alerts[0], /held|rolled back/i);

  const signalsAfterFailure = world.signals.length;
  await world.update();
  assert.equal(world.fetchCount(tarball), 1, 'held SHA is not downloaded again');
  assert.equal(world.signals.length, signalsAfterFailure, 'held SHA does not quit the app again');
  assert.equal(world.marker(), 'old');
  assert.equal(world.alerts.length, 1);

  const goodSha = world.commit();
  world.publish(goodSha);
  await world.update();
  assert.equal(world.marker(), goodSha);
  assert.equal(world.process.marker, goodSha);
  assert.equal(world.state().heldSha, null);
  assert.equal(world.state().installedSha, goodSha);
});

test('a quit timeout aborts with no swap and never escalates past SIGTERM', { skip }, async (t) => {
  const world = makeWorld(t);
  const sha = world.commit();
  const tarball = world.publish(sha);
  world.installApp('old', oldSha);
  world.running('window', 'old');
  world.ignoreTerm = true;
  const start = world.now;
  await world.update();
  assert.equal(world.marker(), 'old');
  assert.equal(world.state().installedSha, oldSha);
  assert.equal(existsSync(world.outgoing), false);
  assert.deepEqual([...new Set(world.signals)], ['SIGTERM']);
  assert.ok(world.now - start >= 30_000, 'waits 30 seconds');
  assert.ok(world.now - start < 40_000, 'gives up at 30 seconds');
  assert.equal(world.alerts.length, 1);
  assert.match(world.alerts[0], /did not quit|still running/i);

  // It exits late, after the agent gave up: the next run must bring it back in its prior mode.
  world.process = null;
  world.ignoreTerm = false;
  world.offline = true;
  await world.update();
  assert.equal(world.process.marker, 'old');
  assert.equal(world.process.mode, 'window');

  world.offline = false;
  await world.update();
  assert.equal(world.marker(), sha);
  assert.equal(world.fetchCount(tarball), 1);
});

test('a denied rename is loud, names App Management and costs the running app nothing', { skip }, async (t) => {
  const world = makeWorld(t);
  const sha = world.commit();
  world.publish(sha);
  world.installApp('old', oldSha);
  world.running('window', 'old');
  run('chflags', ['uchg', world.appPath]);
  await world.update();
  assertNoSwap(world, 'old');
  assert.equal(world.process.marker, 'old');
  assert.equal(world.alerts.length, 1);
  assert.match(world.alerts[0], /App Management/);

  run('chflags', ['nouchg', world.appPath]);
  await world.update();
  assert.equal(world.marker(), sha, 'installs once the permission is granted');
});

test('a failure after quitting relaunches whatever is installed', { skip }, async (t) => {
  const world = makeWorld(t);
  const sha = world.commit();
  world.publish(sha);
  world.installApp('old', oldSha);
  world.running('tray', 'old');
  world.frontmost = true;
  await world.update();
  const staged = join(world.stateDir, 'staging', sha, 'bundle');
  assert.equal(world.marker(staged), sha);
  run('chflags', ['uchg', staged]);
  world.frontmost = false;
  await world.update();
  assert.deepEqual(world.signals, ['SIGTERM']);
  assert.equal(world.marker(), 'old');
  assert.equal(world.process.marker, 'old');
  assert.equal(world.process.mode, 'tray');
  assert.equal(existsSync(world.outgoing), false);
  assert.equal(world.state().installedSha, oldSha);
  assert.equal(world.alerts.length, 1);
  assert.match(world.alerts[0], /App Management/);
});

test('a staged bundle that no longer verifies is replaced by a fresh download', { skip }, async (t) => {
  const world = makeWorld(t);
  const sha = world.commit();
  const tarball = world.publish(sha);
  world.installApp('old', oldSha);
  world.running('window', 'old');
  world.frontmost = true;
  await world.update();
  const staged = join(world.stateDir, 'staging', sha, 'bundle');
  writeFileSync(join(staged, 'Contents', 'Resources', 'marker'), 'tampered');
  world.frontmost = false;
  await world.update();
  assert.equal(world.fetchCount(tarball), 2);
  assert.equal(world.marker(), sha);
  assert.deepEqual(world.alerts, []);
});

test('a relaunch that fails outside the alive check is alerted, not just logged', { skip }, async (t) => {
  const world = makeWorld(t);
  world.installApp('old', oldSha);
  world.writeState({ installedSha: oldSha, swap: { sha: 'c'.repeat(40), mode: 'window' } });
  const exec = world.adapter.exec;
  world.adapter.exec = (command, args) => (command === 'open' ? { ok: false, out: '', err: 'launch denied' } : exec(command, args));
  world.offline = true;
  await world.update();
  assert.equal(world.alerts.length, 1);
  assert.match(world.alerts[0], /launch denied/);
});

test('a missing bundle with nothing to restore reinstalls the same SHA', { skip }, async (t) => {
  const world = makeWorld(t);
  const sha = world.commit();
  world.publish(sha);
  world.installApp(sha);
  rmSync(world.appPath, { recursive: true });
  await world.update();
  assert.equal(world.marker(), sha);
  assert.equal(world.process, null);
  assert.equal(world.state().installedSha, sha);
});

test('a missing bundle does not bypass a hold', { skip }, async (t) => {
  const world = makeWorld(t);
  const sha = world.commit();
  const tarball = world.publish(sha);
  world.installApp('old', oldSha);
  world.writeState({ installedSha: oldSha, heldSha: sha });
  rmSync(world.appPath, { recursive: true });
  await world.update();
  assert.equal(existsSync(world.appPath), false);
  assert.equal(world.fetchCount(tarball), 0);
  assert.equal(world.alerts.length, 1);
  assert.match(world.alerts[0], /missing/i);
});

test('a corrupt state file still recovers an interrupted swap and alerts', { skip }, async (t) => {
  const world = makeWorld(t);
  const sha = world.commit();
  world.publish(sha);
  world.installApp('old', oldSha);
  mkdirSync(world.stateDir, { recursive: true });
  renameSync(world.appPath, world.outgoing);
  writeFileSync(join(world.stateDir, 'state.json'), '');
  await world.update();
  assert.equal(existsSync(world.outgoing), false);
  assert.equal(world.marker(), sha, 'an unknown installed SHA causes one bounded reinstall');
  assert.equal(world.alerts.length, 1);
  assert.match(world.alerts[0], /state/i);
  assert.equal(world.state().installedSha, sha);
  await world.update();
  assert.equal(world.alerts.length, 1, 'the rewritten state does not alert again');
});

test('a waiting bundle is not named .app, so LaunchServices cannot offer it for happier links', { skip }, async (t) => {
  const world = makeWorld(t);
  const sha = world.commit();
  world.publish(sha);
  world.installApp('old', oldSha);
  world.running('window', 'old');
  world.frontmost = true;
  await world.update();
  const found = spawnSync('find', [join(world.stateDir, 'staging'), '-name', '*.app'], { encoding: 'utf8' }).stdout.trim();
  assert.equal(found, '');
  assert.equal(world.marker(join(world.stateDir, 'staging', sha, 'bundle')), sha);
});

test('a git fetch failure counts as a network failure, not a clone fault', { skip }, async (t) => {
  const world = makeWorld(t);
  const sha = world.commit();
  world.publish(sha);
  world.installApp('old', oldSha);
  const bin = join(world.root, 'bin', 'git');
  const working = readFileSync(bin, 'utf8');
  writeFileSync(bin, working.replace("if (args[0] === 'fetch') args[1]", "if (args[0] === 'fetch') { console.error('Could not resolve host'); process.exit(128); }\nif (args[0] === 'fetch') args[1]"));
  await world.update();
  assert.deepEqual(world.alerts, []);
  assert.equal(world.marker(), 'old');
  assert.ok(world.logs.some((line) => /Network:/.test(line)));
  world.now += 27 * HOUR;
  await world.update();
  assert.equal(world.alerts.length, 1, 'still reported once it lasts past 26 hours');
  writeFileSync(bin, working);
  await world.update();
  assert.equal(world.marker(), sha);
});

test('a dark-wake network error is silent until 26 hours without a successful check', { skip }, async (t) => {
  const world = makeWorld(t);
  world.installApp('old', oldSha);
  world.offline = true;
  await world.update();
  assert.deepEqual(world.alerts, [], 'first ever check starts the clock');
  world.now += 25 * HOUR;
  await world.update();
  assert.deepEqual(world.alerts, []);
  world.now += 2 * HOUR;
  await world.update();
  assert.equal(world.alerts.length, 1);
  assert.match(world.alerts[0], /26 hours|reach GitHub/i);
  world.now += HOUR;
  await world.update();
  assert.equal(world.alerts.length, 1);

  world.offline = false;
  await world.update();
  assert.equal(world.state().lastSuccessfulCheckAt, new Date(world.now).toISOString());
  world.offline = true;
  world.now += HOUR;
  await world.update();
  assert.equal(world.alerts.length, 1, 'fresh success resets the clock');
});

test('a failed asset download is a network error, not an alert', { skip }, async (t) => {
  const world = makeWorld(t);
  const sha = world.commit();
  const tarball = world.publish(sha);
  world.assets.delete(tarball);
  world.installApp('old', oldSha);
  world.running('window', 'old');
  await world.update();
  assertNoSwap(world, 'old');
  assert.deepEqual(world.alerts, []);
});

test('watchdog: the latest completed nightly failing alerts once per run id', { skip }, async (t) => {
  const world = makeWorld(t);
  world.installApp('old', oldSha);
  const success = { id: 4, conclusion: 'success', updated_at: new Date(world.now - HOUR).toISOString() };
  world.runs = [{ id: 5, conclusion: 'cancelled', updated_at: new Date(world.now).toISOString() }, success];
  await world.update();
  await world.update();
  assert.equal(world.alerts.length, 1);
  assert.match(world.alerts[0], /nightly/i);
  world.runs = [{ id: 6, conclusion: 'failure', updated_at: new Date(world.now).toISOString() }, ...world.runs];
  await world.update();
  await world.update();
  assert.equal(world.alerts.length, 2);
});

test('watchdog: no success within 26 hours alerts once, and a clean nightly clears it', { skip }, async (t) => {
  const world = makeWorld(t);
  world.installApp('old', oldSha);
  world.runs = [{ id: 4, conclusion: 'success', updated_at: new Date(world.now - 25 * HOUR).toISOString() }];
  await world.update();
  assert.deepEqual(world.alerts, []);
  world.now += 2 * HOUR;
  await world.update();
  await world.update();
  assert.equal(world.alerts.length, 1);
  assert.match(world.alerts[0], /26 hours/);

  world.runs = [{ id: 8, conclusion: 'success', updated_at: new Date(world.now).toISOString() }];
  await world.update();
  assert.equal(world.alerts.length, 1);
  assert.deepEqual(world.state().lastAlertKeys, []);
});

test('watchdog: no runs at all alerts once', { skip }, async (t) => {
  const world = makeWorld(t);
  world.installApp('old', oldSha);
  world.runs = [];
  await world.update();
  await world.update();
  assert.equal(world.alerts.length, 1);
});

test('two standing problems do not alternate alerts hour after hour', { skip }, async (t) => {
  const world = makeWorld(t);
  const sha = world.commit();
  world.publish(sha);
  world.installApp(sha);
  writeFileSync(join(world.devClone, 'untracked.txt'), 'work in progress\n');
  world.runs = [
    { id: 5, conclusion: 'failure', updated_at: new Date(world.now).toISOString() },
    { id: 4, conclusion: 'success', updated_at: new Date(world.now - HOUR).toISOString() },
  ];
  await world.update();
  assert.equal(world.alerts.length, 2);
  await world.update();
  await world.update();
  assert.equal(world.alerts.length, 2);
});

test('an offline run keeps standing alerts deduplicated when the network returns', { skip }, async (t) => {
  const world = makeWorld(t);
  world.installApp('old', oldSha);
  world.runs = [
    { id: 5, conclusion: 'failure', updated_at: new Date(world.now).toISOString() },
    { id: 4, conclusion: 'success', updated_at: new Date(world.now - HOUR).toISOString() },
  ];
  await world.update();
  assert.equal(world.alerts.length, 1);
  world.offline = true;
  await world.update();
  world.offline = false;
  await world.update();
  assert.equal(world.alerts.length, 1);
});

test('pruning keeps the 3 newest rollback tarballs and never touches foreign files', { skip }, async (t) => {
  const world = makeWorld(t);
  const sha = world.commit();
  world.publish(sha);
  world.installApp('old', oldSha);
  const dir = world.config.previousBuildsDir;
  mkdirSync(join(dir, '2026-10-23', APP_NAME), { recursive: true });
  const foreign = ['notes.txt', 'Omnia Happier notes.tar.gz', 'Other 111111111111.tar.gz'];
  for (const name of foreign) writeFileSync(join(dir, name), 'keep');
  const existing = ['Omnia Happier pre-nightly.tar.gz', ...['1', '2', '3'].map((digit) => `Omnia Happier ${digit.repeat(12)}.tar.gz`)];
  existing.forEach((name, index) => {
    writeFileSync(join(dir, name), 'old rollback');
    const when = new Date(Date.now() - (10 - index) * HOUR);
    utimesSync(join(dir, name), when, when);
  });
  await world.update();
  const names = readdirSync(dir).sort();
  assert.deepEqual(names, [
    '2026-10-23',
    'Omnia Happier 222222222222.tar.gz',
    'Omnia Happier 333333333333.tar.gz',
    `Omnia Happier ${oldSha.slice(0, 12)}.tar.gz`,
    'Omnia Happier notes.tar.gz',
    'Other 111111111111.tar.gz',
    'notes.txt',
  ].sort());
  assert.ok(existsSync(join(dir, '2026-10-23', APP_NAME)));
});

test('install writes the launch agent and bootstraps it from the dev clone', { skip }, (t) => {
  const world = makeWorld(t);
  installAgent(world.config, world.adapter);
  const plist = join(world.config.launchAgentsDir, 'com.omnia.happier.nightly-update.plist');
  const parsed = JSON.parse(run('plutil', ['-convert', 'json', '-o', '-', plist]));
  assert.deepEqual(parsed, {
    Label: 'com.omnia.happier.nightly-update',
    ProgramArguments: ['/opt/homebrew/bin/node', world.config.scriptPath, 'run'],
    StartInterval: 3600,
    RunAtLoad: true,
    LimitLoadToSessionType: 'Aqua',
    EnvironmentVariables: { PATH: '/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin' },
    StandardOutPath: world.config.logPath,
    StandardErrorPath: world.config.logPath,
  });
  assert.deepEqual(world.commands('launchctl').at(-1), ['bootstrap', 'gui/501', plist]);
  assert.ok(existsSync(join(world.root, 'Logs')), 'launchd needs the log directory to exist');
});

test('install refuses to run from anywhere but the dev clone', { skip }, (t) => {
  const world = makeWorld(t);
  world.config.scriptPath = join(world.root, 'worktree', 'scripts', 'fork', 'omnia-nightly-update.mjs');
  assert.throws(() => installAgent(world.config, world.adapter), /happier-dev/);
  assert.equal(existsSync(world.config.launchAgentsDir), false);
  assert.deepEqual(world.commands('launchctl'), []);
});

test('install surfaces a failed bootstrap', { skip }, (t) => {
  const world = makeWorld(t);
  const exec = world.adapter.exec;
  world.adapter.exec = (command, args) => (args[0] === 'bootstrap' ? { ok: false, out: '', err: 'denied' } : exec(command, args));
  assert.throws(() => installAgent(world.config, world.adapter), /denied/);
});

test('status reports a healthy machine and exits zero', { skip }, async (t) => {
  const world = makeWorld(t);
  const sha = world.commit();
  world.publish(sha);
  world.installApp(sha);
  await world.update();
  world.logs.length = 0;
  assert.equal(await printStatus(world.config, world.adapter), 0);
  const output = world.logs.join('\n');
  assert.ok(output.includes(sha), output);
  assert.ok(output.includes(releaseTagForSha(sha)), output);
});

test('status exits non-zero and says why for a hold, an error, a missing app or no network', { skip }, async (t) => {
  const world = makeWorld(t);
  const sha = world.commit();
  world.publish(sha);
  const fresh = new Date(world.now).toISOString();
  const statusOf = async () => {
    world.logs.length = 0;
    const code = await printStatus(world.config, world.adapter);
    return { code, output: world.logs.join('\n') };
  };

  world.installApp(sha);
  world.writeState({ installedSha: oldSha, heldSha: sha, lastSuccessfulCheckAt: fresh });
  const held = await statusOf();
  assert.equal(held.code, 1);
  assert.match(held.output, /held/i);

  world.writeState({ installedSha: sha, lastSuccessfulCheckAt: fresh, lastError: 'Something broke' });
  const errored = await statusOf();
  assert.equal(errored.code, 1);
  assert.match(errored.output, /Something broke/);

  world.writeState({ installedSha: sha, lastSuccessfulCheckAt: new Date(world.now - 27 * HOUR).toISOString() });
  assert.equal((await statusOf()).code, 1);

  world.writeState({ installedSha: sha, lastSuccessfulCheckAt: fresh });
  assert.equal((await statusOf()).code, 0);
  world.offline = true;
  assert.equal((await statusOf()).code, 1);
  world.offline = false;

  rmSync(world.appPath, { recursive: true });
  const missing = await statusOf();
  assert.equal(missing.code, 1);
  assert.match(missing.output, /missing/i);
});

test('status treats a rejected latest release as wrong', { skip }, async (t) => {
  const world = makeWorld(t);
  const sha = world.commit();
  world.publish(sha, { release: { immutable: false } });
  world.installApp(sha);
  world.writeState({ installedSha: sha, lastSuccessfulCheckAt: new Date(world.now).toISOString() });
  world.logs.length = 0;
  assert.equal(await printStatus(world.config, world.adapter), 1);
  assert.match(world.logs.join('\n'), /immutable|rejected|refus/i);
});
