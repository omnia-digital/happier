import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import {
  APP_NAME,
  BUNDLE_ID,
  MANIFEST_ASSET,
  PRODUCT_NAME,
  SERVER_URL,
  TARBALL_ASSET,
  releaseTagForSha,
  validateManifest,
  verifyAppBundle,
  verifyTarballLayout,
} from './nightly-release-contract.mjs';

// Turns the bundle built on Cassian into the two assets of a nightly release.

// The bare server URL is in every export as a constant, so these match the compiled sites that
// read the build-time settings. Anything but the expected literal, or a site that moved, fails.
const UPDATER_FLAG_SITE = /isDesktopPetOverlayWindowContext\)\(\)\)return!1;const [\w$]+=[\w$]+\(([^()]*)\)/g;
const SERVER_URL_SITE = /readWebRuntimeConfigServerUrl\)\(\),([^()]*)\)/g;

/** Throws unless the release settings reached the exported JavaScript the app embeds. */
export function verifyUiExport(exportDir) {
  const webDir = join(exportDir, '_expo', 'static', 'js', 'web');
  const updaterFlags = [];
  const serverUrls = [];
  for (const name of readdirSync(webDir).filter((file) => file.endsWith('.js'))) {
    const code = readFileSync(join(webDir, name), 'utf8');
    for (const [, flag] of code.matchAll(UPDATER_FLAG_SITE)) updaterFlags.push(flag.trim());
    for (const [, urls] of code.matchAll(SERVER_URL_SITE)) serverUrls.push(...urls.split(',').map((url) => url.trim()));
  }
  if (updaterFlags.length === 0 || updaterFlags.some((flag) => flag !== '"0"')) {
    throw new Error(`The exported UI does not disable the updater: found flag values [${updaterFlags.join(', ')}] in ${webDir}`);
  }
  if (serverUrls.length === 0 || serverUrls.some((url) => url !== JSON.stringify(SERVER_URL))) {
    throw new Error(`The exported UI does not use server URL ${SERVER_URL}: found [${serverUrls.join(', ')}] in ${webDir}`);
  }
}

function tool(command, args, env = process.env) {
  // A bundle's tar listing can exceed spawnSync's 1 MiB default buffer.
  const result = spawnSync(command, args, { encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed: ${result.stderr.trim()}`);
  return result;
}

function assertAdhocSignature(appPath) {
  // codesign writes its display output to stderr.
  const { stderr } = tool('codesign', ['-dv', appPath]);
  if (!/^Signature=adhoc$/m.test(stderr)) throw new Error(`Bundle is not ad-hoc signed: ${appPath}`);
}

async function sha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function main() {
  const { values } = parseArgs({
    options: {
      app: { type: 'string' },
      'source-sha': { type: 'string' },
      'run-id': { type: 'string' },
      'ui-export': { type: 'string' },
      'out-dir': { type: 'string' },
    },
  });
  const { app, 'source-sha': sourceSha, 'run-id': runId, 'ui-export': uiExport, 'out-dir': outDir } = values;
  if (!app || !uiExport || !outDir) throw new Error('--app, --source-sha, --run-id, --ui-export and --out-dir are required');
  const releaseTag = releaseTagForSha(sourceSha);
  if (!/^[1-9][0-9]*$/.test(String(runId))) throw new Error(`Invalid workflow run id: ${runId}`);
  if (basename(app) !== APP_NAME) throw new Error(`Expected a bundle named ${APP_NAME}, got ${basename(app)}`);

  const { version } = verifyAppBundle(app);
  assertAdhocSignature(app);
  verifyUiExport(uiExport);

  mkdirSync(outDir, { recursive: true });
  const tarball = join(outDir, TARBALL_ASSET);
  // COPYFILE_DISABLE stops macOS tar adding AppleDouble entries beside the bundle root.
  tool('tar', ['-czf', tarball, '-C', dirname(app), APP_NAME], { ...process.env, COPYFILE_DISABLE: '1' });
  verifyTarballLayout(tarball);

  const manifest = validateManifest({
    schema: 1,
    sourceSha,
    workflowRunId: Number(runId),
    version,
    bundleId: BUNDLE_ID,
    productName: PRODUCT_NAME,
    serverUrl: SERVER_URL,
    updatesEnabled: false,
    signature: 'adhoc',
    tarball: TARBALL_ASSET,
    size: statSync(tarball).size,
    sha256: await sha256(tarball),
    rustc: tool('rustc', ['--version']).stdout.trim().split(' ').slice(0, 2).join(' '),
    xcode: tool('xcodebuild', ['-version']).stdout.trim().split('\n')[0],
  }, releaseTag);
  writeFileSync(join(outDir, MANIFEST_ASSET), `${JSON.stringify(manifest, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
