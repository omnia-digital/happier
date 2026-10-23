import * as React from 'react';
import { scmRepositoryService } from '@/scm/scmRepositoryService';
import { useActiveServerAccountScope, useLocalSetting } from '@/sync/domains/state/storage';
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
    React.useEffect(() => {
        if (input.mode !== 'repository') return;
        let current = true;
        // The canonical resolver reads local authenticated context, not SCM/RPC.
        void Promise.all((JSON.parse(serverIdsKey) as string[]).map(async serverId => {
            try { return [serverId, await scmRepositoryService.resolveScopeForServer(serverId) ?? undefined] as const; }
            catch (error) { console.warn('Repository view could not read the local Home account scope', error); return [serverId, undefined] as const; }
        })).then(entries => { if (current) setResolvedScopes({ contextKey, values: Object.fromEntries(entries) }); });
        return () => { current = false; };
    }, [contextKey, input.mode, serverIdsKey]);

    const jobRef = React.useRef<{ contextKey: string; cancelled: boolean; promise: Promise<void> } | null>(null);
    const [refreshing, setRefreshing] = React.useState(false);
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
    const items = React.useMemo(() => input.mode === 'repository' && input.items
        ? projectSessionListRepositoryView({ ...input, items: input.items, scopes, associations }) : input.items,
    [input.items, input.mode, input.groupOrder, input.orderingMode, input.sectionMode, input.folderSortMode, scopes, associations]);
    return { items, selectMode, refresh, refreshing: input.mode === 'repository' && refreshing, scopes, associations };
}
