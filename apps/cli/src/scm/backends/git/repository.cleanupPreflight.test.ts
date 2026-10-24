import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
    vi.unstubAllEnvs();
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function publishedFixture() {
    const f = await fixture();
    await writeFile(join(f.worktree, 'feature.txt'), 'feature\n');
    await f.git(f.worktree, 'add', 'feature.txt');
    await f.git(f.worktree, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'feature');
    const sourceOid = (await f.git(f.worktree, 'rev-parse', 'HEAD')).stdout.trim();
    const baseOid = (await f.git(f.repo, 'rev-parse', 'main')).stdout.trim();
    await f.git(f.worktree, 'push', f.bare, 'feature:feature');
    await f.git(f.repo, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'merge', '--no-ff', '--no-edit', 'feature');
    const targetOid = (await f.git(f.repo, 'rev-parse', 'main')).stdout.trim();
    await f.git(f.repo, 'push', f.bare, 'main:main');
    await f.git(f.repo, 'remote', 'set-url', 'origin', 'https://github.com/example/repo.git');
    const expected = { worktreeRealPath: f.identity.worktreePath, registeredWorktreeRealPath: f.identity.registeredWorktreePath,
        gitCommonDirRealPath: f.identity.commonDirPath, branchName: 'feature' };
    const gitEvidence = await readGitWorktreeCleanupEvidence(expected);
    if (gitEvidence.kind !== 'ok') throw new Error('Git fixture evidence unavailable');
    const link = { providerKind: 'github' as const, providerBaseUrl: 'https://github.com',
        repository: 'example/repo', number: 7, url: 'https://github.com/example/repo/pull/7' };
    const summary: ScmPullRequestSummary = {
        provider: { kind: 'github', name: 'GitHub', baseUrl: link.providerBaseUrl, nameWithOwner: link.repository, remoteName: null },
        number: link.number, title: 'Feature', url: link.url, baseBranch: 'main', headBranch: 'feature',
        state: 'merged', draft: false, headSha: sourceOid, headRepository: link.repository,
    };
    const provider = { result: summary as ScmPullRequestSummary | null };
    const backend = createGitPullRequestBackend({
        githubCliAdapter: { ...githubCliScmHostingProviderAdapter, getPullRequest: async () => provider.result },
        detectGithubCliAuth: async () => ({ kind: 'authenticated', command: 'gh', host: 'github.com' }),
    });
    const readRemoteRefs = async () => await runScmCommand({ bin: 'git', cwd: f.worktree,
        args: ['ls-remote', '--symref', '--exit-code', '--', f.bare, 'HEAD', 'refs/heads/feature'] });
    const input = { gitEvidence, link, backend, readRemoteRefs };
    return { ...f, expected, sourceOid, baseOid, targetOid, summary, provider, input,
        read: (overrides?: Partial<typeof input>) => readGitPublishedMergeEvidence({ ...input, ...overrides }) };
}

