import * as React from 'react';

import { useActiveServerAccountScope, useSetting } from '@/sync/domains/state/storage';
import { storage } from '@/sync/domains/state/storage';
import { getActiveServerAccountScope } from '@/sync/domains/scope/activeServerAccountScope';
import { areServerAccountScopesEqual, type ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import { areServerProfileIdentifiersEquivalent } from '@/sync/domains/server/serverProfiles';
import { resolveCanonicalMachineId, type MachineReplacementRecord } from '@/sync/domains/machines/identity/resolveCanonicalMachineId';
import {
    isServerScopedSessionContextCurrent,
    resolveServerScopedSessionContext,
} from '@/sync/runtime/orchestration/serverScopedRpc/resolveServerScopedSessionContext';
import { useApplySettings } from '@/sync/store/settingsWriters';

import {
    assignLegacyFavoriteToTarget,
    favoritePathsForTarget,
    machinePathTargetKey,
    recentPathsForTarget,
    replaceFavoritePathsForTarget,
    toggleFavoriteForTarget,
    unassignedLegacyFavoritesForTarget,
    type MachinePathTarget,
} from './machinePathPreferences';

type TargetBinding = Readonly<{
    scope: ServerAccountScope;
    viewerScope: ServerAccountScope;
    context: Extract<Awaited<ReturnType<typeof resolveServerScopedSessionContext>>, { scope: 'scoped' }> | null;
}>;

export function useMachinePathTargetScope(serverIdInput?: string | null): TargetBinding | null {
    const viewerScope = useActiveServerAccountScope();
    const serverId = serverIdInput?.trim() || viewerScope?.serverId || null;
    const [foreignBinding, setForeignBinding] = React.useState<TargetBinding | null>(null);
    const targetsActive = !!serverId && !!viewerScope && areServerProfileIdentifiersEquivalent(serverId, viewerScope.serverId);
    const activeBinding: TargetBinding | null = targetsActive && viewerScope
        ? { scope: viewerScope, viewerScope, context: null }
        : null;

    React.useEffect(() => {
        if (!serverId || !viewerScope || targetsActive) {
            setForeignBinding(null);
            return;
        }
        let cancelled = false;
        setForeignBinding(null);
        void (async () => {
            try {
                const context = await resolveServerScopedSessionContext({ serverId, preferScoped: true });
                if (context.scope !== 'scoped'
                    || !areServerProfileIdentifiersEquivalent(context.targetServerId, serverId)
                    || !await isServerScopedSessionContextCurrent(context)
                    || cancelled
                    || !areServerAccountScopesEqual(viewerScope, getActiveServerAccountScope())) return;
                setForeignBinding({
                    scope: { serverId: context.targetServerId, accountId: context.targetAccountId },
                    viewerScope,
                    context,
                });
            } catch {
                // A signed-out or unavailable target has no identifiable preference owner.
            }
        })();
        return () => { cancelled = true; };
    }, [serverId, targetsActive, viewerScope?.accountId, viewerScope?.serverId]);

    return activeBinding ?? (!targetsActive && foreignBinding?.scope.serverId === serverId
        && areServerAccountScopesEqual(foreignBinding.viewerScope, viewerScope) ? foreignBinding : null);
}

export function useMachinePathPreferences(params: Readonly<{
    serverId?: string | null;
    machineId?: string | null;
    machines: ReadonlyArray<MachineReplacementRecord>;
    machineHomeDir?: string | null;
    binding?: TargetBinding | null;
}>) {
    const preferences = useSetting('machinePathPreferencesByTargetV1');
    const legacyFavorites = useSetting('favoriteDirectories');
    const applySettings = useApplySettings();
    const ownBinding = useMachinePathTargetScope(params.binding === undefined ? params.serverId : null);
    const scopeBinding = params.binding === undefined ? ownBinding : params.binding;
    const canonicalMachineId = React.useMemo(
        () => resolveCanonicalMachineId(params.machineId, params.machines)?.machineId ?? null,
        [params.machineId, params.machines],
    );
    const target = React.useMemo(() => scopeBinding && canonicalMachineId
        ? { ...scopeBinding.scope, machineId: canonicalMachineId }
        : null,
    [canonicalMachineId, scopeBinding?.scope.accountId, scopeBinding?.scope.serverId]);
    const bindingRef = React.useRef<{ binding: TargetBinding; target: MachinePathTarget } | null>(null);
    bindingRef.current = scopeBinding && target ? { binding: scopeBinding, target } : null;
    const targetKey = target ? machinePathTargetKey(target) : null;

    const revalidate = React.useCallback(async (captured: { binding: TargetBinding; target: MachinePathTarget }): Promise<boolean> => {
        const current = bindingRef.current;
        if (!current || machinePathTargetKey(current.target) !== machinePathTargetKey(captured.target)) return false;
        if (!areServerAccountScopesEqual(captured.binding.viewerScope, getActiveServerAccountScope())) return false;
        return captured.binding.context ? isServerScopedSessionContextCurrent(captured.binding.context) : true;
    }, []);
    const getVerifiedTarget = React.useCallback(async (): Promise<MachinePathTarget | null> => {
        const captured = bindingRef.current;
        return captured && await revalidate(captured) ? captured.target : null;
    }, [revalidate]);

    const toggleFavorite = React.useCallback(async (path: string) => {
        const captured = bindingRef.current;
        if (!captured || !await revalidate(captured)) return;
        const current = storage.getState().settings.machinePathPreferencesByTargetV1;
        applySettings({ machinePathPreferencesByTargetV1: toggleFavoriteForTarget(current, captured.target, path, params.machineHomeDir) });
    }, [applySettings, params.machineHomeDir, revalidate]);

    const replaceFavorites = React.useCallback(async (paths: ReadonlyArray<string>) => {
        const captured = bindingRef.current;
        if (!captured || !await revalidate(captured)) return;
        const current = storage.getState().settings.machinePathPreferencesByTargetV1;
        applySettings({ machinePathPreferencesByTargetV1: replaceFavoritePathsForTarget(current, captured.target, paths, params.machineHomeDir) });
    }, [applySettings, params.machineHomeDir, revalidate]);

    const assignLegacyFavorite = React.useCallback(async (path: string) => {
        const captured = bindingRef.current;
        if (!captured || !await revalidate(captured)) return;
        const settings = storage.getState().settings;
        const next = assignLegacyFavoriteToTarget(
            settings.machinePathPreferencesByTargetV1,
            settings.favoriteDirectories,
            captured.target,
            path,
            params.machineHomeDir,
        );
        if (next.preferences === settings.machinePathPreferencesByTargetV1) return;
        applySettings({ machinePathPreferencesByTargetV1: next.preferences });
    }, [applySettings, params.machineHomeDir, revalidate]);

    return {
        target,
        targetKey,
        favorites: favoritePathsForTarget(preferences, target),
        recents: recentPathsForTarget(preferences, target),
        unassignedFavorites: unassignedLegacyFavoritesForTarget(legacyFavorites, preferences, target, params.machineHomeDir),
        toggleFavorite,
        replaceFavorites,
        assignLegacyFavorite,
        getVerifiedTarget,
    };
}
