import { getServerProfileById, resolveServerProfileScopeIdForIdentifier } from '../domains/server/serverProfiles';
import { getActiveServerSnapshot } from '../domains/server/serverRuntime';
import { buildSessionListViewData, type SessionListViewItem } from '../domains/session/listing/sessionListViewData';
import type { WorkspacePathDisplayModeV1 } from '../domains/session/listing/sessionWorkspacePresentation';
import { resolveMachineDisplayScope, type MachineDisplayRenderable } from '../domains/machines/machineDisplayRenderable';
import { resolveMachineDisplayPreferenceScope } from '../domains/machines/machineDisplayIconPreference';
import { resolveSessionDisplayTarget } from '../domains/machines/identity/resolveSessionMachineTargets';
import { resolveSessionMachineId } from '../domains/session/directSessions/resolveSessionMachineId';
import type { SessionListRenderableSession } from '../domains/session/listing/sessionListRenderable';
import type { Session } from '../domains/state/storageTypes';

type ProjectLookupResult = {
    key?: {
        machineId?: string | null;
        path?: string | null;
    } | null;
} | null;

type ReachableSessionProjectionParams = Readonly<{
    sessions: Record<string, SessionListRenderableSession>;
    sessionRecords?: Record<string, Session>;
    machines: Record<string, MachineDisplayRenderable>;
    machineRecords?: Record<string, MachineDisplayRenderable>;
    serverId?: string | null;
    getProjectForSession?: (sessionId: string) => ProjectLookupResult;
}>;

function normalizeNonEmptyString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

export function applyReachableTargetsToSessionListRenderables(
    params: ReachableSessionProjectionParams,
): Record<string, SessionListRenderableSession> {
    const sessionRecords = params.sessionRecords;
    const machineRecords = params.machineRecords;
    if (!sessionRecords || !machineRecords) {
        return params.sessions;
    }

    const machines = Object.values(machineRecords);
    if (machines.length === 0) {
        return params.sessions;
    }

    const scope = resolveMachineDisplayPreferenceScope(params.serverId ?? getActiveServerSnapshot().serverId);
    const scopeIds = new Set([scope.serverId, ...scope.legacyServerIds]);
    let nextSessions: Record<string, SessionListRenderableSession> | null = null;
    for (const sessionId in params.sessions) {
        if (!Object.prototype.hasOwnProperty.call(params.sessions, sessionId)) continue;
        const session = params.sessions[sessionId];
        const sessionRecord = sessionRecords[sessionId];
        if (!sessionRecord) continue;
        // The shared full-session map also contains explicitly hydrated foreign routes.
        // Active machines and project history have no authority over those records.
        if (sessionRecord.serverId && !scopeIds.has(sessionRecord.serverId)) continue;

        const metadata = sessionRecord.metadata ?? null;
        const project = params.getProjectForSession?.(sessionId) ?? null;
        const target = resolveSessionDisplayTarget({
            sessionActive: sessionRecord.active === true,
            sessionMachineId: resolveSessionMachineId(metadata),
            sessionPath: normalizeNonEmptyString(metadata?.path),
            projectMachineId: normalizeNonEmptyString(project?.key?.machineId),
            projectPath: normalizeNonEmptyString(project?.key?.path),
            machines,
        });

        if (!target || !session.metadata) continue;

        const targetMachine = machineRecords[target.machineId];
        const nextHomeDir = normalizeNonEmptyString(targetMachine?.metadata?.homeDir) ?? session.metadata.homeDir ?? null;
        const nextHost = normalizeNonEmptyString(targetMachine?.metadata?.host) ?? session.metadata.host ?? null;

        const metadataChanged =
            target.machineId !== session.metadata.machineId
            || target.basePath !== session.metadata.path
            || nextHomeDir !== (session.metadata.homeDir ?? null)
            || nextHost !== (session.metadata.host ?? null);

        if (!metadataChanged) continue;

        nextSessions ??= { ...params.sessions };
        nextSessions[sessionId] = {
            ...session,
            metadata: {
                ...session.metadata,
                machineId: target.machineId,
                path: target.basePath,
                homeDir: nextHomeDir,
                host: nextHost,
            },
        };
    }

    return nextSessions ?? params.sessions;
}

export function buildSessionListViewDataWithServerScope(params: {
    sessions: Record<string, SessionListRenderableSession>;
    sessionRecords?: Record<string, Session>;
    machines: Record<string, MachineDisplayRenderable>;
    machineRecords?: Record<string, MachineDisplayRenderable>;
    machineListByServerId?: Readonly<Record<string, readonly MachineDisplayRenderable[] | null | undefined>>;
    serverId?: string | null;
    groupInactiveSessionsByProject: boolean;
    activeGroupingV1?: 'project' | 'date';
    inactiveGroupingV1?: 'project' | 'date';
    sectionModeV1?: 'activity' | 'single';
    workspacePathDisplayModeV1?: WorkspacePathDisplayModeV1 | null;
    getProjectForSession?: (sessionId: string) => ProjectLookupResult;
}): SessionListViewItem[] {
    const snapshot = getActiveServerSnapshot();
    const serverId = resolveServerProfileScopeIdForIdentifier(normalizeNonEmptyString(params.serverId) ?? snapshot.serverId);
    const partitions = new Map<string, Record<string, SessionListRenderableSession>>();
    const resolvedIds = new Map<string, string>([[serverId, serverId]]);
    for (const session of Object.values(params.sessions)) {
        const rawId = normalizeNonEmptyString(session.serverId ?? params.sessionRecords?.[session.id]?.serverId) ?? serverId;
        let scopeId = resolvedIds.get(rawId);
        if (scopeId === undefined) {
            scopeId = resolveServerProfileScopeIdForIdentifier(rawId);
            resolvedIds.set(rawId, scopeId);
        }
        let partition = partitions.get(scopeId);
        if (!partition) {
            partition = {};
            partitions.set(scopeId, partition);
        }
        partition[session.id] = session;
    }
    return [...partitions].flatMap(([scopeId, partition]) => {
        const scope = resolveMachineDisplayScope({
            serverId: scopeId, activeServerId: serverId,
            resolvedScope: resolveMachineDisplayPreferenceScope(scopeId),
            machines: params.machines, machineListByServerId: params.machineListByServerId,
        });
        const machines = Array.isArray(scope.machines)
            ? Object.fromEntries(scope.machines.map(machine => [machine.id, machine]))
            : scope.machines as Readonly<Record<string, MachineDisplayRenderable>>;
        const reachableSessions = applyReachableTargetsToSessionListRenderables({
            sessions: partitions.size === 1 ? params.sessions : partition,
            sessionRecords: params.sessionRecords,
            machines,
            machineRecords: scope.isActive ? params.machineRecords : machines,
            serverId: scopeId,
            getProjectForSession: scope.isActive ? params.getProjectForSession : undefined,
        });
        return buildSessionListViewData(reachableSessions, machines, {
            groupInactiveSessionsByProject: params.groupInactiveSessionsByProject,
            activeGroupingV1: params.activeGroupingV1,
            inactiveGroupingV1: params.inactiveGroupingV1,
            sectionModeV1: params.sectionModeV1,
            workspacePathDisplayModeV1: params.workspacePathDisplayModeV1,
            serverScope: {
                serverId: scopeId,
                serverName: getServerProfileById(scopeId)?.name,
            },
        });
    });
}
