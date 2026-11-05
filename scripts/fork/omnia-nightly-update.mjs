import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  APP_NAME,
  BUNDLE_ID,
  MANIFEST_ASSET,
  TARBALL_ASSET,
  bundleExecutablePath,
  isTrustedNightlyRelease,
  validateManifest,
  verifyAppBundle,
  verifyTarballLayout,
} from './nightly-release-contract.mjs';
import { updateProductionCheckout } from './production-checkout.mjs';

// Hourly macOS agent: installs the newest Omnia nightly release and keeps the two
// permanent clones on it. See docs/plans/nightly-omnia-release-auto-install/plan.md.

const API = 'https://api.github.com/repos/omnia-digital/happier';
const AGENT_LABEL = 'com.omnia.happier.nightly-update';
const AGENT_SCRIPT = join('scripts', 'fork', 'omnia-nightly-update.mjs');
const AGENT_PATH = '/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin';
const USAGE = 'Usage: node scripts/fork/omnia-nightly-update.mjs <install|run|status>';

const HOUR = 3_600_000;
const IDLE_BEFORE_INSTALL_MS = 15 * 60_000;
const DEFERRAL_ALERT_MS = 24 * HOUR;
// One nightly period plus a two hour margin.
const STALE_MS = 26 * HOUR;
const QUIT_TIMEOUT_MS = 30_000;
const ALIVE_WINDOW_MS = 10_000;
const POLL_MS = 1_000;
const ROLLBACKS_KEPT = 3;
const ROLLBACK_NAME = /^Omnia Happier ([0-9a-f]{12}|pre-nightly)\.tar\.gz$/;

class NetworkError extends Error {}

export function defaultConfig() {
  const apps = join(homedir(), 'Developer', 'Projects', 'Omnia', 'apps');
  const support = join(homedir(), 'Library', 'Application Support', 'Omnia Happier');
  return {
    appPath: join('/Applications', APP_NAME),
    stateDir: join(support, 'nightly-update'),
    previousBuildsDir: join(support, 'Previous Builds'),
    devClone: join(apps, 'happier-dev'),
    productionClone: join(apps, 'happier-production'),
    launchAgentsDir: join(homedir(), 'Library', 'LaunchAgents'),
    logPath: join(homedir(), 'Library', 'Logs', 'omnia-happier-nightly-update.log'),
    nodePath: '/opt/homebrew/bin/node',
    uid: process.getuid(),
    scriptPath: fileURLToPath(import.meta.url),
  };
}

export const systemAdapter = {
  fetch: (url, init) => fetch(url, init),
  exec(command, args) {
    const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: Infinity });
    return { ok: result.status === 0, out: (result.stdout ?? '').trim(), err: (result.stderr ?? result.error?.message ?? '').trim() };
  },
  kill(pid, signal) {
    try {
      process.kill(pid, signal);
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  },
  now: () => Date.now(),
  sleep: (ms) => new Promise((done) => { setTimeout(done, ms); }),
  log: (line) => console.log(line),
  // Notifications from osascript do not appear on this Mac, so alerts are dialogs. Detached
  // because a dialog stays up until clicked and must not hold the hourly run open. No default
  // button, so pressing Return while typing cannot dismiss one unread.
  showDialog(message) {
    const script = ['on run argv', 'display alert "Omnia Happier update" message (item 1 of argv) as critical buttons {"OK"}', 'end run'];
    const child = spawn('osascript', [...script.flatMap((line) => ['-e', line]), message], { detached: true, stdio: 'ignore' });
    child.on('error', (error) => console.error(`Could not show the alert dialog: ${error.message}`));
    child.unref();
  },
};

function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: Infinity, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

function isAncestor(cwd, sha, ref) {
  return spawnSync('git', ['merge-base', '--is-ancestor', sha, ref], { cwd }).status === 0;
}