describe('exact current-source default-target ancestry', () => {
    it('uses the live default OID rather than stale tracking refs, ignoring replacement ancestry', async () => {
        const f = await publishedFixture();
        await f.git(f.repo, 'update-ref', 'refs/remotes/origin/main', f.targetOid);
        await f.git(f.bare, 'update-ref', 'refs/heads/main', f.baseOid);
        await f.git(f.repo, 'replace', f.baseOid, f.targetOid);
        expect((await f.git(f.repo, 'merge-base', '--is-ancestor', f.sourceOid, f.baseOid))).toBeDefined();
        expect(await f.read()).toMatchObject({ kind: 'current_publication_match', integration: { kind: 'unproven', reason: 'not_ancestor' } });
        await f.git(f.bare, 'update-ref', 'refs/heads/main', f.targetOid);
        expect(await f.read()).toMatchObject({ integration: { kind: 'ancestor', sourceOid: f.sourceOid, targetOid: f.targetOid } });
    });

    it('does not mistake a later published empty commit for integration', async () => {
        const f = await publishedFixture();
        await f.git(f.worktree, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-qm', 'later empty');
        await f.git(f.worktree, 'push', f.bare, 'feature:feature');
        const gitEvidence = await readGitWorktreeCleanupEvidence(f.expected);
        if (gitEvidence.kind !== 'ok') throw new Error('Current evidence unavailable');
        f.provider.result = { ...f.summary, headSha: gitEvidence.headOid };
        expect(await f.read({ gitEvidence })).toMatchObject({ kind: 'current_publication_match', integration: { kind: 'unproven', reason: 'not_ancestor' } });
    });

    it.each(['graft', 'shallow', 'promisor', 'missing-target'] as const)('keeps %s history unproven without acquiring objects', async (condition) => {
        const f = await publishedFixture();
        if (condition === 'graft') await writeFile(join(f.identity.commonDirPath, 'info', 'grafts'), `${f.targetOid} ${f.sourceOid}\n`);
        if (condition === 'shallow') await writeFile(join(f.identity.commonDirPath, 'shallow'), `${f.sourceOid}\n`);
        if (condition === 'promisor') await f.git(f.repo, 'config', 'remote.origin.promisor', 'true');
        if (condition === 'missing-target') {
            const outside = join(f.root, 'outside');
            await f.git(f.root, 'clone', '-q', f.bare, outside);
            await f.git(outside, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-qm', 'remote only');
            await f.git(outside, 'push', f.bare, 'main:main');
        }
        expect(await f.read()).toMatchObject({ kind: 'current_publication_match', integration: { kind: 'unproven' } });
        expect((await f.git(f.repo, 'rev-parse', 'main')).stdout.trim()).toBe(f.targetOid);
    });

    it.each(['multiple-fetch', 'multiple-push', 'rewrite', 'wrong-host'] as const)('rejects %s effective remote identity', async (condition) => {
        const f = await publishedFixture();
        if (condition === 'multiple-fetch') await f.git(f.repo, 'remote', 'set-url', '--add', 'origin', 'https://github.com/other/repo.git');
        if (condition === 'multiple-push') {
            await f.git(f.repo, 'remote', 'set-url', '--add', '--push', 'origin', 'https://github.com/example/repo.git');
            await f.git(f.repo, 'remote', 'set-url', '--add', '--push', 'origin', 'https://github.com/other/repo.git');
        }
        if (condition === 'rewrite') await f.git(f.repo, 'config', 'url.https://github.com/other/.insteadOf', 'https://github.com/example/');
        if (condition === 'wrong-host') await f.git(f.repo, 'remote', 'set-url', 'origin', 'https://github.example/example/repo.git');
        expect(await f.read()).toMatchObject({ kind: 'unavailable' });
    });

    it.each(['target', 'source', 'remote-config', 'local-head'] as const)('rejects %s drift during observation', async (condition) => {
        const f = await publishedFixture();
        let first = true;
        const readRemoteRefs = async () => {
            const refs = await f.input.readRemoteRefs();
            if (first) {
                first = false;
                if (condition === 'target') await f.git(f.bare, 'update-ref', 'refs/heads/main', f.baseOid);
                if (condition === 'source') await f.git(f.bare, 'update-ref', 'refs/heads/feature', f.baseOid);
                if (condition === 'remote-config') await f.git(f.repo, 'remote', 'set-url', 'origin', 'https://github.com/other/repo.git');
                if (condition === 'local-head') await f.git(f.worktree, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-qm', 'racing head');
            }
            return refs;
        };
        expect(await f.read({ readRemoteRefs })).toMatchObject({ kind: 'unavailable' });
    });

    it('refuses inherited Git directory/config overrides before reading another repository', async () => {
        const f = await publishedFixture();
        for (const [key, value] of [['GIT_DIR', f.bare], ['GIT_CONFIG_COUNT', '0'], ['GIT_SHALLOW_FILE', join(f.root, 'shadow')]]) {
            vi.stubEnv(key!, value!);
            expect(await f.read()).toMatchObject({ kind: 'unavailable', reason: 'unsafe_git_environment' });
            expect(await readGitWorktreeCleanupEvidence(f.expected)).toMatchObject({ kind: 'unavailable', reason: 'unsafe_git_environment' });
            vi.unstubAllEnvs();
        }
    });

    it('leaves local refs, index, config and working bytes unchanged', async () => {
        const f = await publishedFixture();
        await utimes(join(f.worktree, 'README'), 1, 1);
        const snapshot = async () => ({
            refs: (await f.git(f.repo, 'show-ref')).stdout,
            index: await readFile(join(f.identity.gitDirPath, 'index')),
            config: await readFile(join(f.identity.commonDirPath, 'config')),
            readme: await readFile(join(f.worktree, 'README')),
        });
        const before = await snapshot();
        expect(await readGitWorktreeCleanupEvidence(f.expected)).toMatchObject({ kind: 'ok' });
        expect(await f.read()).toMatchObject({ integration: { kind: 'ancestor' } });
        expect(await snapshot()).toEqual(before);
    });
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

    it('reports locked registration and refuses a changed claimed path or Git common dir', async () => {
        const f = await fixture();
        await f.git(f.repo, 'worktree', 'lock', f.worktree, '--reason', 'fixture');
        const expected = {
            worktreeRealPath: f.identity.worktreePath,
            registeredWorktreeRealPath: f.identity.registeredWorktreePath,
            gitCommonDirRealPath: f.identity.commonDirPath,
            branchName: 'feature',
        };
        expect(await readGitWorktreeCleanupEvidence(expected)).toMatchObject({
            kind: 'ok', registration: { isLocked: true, isMain: false },
        });
        expect(await readGitWorktreeCleanupEvidence({ ...expected, worktreeRealPath: f.repo })).toMatchObject({
            kind: 'unavailable', reason: 'identity_changed',
        });
        expect(await readGitWorktreeCleanupEvidence({ ...expected, gitCommonDirRealPath: f.bare })).toMatchObject({
            kind: 'unavailable', reason: 'identity_changed',
        });
    });
});

describe('current PR state and source publication evidence', () => {
    it.each(['merge', 'squash', 'rebase'] as const)('observes unchanged published source after %s integration without target ancestry assumptions', async (method) => {
        const f = await fixture();
        await writeFile(join(f.worktree, 'feature.txt'), 'feature\n');
        await f.git(f.worktree, 'add', 'feature.txt');
        await f.git(f.worktree, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'feature');
        const sourceOid = (await f.git(f.worktree, 'rev-parse', 'HEAD')).stdout.trim();
        await f.git(f.worktree, 'push', f.bare, 'feature:feature');
        if (method === 'merge') {
            await f.git(f.repo, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'merge', '--no-ff', '--no-edit', 'feature');
        } else if (method === 'squash') {
            await f.git(f.repo, 'merge', '--squash', 'feature');
            await f.git(f.repo, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'squash feature');
        } else {
            await writeFile(join(f.repo, 'main.txt'), 'main change\n');
            await f.git(f.repo, 'add', 'main.txt');
            await f.git(f.repo, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'main change');
            await f.git(f.repo, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'cherry-pick', sourceOid);
        }
        await f.git(f.repo, 'push', f.bare, 'main:main');
        await f.git(f.repo, 'remote', 'set-url', 'origin', 'https://github.com/example/repo.git');
        const gitEvidence = await readGitWorktreeCleanupEvidence({
            worktreeRealPath: f.identity.worktreePath,
            registeredWorktreeRealPath: f.identity.registeredWorktreePath,
            gitCommonDirRealPath: f.identity.commonDirPath,
            branchName: 'feature',
        });
        expect(gitEvidence.kind).toBe('ok');
        if (gitEvidence.kind !== 'ok') throw new Error('Git fixture evidence unavailable');
        expect(gitEvidence.headOid).toBe(sourceOid);
        const link = { providerKind: 'github' as const, providerBaseUrl: 'https://github.com',
            repository: 'example/repo', number: 7, url: 'https://github.com/example/repo/pull/7' };
        const summary: ScmPullRequestSummary = {
            provider: { kind: 'github', name: 'GitHub', baseUrl: link.providerBaseUrl, nameWithOwner: link.repository, remoteName: null },
            number: link.number, title: 'Feature', url: link.url, baseBranch: 'main', headBranch: 'feature',
            state: 'merged', draft: false, headSha: sourceOid, headRepository: link.repository,
        };
        const backend = createGitPullRequestBackend({
            githubCliAdapter: { ...githubCliScmHostingProviderAdapter, getPullRequest: async () => summary },
            detectGithubCliAuth: async () => ({ kind: 'authenticated', command: 'gh', host: 'github.com' }),
        });
        const result = await readGitPublishedMergeEvidence({
            gitEvidence, link, backend,
            readRemoteRefs: async () => await runScmCommand({ bin: 'git', cwd: f.worktree,
                args: ['ls-remote', '--symref', '--exit-code', '--', f.bare, 'HEAD', 'refs/heads/feature'] }),
        });
        expect(result).toMatchObject({ kind: 'current_publication_match', atMergeSourceHead: 'unproven',
            headOid: sourceOid, remoteOid: sourceOid, remoteDefaultBranch: 'main',
            integration: method === 'merge'
                ? { kind: 'ancestor', sourceOid, targetOid: (await f.git(f.repo, 'rev-parse', 'main')).stdout.trim(),
                    targetRef: 'refs/heads/main', providerBaseUrl: link.providerBaseUrl, repository: link.repository }
                : { kind: 'unproven', reason: 'not_ancestor' },
        });
        const ancestry = await runScmCommand({ bin: 'git', cwd: f.repo, args: ['merge-base', '--is-ancestor', sourceOid, 'main'] });
        expect(ancestry.success).toBe(method === 'merge');
    });

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
        expect(await read()).toMatchObject({ kind: 'current_publication_match', atMergeSourceHead: 'unproven',
            headOid: gitEvidence.headOid, remoteName: 'origin', remoteDefaultBranch: 'main' });
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
        await f.git(f.repo, 'remote', 'set-url', 'origin', 'https://github.com/other/repo.git');
        const wrongRemote = await readGitWorktreeCleanupEvidence({
            worktreeRealPath: f.identity.worktreePath, registeredWorktreeRealPath: f.identity.registeredWorktreePath,
            gitCommonDirRealPath: f.identity.commonDirPath, branchName: 'feature',
        });
        if (wrongRemote.kind !== 'ok') throw new Error('Wrong-remote fixture evidence unavailable');
        expect(await readGitPublishedMergeEvidence({ gitEvidence: wrongRemote, link, backend, readRemoteRefs })).toMatchObject({
            kind: 'unavailable', reason: 'remote_identity_unavailable',
        });
        await f.git(f.repo, 'remote', 'set-url', 'origin', 'https://github.com/example/repo.git');
        await f.git(f.repo, 'remote', 'set-url', '--push', 'origin', 'https://github.com/other/repo.git');
        const wrongPushRemote = await readGitWorktreeCleanupEvidence({
            worktreeRealPath: f.identity.worktreePath, registeredWorktreeRealPath: f.identity.registeredWorktreePath,
            gitCommonDirRealPath: f.identity.commonDirPath, branchName: 'feature',
        });
        if (wrongPushRemote.kind !== 'ok') throw new Error('Wrong-push fixture evidence unavailable');
        expect(await readGitPublishedMergeEvidence({ gitEvidence: wrongPushRemote, link, backend, readRemoteRefs })).toMatchObject({
            kind: 'unavailable', reason: 'remote_identity_unavailable',
        });
        await f.git(f.repo, 'remote', 'set-url', '--push', 'origin', 'https://github.com/example/repo.git');
        await f.git(f.bare, 'symbolic-ref', 'HEAD', 'refs/heads/feature');
        expect(await read()).toMatchObject({ kind: 'unavailable', reason: 'default_branch' });
        await f.git(f.bare, 'symbolic-ref', 'HEAD', 'refs/heads/main');
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
    it('removes only the integration blocker for a complete candidate and never mixes PR facts', async () => {
        const f = await publishedFixture();
        const owner = { homeDir: f.root, activeServerDir: join(f.root, 'servers', 'test'), ring: 'stable' as const,
            accountId: 'owner-account', machineId: 'owner-machine', launchNonce: 'launch-one' };
        await recordHostCreatedWorktree({ ...owner, worktreePath: f.worktree, expectedBranchName: 'feature', branchCreatedHere: true });
        await bindCreatedWorktreeToTrackedSession({ ...owner, sessionId: 'session-one', runnerPid: 12345,
            runnerPath: f.worktree, serverResolution: 'created' });
        const otherLink = { ...f.input.link, number: 8, url: 'https://github.com/example/repo/pull/8' };
        const backend = createGitPullRequestBackend({
            githubCliAdapter: { ...githubCliScmHostingProviderAdapter, getPullRequest: async ({ number }) => number === 8
                ? { ...f.summary, number, url: otherLink.url, state: 'open' }
                : f.provider.result },
            detectGithubCliAuth: async () => ({ kind: 'authenticated', command: 'gh', host: 'github.com' }),
        });
        const read = () => readHostWorktreeCleanupPreflight({
            owner: { machineId: owner.machineId, launchNonce: owner.launchNonce },
            hostScope: { homeDir: owner.homeDir, activeServerDir: owner.activeServerDir, ring: owner.ring },
            credentials: { token: 'fixture-token', encryption: null },
            publication: { backend, readRemoteRefs: f.input.readRemoteRefs },
            server: {
                accountId: async () => owner.accountId,
                session: async () => ({ id: 'session-one', active: false, archivedAt: 12, machineId: owner.machineId,
                    encryptionMode: 'plain', metadata: JSON.stringify({ path: f.worktree, machineId: owner.machineId,
                        happyHomeDir: owner.homeDir, sessionPullRequestsV1: { v: 1, links: [otherLink, f.input.link] } }), dataEncryptionKey: null }),
                page: async () => ({ sessions: [], hasNext: false, nextCursor: null }),
            },
        });
        const result = await read();
        expect(result).toMatchObject({ kind: 'observed', publication: { pullRequestNumber: 7, integration: { kind: 'ancestor' } },
            worktree: { kind: 'skipped', blockers: ['process_visibility_unknown'] },
            localBranch: { kind: 'skipped', blockers: ['worktree_registered', 'branch_protection_unknown'] },
            tempDirectory: { kind: 'skipped', blockers: ['temp_directory_unclaimed'] } });
        f.provider.result = { ...f.summary, headSha: f.baseOid };
        expect(await read()).toMatchObject({ kind: 'observed', worktree: { kind: 'skipped',
            blockers: expect.arrayContaining(['publication_unproven', 'integration_snapshot_unproven']) } });
        f.provider.result = null;
        expect(await read()).toMatchObject({ kind: 'observed', worktree: { kind: 'skipped',
            blockers: expect.arrayContaining(['publication_unproven', 'integration_snapshot_unproven']) } });
    });

    it('reads only a durable bound claim and keeps both resources skipped while process and branch protection remain unknown', async () => {
        const f = await fixture();
        const owner = { homeDir: f.root, activeServerDir: join(f.root, 'servers', 'test'), ring: 'stable' as const,
            accountId: 'owner-account', machineId: 'owner-machine', launchNonce: 'launch-one' };
        await recordHostCreatedWorktree({ ...owner, worktreePath: f.worktree, expectedBranchName: 'feature', branchCreatedHere: true });
        await bindCreatedWorktreeToTrackedSession({ ...owner, sessionId: 'session-one', runnerPid: 12345,
            runnerPath: f.worktree, serverResolution: 'created' });
        const result = await readHostWorktreeCleanupPreflight({
            owner: { machineId: owner.machineId, launchNonce: owner.launchNonce },
            hostScope: { homeDir: owner.homeDir, activeServerDir: owner.activeServerDir, ring: owner.ring },
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
            visibleSessionInventory: { pathInUse: false, complete: true },
            worktree: { kind: 'skipped', blockers: expect.arrayContaining(['process_visibility_unknown', 'publication_unproven', 'integration_snapshot_unproven']) },
            localBranch: { kind: 'skipped', blockers: expect.arrayContaining(['worktree_registered', 'branch_protection_unknown', 'integration_snapshot_unproven']) },
            tempDirectory: { kind: 'skipped', blockers: ['temp_directory_unclaimed'] },
        });
        const conflicting = await readHostWorktreeCleanupPreflight({
            owner: { machineId: owner.machineId, launchNonce: owner.launchNonce },
            hostScope: { homeDir: owner.homeDir, activeServerDir: owner.activeServerDir, ring: owner.ring },
            credentials: { token: 'fixture-token', encryption: null },
            server: {
                accountId: async () => owner.accountId,
                session: async () => ({ id: 'session-one', active: false, archivedAt: 12, machineId: owner.machineId,
                    encryptionMode: 'plain', metadata: JSON.stringify({ path: f.worktree, machineId: owner.machineId,
                        happyHomeDir: owner.homeDir }), dataEncryptionKey: null }),
                page: async ({ archivedOnly }) => archivedOnly
                    ? { sessions: [], hasNext: false, nextCursor: null }
                    : { sessions: [{ id: 'session-two', active: false, archivedAt: null, encryptionMode: 'plain',
                        metadata: JSON.stringify({ path: f.worktree, machineId: owner.machineId }), dataEncryptionKey: null }],
                        hasNext: true, nextCursor: null },
            },
        });
        expect(conflicting).toMatchObject({ kind: 'observed',
            visibleSessionInventory: { pathInUse: true, complete: false },
            worktree: { blockers: expect.arrayContaining(['other_session_uses_worktree', 'session_inventory_unknown']) },
        });
        const wrongAccount = await readHostWorktreeCleanupPreflight({
            owner: { machineId: owner.machineId, launchNonce: owner.launchNonce },
            hostScope: { homeDir: owner.homeDir, activeServerDir: owner.activeServerDir, ring: owner.ring },
            credentials: { token: 'fixture-token', encryption: null },
            server: { accountId: async () => 'other-account', session: async () => null,
                page: async () => ({ sessions: [], hasNext: false, nextCursor: null }) },
        });
        expect(wrongAccount).toMatchObject({ kind: 'unavailable', reason: 'claim_unavailable' });
        const wrongSessionPath = await readHostWorktreeCleanupPreflight({
            owner: { machineId: owner.machineId, launchNonce: owner.launchNonce },
            hostScope: { homeDir: owner.homeDir, activeServerDir: owner.activeServerDir, ring: owner.ring },
            credentials: { token: 'fixture-token', encryption: null },
            server: { accountId: async () => owner.accountId,
                session: async () => ({ id: 'session-one', active: false, archivedAt: 12,
                    encryptionMode: 'plain', metadata: JSON.stringify({ path: f.repo, machineId: owner.machineId,
                        happyHomeDir: owner.homeDir }), dataEncryptionKey: null }),
                page: async () => ({ sessions: [], hasNext: false, nextCursor: null }) },
        });
        expect(wrongSessionPath).toMatchObject({ kind: 'unavailable', reason: 'session_identity_mismatch' });
        const activeSession = await readHostWorktreeCleanupPreflight({
            owner: { machineId: owner.machineId, launchNonce: owner.launchNonce },
            hostScope: { homeDir: owner.homeDir, activeServerDir: owner.activeServerDir, ring: owner.ring },
            credentials: { token: 'fixture-token', encryption: null },
            server: { accountId: async () => owner.accountId,
                session: async () => ({ id: 'session-one', active: true, archivedAt: null,
                    encryptionMode: 'plain', metadata: JSON.stringify({ path: f.worktree, machineId: owner.machineId,
                        happyHomeDir: owner.homeDir }), dataEncryptionKey: null }),
                page: async () => ({ sessions: [], hasNext: false, nextCursor: null }) },
        });
        expect(activeSession).toMatchObject({ kind: 'unavailable', reason: 'session_not_archived' });
        const scopeDrift = await readHostWorktreeCleanupPreflight({
            owner: { machineId: owner.machineId, launchNonce: owner.launchNonce },
            credentials: { token: 'fixture-token', encryption: null },
            server: { accountId: async () => owner.accountId, session: async () => null,
                page: async () => ({ sessions: [], hasNext: false, nextCursor: null }) },
        });
        expect(scopeDrift).toMatchObject({ kind: 'unavailable', reason: 'scope_unavailable' });
    });
});
