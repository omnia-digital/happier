import { afterEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  bindCreatedWorktreeToTrackedSession,
  readWorktreeCreationClaim,
  recordHostCreatedWorktree,
} from './worktreeCreationCustody';
import { bindTrackedWorktreeCreation } from './sessions/bindTrackedWorktreeCreation';
import type { TrackedSession } from './types';

const run = promisify(execFile);
const fixtureDirs: string[] = [];

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'happier-worktree-custody-'));
  fixtureDirs.push(root);
  const repository = join(root, 'repo');
  const homeDir = join(root, 'host-home');
  const activeServerDir = join(homeDir, 'servers', 'home-a');
  await mkdir(activeServerDir, { recursive: true });
  await mkdir(repository);
  const git = async (...args: string[]) => await run('git', args, {
    cwd: repository,
    env: { ...process.env, GIT_CONFIG_GLOBAL: join(root, 'empty-gitconfig'), GIT_CONFIG_NOSYSTEM: '1' },
  });
  await git('init', '-q');
  await writeFile(join(repository, 'README'), 'fixture\n');
  await git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'add', 'README');
  await git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture');
  const worktreePath = join(root, 'worktree');
  await git('worktree', 'add', '-qb', 'owned-branch', worktreePath);
  return { root, repository, worktreePath, homeDir, activeServerDir, git };
}

