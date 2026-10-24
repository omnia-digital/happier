import {
  buildSystemSessionMetadataV1,
} from '@happier-dev/protocol';
import { DEFAULT_AGENT_ID, type AgentId } from '@happier-dev/agents';

import { isAgentId } from '@/agents/registry/registryCore';
import { listPreferredMachineIds } from '@/components/settings/pickers/resolvePreferredMachineId';
import { getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';
import { getActiveServerAccountScope } from '@/sync/domains/scope/activeServerAccountScope';
import { recentMachinePathsForScope } from '@/sync/domains/settings/machinePathPreferences';
import { storage } from '@/sync/domains/state/storage';
import { resolveMachineForActiveServerFromState, resolveVisibleMachinesForActiveServerFromState } from '@/sync/store/domains/machines/resolveMachinesForActiveServerFromState';
import { readDirectSessionLink } from '@/sync/domains/session/directSessions/readDirectSessionLink';
import { machineSpawnNewSessionUntilResolved } from '@/sync/ops/machines';
import { readReplacementAwareMachineRpcTarget } from '@/sync/ops/machineRpcTarget';
import { readMachineTargetForSession } from '@/sync/ops/sessionMachineTarget';
import { sync } from '@/sync/sync';
import { isMachineOnline } from '@/utils/sessions/machineUtils';
import { useVoiceTargetStore } from '@/voice/runtime/voiceTargetStore';
import { normalizeNonEmptyString } from '@/voice/shared/normalizeNonEmptyString';
import {
  completeVoiceSpawnAttemptCustody,
  createVoiceSpawnAttempt,
  readVoiceSpawnedSessionIdForAttempt,
} from '@/voice/shared/voiceSpawnAttempt';

import {
  matchesVoiceConversationScope,
  writeVoiceConversationScopeMetadata,
  type VoiceConversationScopeMetadata,
} from './voiceConversationScopeMetadata';
import {
  findReusableVoiceConversationRuntimeSessionId,
  findVoiceConversationSessionId,
  isVoiceConversationSystemSessionMetadata,
  VOICE_CONVERSATION_RETIRED_SYSTEM_SESSION_KEY,
  VOICE_CONVERSATION_SYSTEM_SESSION_KEY,
} from './voiceConversationSystemSessionLookup';
import { persistVoiceAutoTargetMachineId, readVoiceAutoTargetMachineId } from './voiceAutoTargetMachineSettings';

export {
  findReusableVoiceConversationRuntimeSessionId,
  findVoiceConversationSessionId,
  isVoiceConversationSystemSessionMetadata,
  VOICE_CONVERSATION_SYSTEM_SESSION_KEY,
} from './voiceConversationSystemSessionLookup';

const VOICE_HOME_SPAWN_TARGET_WAIT_TIMEOUT_MS = 5_000;
const VOICE_HOME_SPAWN_TARGET_WAIT_INTERVAL_MS = 100;

function buildVoiceConversationSystemSessionMetadata() {
  return buildSystemSessionMetadataV1({ key: VOICE_CONVERSATION_SYSTEM_SESSION_KEY, hidden: true });
}

function shouldRetireLegacyVoiceConversationSession(session: any): boolean {
  if (!session || typeof session !== 'object') return false;
  return readDirectSessionLink(session.metadata ?? null) !== null;
}

function isReusableVoiceConversationRuntimeSession(session: any): boolean {
  if (!session || typeof session !== 'object') return false;
  return session.active === true;
}

function joinFsPath(base: string, child: string): string {
  const trimmedBase = String(base ?? '').trim().replace(/\/+$/g, '');
  const trimmedChild = String(child ?? '').trim().replace(/^\/+/g, '');
  if (!trimmedBase) return trimmedChild;
  if (!trimmedChild) return trimmedBase;
  return `${trimmedBase}/${trimmedChild}`;
}

function scopedRecentMachinePaths(state: any) {
  return recentMachinePathsForScope(
    state?.settings?.machinePathPreferencesByTargetV1 ?? {},
    getActiveServerAccountScope(),
  );
}

function resolveVoiceHomeDirectory(state: any, machineId: string): string | null {
  const agentCfg: any = state?.settings?.voice?.adapters?.local_conversation?.agent ?? {};
  const subdir = normalizeNonEmptyString(agentCfg?.voiceHomeSubdirName) ?? 'voice-agent';
  const machine = resolveMachineForActiveServerFromState(state, machineId);
  if (machine && machine.active === false) return null;
  const happyHomeDir = normalizeNonEmptyString(machine?.metadata?.happyHomeDir);
  if (happyHomeDir) return joinFsPath(happyHomeDir, subdir);

  for (const recent of scopedRecentMachinePaths(state)) {
    if (normalizeNonEmptyString(recent?.machineId) !== machineId) continue;
    const recentDirectory = normalizeNonEmptyString(recent?.path);
    if (recentDirectory) return recentDirectory;
  }

  for (const session of Object.values(state?.sessions ?? {}) as any[]) {
    const resolvedTarget = typeof session?.id === 'string' ? readMachineTargetForSession(session.id) : null;
    if (normalizeNonEmptyString(resolvedTarget?.machineId) !== machineId) continue;
    const sessionDirectory = normalizeNonEmptyString(resolvedTarget?.basePath);
    if (sessionDirectory) return sessionDirectory;
  }

  return null;
}

function resolveReplacementAwareVoiceMachineId(machineId: string | null | undefined): string | null {
  return readReplacementAwareMachineRpcTarget(machineId)?.machineId ?? null;
}

function resolveRecentVoiceDirectoryForMachine(state: any, machineId: string | null | undefined): string | null {
  const normalizedMachineId = normalizeNonEmptyString(machineId);
  if (!normalizedMachineId) return null;
  for (const recent of scopedRecentMachinePaths(state)) {
    if (normalizeNonEmptyString(recent?.machineId) !== normalizedMachineId) continue;
    const recentDirectory = normalizeNonEmptyString(recent?.path);
    if (recentDirectory) return recentDirectory;
  }
  return null;
}

function resolveRecentVoiceDirectoryForRouteMachine(state: any, routeMachineId: string | null | undefined): string | null {
  const normalizedRouteMachineId = normalizeNonEmptyString(routeMachineId);
  if (!normalizedRouteMachineId) return null;
  for (const recent of scopedRecentMachinePaths(state)) {
    const recentMachineId = normalizeNonEmptyString(recent?.machineId);
    if (resolveReplacementAwareVoiceMachineId(recentMachineId) !== normalizedRouteMachineId) continue;
    const recentDirectory = normalizeNonEmptyString(recent?.path);
    if (recentDirectory) return recentDirectory;
  }
  return null;
}

function resolveSpawnTarget(state: any): { machineId: string; directory: string } | null {
  const sessionsObj = state?.sessions ?? {};
  const voiceTarget = useVoiceTargetStore.getState();
  const candidates = [voiceTarget.primaryActionSessionId, voiceTarget.lastFocusedSessionId]
    .map((value) => normalizeNonEmptyString(value))
    .filter(Boolean) as string[];

  for (const sessionId of candidates) {
    const resolvedTarget = readMachineTargetForSession(sessionId);
    const machineId = normalizeNonEmptyString(resolvedTarget?.machineId);
    const directory = normalizeNonEmptyString(resolvedTarget?.basePath);
    if (machineId && directory) return { machineId, directory };
  }

  const recent = scopedRecentMachinePaths(state)[0] ?? null;
  const recentMachineId = normalizeNonEmptyString(recent?.machineId);
  const recentDirectory = normalizeNonEmptyString(recent?.path);
  const recentRouteMachineId = resolveReplacementAwareVoiceMachineId(recentMachineId);
  if (recentRouteMachineId && recentDirectory) return { machineId: recentRouteMachineId, directory: recentDirectory };

  for (const session of Object.values(sessionsObj) as any[]) {
    const resolvedTarget = typeof session?.id === 'string' ? readMachineTargetForSession(session.id) : null;
    const machineId = normalizeNonEmptyString(resolvedTarget?.machineId);
    const directory = normalizeNonEmptyString(resolvedTarget?.basePath);
    if (machineId && directory) return { machineId, directory };
  }

  return null;
}

function resolveVoiceHomeSpawnTarget(state: any): { machineId: string; directory: string } | null {
  const agentCfg: any = state?.settings?.voice?.adapters?.local_conversation?.agent ?? {};
  const fixedMachineId = agentCfg?.machineTargetMode === 'fixed' ? normalizeNonEmptyString(agentCfg?.machineTargetId) : null;
  if (fixedMachineId) {
    const fixedRouteMachineId = resolveReplacementAwareVoiceMachineId(fixedMachineId);
    const fixedDirectory = fixedRouteMachineId
      ? resolveVoiceHomeDirectory(state, fixedRouteMachineId) ?? resolveRecentVoiceDirectoryForMachine(state, fixedMachineId)
      : null;
    if (fixedRouteMachineId && fixedDirectory) return { machineId: fixedRouteMachineId, directory: fixedDirectory };
  }

  const isKnownInactiveMachine = (machineId: string): boolean => {
    const machine =
      resolveMachineForActiveServerFromState(state, machineId)
      ?? state?.machines?.[machineId]
      ?? null;
    return machine?.active === false;
  };

  const stickyAutoMachineId = readVoiceAutoTargetMachineId(state);
  if (stickyAutoMachineId) {
    const stickyMachine =
      resolveMachineForActiveServerFromState(state, stickyAutoMachineId)
      ?? state?.machines?.[stickyAutoMachineId]
      ?? null;
    const stickyDirectory = resolveVoiceHomeDirectory(state, stickyAutoMachineId);
    if (stickyDirectory && stickyMachine?.active !== false) {
      return { machineId: stickyAutoMachineId, directory: stickyDirectory };
    }
  }

  const candidateMachineIds: Array<string | null | undefined> = [
    resolveSpawnTarget(state)?.machineId,
    ...(
      scopedRecentMachinePaths(state).map((entry) => normalizeNonEmptyString(entry.machineId))
    ),
    ...resolveVisibleMachinesForActiveServerFromState(state)
      .filter((machine) => machine.active === true)
      .map((machine) => normalizeNonEmptyString(machine.id)),
    ...listPreferredMachineIds({
      machines: resolveVisibleMachinesForActiveServerFromState(state),
      recentMachinePaths: scopedRecentMachinePaths(state),
    }),
    ...resolveVisibleMachinesForActiveServerFromState(state).map((machine) => normalizeNonEmptyString(machine.id)),
  ];
  const seenMachineIds = new Set<string>();

  for (const candidateMachineId of candidateMachineIds) {
    const originMachineId = normalizeNonEmptyString(candidateMachineId);
    const machineId = resolveReplacementAwareVoiceMachineId(originMachineId);
    if (!machineId) continue;
    if (seenMachineIds.has(machineId)) continue;
    seenMachineIds.add(machineId);
    if (isKnownInactiveMachine(machineId)) continue;
    const directory =
      resolveVoiceHomeDirectory(state, machineId)
      ?? resolveRecentVoiceDirectoryForMachine(state, originMachineId)
      ?? resolveRecentVoiceDirectoryForRouteMachine(state, machineId);
    if (directory) {
      return { machineId, directory };
    }
  }

  return null;
}

function resolveVoiceConversationAgentId(state: any): AgentId {
  const agentCfg = state?.settings?.voice?.adapters?.local_conversation?.agent ?? {};
  const agentSource = String(agentCfg?.agentSource ?? 'session');
  const requestedAgentId = normalizeNonEmptyString(agentCfg?.agentId);
  const lastUsedAgent = normalizeNonEmptyString(state?.settings?.lastUsedAgent);
  const fallback = isAgentId(lastUsedAgent) ? lastUsedAgent : DEFAULT_AGENT_ID;

  if (agentSource === 'agent' && isAgentId(requestedAgentId)) {
    return requestedAgentId;
  }

  return fallback;
}

async function waitForVoiceHomeSpawnTarget(timeoutMs: number): Promise<{ machineId: string; directory: string } | null> {
  const startedAt = Date.now();
  let target = resolveVoiceHomeSpawnTarget(storage.getState());
  while (!target && (Date.now() - startedAt) < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, VOICE_HOME_SPAWN_TARGET_WAIT_INTERVAL_MS));
    target = resolveVoiceHomeSpawnTarget(storage.getState());
  }
  return target;
}

