import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { writeExecutableShimSync } from '@/testkit/fs/executableShim';
import { piPreflightModelsProbeAdapter } from './piPreflightModelsProbeAdapter';
import { PiRpcBackend } from '../rpc/PiRpcBackend';

// Pi's JSONL process is the external boundary; Happier launch, RPC deadlines and cleanup stay real.
function writeFakePi(directory: string, outcome: 'commands' | 'empty' | 'unsupported' | 'malformed' | 'hang') {
  const script = join(directory, 'pi.cjs');
  writeFileSync(script, `
    const fs = require('node:fs');
    const path = require('node:path');
    const args = process.argv.slice(2);
    const trace = { pid: process.pid, cwd: process.cwd(), selected: process.env.PI_TEST_SELECTED, args, requests: [] };
    const record = () => fs.writeFileSync(path.join(process.cwd(), 'trace.json'), JSON.stringify(trace));
    record();
    if (args[args.indexOf('--mode') + 1] !== 'rpc' || !args.includes('--no-session')) process.exit(2);
    require('node:readline').createInterface({input: process.stdin}).on('line', line => {
      const request = JSON.parse(line);
      trace.requests.push(request.type);
      record();
      if (request.type !== 'get_commands') process.exit(3);
      if (${JSON.stringify(outcome)} === 'hang') return;
      const commands = ${JSON.stringify(outcome)} === 'empty' ? [] : [
        {name: 'Mixed-Case', description: 'Native extension', source: 'extension'},
        {name: 'skill:design', description: 'Native slash skill', source: 'skill'},
      ];
      process.stdout.write(JSON.stringify({
        id: request.id, type: 'response', command: request.type,
        success: ${JSON.stringify(outcome)} !== 'unsupported',
        ...(${JSON.stringify(outcome)} === 'unsupported' ? {error: 'Unknown command: get_commands'} : {
          data: ${JSON.stringify(outcome)} === 'malformed' ? {} : {commands},
        }),
      }) + '\\n');
    });
  `);
  return writeExecutableShimSync({
    dir: directory, fileName: process.platform === 'win32' ? 'pi.cmd' : 'pi',
    contents: process.platform === 'win32'
      ? `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`
      : `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`,
  });
}

describe('Pi native preflight catalogs', () => {
  const directories: string[] = [];
  afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  });

  it('settles both concurrent backend disposals only after its native process closes', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'happier-pi-concurrent-dispose-'));
    directories.push(directory);
    const command = writeFakePi(directory, 'commands');
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) env[key] = value;
    }
    const backend = new PiRpcBackend({ cwd: directory, command, args: ['--mode', 'rpc', '--no-session'], env });
    await backend.discoverCommands({ timeoutMs: 5_000 });
    const trace = JSON.parse(readFileSync(join(directory, 'trace.json'), 'utf8')) as { pid: number };
    const first = backend.dispose();
    try {
      await backend.dispose();
      expect(() => process.kill(trace.pid, 0)).toThrow();
    } finally {
      await first;
    }
  });

  async function probe(outcome: Parameters<typeof writeFakePi>[1], timeoutMs = 5_000) {
    const directory = mkdtempSync(join(tmpdir(), 'happier-pi-preflight-catalog-'));
    directories.push(directory);
    const command = writeFakePi(directory, outcome);
    let error: unknown;
    const result = await piPreflightModelsProbeAdapter.probeCatalogsRaw?.({
      cwd: directory, timeoutMs,
      processEnv: { ...process.env, HAPPIER_PI_PATH: command, PI_TEST_SELECTED: 'scoped-auth' },
    }).catch((failure: unknown) => { error = failure; });
    const trace = existsSync(join(directory, 'trace.json'))
      ? JSON.parse(readFileSync(join(directory, 'trace.json'), 'utf8')) as {
        pid: number; cwd: string; selected: string; args: string[]; requests: string[];
      }
      : null;
    return { result, error, trace, directory };
  }

  function expectStopped(trace: Awaited<ReturnType<typeof probe>>['trace']) {
    expect(trace).not.toBeNull();
    if (!trace) return;
    expect(() => process.kill(trace.pid, 0)).toThrow();
    const extensionPath = trace.args[trace.args.lastIndexOf('--extension') + 1];
    expect(existsSync(extensionPath)).toBe(false);
    expect(trace.requests).toEqual(['get_commands']);
  }

  it('reads native commands without a user turn or persisted session and leaves typed skills unsupported', async () => {
    const { result, trace, directory } = await probe('commands');
    expect(result).toEqual({
      commands: [
        { name: 'Mixed-Case', description: 'Native extension', source: 'extension' },
        { name: 'skill:design', description: 'Native slash skill', source: 'skill' },
      ],
      skills: null,
    });
    expect(trace).toMatchObject({ cwd: realpathSync(directory), selected: 'scoped-auth' });
    expectStopped(trace);
  });

  it('preserves an observed empty command catalog', async () => {
    const { result, trace } = await probe('empty');
    expect(result).toEqual({ commands: [], skills: null });
    expectStopped(trace);
  });

  it.each(['unsupported', 'malformed'] as const)('does not claim an empty catalog for %s native discovery', async (outcome) => {
    const { result, error, trace } = await probe(outcome);
    expect(result).toBeUndefined();
    expect(error).toBeInstanceOf(Error);
    expectStopped(trace);
  });

  it('stops the native process and removes its extension when the caller deadline expires', async () => {
    const { result, error, trace } = await probe('hang', 1_500);
    expect(result).toBeUndefined();
    expect(error).toMatchObject({ name: 'PiRpcCommandResponseTimeoutError' });
    expectStopped(trace);
  });
});
