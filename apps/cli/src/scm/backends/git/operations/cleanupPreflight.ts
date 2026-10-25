import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import {
    SessionPullRequestLinkV1Schema,
    sessionPullRequestLinkFromSummary,
    sessionPullRequestLinkKey,
    sessionPullRequestRepositoriesMatch,
    type SessionPullRequestLinkV1,
} from '@happier-dev/protocol';

import { runScmCommand, type ScmExecResult } from '../../../runtime';
import { defaultScmHostingProviderRegistry } from '../../../hostingProviders/registry';
import type { ScmBackendContext } from '../../../types';
import { gitCleanupReadArgs, hasUnsafeGitCleanupEnvironment, type GitWorktreeCleanupEvidence } from '../repository';
import { inspectGitCheckoutIdentity, isGitLinkedWorktreeIdentity } from '../checkoutIdentity';
import { createGitPullRequestBackend } from './pullRequestOperations';

type GitEvidence = Extract<GitWorktreeCleanupEvidence, { kind: 'ok' }>;
type PullRequestBackend = Pick<ReturnType<typeof createGitPullRequestBackend>, 'get'>;
type PublicationFailure =
    | 'invalid_link' | 'provider_unavailable' | 'pr_identity_mismatch' | 'pr_not_merged'
    | 'pr_draft_or_unknown' | 'pr_head_mismatch' | 'pr_branch_mismatch'
    | 'pr_source_unknown' | 'pr_source_repository_mismatch'
    | 'remote_identity_unavailable' | 'remote_identity_ambiguous' | 'remote_lookup_unavailable'
    | 'remote_branch_absent' | 'remote_head_mismatch' | 'remote_default_unknown' | 'default_branch'
    | 'local_head_changed' | 'unsafe_git_environment' | 'remote_configuration_changed' | 'remote_refs_changed';

export type GitCleanupIntegrationEvidence =
    | Readonly<{ kind: 'unproven'; reason: 'target_unknown' | 'graph_unavailable' | 'not_ancestor' }>
    | Readonly<{
        kind: 'ancestor';
        sourceOid: string;
        targetOid: string;
        targetRef: string;
        providerKind: SessionPullRequestLinkV1['providerKind'];
        providerBaseUrl: string;
        repository: string;
    }>;

export type GitPublishedMergeEvidence =
    | Readonly<{ kind: 'unavailable'; reason: PublicationFailure }>
    | Readonly<{
        kind: 'current_publication_match';
        atMergeSourceHead: 'unproven';
        providerKind: SessionPullRequestLinkV1['providerKind'];
        repository: string;
        pullRequestNumber: number;
        branchName: string;
        headOid: string;
        remoteName: string;
        remoteRef: string;
        remoteOid: string;
        remoteDefaultBranch: string;
        integration: GitCleanupIntegrationEvidence;
    }>;

async function existsOrUnknown(path: string): Promise<boolean> {
    return lstat(path).then(() => true, (error: NodeJS.ErrnoException) => error.code !== 'ENOENT');
}