function toVoiceConversationSpawnError(spawned: unknown): Error {
  const errorCode = normalizeNonEmptyString((spawned as any)?.errorCode);
  const errorMessage = normalizeNonEmptyString((spawned as any)?.errorMessage);
  return Object.assign(
    new Error(errorMessage ?? 'voice_conversation_spawn_failed'),
    {
      code: errorCode ?? 'VOICE_CONVERSATION_SPAWN_FAILED',
      ...((spawned as any)?.spawnAttemptCustody
        ? { spawnAttemptCustody: (spawned as any).spawnAttemptCustody }
        : {}),
    },
  );
}

function assertTargetMachineOnline(machineId: string): void {
  const machine: any = storage.getState().machines?.[machineId] ?? null;
  if (!machine) return;
  if (isMachineOnline(machine) === true) return;
  throw Object.assign(
    new Error('Target machine daemon is offline. Start or reconnect the daemon before starting local voice.'),
    { code: 'VOICE_AGENT_TARGET_MACHINE_OFFLINE' },
  );
}

async function waitForSessionMetadata(sessionId: string, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const session = storage.getState().sessions?.[sessionId] ?? null;
    if (session?.metadata) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('voice_conversation_session_not_ready');
}

async function resolveSessionRootTarget(sessionId: string): Promise<Readonly<{ machineId: string; directory: string }> | null> {
  const readTarget = () => {
    const resolvedTarget = readMachineTargetForSession(sessionId);
    const machineId = normalizeNonEmptyString(resolvedTarget?.machineId);
    const directory = normalizeNonEmptyString(resolvedTarget?.basePath);
    return machineId && directory ? { machineId, directory } : null;
  };

  const existingTarget = readTarget();
  if (existingTarget) return existingTarget;

  await Promise.resolve(sync.ensureSessionVisibleForMessageRoute(sessionId)).catch(() => {});
  return readTarget();
}

