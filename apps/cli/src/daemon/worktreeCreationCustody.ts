import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { z } from 'zod';
import type { PublicReleaseRingId } from '@happier-dev/release-runtime/releaseRings';

import { resolveReleaseRingScopedBasename } from '@/cli/runtime/publicReleaseChannel';
import { inspectGitCheckoutIdentity, isGitLinkedWorktreeIdentity } from '@/scm/backends/git/checkoutIdentity';
import { withJsonOwnerFileLock } from '@/utils/fs/jsonOwnerFileLock';
import { writeJsonAtomic } from '@/utils/fs/writeJsonAtomic';

const ClaimSchema = z.object({
  version: z.literal(1),
  accountId: z.string().min(1),
  machineId: z.string().min(1),
  launchNonce: z.string().min(1),
  activeServerDir: z.string().min(1),
  ring: z.enum(['stable', 'preview', 'publicdev']),
  worktreeRealPath: z.string().min(1),
  registeredWorktreeRealPath: z.string().min(1),
  gitCommonDirRealPath: z.string().min(1),
  branchName: z.string().min(1),
  branchCreatedHere: z.boolean(),
  sessionId: z.string().min(1).optional(),
  runnerPid: z.number().int().positive().optional(),
}).strict();

export type WorktreeCreationClaim = z.infer<typeof ClaimSchema>;
type ClaimOwner = Readonly<{
  homeDir: string;
  activeServerDir: string;
  ring?: PublicReleaseRingId | null;
  accountId: string;
  machineId: string;
  launchNonce: string;
}>;

function claimPath(owner: ClaimOwner): string {
  const name = createHash('sha256').update(JSON.stringify([
    owner.accountId, owner.machineId, owner.launchNonce,
  ])).digest('hex');
  return join(owner.activeServerDir, resolveReleaseRingScopedBasename('worktree-creation-custody', owner.ring), `${name}.json`);
}

async function readClaim(path: string): Promise<{ exists: boolean; claim: WorktreeCreationClaim | null }> {
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = ClaimSchema.safeParse(JSON.parse(raw));
    return { exists: true, claim: parsed.success ? parsed.data : null };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { exists: false, claim: null };
    return { exists: true, claim: null };
  }
}

async function withClaimLock<T>(owner: ClaimOwner, task: (path: string) => Promise<T>): Promise<T> {
  const path = claimPath(owner);
  await mkdir(dirname(path), { recursive: true });
  return await withJsonOwnerFileLock({
    lockPath: `${path}.lock`, timeoutMs: 10_000, staleAfterMs: 30_000,
    errorCode: 'WORKTREE_CREATION_CLAIM_LOCK_TIMEOUT',
  }, () => task(path));
}

function validOwner(owner: ClaimOwner): boolean {
  return Boolean(owner.homeDir && owner.activeServerDir.trim() && owner.accountId.trim() && owner.machineId.trim() && owner.launchNonce.trim());
}

function belongsToOwner(claim: WorktreeCreationClaim, owner: ClaimOwner): boolean {
  return claim.accountId === owner.accountId && claim.machineId === owner.machineId
    && claim.launchNonce === owner.launchNonce && claim.activeServerDir === owner.activeServerDir
    && claim.ring === (owner.ring ?? 'stable');
}

export async function readWorktreeCreationClaim(owner: ClaimOwner): Promise<WorktreeCreationClaim | null> {
  if (!validOwner(owner)) return null;
  const claim = (await readClaim(claimPath(owner))).claim;
  return claim && belongsToOwner(claim, owner) ? claim : null;
}

