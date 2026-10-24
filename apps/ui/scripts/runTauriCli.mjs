// @ts-check

import { createRequire } from 'node:module';
import { createTauriActoolEnvironment } from './tauriActoolEnvironment.mjs';

const require = createRequire(import.meta.url);
// The official JS wrapper also exports logError, omitted from its declaration file.
/** @type {typeof import('@tauri-apps/cli') & { logError(message: string): void }} */
const cli = require('@tauri-apps/cli');
const args = process.argv.slice(2);
const actool = args.includes('--no-bundle') ? null : createTauriActoolEnvironment();
const previousPath = process.env.PATH;
try {
  if (actool) process.env.PATH = actool.env.PATH;
  // Delegate argument parsing, execution, and error reporting to the official CLI.
  await cli.run(args, 'tauri');
} catch (error) {
  cli.logError(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  if (previousPath === undefined) delete process.env.PATH;
  else process.env.PATH = previousPath;
  actool?.cleanup();
}