/** A corrupt file yields defaults and `corrupt`, so recovery still runs: restoring a bundle needs nothing from state. */
function loadState(config) {
  const defaults = {
    installedSha: null,
    heldSha: null,
    lastSuccessfulCheckAt: null,
    // Every alert standing after the last complete run. One key would let two standing problems alternate hourly.
    lastAlertKeys: [],
    deferredSince: null,
    swap: null,
    lastError: null,
  };
  const path = join(config.stateDir, 'state.json');
  if (!existsSync(path)) return { state: defaults, corrupt: false };
  try {
    return { state: { ...defaults, ...JSON.parse(readFileSync(path, 'utf8')) }, corrupt: false };
  } catch {
    return { state: defaults, corrupt: true };
  }
}

function saveState(ctx) {
  const path = join(ctx.config.stateDir, 'state.json');
  writeFileSync(`${path}.tmp`, `${JSON.stringify(ctx.state, null, 2)}\n`);
  renameSync(`${path}.tmp`, path);
}

function log(ctx, message) {
  ctx.adapter.log(`${new Date(ctx.adapter.now()).toISOString()} ${message}`);
}

function alert(ctx, key, message) {
  log(ctx, `ALERT ${message}`);
  const alreadySent = ctx.raised.has(key) || ctx.state.lastAlertKeys.includes(key);
  ctx.raised.set(key, message);
  if (alreadySent) return;
  ctx.adapter.showDialog(message);
}

function moveBundle(ctx, from, to) {
  try {
    renameSync(from, to);
  } catch (error) {
    if (error.code !== 'EPERM') throw error;
    throw new Error(`macOS denied replacing ${ctx.config.appPath}. Grant App Management to ${ctx.config.nodePath} in System Settings > Privacy & Security > App Management.`);
  }
}

async function request(ctx, url, headers) {
  try {
    return await ctx.adapter.fetch(url, { headers });
  } catch (error) {
    throw new NetworkError(`${url}: ${error.message}`);
  }
}

/** The parsed JSON body, or null for a 404. Anything else unsuccessful is a transient network failure. */
async function getJson(ctx, url) {
  const response = await request(ctx, url, { Accept: 'application/vnd.github+json' });
  if (response.status === 404) return null;
  if (!response.ok) throw new NetworkError(`${url} returned ${response.status}`);
  let text;
  try {
    text = await response.text();
  } catch (error) {
    throw new NetworkError(`${url}: ${error.message}`);
  }
  return JSON.parse(text);
}

function assetUrl(release, name) {
  return release.assets.find((asset) => asset.name === name).browser_download_url;
}

async function acceptRelease(ctx, release) {
  if (!isTrustedNightlyRelease(release)) {
    throw new Error(`Refused release ${release.tag_name}: it must be a published immutable nightly by the release workflow.`);
  }
  try {
    return validateManifest(await getJson(ctx, assetUrl(release, MANIFEST_ASSET)), release.tag_name);
  } catch (error) {
    if (error instanceof NetworkError) throw error;
    throw new Error(`Refused release ${release.tag_name}: ${error.message}`);
  }
}

function findPid(ctx) {
  if (!existsSync(ctx.config.appPath)) return null;
  const executable = bundleExecutablePath(ctx.config.appPath);
  for (const line of ctx.adapter.exec('ps', ['-axo', 'pid=,comm=']).out.split('\n')) {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (match?.[2] === executable) return Number(match[1]);
  }
  return null;
}

function appMode(ctx, pid) {
  const asn = ctx.adapter.exec('lsappinfo', ['find', `pid=${pid}`]).out;
  const info = ctx.adapter.exec('lsappinfo', ['info', '-only', 'ApplicationType', asn]).out;
  // Only a positive tray reading skips the input check and the window relaunch.
  return info.includes('type="UIElement"') ? 'tray' : 'window';
}

function isFrontmost(ctx) {
  const front = ctx.adapter.exec('lsappinfo', ['front']).out;
  return ctx.adapter.exec('lsappinfo', ['info', '-only', 'bundleID', front]).out.includes(`"${BUNDLE_ID}"`);
}

