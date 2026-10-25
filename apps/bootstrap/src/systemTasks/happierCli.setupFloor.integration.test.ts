import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, readlink, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { installVersionedPayload } from '@happier-dev/cli-common/firstPartyRuntime';
import { afterEach, describe, expect, it } from 'vitest';

import { ensureSetupCapableLocalHappierCli } from './happierCli.js';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

// Real executables replace the OS/service boundary; acquisition, activation and restart planning
// all remain real. Windows requires a native PE fixture rather than a POSIX executable shebang.
describe.skipIf(process.platform === 'win32')('setup-floor managed replacement', () => {
  async function setup() {
    const root = await mkdtemp(join(tmpdir(), 'hsetup-floor-transaction-'));
    roots.push(root);
    const home = join(root, 'home');
    const serviceVersion = join(root, 'running-service-version');
    const restartLog = join(root, 'restarts');
    await writeFile(serviceVersion, '0.2.12');
    const processEnv = { ...process.env, HOME: root, USERPROFILE: root, HAPPIER_HOME_DIR: home, HAPPIER_BOOTSTRAP_CLI_PATH: '', HAPPIER_BOOTSTRAP_HAPPIER_PATH: '', HAPPIER_STACK_REPO_DIR: root, PATH: '' };
    async function payload(version: string, broken = false) {
      const payloadRoot = join(root, `payload-${version}`);
      await mkdir(join(payloadRoot, 'package-dist'), { recursive: true });
      await writeFile(join(payloadRoot, 'package-dist', 'index.mjs'), 'export {};\n');
      const status = {
        server: { activeServerId: 'cloud', serverUrl: 'https://relay.example.test', localServerUrl: null, publicServerUrl: 'https://relay.example.test', webappUrl: 'https://app.example.test', comparableKey: 'relay.example.test' },
        daemon: { running: true, serviceManaged: true, pid: 4321, httpPort: 7777 },
        service: { installed: true, running: true },
        auth: { authenticated: true, machineRegistered: true, machineId: 'local', needsAuth: false, accountId: 'acct' },
      };
      await writeFile(join(payloadRoot, 'happier'), `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
if (${broken}) process.exit(3);
if (args.includes('--version')) console.log(${JSON.stringify(version)});
else if (args.join(' ') === 'daemon service list --json') console.log(JSON.stringify({ entries: [] }));
else if (args.join(' ') === 'daemon status --json') {
  const status = ${JSON.stringify(status)};
  status.daemon.startedWithCliVersion = fs.readFileSync(${JSON.stringify(serviceVersion)}, 'utf8');
  console.log(JSON.stringify(status));
} else {
  if (args.includes('restart')) {
    fs.writeFileSync(${JSON.stringify(serviceVersion)}, ${JSON.stringify(version)});
    fs.appendFileSync(${JSON.stringify(restartLog)}, ${JSON.stringify(version + '\n')});
  }
  console.log(JSON.stringify({ ok: true }));
}
`);
      await chmod(join(payloadRoot, 'happier'), 0o755);
      return payloadRoot;
    }
    await installVersionedPayload({ componentId: 'happier-cli', processEnv, releaseRing: 'stable', versionId: '0.2.12', payloadRoot: await payload('0.2.12') });
    const preparePayload = async () => ({ versionId: '0.2.13', payloadRoot: await payload('0.2.13'), cleanup: async () => {} });
    async function activation() {
      const bin = join(home, 'bin');
      return {
        marker: await readFile(join(home, 'cli', 'current.version'), 'utf8'),
        pointer: await readlink(join(home, 'cli', 'current')),
        channel: await readFile(join(home, 'default-cli-release-channel.json'), 'utf8'),
        shims: await Promise.all((await readdir(bin)).sort().map(async (name) => [name, await readFile(join(bin, name), 'utf8')])),
      };
    }
    return { home, processEnv, payload, preparePayload, activation, serviceVersion, restartLog };
  }

  it('rejects a bad staged executable without displacing the old CLI or running service', async () => {
    const computer = await setup();
    const before = await computer.activation();
    await expect(ensureSetupCapableLocalHappierCli({ releaseRing: 'stable', processEnv: computer.processEnv }, {
      preparePayload: async () => ({ versionId: '0.2.13', payloadRoot: await computer.payload('0.2.13', true), cleanup: async () => {} }),
    })).rejects.toMatchObject({ code: 'cli_update_smoke_failed' });
    expect(await computer.activation()).toEqual(before);
    expect(await readFile(computer.serviceVersion, 'utf8')).toBe('0.2.12');
    expect(existsSync(computer.restartLog)).toBe(false);
  });

  it('uses the existing service restart proof on a successful floor replacement', async () => {
    const computer = await setup();
    await expect(ensureSetupCapableLocalHappierCli({ releaseRing: 'stable', processEnv: computer.processEnv }, { preparePayload: computer.preparePayload }))
      .resolves.toMatchObject({ provenance: 'managed', version: '0.2.13' });
    expect(await readFile(computer.serviceVersion, 'utf8')).toBe('0.2.13');
    expect(await readFile(computer.restartLog, 'utf8')).toBe('0.2.13\n');
  });

  it('keeps first acquisition on its path and refuses a below-floor target before activation', async () => {
    const computer = await setup();
    // This exact layout belongs to the temporary test home; simulate no existing managed CLI.
    await rm(join(computer.home, 'cli'), { recursive: true });
    await rm(join(computer.home, 'bin'), { recursive: true });
    await rm(join(computer.home, 'default-cli-release-channel.json'));
    await expect(ensureSetupCapableLocalHappierCli({ releaseRing: 'stable', processEnv: computer.processEnv }, {
      preparePayload: async () => ({ versionId: '0.2.12', payloadRoot: await computer.payload('0.2.12'), cleanup: async () => {} }),
    })).rejects.toMatchObject({ code: 'cli_below_setup_floor' });
    expect(existsSync(join(computer.home, 'cli', 'current.version'))).toBe(false);
    expect(existsSync(join(computer.home, 'default-cli-release-channel.json'))).toBe(false);
  });
});
