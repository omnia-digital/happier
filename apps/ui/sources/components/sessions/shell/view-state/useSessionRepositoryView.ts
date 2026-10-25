import * as React from 'react';
import { TokenStorage } from '@/auth/storage/tokenStorage';
import { scmRepositoryService } from '@/scm/scmRepositoryService';
import { storage, useActiveServerAccountScope, useLocalSetting, useSessionOrganizationGroupOrderByServer } from '@/sync/domains/state/storage';
import { applyLocalSettingsFromUi } from '@/sync/store/settingsWriters';
import { listRepositoryAssociationChoices, withManualRepositoryAssociation, type RepositoryWorkspace, type RepositoryAssociationChoice } from '@/sync/domains/session/listing/sessionRepositoryIdentity';
import type { ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import type { SessionListViewItem } from '@/sync/domains/session/listing/sessionListViewData';
import type { SessionListOrderingModeV1, SessionListOrderingSectionMode } from '@/sync/domains/session/listing/sessionListOrderingRules';
import type { SessionListFolderSortModeV1 } from '@/sync/domains/session/listing/sessionListFolderSortMode';
import { areServerProfileIdentifiersEquivalent, resolveServerProfileScopeIdForIdentifier } from '@/sync/domains/server/serverProfiles';
import type { SessionListGroupOrderScope } from '../commit/persistSessionListGroupOrder';
import { discoverSessionRepositories, type RepositoryDiscoveryFailure, type RepositoryDiscoveryWorkspace } from './sessionRepositoryDiscovery';
import { collectRepositoryDiscoveryWorkspaces, projectSessionListRepositoryView } from './projectSessionListRepositoryView';
import { projectSessionListFlatView } from './projectSessionListFlatView';

export type SessionListViewMode = 'original' | 'machine' | 'repository' | 'flat';
type Scopes = Readonly<Record<string, ServerAccountScope | undefined>>;

type Input = Readonly<{
    items: SessionListViewItem[] | null;
    mode: SessionListViewMode;
    setMode: (mode: SessionListViewMode) => void;
    onFailure: (failures: readonly RepositoryDiscoveryFailure[]) => void;
    groupOrder?: Readonly<Record<string, readonly string[] | undefined>>;
    orderingMode?: SessionListOrderingModeV1;
    sectionMode?: SessionListOrderingSectionMode;
    folderSortMode?: SessionListFolderSortModeV1;
}>;

/** Read local identity on restore; repository discovery follows explicit intent and new workspaces. */
export function useSessionRepositoryView(input: Input) {
    const activeScope = useActiveServerAccountScope();
    const associations = useLocalSetting('sessionRepositoryAssociationsV1');
    const serverIdsKey = React.useMemo(() => JSON.stringify([...new Set((input.items ?? []).map(item => item.serverId ?? activeScope?.serverId ?? '').filter(Boolean))].sort()), [input.items, activeScope?.serverId]);
    const scopeReadKey = JSON.stringify([activeScope, serverIdsKey]);
    // The visible Home set changes as sessions arrive. It does not invalidate
    // an authenticated discovery already in flight for another Home.
    const contextKey = JSON.stringify(activeScope);
    const arrivalScopeKey = JSON.stringify(activeScope ? [activeScope.serverId, activeScope.accountId] : null);
    const inputRef = React.useRef(input); inputRef.current = input;
    const modeRef = React.useRef(input.mode); modeRef.current = input.mode;
    const contextRef = React.useRef(contextKey); contextRef.current = contextKey;
    const [resolvedScopes, setResolvedScopes] = React.useState<{ contextKey: string; values: Scopes } | null>(null);
    const scopes = React.useMemo((): Scopes => {
        const result: Record<string, ServerAccountScope | undefined> = resolvedScopes?.contextKey === scopeReadKey ? { ...resolvedScopes.values } : {};
        if (activeScope) {
            result[''] = activeScope;
            result[activeScope.serverId] = activeScope;
            for (const serverId of JSON.parse(serverIdsKey) as string[]) {
                if (areServerProfileIdentifiersEquivalent(serverId, activeScope.serverId)) result[serverId] = activeScope;
            }
        }
        return result;
    }, [activeScope, scopeReadKey, resolvedScopes, serverIdsKey]);
    const jobRef = React.useRef<{ contextKey: string; cancelled: boolean; followUpWorkspaces: RepositoryDiscoveryWorkspace[]; promise: Promise<void> } | null>(null);
    const scopesRef = React.useRef(scopes); scopesRef.current = scopes;
    const runRef = React.useRef<(refresh: boolean, newWorkspaces?: readonly RepositoryDiscoveryWorkspace[]) => Promise<void>>(() => Promise.resolve());
    const observedWorkspacesRef = React.useRef<{ contextKey: string; mode: SessionListViewMode; keys: Set<string> } | null>(null);
    const [refreshing, setRefreshing] = React.useState(false);
    React.useEffect(() => {
        if (input.mode !== 'repository' && input.mode !== 'flat') return;
        let cancelRead = () => {};
        const readScopes = () => {
            cancelRead();
            let current = true;
            cancelRead = () => { current = false; };
            setResolvedScopes(null);
            // Local authenticated context only: account changes never initiate SCM/RPC.
            void Promise.all((JSON.parse(serverIdsKey) as string[]).map(async serverId => {
                try { return [serverId, await scmRepositoryService.resolveScopeForServer(serverId) ?? undefined] as const; }
                catch (error) { console.warn('Session list could not read the local Home account scope', error); return [serverId, undefined] as const; }
            })).then(entries => { if (current) setResolvedScopes({ contextKey: scopeReadKey, values: Object.fromEntries(entries) }); });
        };
        const unsubscribe = TokenStorage.subscribeCredentialChanges(() => {
            if (jobRef.current) jobRef.current.cancelled = true;
            setRefreshing(false);
            readScopes();
        });
        readScopes();
        return () => { cancelRead(); unsubscribe(); };
    }, [input.mode, scopeReadKey, serverIdsKey]);

    React.useEffect(() => () => { if (jobRef.current) jobRef.current.cancelled = true; }, []);
    React.useEffect(() => {
        const job = jobRef.current;
        if (job && (job.contextKey !== contextKey || input.mode !== 'repository')) {
            job.cancelled = true;
            setRefreshing(false);
        }
    }, [contextKey, input.mode]);
    const run = React.useCallback((refresh: boolean, newWorkspaces?: readonly RepositoryDiscoveryWorkspace[]): Promise<void> => {
        if (modeRef.current !== 'repository') return Promise.resolve();
        const capturedContext = contextRef.current;
        if (jobRef.current && !jobRef.current.cancelled && jobRef.current.contextKey === capturedContext) return jobRef.current.promise;
        if (jobRef.current) jobRef.current.cancelled = true;
        const job = { contextKey: capturedContext, cancelled: false, followUpWorkspaces: [] as RepositoryDiscoveryWorkspace[], promise: Promise.resolve() };
        jobRef.current = job;
        setRefreshing(true);
        job.promise = discoverSessionRepositories({
            workspaces: newWorkspaces ?? collectRepositoryDiscoveryWorkspaces(inputRef.current.items ?? [], scopes),
            refresh, verifyNewWorkspace: newWorkspaces !== undefined,
            isCurrent: () => !job.cancelled && modeRef.current === 'repository' && contextRef.current === capturedContext,
        }).then(failures => {
            if (!job.cancelled && contextRef.current === capturedContext && failures.length > 0) inputRef.current.onFailure(failures);
        }).finally(() => {
            const shouldFollowUp = job.followUpWorkspaces.length > 0 && !job.cancelled && contextRef.current === capturedContext && modeRef.current === 'repository';
            if (jobRef.current === job) { jobRef.current = null; if (!job.cancelled) setRefreshing(false); }
            if (shouldFollowUp) void runRef.current(false, job.followUpWorkspaces);
        });
        return job.promise;
    }, [scopes]);
    runRef.current = run;
    React.useEffect(() => {
        if (input.items === null) return;
        const workspacesByKey = new Map(collectRepositoryDiscoveryWorkspaces(input.items ?? [], scopesRef.current)
            .map(workspace => [JSON.stringify([workspace.serverId, workspace.machineId, workspace.path]), workspace] as const));
        const keys = new Set(workspacesByKey.keys());
        const observed = observedWorkspacesRef.current;
        if (!observed || observed.contextKey !== arrivalScopeKey || observed.mode !== input.mode) {
            observedWorkspacesRef.current = { contextKey: arrivalScopeKey, mode: input.mode, keys };
            return;
        }
        const arrivals = [...workspacesByKey].filter(([key]) => !observed.keys.has(key)).map(([, workspace]) => workspace);
        for (const key of keys) observed.keys.add(key);
        if (input.mode !== 'repository' || arrivals.length === 0) return;
        const job = jobRef.current;
        if (job && !job.cancelled && job.contextKey === contextKey) job.followUpWorkspaces.push(...arrivals);
        else void runRef.current(false, arrivals);
    }, [contextKey, input.items, input.mode]);
    const selectMode = React.useCallback((mode: SessionListViewMode) => {
        modeRef.current = mode;
        if (mode !== 'repository' && jobRef.current) { jobRef.current.cancelled = true; setRefreshing(false); }
        inputRef.current.setMode(mode);
        if (mode === 'repository') void run(false);
    }, [run]);
    const refresh = React.useCallback(() => run(true), [run]);
    const getAssociationChoices = React.useCallback((workspace: RepositoryWorkspace) =>
        listRepositoryAssociationChoices(storage.getState().localSettings.sessionRepositoryAssociationsV1, workspace), []);
    const associate = React.useCallback(async (workspace: RepositoryWorkspace, choice: RepositoryAssociationChoice | null) => {
        const capturedContext = contextRef.current;
        const scope = await scmRepositoryService.resolveScopeForServer(workspace.serverId);
        if (!scope || scope.serverId !== workspace.serverId || scope.accountId !== workspace.accountId
            || contextRef.current !== capturedContext) throw new Error('Repository account scope changed');
        const current = storage.getState().localSettings.sessionRepositoryAssociationsV1;
        const next = withManualRepositoryAssociation(current, workspace, choice);
        if (next !== current) applyLocalSettingsFromUi({ sessionRepositoryAssociationsV1: next });
    }, []);
    const canonicalServerIds = React.useMemo(() => Object.fromEntries((JSON.parse(serverIdsKey) as string[])
        .map(serverId => [serverId, resolveServerProfileScopeIdForIdentifier(serverId)])), [serverIdsKey]);
    const orderServerIds = React.useMemo(() => [...new Set(Object.values(canonicalServerIds))].sort(), [canonicalServerIds]);
    const orderByServer = useSessionOrganizationGroupOrderByServer(orderServerIds);
    const allGroupOrder = React.useMemo(() => {
        const result = { ...input.groupOrder };
        for (const orders of Object.values(orderByServer)) for (const [key, values] of Object.entries(orders)) {
            result[key] = [...new Set([...(result[key] ?? []), ...values])];
        }
        return result;
    }, [input.groupOrder, orderByServer]);
    const items = React.useMemo(() => input.mode === 'repository' && input.items
        ? projectSessionListRepositoryView({ ...input, groupOrder: allGroupOrder, items: input.items, scopes, associations })
        : input.mode === 'flat' && input.items
            ? projectSessionListFlatView({ ...input, groupOrder: allGroupOrder, items: input.items })
            : input.items,
    [input.items, input.mode, allGroupOrder, input.orderingMode, input.sectionMode, input.folderSortMode, scopes, associations]);
    const orderState = React.useMemo(() => {
        const groupOrder = { ...allGroupOrder };
        const orderScopes: Record<string, readonly SessionListGroupOrderScope[] | null> = {};
        const unresolvedFlatGroups = new Set<string>();
        const addScope = (key: string, scope: SessionListGroupOrderScope) => {
            const existing = orderScopes[key] ?? [];
            orderScopes[key] = [...existing.filter(value => value.serverId !== scope.serverId), scope];
        };
        // Preserve provenance for hidden orders too: a structural move can clear a
        // former group that is not rendered in the current view.
        for (const [serverId, orders] of Object.entries(orderByServer)) {
            const scope = Object.values(scopes).find(value => value?.serverId === serverId) ?? { serverId };
            for (const key of Object.keys(orders)) addScope(key, scope);
        }
        for (const sourceItems of input.mode === 'flat' ? [input.items ?? [], items ?? []] : [input.items ?? []]) {
            for (const item of sourceItems) {
                if (!item.groupKey) continue;
                // Shared band headers have no Home of their own; their rows supply it.
                // Empty physical folders/projects still belong to the implicit active Home.
                const usesImplicitHome = item.type === 'session' || item.headerKind === 'folder' || item.headerKind === 'project';
                const serverId = item.serverId ?? (usesImplicitHome ? activeScope?.serverId : undefined);
                if (input.mode === 'flat' && usesImplicitHome && item.groupKey.startsWith('flat-v1:') && (!serverId || !scopes[serverId]?.accountId)) {
                    unresolvedFlatGroups.add(item.groupKey);
                    continue;
                }
                if (serverId) addScope(item.groupKey, scopes[serverId] ?? { serverId: canonicalServerIds[serverId] ?? serverId });
            }
        }
        for (const key of unresolvedFlatGroups) orderScopes[key] = null;
        if (input.mode === 'repository') for (const item of items ?? []) {
            if (item.type !== 'header' || !item.repository || !item.groupKey) continue;
            const checkout = item.repository.checkouts[0];
            for (const key of [item.groupKey, item.repository.orderScope]) {
                orderScopes[key] = checkout ? [{ serverId: checkout.serverId, accountId: checkout.accountId }] : null;
                groupOrder[key] = allGroupOrder[key] ?? [];
            }
        }
        return { groupOrder, orderScopes };
    }, [activeScope, allGroupOrder, canonicalServerIds, input.items, input.mode, items, orderByServer, scopes]);
    return { items, selectMode, refresh, getAssociationChoices, associate, refreshing: input.mode === 'repository' && refreshing, scopes, associations, ...orderState };
}
