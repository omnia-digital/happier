import type { ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import React from 'react';

import { useResolvedActiveServerSelection } from '@/hooks/server/useEffectiveServerSelection';
import { useFeatureDecision } from '@/hooks/server/useFeatureDecision';
import { useIsTablet } from '@/utils/platform/responsive';
import {
    SessionListViewItem,
    useLocalSettingMutable,
    useMachineDisplayById,
    useSessionMachineDisplayLists,
    useProfile,
    useSessionOrganizationProjections,
    useSetting,
    useSettingMutable,
} from '@/sync/domains/state/storage';
import { applySessionFoldersToSessionListViewData } from '@/sync/domains/session/listing/sessionListViewData';
import {
    buildSessionListIndexFromViewData,
    type SessionListIndexItem,
} from '@/sync/domains/session/listing/sessionListIndex';
import type { SessionFoldersV1 } from '@/sync/domains/session/folders';
import { normalizeSessionListFolderSortMode } from '@/sync/domains/session/listing/sessionListFolderSortMode';
import {
    normalizeSessionListOrderingModeV1,
    resolveEffectiveSessionListFolderSortMode,
} from '@/sync/domains/session/listing/sessionListOrderingRules';
import {
    buildSessionOrganizationListViewStateForServers,
    buildSessionOrganizationReorderRequestFromWorkspaceOrder,
} from '@/sync/domains/session/organization/viewState';
import {
    deleteSessionLabel as deleteSessionOrganizationLabel,
    reorderSessionOrganization,
    setSessionPin as setSessionOrganizationPin,
    setSessionTagLabels as setSessionOrganizationTagLabels,
    upsertSessionLabel as upsertSessionOrganizationLabel,
} from '@/sync/ops/sessionOrganization';
import { syncPerformanceTelemetry } from '@/sync/runtime/syncPerformanceTelemetry';
import { Modal } from '@/modal';
import { t } from '@/text';
import { HappyError } from '@/utils/errors/errors';

import {
    countCollapsedSessionListGroups,
    filterCollapsedSessionListItems,
} from '../sessionListCollapsedItems';
import {
    buildSessionListReachabilityModels,
    createSessionListReachabilityModelsCache,
} from '../sessionListReachabilityModels';
import {
    buildSessionListSelectedItems,
    type SessionListSelectedItem,
} from '../sessionListSelectedItems';
import {
    filterSessionListItemsByFocusedFolder,
    type SessionFolderViewModeV1,
} from '../sessionFolderShellTypes';
import { getAllKnownTags } from '../sessionTagUtils';
import { useSessionAttentionStandingInputs } from '@/hooks/session/useSessionAttentionStandingInputs';
import { useSessionListFocusedFolderState } from './useSessionListFocusedFolderState';
import type { SessionListStorageFilter } from '@/sync/domains/session/sessionStorageKind';
import {
    filterSessionListItemsForHeaderControls,
    hasActiveSessionListHeaderFilters,
    type SessionListHeaderFilterInput,
} from '../sessionListFilters';
import { useSessionListSnapshotWhenInactive } from '../surface/useSessionListSnapshotWhenInactive';
import { resolveSessionOrganizationMutationScope, type SessionOrganizationMutationScope } from '@/sync/domains/session/organization/mutationScope';
import { persistSessionListFolders } from '../commit/persistSessionListFolders';
import { persistSessionListGroupOrder } from '../commit/persistSessionListGroupOrder';
import { projectSessionListMachineView } from './projectSessionListMachineView';
import { useSessionRepositoryView, type SessionListViewMode } from './useSessionRepositoryView';
import { projectSessionListStatusView, sessionListStatusRowKey, type SessionListStatusMode } from './projectSessionListStatusView';
import { useSessionTicketStatuses } from '@/hooks/session/useSessionTicketStatus';
import { useSessionListStatusInputs } from './useSessionListStatusInputs';

const EMPTY_SESSION_KEYS: ReadonlyArray<string> = Object.freeze([]);
const EMPTY_SESSION_LIST_GROUP_ORDER: Readonly<Record<string, ReadonlyArray<string> | undefined>> = Object.freeze({});
const EMPTY_SESSION_WORKSPACE_ORDER: Readonly<Record<string, ReadonlyArray<string> | undefined>> = Object.freeze({});

const useSessionFolderViewModeMutable = useSettingMutable as unknown as (
    name: 'sessionFolderViewModeV1'
) => [SessionFolderViewModeV1 | null | undefined, (value: SessionFolderViewModeV1) => void];
const useCollapsedGroupKeysMutable = useLocalSettingMutable as unknown as (
    name: 'collapsedGroupKeysV1'
) => [Readonly<Record<string, boolean>>, (value: Readonly<Record<string, boolean>>) => void];

function countSessionListItems(items: ReadonlyArray<SessionListViewItem> | null | undefined): number {
    if (!items) return 0;
    return items.reduce((count, item) => count + (item.type === 'session' ? 1 : 0), 0);
}

function parseServerScopedSessionKey(serverId: string, keyRaw: unknown): string | null {
    const key = typeof keyRaw === 'string' ? keyRaw.trim() : '';
    const prefix = `${serverId}:`;
    if (!key.startsWith(prefix)) return null;
    const sessionId = key.slice(prefix.length).trim();
    return sessionId || null;
}

function normalizeStringArray(values: readonly string[] | null | undefined): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const value of values ?? []) {
        const normalized = typeof value === 'string' ? value.trim() : '';
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        out.push(normalized);
    }
    return out;
}