function idleMs(ctx) {
  const match = /"HIDIdleTime" = (\d+)/.exec(ctx.adapter.exec('ioreg', ['-c', 'IOHIDSystem']).out);
  // An unreadable idle time counts as active, which only defers.
  return match ? Number(match[1]) / 1_000_000 : 0;
}

function relaunch(ctx, mode) {
  if (mode === 'none' || findPid(ctx)) return;
  // --menu-bar is what the app's own login item passes. Needs no launchd state, unlike kickstart.
  const result = ctx.adapter.exec('open', ['-g', '-a', ctx.config.appPath, ...(mode === 'tray' ? ['--args', '--menu-bar'] : [])]);
  if (!result.ok) alert(ctx, `relaunch-failed:${mode}`, `Could not relaunch Omnia Happier in ${mode} mode: ${result.err}`);
}

async function quitApp(ctx, pid) {
  ctx.adapter.kill(pid, 'SIGTERM');
  const deadline = ctx.adapter.now() + QUIT_TIMEOUT_MS;
  // Match by path, so a respawned copy still counts as running.
  while (findPid(ctx)) {
    if (ctx.adapter.now() >= deadline) return false;
    await ctx.adapter.sleep(POLL_MS);
  }
  return true;
}

/** Launches the swapped-in app when needed; true when one process survives the alive window. */
async function staysRunning(ctx, mode) {
  relaunch(ctx, mode);
  const deadline = ctx.adapter.now() + ALIVE_WINDOW_MS;
  let pid = findPid(ctx);
  while (!pid && ctx.adapter.now() < deadline) {
    await ctx.adapter.sleep(POLL_MS);
    pid = findPid(ctx);
  }
  if (!pid) return false;
  await ctx.adapter.sleep(ALIVE_WINDOW_MS);
  return findPid(ctx) === pid;
}

async function confirmSwap(ctx, swap) {
  if (swap.mode === 'none' || await staysRunning(ctx, swap.mode)) {
    rmSync(ctx.outgoing, { recursive: true, force: true });
    rmSync(ctx.stagingDir, { recursive: true, force: true });
    ctx.state.installedSha = swap.sha;
    ctx.state.swap = null;
    ctx.state.deferredSince = null;
    saveState(ctx);
    log(ctx, `Installed ${swap.sha}`);
    return;
  }
  await rollBack(ctx, swap);
}

async function rollBack(ctx, swap) {
  const pid = findPid(ctx);
  if (pid && !await quitApp(ctx, pid)) {
    // The swap stays recorded so the next run looks at it again.
    alert(ctx, `rollback-blocked:${swap.sha}`, `Omnia Happier ${swap.sha.slice(0, 12)} failed its alive check and did not quit, so it could not be rolled back.`);
    return;
  }
  const failed = join(ctx.config.stateDir, 'failed.app');
  rmSync(failed, { recursive: true, force: true });
  moveBundle(ctx, ctx.config.appPath, failed);
  moveBundle(ctx, ctx.outgoing, ctx.config.appPath);
  rmSync(failed, { recursive: true, force: true });
  rmSync(ctx.stagingDir, { recursive: true, force: true });
  ctx.state.heldSha = swap.sha;
  ctx.state.swap = null;
  saveState(ctx);
  relaunch(ctx, swap.mode);
  alert(ctx, `held:${swap.sha}`, `Omnia Happier ${swap.sha.slice(0, 12)} did not stay running. Rolled back and held that build until a newer release.`);
}

/** Step 1: finish whatever a previous run left between quitting the app and confirming the new one. */
async function recoverSwap(ctx) {
  const { swap } = ctx.state;
  if (existsSync(ctx.outgoing)) {
    if (existsSync(ctx.config.appPath)) {
      await confirmSwap(ctx, swap ?? { sha: ctx.state.installedSha, mode: 'none' });
      return;
    }
    moveBundle(ctx, ctx.outgoing, ctx.config.appPath);
    log(ctx, 'Restored the app bundle after an interrupted swap.');
  } else if (!swap) {
    return;
  }
  ctx.state.swap = null;
  saveState(ctx);
  if (swap) relaunch(ctx, swap.mode);
}