let ensurePromise: Promise<string> | null = null;

async function touchVoiceConversationSession(sessionId: string): Promise<void> {
  await sync.patchSessionMetadataWithRetry(sessionId, (metadata: any) => {
    const summaryText = typeof metadata?.summary?.text === 'string' ? metadata.summary.text : 'Voice conversation (system)';
    return {
      ...metadata,
      ...buildVoiceConversationSystemSessionMetadata(),
      summary: { text: summaryText, updatedAt: Date.now() },
    };
  });
}

async function touchVoiceConversationSessionWithScope(
  sessionId: string,
  scope: VoiceConversationScopeMetadata,
): Promise<void> {
  await sync.patchSessionMetadataWithRetry(sessionId, (metadata: any) =>
    writeVoiceConversationScopeMetadata(
      {
        ...metadata,
        ...buildVoiceConversationSystemSessionMetadata(),
        summary: {
          text: typeof metadata?.summary?.text === 'string' ? metadata.summary.text : 'Voice conversation (system)',
          updatedAt: Date.now(),
        },
      },
      scope,
    ),
  );
}

function resolveConversationRetentionLimit(state: any): number {
  const agentCfg: any = state?.settings?.voice?.adapters?.local_conversation?.agent ?? {};
  const policy = agentCfg?.rootSessionPolicy === 'keep_warm' ? 'keep_warm' : 'single';
  if (policy === 'single') return 1;
  const raw = Number(agentCfg?.maxWarmRoots ?? 3);
  return Number.isFinite(raw) ? Math.max(1, Math.min(10, Math.floor(raw))) : 3;
}

