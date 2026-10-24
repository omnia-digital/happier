import { realpath } from 'node:fs/promises';
import { relative, sep } from 'node:path';
import { readSessionPullRequestLinks } from '@happier-dev/protocol';
import type { PublicReleaseRingId } from '@happier-dev/release-runtime/releaseRings';

import { fetchChangesAccountId } from '@/api/changes';
import { configuration } from '@/configuration';
import type { Credentials } from '@/persistence';
import { readGitWorktreeCleanupEvidence, type GitWorktreeCleanupEvidence } from '@/scm/backends/git/repository';
import { readGitPublishedMergeEvidence, type GitPublishedMergeEvidence } from '@/scm/backends/git/operations/cleanupPreflight';
import { fetchSessionById, fetchSessionsPage } from '@/session/transport/http/sessionsHttp';
import { tryDecryptSessionMetadata } from '@/session/transport/encryption/sessionEncryptionContext';
import { readWorktreeCreationClaim } from './worktreeCreationCustody';

type SessionRecord = Readonly<{
  id: string;
  active: boolean;
  archivedAt?: number | null;
  metadata: string;
  encryptionMode?: 'plain' | 'e2ee';
  dataEncryptionKey?: string | null;
  machineId?: unknown;
}>;

type ServerReaders = Readonly<{
  accountId: (input: { token: string }) => Promise<string>;
  session: (input: { token: string; sessionId: string }) => Promise<SessionRecord | null>;
  page: (input: { token: string; cursor?: string; limit: number; archivedOnly: boolean }) => Promise<{
    sessions: readonly SessionRecord[];
    hasNext?: boolean;
    nextCursor?: string | null;
  }>;
}>;

type HostScope = Readonly<{
  homeDir: string;
  activeServerDir: string;
  ring: PublicReleaseRingId;
}>;

type Owner = Readonly<{
  machineId: string;
  launchNonce: string;
}>;

type Skip = Readonly<{ kind: 'skipped'; blockers: readonly string[] }>;

export type HostWorktreeCleanupPreflight =
  | Readonly<{ kind: 'unavailable'; reason: 'scope_unavailable' | 'claim_unavailable' | 'account_unavailable' | 'session_unavailable' | 'session_not_archived' | 'session_identity_mismatch' | 'git_unavailable'; gitReason?: string }>
  | Readonly<{
    kind: 'observed';
    sessionId: string;
    worktree: Skip;
    localBranch: Skip;
    tempDirectory: Skip;
    git: Extract<GitWorktreeCleanupEvidence, { kind: 'ok' }>;
    publication: GitPublishedMergeEvidence | null;
    visibleSessionInventory: Readonly<{ pathInUse: boolean; complete: boolean }>;
  }>;

function pathInside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !rel.startsWith(sep));
}

