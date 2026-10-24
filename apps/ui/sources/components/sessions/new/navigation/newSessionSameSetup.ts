import type { Session } from '@/sync/domains/state/storageTypes';
import { storage } from '@/sync/domains/state/storage';
import { getActiveServerAccountScope } from '@/sync/domains/scope/activeServerAccountScope';
import { areServerAccountScopesEqual } from '@/sync/domains/scope/serverAccountScope';
import type { ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import { areServerProfileIdentifiersEquivalent } from '@/sync/domains/server/serverProfiles';
import { resolveServerScopedSessionContext } from '@/sync/runtime/orchestration/serverScopedRpc/resolveServerScopedSessionContext';
import { sync } from '@/sync/sync';
import { hasAuthoritativeHydratedSessionForRoute } from '@/hooks/session/useHydrateSessionForRoute';
import {
    readSessionMachineTargetState,
    resolveDisplayMachineTargetForSessionFromState,
    resolveMachineTargetForSessionFromState,
    type SessionMachineTarget,
} from '@/sync/ops/sessionMachineTarget';
import { buildNewSessionTempDataFromSessionConfiguration } from '@/components/sessions/authoring/draft/sessionConfigurationSeed';
import { storeTempData } from '@/utils/sessions/tempDataStore';
import { resolveNewSessionDraftRouteIdentity } from './newSessionDraftRouteIdentity';
import { buildNewSessionLaunchRouteParams } from './newSessionRouteParams';

export const SESSION_NEW_SAME_SETUP_ACTION_ID = 'session.sameSetup';

type SameSetupTarget = Readonly<{ machineId: string | null; directory: string | null }>;
type SameSetupRoute = Readonly<{
    pathname: '/new';
    params: ReturnType<typeof buildNewSessionLaunchRouteParams> & { dataId: string };
}>;

function nonBlank(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** The Info action and sidebar action choose the same machine/path when a machine was replaced. */
export function resolveNewSessionSameSetupTarget(params: Readonly<{
    session: Pick<Session, 'metadata'>;
    reachableTarget: SessionMachineTarget | null;
    displayTarget: Readonly<{ machineId: string; basePath: string }> | null;
}>): SameSetupTarget {
    const target = params.reachableTarget
        && (!params.displayTarget || params.reachableTarget.machineId === params.displayTarget.machineId)
        ? params.reachableTarget
        : params.displayTarget;
    return {
        machineId: nonBlank(target?.machineId) ?? nonBlank(params.session.metadata?.machineId),
        directory: nonBlank(target?.basePath) ?? nonBlank(params.session.metadata?.path),
    };
}

/** Start a blank authoring draft; the New Session screen remains the only place that creates it. */
export function buildNewSessionSameSetupRoute(params: Readonly<{
    session: Session;
    machineId: string | null;
    directory: string | null;
    targetServerId: string | null;
}>): SameSetupRoute {
    const draftId = resolveNewSessionDraftRouteIdentity({ routeDraftId: undefined }).draftId;
    const dataId = storeTempData(buildNewSessionTempDataFromSessionConfiguration({
        session: params.session,
        machineId: params.machineId,
        directoryOverride: params.directory,
    }));
    return {
        pathname: '/new',
        params: {
            ...buildNewSessionLaunchRouteParams({
                draftId,
                machineId: params.machineId,
                directory: params.directory,
                targetServerId: params.targetServerId,
            }),
            dataId,
        },
    };
}

type SameSetupPreparationResult =
    | Readonly<{ kind: 'ready'; route: SameSetupRoute }>
    | Readonly<{ kind: 'missing' | 'unavailable' | 'machine_unavailable' | 'directory_unavailable' }>;

/** Thin list rows acquire the full source only after the user asks to copy its setup. */
export async function prepareNewSessionSameSetupFromRow(params: Readonly<{
    sessionId: string;
    serverId?: string | null;
}>): Promise<SameSetupPreparationResult> {
    const accountScope = getActiveServerAccountScope();
    const sessionId = nonBlank(params.sessionId);
    const targetServerId = nonBlank(params.serverId) ?? accountScope?.serverId ?? null;
    if (!accountScope || !sessionId || !targetServerId) return { kind: 'unavailable' };

    const sourceIsActive = areServerProfileIdentifiersEquivalent(targetServerId, accountScope.serverId);
    let sourceScope: ServerAccountScope = accountScope;
    if (!sourceIsActive) {
        try {
            const context = await resolveServerScopedSessionContext({ serverId: targetServerId });
            if (context.scope !== 'scoped'
                || !areServerProfileIdentifiersEquivalent(context.targetServerId, targetServerId)) {
                return { kind: 'unavailable' };
            }
            sourceScope = { serverId: context.targetServerId, accountId: context.targetAccountId };
        } catch {
            return { kind: 'unavailable' };
        }
    }
    if (!areServerAccountScopesEqual(accountScope, getActiveServerAccountScope())) {
        return { kind: 'unavailable' };
    }

    // Foreign cached records have a server id but no account stamp. Refresh on click so a
    // previous login to the same Home cannot supply another account's authoring settings.
    if (!sourceIsActive || !hasAuthoritativeHydratedSessionForRoute(sessionId, sourceScope.serverId)) {
        const result = await sync.ensureSessionVisibleForMessageRoute(sessionId, {
            serverId: sourceScope.serverId,
            forceRefresh: true,
        });
        if (!areServerAccountScopesEqual(accountScope, getActiveServerAccountScope())) {
            return { kind: 'unavailable' };
        }
        if (result.kind === 'missing') return { kind: 'missing' };
        if (result.kind !== 'available') return { kind: 'unavailable' };
        if (!result.serverId || !areServerProfileIdentifiersEquivalent(result.serverId, sourceScope.serverId)) {
            return { kind: 'unavailable' };
        }
    }

    if (!sourceIsActive) {
        try {
            const context = await resolveServerScopedSessionContext({ serverId: sourceScope.serverId });
            if (context.scope !== 'scoped'
                || !areServerAccountScopesEqual(sourceScope, {
                    serverId: context.targetServerId,
                    accountId: context.targetAccountId,
                })) {
                return { kind: 'unavailable' };
            }
        } catch {
            return { kind: 'unavailable' };
        }
    }

    if (!areServerAccountScopesEqual(accountScope, getActiveServerAccountScope())) {
        return { kind: 'unavailable' };
    }
    if (!hasAuthoritativeHydratedSessionForRoute(sessionId, sourceScope.serverId)) {
        return { kind: 'unavailable' };
    }
    const session = storage.getState().sessions[sessionId];
    if (!session || !areServerProfileIdentifiersEquivalent(session.serverId ?? '', sourceScope.serverId)) {
        return { kind: 'unavailable' };
    }

    const targetState = readSessionMachineTargetState(sourceScope);
    const target = resolveNewSessionSameSetupTarget({
        session,
        reachableTarget: resolveMachineTargetForSessionFromState(targetState, sessionId),
        displayTarget: resolveDisplayMachineTargetForSessionFromState({
            state: targetState,
            sessionId,
            metadata: session.metadata,
        }),
    });
    if (!target.machineId) return { kind: 'machine_unavailable' };
    if (!target.directory) return { kind: 'directory_unavailable' };
    return {
        kind: 'ready',
        route: buildNewSessionSameSetupRoute({
            session,
            machineId: target.machineId,
            directory: target.directory,
            targetServerId: sourceScope.serverId,
        }),
    };
}