async function retireVoiceConversationSession(sessionId: string): Promise<void> {
  await sync.patchSessionMetadataWithRetry(sessionId, (metadata: any) => ({
    ...metadata,
    ...buildSystemSessionMetadataV1({ key: VOICE_CONVERSATION_RETIRED_SYSTEM_SESSION_KEY, hidden: true }),
    voiceAgentRunV1: null,
  }));
}

async function applyVoiceConversationRetentionPolicy(params: Readonly<{ keepSessionId: string }>): Promise<void> {
  const keepSessionId = normalizeNonEmptyString(params.keepSessionId);
  if (!keepSessionId) return;

  const state: any = storage.getState();
  const limit = resolveConversationRetentionLimit(state);
  if (!Number.isFinite(limit) || limit <= 0) return;

  const sessions: Array<{ id: string; updatedAt: number }> = [];
  for (const session of Object.values(state?.sessions ?? {}) as any[]) {
    if (!session || typeof session.id !== 'string') continue;
    if (!isVoiceConversationSystemSessionMetadata(session.metadata ?? null)) continue;
    if (session.id === keepSessionId) continue;
    const updatedAt = typeof session.updatedAt === 'number' && Number.isFinite(session.updatedAt) ? session.updatedAt : 0;
    sessions.push({ id: session.id, updatedAt });
  }

  if (limit === 1) {
    await Promise.all(sessions.map((session) => retireVoiceConversationSession(session.id).catch(() => {})));
    return;
  }

  sessions.sort((left, right) => (right.updatedAt - left.updatedAt) || left.id.localeCompare(right.id));
  const keepCount = Math.max(0, limit - 1);
  const toRetire = sessions.slice(keepCount);
  await Promise.all(toRetire.map((session) => retireVoiceConversationSession(session.id).catch(() => {})));
}