/** Persist only after Git has actually created a linked worktree. This never adopts a path. */
export async function recordHostCreatedWorktree(input: ClaimOwner & Readonly<{
  worktreePath: string;
  expectedBranchName: string;
  branchCreatedHere: boolean;
}>): Promise<WorktreeCreationClaim | null> {
  if (!validOwner(input)) return null;
  const identity = await inspectGitCheckoutIdentity({ cwd: input.worktreePath });
  if (!identity || !isGitLinkedWorktreeIdentity(identity) || !identity.branchName
    || identity.branchName !== input.expectedBranchName) return null;
  const [worktreeRealPath, registeredWorktreeRealPath, gitCommonDirRealPath] = await Promise.all([
    realpath(identity.worktreePath), realpath(identity.registeredWorktreePath), realpath(identity.commonDirPath),
  ]).catch(() => [null, null, null]);
  if (!worktreeRealPath || !registeredWorktreeRealPath || !gitCommonDirRealPath
    || worktreeRealPath !== registeredWorktreeRealPath
    || worktreeRealPath !== await realpath(input.worktreePath).catch(() => null)) return null;
  const claim: WorktreeCreationClaim = {
    version: 1,
    accountId: input.accountId,
    machineId: input.machineId,
    launchNonce: input.launchNonce,
    activeServerDir: input.activeServerDir,
    ring: input.ring ?? 'stable',
    worktreeRealPath,
    registeredWorktreeRealPath,
    gitCommonDirRealPath,
    branchName: identity.branchName,
    branchCreatedHere: input.branchCreatedHere,
  };
  return await withClaimLock(input, async (path) => {
    const prior = await readClaim(path);
    if (prior.exists) {
      if (!prior.claim) return null;
      return belongsToOwner(prior.claim, input)
        && prior.claim.worktreeRealPath === claim.worktreeRealPath
        && prior.claim.registeredWorktreeRealPath === claim.registeredWorktreeRealPath
        && prior.claim.gitCommonDirRealPath === claim.gitCommonDirRealPath
        && prior.claim.branchName === claim.branchName
        && prior.claim.branchCreatedHere === claim.branchCreatedHere ? prior.claim : null;
    }
    await writeJsonAtomic(path, claim);
    return claim;
  });
}

/** Called only after daemon correlation to a tracked child and its authenticated server result. */
export async function bindCreatedWorktreeToTrackedSession(input: ClaimOwner & Readonly<{
  sessionId: string;
  runnerPid: number;
  runnerPath: string;
  serverResolution?: 'created' | 'existing';
}>): Promise<WorktreeCreationClaim | null> {
  if (!validOwner(input) || !input.sessionId.trim() || !Number.isSafeInteger(input.runnerPid) || input.runnerPid <= 0) return null;
  // Normal sessions have no host-created worktree. Avoid creating claim storage for them.
  if (!await readWorktreeCreationClaim(input)) return null;
  return await withClaimLock(input, async (path) => {
    const claim = (await readClaim(path)).claim;
    if (!claim || !belongsToOwner(claim, input)) return null;
    if (!claim.sessionId && input.serverResolution !== 'created') return null;
    if (claim.sessionId && claim.sessionId !== input.sessionId) return null;
    const runnerRealPath = await realpath(input.runnerPath).catch(() => null);
    if (!runnerRealPath) return null;
    const rel = relative(claim.worktreeRealPath, runnerRealPath);
    if (rel === '..' || rel.startsWith(`..${sep}`) || rel.startsWith(sep)) return null;
    const identity = await inspectGitCheckoutIdentity({ cwd: runnerRealPath });
    if (!identity) return null;
    const [actualRoot, actualCommon, actualRegistered] = await Promise.all([
      realpath(identity.worktreePath), realpath(identity.commonDirPath), realpath(identity.registeredWorktreePath),
    ]).catch(() => [null, null, null]);
    if (actualRoot !== claim.worktreeRealPath || actualCommon !== claim.gitCommonDirRealPath
      || actualRegistered !== claim.registeredWorktreeRealPath || identity.branchName !== claim.branchName) return null;
    if (claim.sessionId) return claim;
    const bound: WorktreeCreationClaim = { ...claim, sessionId: input.sessionId, runnerPid: input.runnerPid };
    await writeJsonAtomic(path, bound);
    return bound;
  });
}
