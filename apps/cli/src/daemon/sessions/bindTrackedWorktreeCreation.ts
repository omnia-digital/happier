import { realpath } from 'node:fs/promises';
import type { Metadata } from '@/api/types';
import type { TrackedSession } from '@/daemon/types';
import type { PublicReleaseRingId } from '@happier-dev/release-runtime/releaseRings';
import {
  bindCreatedWorktreeToTrackedSession,
  type WorktreeCreationClaim,
} from '@/daemon/worktreeCreationCustody';

type Owner = Readonly<{
  homeDir: string;
  activeServerDir: string;
  ring: PublicReleaseRingId;
  accountId: string;
  machineId: string;
}>;

/** The webhook owner supplies only correlated daemon-child reports to this binder. */
export async function bindTrackedWorktreeCreation(input: Readonly<{
  owner: Owner;
  tracked: TrackedSession;
  metadata: Pick<Metadata, 'path' | 'machineId' | 'happyHomeDir' | 'hostPid' | 'startedBy'>;
  sessionId: string;
  serverResolution?: 'created' | 'existing';
  creationAccountId?: string;
}>): Promise<WorktreeCreationClaim | null> {
  const { owner, tracked, metadata, sessionId } = input;
  const spawn = tracked.spawnOptions;
  const runnerPid = metadata.hostPid;
  if (tracked.startedBy !== 'daemon' || metadata.startedBy !== 'daemon'
    || tracked.happySessionId !== sessionId || !spawn?.spawnNonce?.trim()
    || typeof runnerPid !== 'number' || !Number.isSafeInteger(runnerPid)
    || (runnerPid !== tracked.pid && runnerPid !== tracked.sessionRunnerPid)
    || spawn.machineId !== owner.machineId || metadata.machineId !== owner.machineId
    || metadata.happyHomeDir !== owner.homeDir || input.creationAccountId !== owner.accountId) return null;
  const mayCreateBinding = !spawn.existingSessionId && !spawn.sessionId && !spawn.resume
    && !spawn.handoffStateTransfer && !spawn.existingSessionAttachPayload;
  const [spawnRealPath, reportedRealPath] = await Promise.all([
    realpath(spawn.directory), realpath(metadata.path),
  ]).catch(() => [null, null]);
  if (!spawnRealPath || reportedRealPath !== spawnRealPath) return null;
  return await bindCreatedWorktreeToTrackedSession({
    ...owner,
    launchNonce: spawn.spawnNonce,
    sessionId,
    runnerPid,
    runnerPath: reportedRealPath,
    serverResolution: mayCreateBinding ? input.serverResolution : undefined,
  });
}
