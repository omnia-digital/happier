import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { inspectGitCheckoutIdentity } from './checkoutIdentity';
import { readGitWorktreeCleanupEvidence } from './repository';
import { readGitPublishedMergeEvidence } from './operations/cleanupPreflight';
import { createGitPullRequestBackend } from './operations/pullRequestOperations';
import { githubCliScmHostingProviderAdapter } from '../../hostingProviders/providers/githubCliAdapter';
import { runScmCommand } from '../../runtime';
import type { ScmPullRequestSummary } from '@happier-dev/protocol';
import { readHostWorktreeCleanupPreflight } from '../../../daemon/readHostWorktreeCleanupPreflight';
import { bindCreatedWorktreeToTrackedSession, recordHostCreatedWorktree } from '../../../daemon/worktreeCreationCustody';

const run = promisify(execFile);
const roots: string[] = [];

async function fixture() {
    const root = await mkdtemp(join(tmpdir(), 'happier-cleanup-git-'));
    roots.push(root);
    const bare = join(root, 'origin.git');
    const repo = join(root, 'repo');
    const worktree = join(root, 'feature');
    const env = { ...process.env, GIT_CONFIG_GLOBAL: join(root, 'empty-gitconfig'), GIT_CONFIG_NOSYSTEM: '1' };
    const git = async (cwd: string, ...args: string[]) => await run('git', args, { cwd, env });
    await git(root, 'init', '--bare', '-q', bare);
    await git(root, 'clone', '-q', bare, repo);
    await writeFile(join(repo, 'README'), 'base\n');
    await git(repo, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'add', 'README');
    await git(repo, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'base');
    await git(repo, 'branch', '-M', 'main');
    await git(repo, 'push', '-q', '-u', 'origin', 'main');
    await git(bare, 'symbolic-ref', 'HEAD', 'refs/heads/main');
    await git(repo, 'worktree', 'add', '-qb', 'feature', worktree);
    const identity = await inspectGitCheckoutIdentity({ cwd: worktree });
    if (!identity) throw new Error('Disposable linked worktree identity unavailable');
    return { root, bare, repo, worktree, git, identity };
}

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('Git cleanup preflight evidence', () => {
    it('reads a clean linked worktree, real registration, branch and common-dir identity', async () => {
        const f = await fixture();
        const evidence = await readGitWorktreeCleanupEvidence({
            worktreeRealPath: f.identity.worktreePath,
            registeredWorktreeRealPath: f.identity.registeredWorktreePath,
            gitCommonDirRealPath: f.identity.commonDirPath,
            branchName: 'feature',
        });
        expect(evidence).toMatchObject({
            kind: 'ok', branchName: 'feature',
            status: { staged: [], modified: [], untracked: [], ignored: [] },
            registration: { isLocked: false, isPrunable: false, isMain: false, otherWorktreeUsesBranch: false },
            operationState: null,
        });
    });

    it('separately captures staged, modified, untracked and ignored bytes', async () => {
        const f = await fixture();
        await writeFile(join(f.worktree, '.gitignore'), 'ignored.log\n');
        await f.git(f.worktree, 'add', '.gitignore');
        await writeFile(join(f.worktree, 'README'), 'modified\n');
        await writeFile(join(f.worktree, 'untracked.txt'), 'untracked\n');
        await writeFile(join(f.worktree, 'ignored.log'), 'ignored\n');
        const evidence = await readGitWorktreeCleanupEvidence({
            worktreeRealPath: f.identity.worktreePath,
            registeredWorktreeRealPath: f.identity.registeredWorktreePath,
            gitCommonDirRealPath: f.identity.commonDirPath,
            branchName: 'feature',
        });
        expect(evidence).toMatchObject({
            kind: 'ok',
            status: {
                staged: ['.gitignore'], modified: ['README'],
                untracked: ['untracked.txt'], ignored: ['ignored.log'],
            },
        });
    });
});

