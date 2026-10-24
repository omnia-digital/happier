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
import { areServerProfileIdentifiersEquivalent } from '@/sync/domains/server/serverProfiles';
import { discoverSessionRepositories, type RepositoryDiscoveryFailure } from './sessionRepositoryDiscovery';
import { collectRepositoryDiscoveryWorkspaces, projectSessionListRepositoryView } from './projectSessionListRepositoryView';

export type SessionListViewMode = 'original' | 'machine' | 'repository';
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

/** Read local identity on restore; only explicit selection/Refresh discovers repositories. */
export function useSessionRepositoryView(input: Input) {
    const activeScope = useActiveServerAccountScope();
    const associations = useLocalSetting('sessionRepositoryAssociationsV1');
    const serverIdsKey = React.useMemo(() => JSON.stringify([...new Set((input.items ?? []).map(item => item.serverId ?? activeScope?.serverId ?? '').filter(Boolean))].sort()), [input.items, activeScope?.serverId]);
    const contextKey = JSON.stringify([activeScope, serverIdsKey]);
    const inputRef = React.useRef(input); inputRef.current = input;
    const modeRef = React.useRef(input.mode); modeRef.current = input.mode;
    const contextRef = React.useRef(contextKey); contextRef.current = contextKey;
    const [resolvedScopes, setResolvedScopes] = React.useState<{ contextKey: string; values: Scopes } | null>(null);
    const scopes = React.useMemo((): Scopes => {
        const result: Record<string, ServerAccountScope | undefined> = resolvedScopes?.contextKey === contextKey ? { ...resolvedScopes.values } : {};
        if (activeScope) {
            result[''] = activeScope;
            result[activeScope.serverId] = activeScope;
            for (const serverId of JSON.parse(serverIdsKey) as string[]) {
                if (areServerProfileIdentifiersEquivalent(serverId, activeScope.serverId)) result[serverId] = activeScope;
            }
        }
        return result;
    }, [activeScope, contextKey, resolvedScopes, serverIdsKey]);
    const jobRef = React.useRef<{ contextKey: string; cancelled: boolean; promise: Promise<void> } | null>(null);
    const [refreshing, setRefreshing] = React.useState(false);
    React.useEffect(() => {
        if (input.mode !== 'repository') return;
        let cancelRead = () => {};
        const readScopes = () => {
            cancelRead();
            let current = true;
            cancelRead = () => { current = false; };
            setResolvedScopes(null);
            // Local authenticated context only: account changes never initiate SCM/RPC.
            void Promise.all((JSON.parse(serverIdsKey) as string[]).map(async serverId => {
                try { return [serverId, await scmRepositoryService.resolveScopeForServer(serverId) ?? undefined] as const; }
                catch (error) { console.warn('Repository view could not read the local Home account scope', error); return [serverId, undefined] as const; }
            })).then(entries => { if (current) setResolvedScopes({ contextKey, values: Object.fromEntries(entries) }); });
        };
        const unsubscribe = TokenStorage.subscribeCredentialChanges(() => {
            if (jobRef.current) jobRef.current.cancelled = true;
            setRefreshing(false);
            readScopes();
        });
        readScopes();
        return () => { cancelRead(); unsubscribe(); };
    }, [contextKey, input.mode, serverIdsKey]);

    React.useEffect(() => () => { if (jobRef.current) jobRef.current.cancelled = true; }, []);
    React.useEffect(() => {
        const job = jobRef.current;
        if (job && (job.contextKey !== contextKey || input.mode !== 'repository')) {
            job.cancelled = true;
            setRefreshing(false);
        }
    }, [contextKey, input.mode]);
    const run = React.useCallback((refresh: boolean): Promise<void> => {
        if (modeRef.current !== 'repository') return Promise.resolve();
        const capturedContext = contextRef.current;
        if (jobRef.current && !jobRef.current.cancelled && jobRef.current.contextKey === capturedContext) return jobRef.current.promise;
        if (jobRef.current) jobRef.current.cancelled = true;
        const job = { contextKey: capturedContext, cancelled: false, promise: Promise.resolve() };
        jobRef.current = job;
        setRefreshing(true);
        job.promise = discoverSessionRepositories({
            workspaces: collectRepositoryDiscoveryWorkspaces(inputRef.current.items ?? [], scopes), refresh,
            isCurrent: () => !job.cancelled && modeRef.current === 'repository' && contextRef.current === capturedContext,
        }).then(failures => {
            if (!job.cancelled && contextRef.current === capturedContext && failures.length > 0) inputRef.current.onFailure(failures);
        }).finally(() => {
            if (jobRef.current === job) { jobRef.current = null; if (!job.cancelled) setRefreshing(false); }
        });
        return job.promise;
    }, [scopes]);
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
    const orderServerIds = React.useMemo(() => input.mode === 'repository'
        ? [...new Set(Object.values(scopes).flatMap(scope => scope ? [scope.serverId] : []))].sort() : [], [input.mode, scopes]);
    const orderByServer = useSessionOrganizationGroupOrderByServer(orderServerIds);
    const allGroupOrder = React.useMemo(() => Object.assign({}, input.groupOrder, ...Object.values(orderByServer)), [input.groupOrder, orderByServer]);
    const items = React.useMemo(() => input.mode === 'repository' && input.items
        ? projectSessionListRepositoryView({ ...input, groupOrder: allGroupOrder, items: input.items, scopes, associations }) : input.items,
    [input.items, input.mode, allGroupOrder, input.orderingMode, input.sectionMode, input.folderSortMode, scopes, associations]);
    const orderState = React.useMemo(() => {
        const groupOrder = { ...input.groupOrder };
        const orderScopes: Record<string, ServerAccountScope | null> = {};
        if (input.mode === 'repository') for (const item of items ?? []) {
            if (item.type !== 'header' || !item.repository || !item.groupKey) continue;
            const checkout = item.repository.checkouts[0];
            for (const key of [item.groupKey, item.repository.orderScope]) {
                orderScopes[key] = checkout ? { serverId: checkout.serverId, accountId: checkout.accountId } : null;
                groupOrder[key] = allGroupOrder[key] ?? [];
            }
        }
        return { groupOrder, orderScopes };
    }, [allGroupOrder, input.groupOrder, input.mode, items]);
    return { items, selectMode, refresh, getAssociationChoices, associate, refreshing: input.mode === 'repository' && refreshing, scopes, associations, ...orderState };
}