/** Current publication and independent raw ancestry. Never asserts a provider's immutable merge-time source snapshot. */
export async function readGitPublishedMergeEvidence(input: Readonly<{
    gitEvidence: GitEvidence;
    link: SessionPullRequestLinkV1;
    backend?: PullRequestBackend;
    /** Genuine Git network boundary; tests route it to a disposable bare origin. */
    readRemoteRefs?: (remoteName: string, branchName: string) => Promise<ScmExecResult>;
}>): Promise<GitPublishedMergeEvidence> {
    const unavailable = (reason: PublicationFailure) => ({ kind: 'unavailable', reason } as const);
    if (hasUnsafeGitCleanupEnvironment()) return unavailable('unsafe_git_environment');
    if (!SessionPullRequestLinkV1Schema.safeParse(input.link).success) return unavailable('invalid_link');
    const matchesCurrentCheckout = async () => {
        const current = await inspectGitCheckoutIdentity({ cwd: input.gitEvidence.worktreeRealPath });
        return current && isGitLinkedWorktreeIdentity(current)
            && current.branchName === input.gitEvidence.branchName
            && current.headRevision?.toLowerCase() === input.gitEvidence.headOid
            && current.worktreePath === input.gitEvidence.worktreeRealPath
            && current.commonDirPath === input.gitEvidence.gitCommonDirRealPath;
    };
    if (!await matchesCurrentCheckout()) return unavailable('local_head_changed');
    const context: ScmBackendContext = {
        cwd: input.gitEvidence.worktreeRealPath,
        projectKey: `cleanup-preflight:${input.gitEvidence.worktreeRealPath}`,
        detection: { isRepo: true, rootPath: input.gitEvidence.worktreeRealPath, mode: '.git' },
    };
    const response = await (input.backend ?? createGitPullRequestBackend({ readOnlyGit: true })).get({
        context,
        request: { cwd: context.cwd, prReference: { number: input.link.number }, linkedIdentity: input.link },
    }).catch(() => null);
    if (!response?.success || !response.pullRequest) return unavailable('provider_unavailable');
    const pr = response.pullRequest;
    const freshIdentity = sessionPullRequestLinkFromSummary(pr);
    if (!freshIdentity || sessionPullRequestLinkKey(freshIdentity) !== sessionPullRequestLinkKey(input.link)) {
        return unavailable('pr_identity_mismatch');
    }
    if (pr.state !== 'merged') return unavailable('pr_not_merged');
    if (pr.draft !== false) return unavailable('pr_draft_or_unknown');
    if (!pr.headRepository) return unavailable('pr_source_unknown');
    if (!sessionPullRequestRepositoriesMatch(input.link.providerKind, pr.headRepository, input.link.repository)) {
        return unavailable('pr_source_repository_mismatch');
    }
    if (pr.headBranch !== input.gitEvidence.branchName) return unavailable('pr_branch_mismatch');
    if (pr.headSha?.toLowerCase() !== input.gitEvidence.headOid) return unavailable('pr_head_mismatch');

    const matchingRemotes = input.gitEvidence.remotes.filter((remote) => {
        if (!remote.fetchUrl || !remote.pushUrl) return false;
        const fetchProvider = defaultScmHostingProviderRegistry.detectRemote({ remoteName: remote.name, remoteUrl: remote.fetchUrl });
        const pushProvider = defaultScmHostingProviderRegistry.detectRemote({ remoteName: remote.name, remoteUrl: remote.pushUrl });
        return [fetchProvider, pushProvider].every((provider) => provider?.kind === input.link.providerKind
            && provider.baseUrl === input.link.providerBaseUrl
            && provider.nameWithOwner !== null
            && sessionPullRequestRepositoriesMatch(input.link.providerKind, provider.nameWithOwner, input.link.repository));
    });
    if (matchingRemotes.length === 0) return unavailable('remote_identity_unavailable');
    if (matchingRemotes.length !== 1) return unavailable('remote_identity_ambiguous');
    const remote = matchingRemotes[0]!;
    const gitRead = (args: string[]) => runScmCommand({ bin: 'git', cwd: context.cwd,
        args: [...gitCleanupReadArgs, ...args], env: { GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never' } });
    const readLocalContext = async () => {
        if (hasUnsafeGitCleanupEnvironment()) return null;
        const [fetchUrls, pushUrls, config, shallow, grafts, alternates] = await Promise.all([
            gitRead(['remote', 'get-url', '--all', remote.name]),
            gitRead(['remote', 'get-url', '--push', '--all', remote.name]),
            gitRead(['config', '--null', '--list']),
            gitRead(['rev-parse', '--is-shallow-repository']),
            existsOrUnknown(join(input.gitEvidence.gitCommonDirRealPath, 'info', 'grafts')),
            existsOrUnknown(join(input.gitEvidence.gitCommonDirRealPath, 'objects', 'info', 'alternates')),
        ]);
        if (!fetchUrls.success || !pushUrls.success || !config.success || !shallow.success) return null;
        const urls = [fetchUrls.stdout.trim().split(/\r?\n/), pushUrls.stdout.trim().split(/\r?\n/)];
        if (urls.some((values) => values.length !== 1)) return null;
        if (urls[0]![0] !== remote.fetchUrl || urls[1]![0] !== remote.pushUrl) return null;
        // Include effective URLs and configuration so rewrites and configuration drift cannot reuse old identity.
        return { fetchUrl: fetchUrls.stdout, pushUrl: pushUrls.stdout, config: config.stdout,
            graphUnavailable: shallow.stdout.trim() !== 'false' || grafts || alternates
                || config.stdout.split('\0').some((entry) => /^(extensions\.partialclone|remote\..*\.promisor)\n/i.test(entry)) };
    };
    const localContext = await readLocalContext();
    if (!localContext) return unavailable('remote_identity_unavailable');
    const remoteRef = `refs/heads/${input.gitEvidence.branchName}`;
    const readRemoteRefs = input.readRemoteRefs ?? ((remoteName: string, branchName: string) => runScmCommand({
        bin: 'git', cwd: context.cwd,
        args: [...gitCleanupReadArgs, 'ls-remote', '--symref', '--exit-code', '--', remoteName, 'HEAD', `refs/heads/${branchName}`],
        env: { GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never' },
    }));
    const remoteResult = await readRemoteRefs(remote.name, input.gitEvidence.branchName).catch(() => null);
    if (!remoteResult) return unavailable('remote_lookup_unavailable');
    if (!remoteResult.success) return unavailable(remoteResult.exitCode === 2 ? 'remote_branch_absent' : 'remote_lookup_unavailable');

    const lines = remoteResult.stdout.split(/\r?\n/).filter(Boolean);
    const defaultBranches = lines.map((line) => /^ref: (refs\/heads\/.+)\tHEAD$/.exec(line)?.[1] ?? null).filter((ref): ref is string => ref !== null);
    if (defaultBranches.length !== 1) return unavailable('remote_default_unknown');
    const remoteDefaultBranch = defaultBranches[0]!.slice('refs/heads/'.length);
    if (remoteDefaultBranch === input.gitEvidence.branchName || pr.baseBranch === input.gitEvidence.branchName) return unavailable('default_branch');
    const sourceRefs = lines.map((line) => /^([0-9a-f]{40,64})\t(refs\/heads\/.+)$/.exec(line)).filter((match) => match?.[2] === remoteRef);
    if (sourceRefs.length === 0) return unavailable('remote_branch_absent');
    if (sourceRefs.length !== 1 || sourceRefs[0]![1]!.toLowerCase() !== input.gitEvidence.headOid) return unavailable('remote_head_mismatch');
    // HEAD's symbolic target and OID are from the same live advertisement. Only that default target is permitted.
    const targetOids = lines.map((line) => /^([0-9a-f]{40,64})\tHEAD$/.exec(line)?.[1]).filter((oid): oid is string => Boolean(oid));
    let integration: GitCleanupIntegrationEvidence = { kind: 'unproven', reason: 'target_unknown' };
    if (targetOids.length === 1) {
        integration = { kind: 'unproven', reason: 'graph_unavailable' };
        if (!localContext.graphUnavailable) {
            const sourceOid = input.gitEvidence.headOid;
            const targetOid = targetOids[0]!.toLowerCase();
            // Walk the complete local commit graph first; missing history and command errors never prove absence/presence.
            const graph = await gitRead(['rev-list', '--count', sourceOid, targetOid, '--']);
            if (graph.success) {
                const ancestry = await gitRead(['merge-base', '--is-ancestor', sourceOid, targetOid]);
                if (ancestry.success) integration = { kind: 'ancestor', sourceOid, targetOid,
                    targetRef: `refs/heads/${remoteDefaultBranch}`, providerKind: input.link.providerKind,
                    providerBaseUrl: input.link.providerBaseUrl, repository: input.link.repository };
                else if (ancestry.exitCode === 1) integration = { kind: 'unproven', reason: 'not_ancestor' };
            }
        }
    }
    const repeatedRemote = await readRemoteRefs(remote.name, input.gitEvidence.branchName).catch(() => null);
    if (!repeatedRemote?.success || repeatedRemote.stdout !== remoteResult.stdout) return unavailable('remote_refs_changed');
    const repeatedContext = await readLocalContext();
    if (!repeatedContext || JSON.stringify(repeatedContext) !== JSON.stringify(localContext)) return unavailable('remote_configuration_changed');
    if (!await matchesCurrentCheckout()) return unavailable('local_head_changed');
    return {
        kind: 'current_publication_match',
        atMergeSourceHead: 'unproven',
        providerKind: input.link.providerKind,
        repository: input.link.repository,
        pullRequestNumber: input.link.number,
        branchName: input.gitEvidence.branchName,
        headOid: input.gitEvidence.headOid,
        remoteName: remote.name,
        remoteRef,
        remoteOid: sourceRefs[0]![1]!.toLowerCase(),
        remoteDefaultBranch,
        integration,
    };
}