function fastForwardDevClone(clone, sha) {
  if (git(clone, 'branch', '--show-current') !== 'dev') throw new Error(`${clone} is not on dev; happier-dev was left alone.`);
  if (git(clone, 'status', '--porcelain=v1', '--untracked-files=all')) throw new Error(`${clone} has uncommitted work; happier-dev was left alone.`);
  if (isAncestor(clone, sha, 'HEAD')) return;
  git(clone, 'fetch', 'origin', 'refs/heads/dev:refs/remotes/origin/dev');
  if (!isAncestor(clone, sha, 'refs/remotes/origin/dev')) throw new Error(`${sha} is not on origin/dev; happier-dev was left alone.`);
  git(clone, 'merge', '--ff-only', '--no-overwrite-ignore', sha);
}

/** Step 3. Returns false unless the SHA is proven on production, the origin check for everything after. */
function refreshClones(ctx, sha) {
  const { productionClone, devClone } = ctx.config;
  try {
    updateProductionCheckout(productionClone);
  } catch (error) {
    if (error.code === 'PRODUCTION_FETCH_FAILED') throw new NetworkError(error.message);
    alert(ctx, `production-clone:${sha}`, `happier-production could not update, so ${sha.slice(0, 12)} is unproven and will not install: ${error.message}`);
    return false;
  }
  if (!isAncestor(productionClone, sha, 'HEAD')) {
    // happier-dev runs this agent, so it must not advance to a SHA production never certified.
    alert(ctx, `not-on-production:${sha}`, `Release ${sha.slice(0, 12)} is not on production. Refused.`);
    return false;
  }
  try {
    fastForwardDevClone(devClone, sha);
  } catch (error) {
    alert(ctx, `dev-clone:${sha}`, `happier-dev did not update: ${error.message}`);
  }
  return true;
}

/** Step 5. Returns the staged, verified bundle, downloading it unless an earlier run left a good one. */
async function stageRelease(ctx, release, manifest) {
  const stagedDir = join(ctx.stagingDir, manifest.sourceSha);
  // No .app name while it waits: LaunchServices could offer a same-id bundle for happier:// links.
  const staged = join(stagedDir, 'bundle');
  if (existsSync(staged)) {
    try {
      verifyAppBundle(staged);
      return staged;
    } catch (error) {
      log(ctx, `Discarding the staged bundle: ${error.message}`);
    }
  }
  rmSync(ctx.stagingDir, { recursive: true, force: true });
  const unpacked = join(ctx.stagingDir, 'unpacking');
  mkdirSync(unpacked, { recursive: true });
  try {
    const tarball = join(ctx.stagingDir, TARBALL_ASSET);
    writeFileSync(tarball, await downloadTarball(ctx, release, manifest));
    verifyTarballLayout(tarball);
    const extracted = spawnSync('tar', ['-xzf', tarball, '-C', unpacked], { encoding: 'utf8' });
    if (extracted.status !== 0) throw new Error(`Could not unpack the release tarball: ${extracted.stderr}`);
    verifyAppBundle(join(unpacked, APP_NAME));
    rmSync(tarball);
    mkdirSync(stagedDir);
    renameSync(join(unpacked, APP_NAME), staged);
    rmSync(unpacked, { recursive: true });
    return staged;
  } catch (error) {
    rmSync(ctx.stagingDir, { recursive: true, force: true });
    throw error;
  }
}

async function downloadTarball(ctx, release, manifest) {
  const url = assetUrl(release, TARBALL_ASSET);
  const response = await request(ctx, url);
  if (!response.ok) throw new NetworkError(`${url} returned ${response.status}`);
  let bytes;
  try {
    bytes = Buffer.from(await response.arrayBuffer());
  } catch (error) {
    throw new NetworkError(`${url}: ${error.message}`);
  }
  const label = manifest.sourceSha.slice(0, 12);
  if (bytes.length !== manifest.size) throw new Error(`Release ${label} tarball is ${bytes.length} bytes, expected ${manifest.size}. Refused.`);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== manifest.sha256) throw new Error(`Release ${label} tarball hash is ${sha256}, expected ${manifest.sha256}. Refused.`);
  return bytes;
}