afterEach(async () => {
  await Promise.all(fixtureDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('host worktree creation custody', () => {
  it('records actual Git identity and binds only the matching tracked created session across reload', async () => {
    const f = await fixture();
    const owner = { homeDir: f.homeDir, activeServerDir: f.activeServerDir, accountId: 'account-a', machineId: 'machine-a', launchNonce: 'nonce-a' };
    const recorded = await recordHostCreatedWorktree({ ...owner, worktreePath: f.worktreePath, expectedBranchName: 'owned-branch', branchCreatedHere: true });
    expect(recorded?.worktreeRealPath).toBe(await realpath(f.worktreePath));
    expect(recorded?.branchName).toBe('owned-branch');
    expect(recorded?.branchCreatedHere).toBe(true);
    expect(recorded?.gitCommonDirRealPath).toBe(await realpath(join(f.repository, '.git')));
    expect(recorded?.registeredWorktreeRealPath).toBe(await realpath(f.worktreePath));

    const bound = await bindCreatedWorktreeToTrackedSession({
      ...owner, sessionId: 'session-a', runnerPid: 12345, runnerPath: f.worktreePath,
      serverResolution: 'created',
    });
    expect(bound?.sessionId).toBe('session-a');
    expect((await readWorktreeCreationClaim(owner))?.sessionId).toBe('session-a');
    expect(await bindCreatedWorktreeToTrackedSession({
      ...owner, sessionId: 'session-a', runnerPid: 12345, runnerPath: f.worktreePath,
      serverResolution: 'existing',
    })).toMatchObject({ sessionId: 'session-a' });
  });

  it('keeps wrong account, machine, nonce, path, and server resolution unclaimed', async () => {
    const f = await fixture();
    const owner = { homeDir: f.homeDir, activeServerDir: f.activeServerDir, accountId: 'account-a', machineId: 'machine-a', launchNonce: 'nonce-a' };
    await recordHostCreatedWorktree({ ...owner, worktreePath: f.worktreePath, expectedBranchName: 'owned-branch', branchCreatedHere: false });
    const good = { ...owner, sessionId: 'session-a', runnerPid: 12345, runnerPath: f.worktreePath, serverResolution: 'created' as const };
    for (const bad of [
      { ...good, accountId: 'account-b' }, { ...good, machineId: 'machine-b' },
      { ...good, launchNonce: 'nonce-b' }, { ...good, runnerPath: f.repository },
      { ...good, serverResolution: 'existing' as const }, { ...good, serverResolution: undefined },
    ]) {
      expect(await bindCreatedWorktreeToTrackedSession(bad)).toBeNull();
    }
    expect((await readWorktreeCreationClaim(owner))?.sessionId).toBeUndefined();
    expect((await readWorktreeCreationClaim(owner))?.branchCreatedHere).toBe(false);
  });

  it('does not adopt corrupted records or replace a different claim on nonce retry', async () => {
    const f = await fixture();
    const owner = { homeDir: f.homeDir, activeServerDir: f.activeServerDir, accountId: 'account-a', machineId: 'machine-a', launchNonce: 'nonce-a' };
    const first = await recordHostCreatedWorktree({ ...owner, worktreePath: f.worktreePath, expectedBranchName: 'owned-branch', branchCreatedHere: true });
    expect(first).not.toBeNull();
    expect(await recordHostCreatedWorktree({ ...owner, worktreePath: f.repository, expectedBranchName: 'owned-branch', branchCreatedHere: true })).toBeNull();
    const files = await import('node:fs/promises').then((fs) => fs.readdir(join(f.activeServerDir, 'worktree-creation-custody')));
    expect(files.filter((name) => name.endsWith('.json'))).toHaveLength(1);
    const claimFile = join(f.activeServerDir, 'worktree-creation-custody', files.find((name) => name.endsWith('.json'))!);
    await writeFile(claimFile, JSON.stringify({ ...first, accountId: 'account-b' }));
    expect(await readWorktreeCreationClaim(owner)).toBeNull();
    expect(await recordHostCreatedWorktree({ ...owner, worktreePath: f.worktreePath, expectedBranchName: 'owned-branch', branchCreatedHere: true })).toBeNull();
    await writeFile(claimFile, '{bad');
    expect(await readWorktreeCreationClaim(owner)).toBeNull();
    expect(await bindCreatedWorktreeToTrackedSession({
      ...owner, sessionId: 'session-a', runnerPid: 12345, runnerPath: f.worktreePath,
      serverResolution: 'created',
    })).toBeNull();
  });

  it('requires the tracked child and its server-created result to match owner, nonce, machine, and path', async () => {
    const f = await fixture();
    const owner = { homeDir: f.homeDir, activeServerDir: f.activeServerDir, ring: 'stable' as const, accountId: 'account-a', machineId: 'machine-a', launchNonce: 'nonce-a' };
    await recordHostCreatedWorktree({ ...owner, worktreePath: f.worktreePath, expectedBranchName: 'owned-branch', branchCreatedHere: true });
    const tracked = {
      pid: 12345, startedBy: 'daemon', happySessionId: 'session-a',
      spawnOptions: { directory: f.worktreePath, machineId: 'machine-a', spawnNonce: 'nonce-a' },
    } as TrackedSession;
    const metadata = { path: f.worktreePath, machineId: 'machine-a', happyHomeDir: f.homeDir, hostPid: 12345, startedBy: 'daemon' as const };
    const request = { owner, tracked, metadata, sessionId: 'session-a', serverResolution: 'created' as const, creationAccountId: 'account-a' };
    expect(await bindTrackedWorktreeCreation({ ...request, creationAccountId: 'account-b' })).toBeNull();
    expect(await bindTrackedWorktreeCreation({ ...request, creationAccountId: undefined })).toBeNull();
    expect(await bindTrackedWorktreeCreation({ ...request, owner: { ...owner, accountId: 'account-b' } })).toBeNull();
    expect(await bindTrackedWorktreeCreation({ ...request, tracked: { ...tracked, spawnOptions: { ...tracked.spawnOptions!, machineId: 'machine-b' } } })).toBeNull();
    expect(await bindTrackedWorktreeCreation({ ...request, tracked: { ...tracked, spawnOptions: { ...tracked.spawnOptions!, spawnNonce: 'nonce-b' } } })).toBeNull();
    expect(await bindTrackedWorktreeCreation({ ...request, metadata: { ...metadata, path: f.repository } })).toBeNull();
    expect(await bindTrackedWorktreeCreation({ ...request, metadata: { ...metadata, hostPid: 67890 } })).toBeNull();
    expect(await bindTrackedWorktreeCreation({ ...request, serverResolution: 'existing' })).toBeNull();
    expect(await bindTrackedWorktreeCreation({ ...request, serverResolution: undefined })).toBeNull();
    expect(await bindTrackedWorktreeCreation({ ...request, tracked: { ...tracked, spawnOptions: { ...tracked.spawnOptions!, existingSessionId: 'session-a' } } })).toBeNull();
    expect(await bindTrackedWorktreeCreation(request)).toMatchObject({ sessionId: 'session-a' });
    expect(await bindTrackedWorktreeCreation({
      ...request,
      serverResolution: 'existing',
      tracked: { ...tracked, spawnOptions: { ...tracked.spawnOptions!, existingSessionId: 'session-a' } },
    })).toMatchObject({ sessionId: 'session-a' });
  });

  it('does not lend the same nonce and account claim to another Home under the same host storage root', async () => {
    const f = await fixture();
    const owner = { homeDir: f.homeDir, activeServerDir: f.activeServerDir, accountId: 'account-a', machineId: 'machine-a', launchNonce: 'nonce-a' };
    await recordHostCreatedWorktree({ ...owner, worktreePath: f.worktreePath, expectedBranchName: 'owned-branch', branchCreatedHere: true });
    const otherHome = { ...owner, activeServerDir: join(f.homeDir, 'servers', 'home-b') };
    expect(await readWorktreeCreationClaim(otherHome)).toBeNull();
    expect(await bindCreatedWorktreeToTrackedSession({
      ...otherHome, sessionId: 'session-b', runnerPid: 12345,
      runnerPath: f.worktreePath, serverResolution: 'created',
    })).toBeNull();
  });

  it('does not claim a branch that replaced the branch returned by creation before capture', async () => {
    const f = await fixture();
    const owner = { homeDir: f.homeDir, activeServerDir: f.activeServerDir, accountId: 'account-a', machineId: 'machine-a', launchNonce: 'nonce-a' };
    await f.git('branch', 'preexisting-branch');
    await f.git('-C', f.worktreePath, 'switch', '-q', 'preexisting-branch');
    expect(await recordHostCreatedWorktree({
      ...owner, worktreePath: f.worktreePath, expectedBranchName: 'owned-branch', branchCreatedHere: true,
    })).toBeNull();
    expect(await readWorktreeCreationClaim(owner)).toBeNull();
  });
});