describe('fresh published merge proof', () => {
    it('requires the provider PR head and live source branch to match the claimed local HEAD', async () => {
        const f = await fixture();
        await f.git(f.repo, 'remote', 'set-url', 'origin', 'https://github.com/example/repo.git');
        await writeFile(join(f.worktree, 'feature.txt'), 'feature\n');
        await f.git(f.worktree, 'add', 'feature.txt');
        await f.git(f.worktree, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'feature');
        // Only the test fixture transfer goes to the disposable bare origin.
        await f.git(f.worktree, 'push', f.bare, 'feature:feature');
        const gitEvidence = await readGitWorktreeCleanupEvidence({
            worktreeRealPath: f.identity.worktreePath,
            registeredWorktreeRealPath: f.identity.registeredWorktreePath,
            gitCommonDirRealPath: f.identity.commonDirPath,
            branchName: 'feature',
        });
        expect(gitEvidence.kind).toBe('ok');
        if (gitEvidence.kind !== 'ok') throw new Error('Git fixture evidence unavailable');
        const link = {
            providerKind: 'github' as const, providerBaseUrl: 'https://github.com',
            repository: 'example/repo', number: 7, url: 'https://github.com/example/repo/pull/7',
        };
        const summary: ScmPullRequestSummary = {
            provider: { kind: 'github', name: 'GitHub', baseUrl: 'https://github.com', nameWithOwner: 'example/repo', remoteName: null },
            number: 7, title: 'Feature', url: link.url, baseBranch: 'main', headBranch: 'feature',
            state: 'merged', draft: false, headSha: gitEvidence.headOid, headRepository: 'example/repo',
        };
        let providerResult: ScmPullRequestSummary | null = summary;
        const backend = createGitPullRequestBackend({
            githubCliAdapter: { ...githubCliScmHostingProviderAdapter, getPullRequest: async () => providerResult },
            detectGithubCliAuth: async () => ({ kind: 'authenticated', command: 'gh', host: 'github.com' }),
        });
        const readRemoteRefs = async (remoteName: string, branchName: string) => {
            expect(remoteName).toBe('origin');
            return await runScmCommand({
                bin: 'git', cwd: f.worktree,
                args: ['ls-remote', '--symref', '--exit-code', '--', f.bare, 'HEAD', `refs/heads/${branchName}`],
            });
        };
        const read = () => readGitPublishedMergeEvidence({ gitEvidence, link, backend, readRemoteRefs });
        expect(await read()).toMatchObject({ kind: 'verified', headOid: gitEvidence.headOid, remoteName: 'origin', remoteDefaultBranch: 'main' });
        providerResult = { ...summary, state: 'closed' };
        expect(await read()).toMatchObject({ kind: 'unavailable', reason: 'pr_not_merged' });
        providerResult = { ...summary, state: 'merged', headSha: 'a'.repeat(40) };
        expect(await read()).toMatchObject({ kind: 'unavailable', reason: 'pr_head_mismatch' });
        providerResult = { ...summary, draft: true };
        expect(await read()).toMatchObject({ kind: 'unavailable', reason: 'pr_draft_or_unknown' });
        providerResult = { ...summary, headRepository: 'fork/repo' };
        expect(await read()).toMatchObject({ kind: 'unavailable', reason: 'pr_source_repository_mismatch' });
        providerResult = { ...summary, headRepository: undefined };
        expect(await read()).toMatchObject({ kind: 'unavailable', reason: 'pr_source_unknown' });
        providerResult = null;
        expect(await read()).toMatchObject({ kind: 'unavailable', reason: 'provider_unavailable' });
        providerResult = { ...summary, url: 'https://github.com/other/repo/pull/7', provider: { ...summary.provider, nameWithOwner: 'other/repo' } };
        expect(await read()).toMatchObject({ kind: 'unavailable' });
        providerResult = summary;
        await f.git(f.bare, 'update-ref', 'refs/heads/feature', (await f.git(f.bare, 'rev-parse', 'refs/heads/main')).stdout.trim());
        expect(await read()).toMatchObject({ kind: 'unavailable', reason: 'remote_head_mismatch' });
        await f.git(f.bare, 'update-ref', '-d', 'refs/heads/feature');
        expect(await read()).toMatchObject({ kind: 'unavailable', reason: 'remote_branch_absent' });
        await writeFile(join(f.worktree, 'later.txt'), 'later\n');
        await f.git(f.worktree, 'add', 'later.txt');
        await f.git(f.worktree, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'later local');
        expect(await read()).toMatchObject({ kind: 'unavailable', reason: 'local_head_changed' });
    });
});

describe('host claim and archived-session preflight', () => {
    it('reads only a durable bound claim and keeps both resources skipped while process and branch protection remain unknown', async () => {
        const f = await fixture();
        const owner = { homeDir: f.root, activeServerDir: join(f.root, 'servers', 'test'), ring: 'stable' as const,
            accountId: 'owner-account', machineId: 'owner-machine', launchNonce: 'launch-one' };
        await recordHostCreatedWorktree({ ...owner, worktreePath: f.worktree, expectedBranchName: 'feature', branchCreatedHere: true });
        await bindCreatedWorktreeToTrackedSession({ ...owner, sessionId: 'session-one', runnerPid: 12345,
            runnerPath: f.worktree, serverResolution: 'created' });
        const result = await readHostWorktreeCleanupPreflight({
            owner: { homeDir: owner.homeDir, activeServerDir: owner.activeServerDir, ring: owner.ring,
                machineId: owner.machineId, launchNonce: owner.launchNonce },
            credentials: { token: 'fixture-token', encryption: null },
            server: {
                accountId: async () => owner.accountId,
                session: async () => ({ id: 'session-one', active: false, archivedAt: 12, machineId: owner.machineId,
                    encryptionMode: 'plain', metadata: JSON.stringify({ path: f.worktree, machineId: owner.machineId,
                        happyHomeDir: owner.homeDir }), dataEncryptionKey: null }),
                page: async () => ({ sessions: [], hasNext: false, nextCursor: null }),
            },
        });
        expect(result).toMatchObject({
            kind: 'observed', sessionId: 'session-one',
            worktree: { kind: 'skipped', blockers: expect.arrayContaining(['process_visibility_unknown', 'publication_unproven']) },
            localBranch: { kind: 'skipped', blockers: expect.arrayContaining(['worktree_registered', 'branch_protection_unknown']) },
        });
        const wrongAccount = await readHostWorktreeCleanupPreflight({
            owner: { homeDir: owner.homeDir, activeServerDir: owner.activeServerDir, ring: owner.ring,
                machineId: owner.machineId, launchNonce: owner.launchNonce },
            credentials: { token: 'fixture-token', encryption: null },
            server: { accountId: async () => 'other-account', session: async () => null,
                page: async () => ({ sessions: [], hasNext: false, nextCursor: null }) },
        });
        expect(wrongAccount).toMatchObject({ kind: 'unavailable', reason: 'claim_unavailable' });
    });
});
