import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';

import { readWorktreeCreationClaim } from '@/daemon/worktreeCreationCustody';
import { registerScmHandlers } from './scm';

const run = promisify(execFile);
const fixtureDirs: string[] = [];

afterEach(async () => {
  await Promise.all(fixtureDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('SCM host worktree creation custody', () => {
  it('records a real host-created worktree with the authenticated machine owner while an existing branch remains unowned', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-scm-claim-'));
    fixtureDirs.push(root);
    const repository = join(root, 'repo');
    await mkdir(repository);
    const git = async (...args: string[]) => await run('git', args, {
      cwd: repository,
      env: { ...process.env, GIT_CONFIG_GLOBAL: join(root, 'empty-gitconfig'), GIT_CONFIG_NOSYSTEM: '1' },
    });
    await git('init', '-q');
    await writeFile(join(repository, 'README'), 'fixture\n');
    await git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'add', 'README');
    await git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture');
    await git('branch', 'reusable-branch');

    const handlers = new Map<string, (request: any) => Promise<any>>();
    const homeDir = join(root, 'host-home');
    registerScmHandlers({ registerHandler: (method: string, handler: (request: any) => Promise<any>) => {
      handlers.set(method, handler);
    } } as any, repository, {
      getCreationCustodyScope: async () => ({ homeDir, accountId: 'account-host', machineId: 'machine-host' }),
    });
    const create = handlers.get(RPC_METHODS.SCM_WORKTREE_CREATE)!;
    const result = await create({ cwd: repository, displayName: 'owned-branch', launchNonce: 'nonce-created' });
    expect(result.success).toBe(true);
    expect(await readWorktreeCreationClaim({ homeDir, accountId: 'account-host', machineId: 'machine-host', launchNonce: 'nonce-created' }))
      .toMatchObject({ branchName: 'owned-branch', branchCreatedHere: true });

    const existingResult = await create({ cwd: repository, displayName: 'reusable-branch', branchMode: 'existing', launchNonce: 'nonce-existing' });
    expect(existingResult.success).toBe(true);
    expect(await readWorktreeCreationClaim({ homeDir, accountId: 'account-host', machineId: 'machine-host', launchNonce: 'nonce-existing' }))
      .toMatchObject({ branchName: 'reusable-branch', branchCreatedHere: false });
  });
});