/** Read-only evidence. Every observed result still skips removal: process users and branch protection are unproven. */
export async function readHostWorktreeCleanupPreflight(input: Readonly<{
  owner: Owner;
  credentials: Credentials;
  /** Paired fixture boundaries only; production derives both from the active configuration. */
  hostScope?: HostScope;
  server?: ServerReaders;
  /** Genuine provider and remote-transport boundaries for disposable tests. */
  publication?: Pick<Parameters<typeof readGitPublishedMergeEvidence>[0], 'backend' | 'readRemoteRefs'>;
}>): Promise<HostWorktreeCleanupPreflight> {
  if (Boolean(input.hostScope) !== Boolean(input.server)) return { kind: 'unavailable', reason: 'scope_unavailable' };
  const hostScope = input.hostScope ?? {
    homeDir: configuration.happyHomeDir,
    activeServerDir: configuration.activeServerDir,
    ring: configuration.publicReleaseRing,
  };
  const server = input.server ?? {
    accountId: fetchChangesAccountId,
    session: fetchSessionById,
    page: fetchSessionsPage,
  };
  const accountId = await server.accountId({ token: input.credentials.token }).catch(() => null);
  if (!accountId) return { kind: 'unavailable', reason: 'account_unavailable' };
  const claim = await readWorktreeCreationClaim({ ...hostScope, ...input.owner, accountId });
  if (!claim?.sessionId) return { kind: 'unavailable', reason: 'claim_unavailable' };
  const rawSession = await server.session({ token: input.credentials.token, sessionId: claim.sessionId }).catch(() => null);
  if (!rawSession) return { kind: 'unavailable', reason: 'session_unavailable' };
  if (rawSession.id !== claim.sessionId) return { kind: 'unavailable', reason: 'session_identity_mismatch' };
  if (rawSession.active !== false || rawSession.archivedAt == null) return { kind: 'unavailable', reason: 'session_not_archived' };
  const metadata = await Promise.resolve().then(() => tryDecryptSessionMetadata({ credentials: input.credentials, rawSession })).catch(() => null);
  const sessionPath = typeof metadata?.path === 'string' ? await realpath(metadata.path).catch(() => null) : null;
  if (!metadata || metadata.machineId !== claim.machineId || metadata.happyHomeDir !== hostScope.homeDir
    || (typeof rawSession.machineId === 'string' && rawSession.machineId !== claim.machineId)
    || sessionPath !== claim.worktreeRealPath) return { kind: 'unavailable', reason: 'session_identity_mismatch' };

  const git = await readGitWorktreeCleanupEvidence(claim);
  if (git.kind !== 'ok') return { kind: 'unavailable', reason: 'git_unavailable', gitReason: git.reason };

  const visibleSessionInventory = { pathInUse: false, complete: true };
  for (const archivedOnly of [false, true]) {
    let cursor: string | undefined;
    const seen = new Set<string>();
    while (true) {
      const page = await server.page({ token: input.credentials.token, cursor, limit: 200, archivedOnly }).catch(() => null);
      if (!page) { visibleSessionInventory.complete = false; break; }
      for (const row of page.sessions) {
        if (row.id === claim.sessionId) continue;
        const other = await Promise.resolve().then(() => tryDecryptSessionMetadata({ credentials: input.credentials, rawSession: row })).catch(() => null);
        if (!other || typeof other.machineId !== 'string' || typeof other.path !== 'string') {
          visibleSessionInventory.complete = false;
          continue;
        }
        if (other.machineId !== claim.machineId) continue;
        const otherPath = await realpath(other.path).catch(() => null);
        if (!otherPath) { visibleSessionInventory.complete = false; continue; }
        if (pathInside(claim.worktreeRealPath, otherPath)) visibleSessionInventory.pathInUse = true;
      }
      if (page.hasNext === false) break;
      if (page.hasNext !== true || !page.nextCursor || seen.has(page.nextCursor)) {
        visibleSessionInventory.complete = false;
        break;
      }
      seen.add(page.nextCursor);
      cursor = page.nextCursor;
    }
  }

  let publication: GitPublishedMergeEvidence | null = null;
  for (const link of readSessionPullRequestLinks(metadata)) {
    const result = await readGitPublishedMergeEvidence({ gitEvidence: git, link, ...input.publication });
    publication = result;
    if (result.kind === 'current_publication_match') break;
  }
  const worktreeBlockers = ['process_visibility_unknown'];
  if (git.status.staged.length || git.status.modified.length || git.status.untracked.length || git.status.ignored.length) worktreeBlockers.push('worktree_dirty');
  if (git.registration.isLocked) worktreeBlockers.push('worktree_locked');
  if (git.registration.isPrunable || git.registration.isMain || git.registration.otherWorktreeUsesBranch) worktreeBlockers.push('registration_unsafe');
  if (git.operationState !== null) worktreeBlockers.push('git_operation_active');
  if (visibleSessionInventory.pathInUse) worktreeBlockers.push('other_session_uses_worktree');
  if (!visibleSessionInventory.complete) worktreeBlockers.push('session_inventory_unknown');
  if (publication?.kind !== 'current_publication_match') worktreeBlockers.push('publication_unproven');
  worktreeBlockers.push('integration_snapshot_unproven');

  const branchBlockers = ['worktree_registered', 'branch_protection_unknown'];
  if (!claim.branchCreatedHere) branchBlockers.push('branch_not_owned');
  if (publication?.kind !== 'current_publication_match') branchBlockers.push('publication_unproven');
  branchBlockers.push('integration_snapshot_unproven');
  if (git.registration.otherWorktreeUsesBranch) branchBlockers.push('branch_used_by_other_worktree');
  return {
    kind: 'observed', sessionId: claim.sessionId,
    worktree: { kind: 'skipped', blockers: worktreeBlockers },
    localBranch: { kind: 'skipped', blockers: branchBlockers },
    tempDirectory: { kind: 'skipped', blockers: ['temp_directory_unclaimed'] },
    git, publication, visibleSessionInventory,
  };
}