async function retireLegacyVoiceConversationSessions(params: Readonly<{
  machineId: string;
  directory: string;
}>): Promise<void> {
  const machineId = normalizeNonEmptyString(params.machineId);
  const directory = normalizeNonEmptyString(params.directory);
  if (!machineId || !directory) return;

  const state: any = storage.getState();
  const toRetire: string[] = [];
  for (const session of Object.values(state.sessions ?? {}) as any[]) {
    if (!session || typeof session.id !== 'string') continue;
    if (!isVoiceConversationSystemSessionMetadata(session.metadata ?? null)) continue;
    if (!shouldRetireLegacyVoiceConversationSession(session)) continue;
    if (normalizeNonEmptyString(session.metadata?.machineId) !== machineId) continue;
    if (normalizeNonEmptyString(session.metadata?.path) !== directory) continue;
    toRetire.push(session.id);
  }

  await Promise.all(toRetire.map((sessionId) => retireVoiceConversationSession(sessionId).catch(() => {})));
}

export async function ensureVoiceConversationSessionForVoiceHome(): Promise<string> {
  const target = await waitForVoiceHomeSpawnTarget(VOICE_HOME_SPAWN_TARGET_WAIT_TIMEOUT_MS);
  if (!target) {
    throw Object.assign(new Error('voice_conversation_spawn_target_missing'), { code: 'VOICE_CONVERSATION_TARGET_MISSING' });
  }

  await retireLegacyVoiceConversationSessions(target).catch(() => {});
  const state: any = storage.getState();

  let bestExisting: { id: string; updatedAt: number } | null = null;
  for (const session of Object.values(state.sessions ?? {}) as any[]) {
    if (!session || typeof session.id !== 'string') continue;
    if (!isVoiceConversationSystemSessionMetadata(session.metadata ?? null)) continue;
    if (normalizeNonEmptyString(session.metadata?.machineId) !== target.machineId) continue;
    if (normalizeNonEmptyString(session.metadata?.path) !== target.directory) continue;
    if (!matchesVoiceConversationScope(session.metadata ?? null, { kind: 'voice_home' })) continue;
    if (!isReusableVoiceConversationRuntimeSession(session)) continue;
    const updatedAt = typeof session.updatedAt === 'number' && Number.isFinite(session.updatedAt) ? session.updatedAt : 0;
    if (!bestExisting || updatedAt > bestExisting.updatedAt || (updatedAt === bestExisting.updatedAt && session.id < bestExisting.id)) {
      bestExisting = { id: session.id, updatedAt };
    }
  }

  if (bestExisting) {
    persistVoiceAutoTargetMachineId(target.machineId);
    await touchVoiceConversationSessionWithScope(bestExisting.id, { kind: 'voice_home' }).catch(() => {});
    await applyVoiceConversationRetentionPolicy({ keepSessionId: bestExisting.id }).catch(() => {});
    return bestExisting.id;
  }

  const agent = resolveVoiceConversationAgentId(state);
  const serverId = getActiveServerSnapshot().serverId;
  const spawnAttempt = createVoiceSpawnAttempt();
  const spawned = await machineSpawnNewSessionUntilResolved({
    machineId: target.machineId,
    directory: target.directory,
    transcriptStorage: 'persisted',
    approvedNewDirectoryCreation: true,
    backendTarget: { kind: 'builtInAgent', agentId: agent },
    serverId,
    userAttemptId: spawnAttempt.userAttemptId,
    firstTurnLocalId: spawnAttempt.firstTurnLocalId,
    attachmentMessageLocalId: spawnAttempt.attachmentMessageLocalId,
  });

  const spawnedSessionId = readVoiceSpawnedSessionIdForAttempt(spawned, spawnAttempt);
  if (!spawnedSessionId) {
    throw toVoiceConversationSpawnError(spawned);
  }

  await sync.refreshSessions();
  await waitForSessionMetadata(spawnedSessionId, 15_000);
  persistVoiceAutoTargetMachineId(target.machineId);
  await touchVoiceConversationSessionWithScope(spawnedSessionId, { kind: 'voice_home' }).catch(() => {});
  await applyVoiceConversationRetentionPolicy({ keepSessionId: spawnedSessionId }).catch(() => {});
  await completeVoiceSpawnAttemptCustody({
    spawned,
    attempt: spawnAttempt,
    machineId: target.machineId,
    serverId,
  });
  return spawnedSessionId;
}