function measureSessionListRenderDerivation<T>(
    name: string,
    items: ReadonlyArray<SessionListViewItem> | null | undefined,
    fields: () => Readonly<Record<string, number>>,
    compute: () => T,
): T {
    if (!syncPerformanceTelemetry.isEnabled()) {
        return compute();
    }
    return syncPerformanceTelemetry.measure(
        name,
        {
            items: items?.length ?? 0,
            ...fields(),
        },
        compute,
    );
}

export type UseSessionListViewStateInput = Readonly<{
    data: SessionListViewItem[] | null;
    pathname: string;
    storageKind?: SessionListStorageFilter;
    headerFilters?: SessionListHeaderFilterInput;
    sessionListSurfaceDataActive?: boolean;
}>;

export function useSessionListViewState({
    data,
    headerFilters,
    pathname,
    sessionListSurfaceDataActive = true,
    storageKind,
}: UseSessionListViewStateInput) {
    const isTablet = useIsTablet();
    const [sessionMruOrderV1, setSessionMruOrderV1] = useLocalSettingMutable('sessionMruOrderV1');
    const [sessionListFolderSortModeRaw, setSessionListFolderSortModeV1] = useLocalSettingMutable('sessionListFolderSortModeV1');
    const [sessionListMachineViewRaw, persistSessionListMachineViewV1] = useLocalSettingMutable('sessionListMachineViewV1');
    const [sessionListOrderingModeRaw, setSessionListOrderingModeV1] = useSettingMutable('sessionListOrderingModeV1');
    const [sessionListStatusSortingRaw, setSessionListStatusSorting] = useSettingMutable('sessionListStatusSortV1');
    const [sessionListStatusGroupingRaw, setSessionListStatusGrouping] = useLocalSettingMutable('sessionListStatusGroupingV1');
    const sessionListStatusSorting: SessionListStatusMode = sessionListStatusSortingRaw === 'agent' || sessionListStatusSortingRaw === 'ticket' ? sessionListStatusSortingRaw : 'none';
    const sessionListStatusGrouping: SessionListStatusMode = sessionListStatusGroupingRaw === 'agent' || sessionListStatusGroupingRaw === 'ticket' ? sessionListStatusGroupingRaw : 'none';
    const statusOrganizationActive = sessionListStatusGrouping !== 'none' || sessionListStatusSorting !== 'none';
    const [sessionFolderViewModeRaw, setSessionFolderViewModeV1] = useSessionFolderViewModeMutable('sessionFolderViewModeV1');
    const sessionTagsEnabled = useSetting('sessionTagsEnabled');
    const [hideInactiveSessionsSetting, setHideInactiveSessions] = useSettingMutable('hideInactiveSessions');
    const rememberLastProjectSessionSelections = useSetting('rememberLastProjectSessionSelections') !== false;
    const workspaceFaviconsEnabled = useSetting('workspaceFaviconsEnabled') !== false;
    const workspaceMachineSubtitlesEnabled = useSetting('workspaceMachineSubtitlesEnabled') !== false;
    const [collapsedGroupKeysV1, setCollapsedGroupKeysV1] = useCollapsedGroupKeysMutable('collapsedGroupKeysV1');
    const sessionListDensity = useSetting('sessionListDensity');
    const profile = useProfile();
    const machineDisplayById = useMachineDisplayById();
    const machineDisplayLists = useSessionMachineDisplayLists();
    const renderMachineDisplayLists = useSessionListSnapshotWhenInactive(machineDisplayLists, sessionListSurfaceDataActive);
    const renderMachineDisplayById = useSessionListSnapshotWhenInactive(
        machineDisplayById,
        sessionListSurfaceDataActive,
    );
    const selection = useResolvedActiveServerSelection();
    const activeOrganizationServerId = selection.activeServerId ?? null;
    const organizationProjections = useSessionOrganizationProjections(selection.enabled ? selection.allowedServerIds : [selection.activeServerId]);
    const organizationListViewState = React.useMemo(() => buildSessionOrganizationListViewStateForServers(organizationProjections), [organizationProjections]);
    const sessionFoldersDecision = useFeatureDecision('sessions.folders');

    const hideInactiveSessions = hideInactiveSessionsSetting === true;
    const compactSessionView = sessionListDensity === 'cozy' || sessionListDensity === 'narrow';
    const compactSessionViewMinimal = sessionListDensity === 'narrow';
    const currentUserId = typeof profile?.id === 'string' ? profile.id : null;
    const selectedServerCount = selection.allowedServerIds?.length ?? 0;
    const showServerBadge = selection.enabled && selection.presentation === 'flat-with-badge' && selectedServerCount > 1;
    const showPinnedServerBadge = selection.enabled && selectedServerCount > 1;
    const selectable = isTablet;
    const folderActionsEnabled = storageKind !== 'direct' && sessionFoldersDecision?.state === 'enabled';
    const sessionFolderViewMode: SessionFolderViewModeV1 = sessionFolderViewModeRaw === 'tree' ? 'tree' : 'off';
    const sessionListSavedFolderSortMode = normalizeSessionListFolderSortMode(sessionListFolderSortModeRaw);
    const sessionListOrderingMode = normalizeSessionListOrderingModeV1(sessionListOrderingModeRaw);
    const sessionListMachineViewMode: SessionListViewMode = sessionListMachineViewRaw === 'repository' ? 'repository' : sessionListMachineViewRaw === 'machine' ? 'machine' : sessionListMachineViewRaw === 'flat' ? 'flat' : 'original';
    const sessionListSectionMode = useSetting('sessionListSectionModeV1') === 'single' ? 'single' : 'activity';
    const sessionListFolderSortMode = resolveEffectiveSessionListFolderSortMode({
        orderingMode: sessionListOrderingMode,
        folderSortMode: sessionListSavedFolderSortMode,
    });
    const folderViewEnabled = folderActionsEnabled && sessionFolderViewMode === 'tree';
    const sessionFoldersV1 = organizationListViewState.sessionFoldersV1;
    const sessionTagsV1 = organizationListViewState.sessionTagsV1 as Record<string, string[]>;
    const sessionFolderAssignmentsBySessionKey = organizationListViewState.sessionFolderAssignmentsBySessionKey;
    const attentionStanding = useSessionAttentionStandingInputs(
        organizationListViewState.attentionStandingOverridesBySessionKey,
    );
    const pinnedKeyList = Array.isArray(organizationListViewState.pinnedSessionKeysV1)
        ? organizationListViewState.pinnedSessionKeysV1
        : EMPTY_SESSION_KEYS;
    const sessionListGroupOrderV1 = organizationListViewState.sessionListGroupOrderV1;
    const sessionWorkspaceOrderV1 = organizationListViewState.sessionWorkspaceOrderV1;
    const workspaceLabelsV1 = organizationListViewState.workspaceLabelsV1;
    const activeGroupOrderMap = sessionListGroupOrderV1 ?? EMPTY_SESSION_LIST_GROUP_ORDER;
    const currentWorkspaceOrderMap = sessionWorkspaceOrderV1 ?? EMPTY_SESSION_WORKSPACE_ORDER;

    const pinnedKeySet = React.useMemo(() => {
        return new Set(pinnedKeyList);
    }, [pinnedKeyList]);

    const allKnownTags = React.useMemo(() => getAllKnownTags(sessionTagsV1), [sessionTagsV1]);

    const getOrganizationMutationContext = React.useCallback(async (): Promise<SessionOrganizationMutationScope | null> => {
        const resolved = await resolveSessionOrganizationMutationScope(activeOrganizationServerId);
        return resolved.ok ? resolved.scope : null;
    }, [activeOrganizationServerId]);

    const runOrganizationMutation = React.useCallback((mutation: () => Promise<void>) => {
        void mutation().catch((error: unknown) => {
            Modal.alert(
                t('common.error'),
                error instanceof HappyError ? error.message : t('errors.unknownError'),
            );
        });
    }, []);

    const setPinnedSessionKeysV1 = React.useCallback((nextKeysRaw: readonly string[]) => {
        runOrganizationMutation(async () => {
            const mutation = await getOrganizationMutationContext();
            if (!mutation) return;
            const nextKeys = new Set(normalizeStringArray(nextKeysRaw));
            const currentKeys = new Set(pinnedKeyList);
            const changes: Array<{ sessionId: string; pinned: boolean; sortKey?: string | null }> = [];
            for (const key of nextKeys) {
                if (currentKeys.has(key)) continue;
                const sessionId = parseServerScopedSessionKey(mutation.serverId, key);
                if (sessionId) changes.push({ sessionId, pinned: true });
            }
            for (const key of currentKeys) {
                if (nextKeys.has(key)) continue;
                const sessionId = parseServerScopedSessionKey(mutation.serverId, key);
                if (sessionId) changes.push({ sessionId, pinned: false });
            }
            await Promise.all(changes.map((change) => setSessionOrganizationPin({
                ...mutation,
                sessionId: change.sessionId,
                pinned: change.pinned,
                sortKey: change.sortKey,
            })));
        });
    }, [getOrganizationMutationContext, pinnedKeyList, runOrganizationMutation]);

    const setSessionTagsV1 = React.useCallback((nextTagsRaw: Record<string, readonly string[]>) => {
        runOrganizationMutation(async () => {
            const mutation = await getOrganizationMutationContext();
            if (!mutation) return;
            const keys = new Set([...Object.keys(sessionTagsV1 ?? {}), ...Object.keys(nextTagsRaw ?? {})]);
            const changes: Array<{ sessionId: string; tagIds: string[] }> = [];
            for (const key of keys) {
                const sessionId = parseServerScopedSessionKey(mutation.serverId, key);
                if (!sessionId) continue;
                const current = normalizeStringArray(sessionTagsV1?.[key]);
                const next = normalizeStringArray(nextTagsRaw?.[key]);
                if (current.length === next.length && current.every((value, index) => value === next[index])) continue;
                changes.push({ sessionId, tagIds: next });
            }
            await Promise.all(changes.map((change) => setSessionOrganizationTagLabels({
                ...mutation,
                sessionId: change.sessionId,
                tags: change.tagIds,
            })));
        });
    }, [getOrganizationMutationContext, runOrganizationMutation, sessionTagsV1]);


    const setSessionWorkspaceOrderV1 = React.useCallback((nextOrder: Record<string, readonly string[] | undefined>) => {
        runOrganizationMutation(async () => {
            const mutation = await getOrganizationMutationContext();
            if (!mutation) return;
            const requests = Object.entries(nextOrder ?? {})
                .map(([scopeKey, itemKeys]) => buildSessionOrganizationReorderRequestFromWorkspaceOrder({
                    serverId: mutation.serverId,
                    scopeKey,
                    itemKeys: itemKeys ?? [],
                }))
                .filter((request): request is NonNullable<typeof request> => request != null);
            await Promise.all(requests.map((request) => reorderSessionOrganization({ ...mutation, request })));
        });
    }, [getOrganizationMutationContext, runOrganizationMutation]);

    const setSessionFoldersV1 = React.useCallback((nextFolders: SessionFoldersV1, target?: Readonly<{ scope: ServerAccountScope; current: SessionFoldersV1 }>) => {
        runOrganizationMutation(() => persistSessionListFolders({
            current: target?.current ?? sessionFoldersV1, next: nextFolders,
            serverId: activeOrganizationServerId, scope: target?.scope,
        }));
    }, [activeOrganizationServerId, runOrganizationMutation, sessionFoldersV1]);

    const setWorkspaceLabelsV1 = React.useCallback((nextLabelsRaw: Record<string, string>) => {
        runOrganizationMutation(async () => {
            const mutation = await getOrganizationMutationContext();
            if (!mutation) return;
            const keys = new Set([...Object.keys(workspaceLabelsV1 ?? {}), ...Object.keys(nextLabelsRaw ?? {})]);
            const tasks: Promise<void>[] = [];
            for (const keyRaw of keys) {
                const scopeKey = typeof keyRaw === 'string' ? keyRaw.trim() : '';
                if (!scopeKey) continue;
                const current = typeof workspaceLabelsV1?.[scopeKey] === 'string'
                    ? workspaceLabelsV1[scopeKey].trim()
                    : '';
                const next = typeof nextLabelsRaw?.[scopeKey] === 'string'
                    ? nextLabelsRaw[scopeKey].trim()
                    : '';
                if (current === next) continue;
                if (next) {
                    tasks.push(upsertSessionOrganizationLabel({
                        ...mutation,
                        request: {
                            labelKind: 'workspace',
                            scopeKey,
                            display: { t: 'plain', v: { label: next } },
                        },
                    }));
                } else {
                    tasks.push(deleteSessionOrganizationLabel({
                        ...mutation,
                        request: {
                            labelKind: 'workspace',
                            scopeKey,
                        },
                    }));
                }
            }
            await Promise.all(tasks);
        });
    }, [getOrganizationMutationContext, runOrganizationMutation, workspaceLabelsV1]);

    const machinePresentedData = React.useMemo(() => {
        if (!data || sessionListMachineViewMode !== 'machine' || sessionListStatusGrouping !== 'none') return data;
        return projectSessionListMachineView(data, renderMachineDisplayById, workspaceLabelsV1, renderMachineDisplayLists);
    }, [data, renderMachineDisplayById, renderMachineDisplayLists, sessionListMachineViewMode, sessionListStatusGrouping, workspaceLabelsV1]);

    const physicalFolderPresentedData = React.useMemo(() => {
        if (!machinePresentedData || !folderViewEnabled) return machinePresentedData;
        return applySessionFoldersToSessionListViewData(machinePresentedData, {
            enabled: true,
            folders: sessionFoldersV1,
            assignmentsBySessionKey: sessionFolderAssignmentsBySessionKey,
        });
    }, [machinePresentedData, folderViewEnabled, sessionFolderAssignmentsBySessionKey, sessionFoldersV1]);

    const reportRepositoryDiscoveryFailure = React.useCallback(() => {
        Modal.alert(t('common.error'), t('sessionsList.repositoryRefreshFailed'));
    }, []);
    const repositoryView = useSessionRepositoryView({
        items: physicalFolderPresentedData,
        mode: sessionListStatusGrouping === 'none' ? sessionListMachineViewMode : 'original',
        setMode: persistSessionListMachineViewV1,
        onFailure: reportRepositoryDiscoveryFailure,
        groupOrder: activeGroupOrderMap,
        orderingMode: sessionListOrderingMode,
        sectionMode: sessionListSectionMode,
        folderSortMode: sessionListFolderSortMode,
    });
    const currentGroupOrderMap = repositoryView.groupOrder;
    const setSessionListGroupOrderV1 = React.useCallback((nextOrder: Record<string, readonly string[] | undefined>) => {
        runOrganizationMutation(() => persistSessionListGroupOrder({
            currentOrder: currentGroupOrderMap, nextOrder, defaultServerId: activeOrganizationServerId,
            groupScopes: repositoryView.orderScopes,
        }));
    }, [activeOrganizationServerId, currentGroupOrderMap, repositoryView.orderScopes, runOrganizationMutation]);
    const folderPresentedData = repositoryView.items;
    const setSessionListMachineViewV1 = repositoryView.selectMode;

    const headerFiltersActive = hasActiveSessionListHeaderFilters(headerFilters);

    const collapsedListItems = React.useMemo(() => {
        return measureSessionListRenderDerivation(
            'ui.sessionsList.render.collapsedFiltering',
            folderPresentedData,
            () => ({ collapsedGroups: countCollapsedSessionListGroups(collapsedGroupKeysV1) }),
            () => {
                if (!folderPresentedData || headerFiltersActive || sessionListStatusGrouping !== 'none') return folderPresentedData;
                return filterCollapsedSessionListItems(folderPresentedData, collapsedGroupKeysV1);
            },
        );
    }, [folderPresentedData, headerFiltersActive, collapsedGroupKeysV1, sessionListStatusGrouping]);

    const focusedFolderState = useSessionListFocusedFolderState({
        canInvalidateFocusedFolder: sessionListSurfaceDataActive,
        folderViewEnabled,
        folderPresentedData,
    });

    const focusedListItems = React.useMemo(() => {
        if (!folderViewEnabled || !focusedFolderState.focusedFolderId || !collapsedListItems) return collapsedListItems;
        return filterSessionListItemsByFocusedFolder(collapsedListItems, focusedFolderState.focusedFolderId);
    }, [collapsedListItems, focusedFolderState.focusedFolderId, folderViewEnabled]);

    const selectionScopeBaseListItems = React.useMemo(() => {
        if (!folderViewEnabled || !focusedFolderState.focusedFolderId || !folderPresentedData) return folderPresentedData;
        return filterSessionListItemsByFocusedFolder(folderPresentedData, focusedFolderState.focusedFolderId);
    }, [folderPresentedData, focusedFolderState.focusedFolderId, folderViewEnabled]);

    const selectionScopeListItems = React.useMemo(() => {
        if (!selectionScopeBaseListItems || !headerFilters) return selectionScopeBaseListItems;
        return filterSessionListItemsForHeaderControls(selectionScopeBaseListItems, {
            ...headerFilters,
            sessionTags: sessionTagsV1 ?? {},
        });
    }, [selectionScopeBaseListItems, headerFilters, sessionTagsV1]);

    const filteredListItems = React.useMemo(() => {
        if (!focusedListItems || !headerFilters) return focusedListItems;
        return filterSessionListItemsForHeaderControls(focusedListItems, {
            ...headerFilters,
            sessionTags: sessionTagsV1 ?? {},
        });
    }, [focusedListItems, headerFilters, sessionTagsV1]);

    // Loaded, filtered candidates create ticket demand before row visibility or generated collapse.
    const agentStatusActive = sessionListStatusGrouping === 'agent' || sessionListStatusSorting === 'agent';
    const statusInputs = useSessionListStatusInputs(selectionScopeListItems, selection.activeServerId,
        sessionListSurfaceDataActive && statusOrganizationActive, agentStatusActive,
        sessionListStatusGrouping === 'ticket' || sessionListStatusSorting === 'ticket');
    const runtimeNowMs = statusInputs.runtimeNowMs;
    const ticketDemands = React.useMemo(() => (selectionScopeListItems ?? []).flatMap(item => {
        if (item.type !== 'session') return [];
        const key = sessionListStatusRowKey(item); const association = statusInputs.ticketAssociations.get(key);
        return association ? [{ key, serverId: item.serverId, association }] : [];
    }), [selectionScopeListItems, statusInputs.ticketAssociations]);
    const ticketProjection = useSessionTicketStatuses(ticketDemands,
        sessionListSurfaceDataActive && (sessionListStatusGrouping === 'ticket' || sessionListStatusSorting === 'ticket'));
    const ticketStates = React.useMemo(() => new Map([...statusInputs.metadataStates, ...ticketProjection.states]), [statusInputs.metadataStates, ticketProjection.states]);
    const statusPresentedItems = React.useMemo(() => {
        if (!filteredListItems) return filteredListItems;
        const projected = projectSessionListStatusView({ items: filteredListItems, grouping: sessionListStatusGrouping,
            sorting: sessionListStatusSorting, ticketStatuses: ticketStates, nowMs: runtimeNowMs,
            agentStatuses: statusInputs.agentStatuses, ticketAssociations: statusInputs.ticketAssociations });
        return sessionListStatusGrouping === 'none' || headerFiltersActive ? projected : filterCollapsedSessionListItems(projected, collapsedGroupKeysV1);
    }, [filteredListItems, sessionListStatusGrouping, sessionListStatusSorting, ticketStates, runtimeNowMs, headerFiltersActive, collapsedGroupKeysV1, statusInputs.agentStatuses, statusInputs.ticketAssociations]);
    const statusSelectionScopeListItems = React.useMemo(() => selectionScopeListItems && statusOrganizationActive
        ? projectSessionListStatusView({ items: selectionScopeListItems, grouping: sessionListStatusGrouping,
            sorting: sessionListStatusSorting, ticketStatuses: ticketStates, nowMs: runtimeNowMs,
            agentStatuses: statusInputs.agentStatuses, ticketAssociations: statusInputs.ticketAssociations }) : selectionScopeListItems,
    [selectionScopeListItems, statusOrganizationActive, sessionListStatusGrouping, sessionListStatusSorting, ticketStates, runtimeNowMs, statusInputs.agentStatuses, statusInputs.ticketAssociations]);

    const folderBreadcrumbRootTitle = React.useMemo(() => {
        if (focusedFolderState.folderBreadcrumbs.length === 0 || !filteredListItems) return null;
        const projectHeader = filteredListItems.find((item): item is Extract<SessionListViewItem, { type: 'header' }> =>
            item.type === 'header' && item.headerKind === 'project'
        );
        return projectHeader?.title ?? null;
    }, [filteredListItems, focusedFolderState.folderBreadcrumbs.length]);

    const reachabilityModelsCacheRef = React.useRef(createSessionListReachabilityModelsCache());
    const reachabilityModels = React.useMemo(() => {
        return measureSessionListRenderDerivation(
            'ui.sessionsList.render.reachabilityDisplayMap',
            statusPresentedItems,
            () => ({
                sessions: countSessionListItems(statusPresentedItems),
                displayRows: countSessionListItems(statusPresentedItems),
                machines: Object.keys(renderMachineDisplayById).length,
            }),
            () => buildSessionListReachabilityModels({
                cache: reachabilityModelsCacheRef.current,
                items: statusPresentedItems,
                machinesById: renderMachineDisplayById,
                machineListByServerId: renderMachineDisplayLists,
                workspaceLabelsV1,
            }),
        );
    }, [statusPresentedItems, renderMachineDisplayById, renderMachineDisplayLists, workspaceLabelsV1]);

    const selectedItemsRef = React.useRef<ReadonlyArray<SessionListSelectedItem> | null>(null);
    const visibleListItems = React.useMemo(() => {
        return measureSessionListRenderDerivation(
            'ui.sessionsList.render.selectedMapping',
            statusPresentedItems,
            () => ({ selectable: selectable ? 1 : 0 }),
            () => buildSessionListSelectedItems({
                items: statusPresentedItems,
                pathname,
                selectable,
                previousItems: selectedItemsRef.current,
            }),
        );
    }, [statusPresentedItems, pathname, selectable]);
    selectedItemsRef.current = visibleListItems ?? null;

    const sessionListIndexRef = React.useRef<ReadonlyArray<SessionListIndexItem>>([]);
    const sessionListIndex = React.useMemo(() => {
        return buildSessionListIndexFromViewData(
            (visibleListItems ?? []) as ReadonlyArray<SessionListViewItem>,
            sessionListIndexRef.current,
        ) ?? [];
    }, [visibleListItems]);
    sessionListIndexRef.current = sessionListIndex;

    return {
        pinnedKeyList,
        pinnedKeySet,
        setPinnedSessionKeysV1,
        attentionStandingEnabled: attentionStanding.actionEnabled,
        attentionStandingPolicy: attentionStanding.policy,
        sessionMruOrderV1,
        setSessionMruOrderV1,
        sessionListGroupOrderV1,
        setSessionListGroupOrderV1,
        currentGroupOrderMap,
        sessionWorkspaceOrderV1,
        setSessionWorkspaceOrderV1,
        currentWorkspaceOrderMap,
        sessionFolderViewMode,
        setSessionFolderViewModeV1,
        sessionListOrderingMode,
        sessionListStatusGrouping,
        sessionListStatusSorting,
        setSessionListStatusGrouping,
        setSessionListStatusSorting,
        statusOrganizationActive,
        sessionListMachineViewMode,
        refreshSessionRepositories: repositoryView.refresh,
        getRepositoryAssociationChoices: repositoryView.getAssociationChoices,
        associateSessionRepository: repositoryView.associate,
        sessionRepositoriesRefreshing: repositoryView.refreshing,
        setSessionListMachineViewV1,
        setSessionListOrderingModeV1,
        sessionListSavedFolderSortMode,
        sessionListFolderSortMode,
        setSessionListFolderSortModeV1,
        sessionFoldersV1,
        setSessionFoldersV1,
        sessionTagsV1,
        setSessionTagsV1,
        sessionTagsEnabled,
        hideInactiveSessions,
        setHideInactiveSessions,
        rememberLastProjectSessionSelections,
        workspaceLabelsV1,
        setWorkspaceLabelsV1,
        workspaceFaviconsEnabled,
        workspaceMachineSubtitlesEnabled,
        collapsedGroupKeysV1,
        setCollapsedGroupKeysV1,
        compactSessionView,
        compactSessionViewMinimal,
        currentUserId,
        selection,
        showServerBadge,
        showPinnedServerBadge,
        selectable,
        folderActionsEnabled,
        folderViewEnabled,
        allKnownTags,
        folderPresentedData,
        collapsedListItems,
        selectionScopeListItems: statusSelectionScopeListItems,
        focusedListItems: filteredListItems,
        visibleListItems,
        listItems: (visibleListItems ?? []) as Array<SessionListViewItem | (Extract<SessionListViewItem, { type: 'session' }> & { selected?: boolean })>,
        sessionListIndex,
        sessionListIndexRef,
        reachabilityModels,
        hasMultipleMachines: reachabilityModels.hasMultipleMachines,
        reachableSessionDisplayByKey: reachabilityModels.reachableSessionDisplayByKey,
        sessionFolderAssignmentsBySessionKey,
        folderBreadcrumbRootTitle,
        ...focusedFolderState,
    };
}