function saveRollback(ctx) {
  const { appPath, previousBuildsDir } = ctx.config;
  mkdirSync(previousBuildsDir, { recursive: true });
  const name = `Omnia Happier ${ctx.state.installedSha?.slice(0, 12) ?? 'pre-nightly'}.tar.gz`;
  const path = join(previousBuildsDir, name);
  // COPYFILE_DISABLE keeps AppleDouble files out of the archive.
  const archived = spawnSync('tar', ['-czf', `${path}.tmp`, '-C', dirname(appPath), basename(appPath)], { encoding: 'utf8', env: { ...process.env, COPYFILE_DISABLE: '1' } });
  if (archived.status !== 0) {
    rmSync(`${path}.tmp`, { force: true });
    throw new Error(`Could not save the rollback tarball: ${archived.stderr}`);
  }
  renameSync(`${path}.tmp`, path);
  const tarballs = readdirSync(previousBuildsDir)
    .filter((entry) => ROLLBACK_NAME.test(entry))
    .map((entry) => ({ path: join(previousBuildsDir, entry), mtime: statSync(join(previousBuildsDir, entry)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  for (const old of tarballs.slice(ROLLBACKS_KEPT)) rmSync(old.path);
}

/** Step 7. */
async function installStaged(ctx, sha, staged, pid, mode) {
  const { appPath } = ctx.config;
  if (existsSync(appPath)) {
    // A denied rename must not cost a running app its sessions, so prove the permission before quitting.
    moveBundle(ctx, appPath, ctx.outgoing);
    moveBundle(ctx, ctx.outgoing, appPath);
    saveRollback(ctx);
  }
  ctx.state.swap = { sha, mode };
  saveState(ctx);
  if (pid && !await quitApp(ctx, pid)) {
    // The swap stays recorded: if the app exits later, the next run relaunches it.
    alert(ctx, `quit-timeout:${sha}`, `Omnia Happier did not quit within ${QUIT_TIMEOUT_MS / 1000} seconds and is still running, so ${sha.slice(0, 12)} was not installed.`);
    return;
  }
  try {
    if (existsSync(appPath)) moveBundle(ctx, appPath, ctx.outgoing);
    moveBundle(ctx, staged, appPath);
  } catch (error) {
    if (!existsSync(appPath) && existsSync(ctx.outgoing)) moveBundle(ctx, ctx.outgoing, appPath);
    ctx.state.swap = null;
    saveState(ctx);
    relaunch(ctx, mode);
    throw error;
  }
  await confirmSwap(ctx, ctx.state.swap);
}

/** A run that ends without a network failure is a successful check, so API, git and download outages all reach the 26 hour alert. */
async function updateFromRelease(ctx) {
  try {
    await applyLatestRelease(ctx);
  } catch (error) {
    if (error instanceof NetworkError) throw error;
    ctx.state.lastSuccessfulCheckAt = new Date(ctx.adapter.now()).toISOString();
    throw error;
  }
  ctx.state.lastSuccessfulCheckAt = new Date(ctx.adapter.now()).toISOString();
}

async function applyLatestRelease(ctx) {
  await recoverSwap(ctx);
  const release = await getJson(ctx, `${API}/releases/latest`);
  if (!release) {
    log(ctx, 'No release has been published yet.');
    return;
  }
  const manifest = await acceptRelease(ctx, release);
  const sha = manifest.sourceSha;
  if (!refreshClones(ctx, sha)) return;

  if (ctx.state.heldSha && ctx.state.heldSha !== sha) ctx.state.heldSha = null;
  const bundlePresent = existsSync(ctx.config.appPath);
  if (ctx.state.heldSha === sha) {
    log(ctx, `${sha} is held after a failed install.`);
    if (!bundlePresent) alert(ctx, `bundle-missing:${sha}`, `${ctx.config.appPath} is missing and the latest release is held, so nothing was installed.`);
    return;
  }
  if (bundlePresent && ctx.state.installedSha === sha) {
    ctx.state.deferredSince = null;
    log(ctx, `${sha} is already installed.`);
    return;
  }

  const staged = await stageRelease(ctx, release, manifest);
  const pid = findPid(ctx);
  const mode = pid ? appMode(ctx, pid) : 'none';
  if (pid && (isFrontmost(ctx) || (mode === 'window' && idleMs(ctx) < IDLE_BEFORE_INSTALL_MS))) {
    ctx.state.deferredSince ??= new Date(ctx.adapter.now()).toISOString();
    log(ctx, `Deferred ${sha} while the app is in use.`);
    if (ctx.adapter.now() - Date.parse(ctx.state.deferredSince) > DEFERRAL_ALERT_MS) {
      alert(ctx, `deferred:${ctx.state.deferredSince}`, `Omnia Happier ${sha.slice(0, 12)} has been deferred since ${ctx.state.deferredSince} because the app stays in use.`);
    }
    return;
  }
  await installStaged(ctx, sha, staged, pid, mode);
}

/** Step 8. GitHub lists runs newest first, and one page covers far more than the 26 hour window. */
async function watchdog(ctx) {
  const body = await getJson(ctx, `${API}/actions/workflows/omnia-production.yml/runs?status=completed`);
  const runs = body?.workflow_runs ?? [];
  const latest = runs[0];
  if (latest && latest.conclusion !== 'success') {
    alert(ctx, `nightly-failed:${latest.id}`, `The latest nightly (run ${latest.id}) ended ${latest.conclusion}.`);
  }
  const success = runs.find((run) => run.conclusion === 'success');
  if (!success || ctx.adapter.now() - Date.parse(success.updated_at) > STALE_MS) {
    alert(ctx, `nightly-stale:${success?.id ?? 'none'}`, 'No nightly has succeeded in the last 26 hours. Check the Cassian runner.');
  }
}

function noteNetworkFailure(ctx, error) {
  log(ctx, `Network: ${error.message}`);
  ctx.incomplete = true;
  const lastCheck = ctx.state.lastSuccessfulCheckAt;
  if (!lastCheck) {
    // Start the clock, or a machine that has never reached GitHub would never say so.
    ctx.state.lastSuccessfulCheckAt = new Date(ctx.adapter.now()).toISOString();
  } else if (ctx.adapter.now() - Date.parse(lastCheck) > STALE_MS) {
    alert(ctx, `offline:${lastCheck}`, `Could not reach GitHub or download the release for over 26 hours (last success ${lastCheck}).`);
  }
}

function open(config, adapter) {
  const { state, corrupt } = loadState(config);
  return {
    config,
    adapter,
    state,
    stateCorrupt: corrupt,
    outgoing: join(config.stateDir, 'outgoing.app'),
    stagingDir: join(config.stateDir, 'staging'),
    raised: new Map(),
    incomplete: false,
  };
}

export async function runUpdate(config, adapter) {
  mkdirSync(config.stateDir, { recursive: true });
  const ctx = open(config, adapter);
  if (ctx.stateCorrupt) alert(ctx, 'state-corrupt', 'The update agent state file was unreadable and has been reset. The latest release will be reinstalled once.');
  for (const step of [updateFromRelease, watchdog]) {
    try {
      await step(ctx);
    } catch (error) {
      if (error instanceof NetworkError) noteNetworkFailure(ctx, error);
      else alert(ctx, `error:${step.name}:${error.message}`, error.message);
    }
  }
  const raised = [...ctx.raised.keys()];
  // A run that could not evaluate everything cannot say a standing problem went away.
  ctx.state.lastAlertKeys = ctx.incomplete ? [...new Set([...ctx.state.lastAlertKeys, ...raised])] : raised;
  if (raised.length) ctx.state.lastError = [...ctx.raised.values()].at(-1);
  else if (!ctx.incomplete) ctx.state.lastError = null;
  saveState(ctx);
}

function plistString(value) {
  return `<string>${String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</string>`;
}

export function installAgent(config, adapter) {
  const script = join(config.devClone, AGENT_SCRIPT);
  if (resolve(config.scriptPath) !== script) {
    throw new Error(`The agent must be installed from happier-dev (${script}), not ${config.scriptPath}.`);
  }
  mkdirSync(config.launchAgentsDir, { recursive: true });
  mkdirSync(dirname(config.logPath), { recursive: true });
  const plist = join(config.launchAgentsDir, `${AGENT_LABEL}.plist`);
  writeFileSync(plist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key>${plistString(AGENT_LABEL)}
<key>ProgramArguments</key><array>${plistString(config.nodePath)}${plistString(script)}${plistString('run')}</array>
<key>StartInterval</key><integer>3600</integer>
<key>RunAtLoad</key><true/>
<key>LimitLoadToSessionType</key>${plistString('Aqua')}
<key>EnvironmentVariables</key><dict><key>PATH</key>${plistString(AGENT_PATH)}</dict>
<key>StandardOutPath</key>${plistString(config.logPath)}
<key>StandardErrorPath</key>${plistString(config.logPath)}
</dict></plist>
`);
  // Replaces an already-loaded copy; the bootout failing just means there was none.
  adapter.exec('launchctl', ['bootout', `gui/${config.uid}/${AGENT_LABEL}`]);
  const loaded = adapter.exec('launchctl', ['bootstrap', `gui/${config.uid}`, plist]);
  if (!loaded.ok) throw new Error(`launchctl bootstrap failed: ${loaded.err}`);
  adapter.log(`Installed ${AGENT_LABEL} from ${script}`);
}

/** Prints the current picture and returns the process exit code. Changes nothing. */
export async function printStatus(config, adapter) {
  const ctx = open(config, adapter);
  const { state } = ctx;
  const problems = ctx.stateCorrupt ? ['The state file is unreadable; the next run resets it.'] : [];
  let latest = 'none published';
  try {
    const release = await getJson(ctx, `${API}/releases/latest`);
    if (release) {
      await acceptRelease(ctx, release);
      latest = release.tag_name;
    }
  } catch (error) {
    latest = 'unavailable';
    problems.push(error.message);
  }
  if (!existsSync(config.appPath)) problems.push(`${config.appPath} is missing.`);
  if (state.heldSha) problems.push(`Held after a failed install: ${state.heldSha}`);
  if (state.lastError) problems.push(`Last error: ${state.lastError}`);
  if (!state.lastSuccessfulCheckAt || adapter.now() - Date.parse(state.lastSuccessfulCheckAt) > STALE_MS) {
    problems.push(`No successful check in 26 hours (last: ${state.lastSuccessfulCheckAt ?? 'never'}).`);
  }
  adapter.log(`Installed: ${state.installedSha ?? 'unknown'}`);
  adapter.log(`Latest release: ${latest}`);
  adapter.log(`State: ${state.deferredSince ? `deferred since ${state.deferredSince}` : problems.length ? 'needs attention' : 'ok'}`);
  adapter.log(`Last successful check: ${state.lastSuccessfulCheckAt ?? 'never'}`);
  for (const problem of problems) adapter.log(problem);
  return problems.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, ...rest] = process.argv.slice(2);
    if (process.platform !== 'darwin') throw new Error('The nightly update agent runs on macOS only.');
    if (rest.length || !['install', 'run', 'status'].includes(command)) throw new Error(USAGE);
    const config = defaultConfig();
    if (command === 'install') installAgent(config, systemAdapter);
    if (command === 'run') await runUpdate(config, systemAdapter);
    if (command === 'status') process.exitCode = await printStatus(config, systemAdapter);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