export async function ensureVoiceConversationSessionId(): Promise<string> {
  if (ensurePromise) return await ensurePromise;

  ensurePromise = (async () => {
    try {
      return await ensureVoiceConversationSessionForVoiceHome();
    } finally {
      ensurePromise = null;
    }
  })();

  return await ensurePromise;
}

export async function ensureVoiceConversationSessionForSessionRoot(params: Readonly<{ sessionId: string }>): Promise<string> {
  const sessionId = normalizeNonEmptyString(params.sessionId);
  if (!sessionId) throw new Error('voice_conversation_session_target_missing');

  const target = await resolveSessionRootTarget(sessionId);
  const machineId = target?.machineId ?? null;
  const directory = target?.directory ?? null;
  if (!machineId || !directory) throw new Error('voice_conversation_session_target_missing');
  assertTargetMachineOnline(machineId);

  await retireLegacyVoiceConversationSessions({ machineId, directory }).catch(() => {});
  const state: any = storage.getState();

  let bestExisting: { id: string; updatedAt: number } | null = null;
  for (const existingSession of Object.values(state.sessions ?? {}) as any[]) {
    if (!existingSession || typeof existingSession.id !== 'string') continue;
    if (!isVoiceConversationSystemSessionMetadata(existingSession.metadata ?? null)) continue;
    if (normalizeNonEmptyString(existingSession.metadata?.machineId) !== machineId) continue;
    if (normalizeNonEmptyString(existingSession.metadata?.path) !== directory) continue;
    if (!matchesVoiceConversationScope(existingSession.metadata ?? null, { kind: 'session_root', sessionRootId: sessionId })) continue;
    if (!isReusableVoiceConversationRuntimeSession(existingSession)) continue;
    const updatedAt = typeof existingSession.updatedAt === 'number' && Number.isFinite(existingSession.updatedAt) ? existingSession.updatedAt : 0;
    if (!bestExisting || updatedAt > bestExisting.updatedAt || (updatedAt === bestExisting.updatedAt && existingSession.id < bestExisting.id)) {
      bestExisting = { id: existingSession.id, updatedAt };
    }
  }

  if (bestExisting) {
    await touchVoiceConversationSessionWithScope(bestExisting.id, { kind: 'session_root', sessionRootId: sessionId }).catch(() => {});
    await applyVoiceConversationRetentionPolicy({ keepSessionId: bestExisting.id }).catch(() => {});
    return bestExisting.id;
  }

  const agent = resolveVoiceConversationAgentId(state);
  const serverId = getActiveServerSnapshot().serverId;
  const spawnAttempt = createVoiceSpawnAttempt();
  const spawned = await machineSpawnNewSessionUntilResolved({
    machineId,
    directory,
    transcriptStorage: 'persisted',
    backendTarget: { kind: 'builtInAgent', agentId: agent },
    serverId,
    userAttemptId: spawnAttempt.userAttemptId,
    firstTurnLocalId: spawnAttempt.firstTurnLocalId,
    attachmentMessageLocalId: spawnAttempt.attachmentMessageLocalId,
  });

  const spawnedSessionId = readVoiceSpawnedSessionIdForAttempt(spawned, spawnAttempt);
  if (!spawnedSessionId) {
    throw toVoiceConversationSpawnError(spawned);
  }

  await sync.refreshSessions();
  await waitForSessionMetadata(spawnedSessionId, 15_000);
  await touchVoiceConversationSessionWithScope(spawnedSessionId, { kind: 'session_root', sessionRootId: sessionId }).catch(() => {});
  await applyVoiceConversationRetentionPolicy({ keepSessionId: spawnedSessionId }).catch(() => {});
  await completeVoiceSpawnAttemptCustody({
    spawned,
    attempt: spawnAttempt,
    machineId,
    serverId,
  });

  return spawnedSessionId;
}
