import React from 'react';
import { useWindowDimensions } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import { DropdownMenu, type DropdownMenuItem } from '@/components/ui/forms/dropdown/DropdownMenu';
import { t } from '@/text';
import type { SessionFolderViewModeV1 } from './sessionFolderShellTypes';
import type { SessionListFolderSortModeV1 } from '@/sync/domains/session/listing/sessionListFolderSortMode';
import { Icon, ICON_SIZE } from '@/components/ui/icons/Icon';
import { PressableSurface } from '@/components/ui/interaction/PressableSurface';
import type { SessionListViewMode } from './view-state/useSessionRepositoryView';
import type { SessionListStatusMode } from './view-state/projectSessionListStatusView';
import {
    SESSION_LIST_ORDERING_MODES_V1,
    resolveEffectiveSessionListFolderSortMode,
    type SessionListOrderingModeV1,
} from '@/sync/domains/session/listing/sessionListOrderingRules';

const FOLDER_SORT_MODE_ACTION_PREFIX = 'session-folder-sort-mode:';

function resolveFolderSortModeAction(itemId: string): SessionListFolderSortModeV1 | null {
    if (!itemId.startsWith(FOLDER_SORT_MODE_ACTION_PREFIX)) return null;
    const rawMode = itemId.slice(FOLDER_SORT_MODE_ACTION_PREFIX.length);
    return rawMode === 'mixed' || rawMode === 'foldersFirst' ? rawMode : null;
}

function resolveOrderingModeAction(itemId: string): SessionListOrderingModeV1 | null {
    return itemId === 'custom' || itemId === 'created' || itemId === 'updated' ? itemId : null;
}

function getOrderingModeTitle(mode: SessionListOrderingModeV1): string {
    if (mode === 'created') return t('sessionsList.orderingMode.created');
    if (mode === 'updated') return t('sessionsList.orderingMode.updated');
    return t('sessionsList.orderingMode.custom');
}

export function SessionListViewMenuButton(props: Readonly<{
    machineViewMode: SessionListViewMode;
    onMachineViewModeChange: (mode: SessionListViewMode) => void;
    onRepositoryRefresh?: () => void;
    repositoryRefreshing?: boolean;
    folderViewMode: SessionFolderViewModeV1;
    onFolderViewModeChange: (mode: SessionFolderViewModeV1) => void;
    orderingMode: SessionListOrderingModeV1;
    onOrderingModeChange: (mode: SessionListOrderingModeV1) => void;
    statusGrouping: SessionListStatusMode;
    statusSorting: SessionListStatusMode;
    onStatusGroupingChange: (mode: SessionListStatusMode) => void;
    onStatusSortingChange: (mode: SessionListStatusMode) => void;
    folderSortMode: SessionListFolderSortModeV1;
    onFolderSortModeChange: (mode: SessionListFolderSortModeV1) => void;
    hideInactiveSessions: boolean;
    onHideInactiveSessionsChange: (next: boolean) => void;
    disabled?: boolean;
}>) {
    const { theme } = useUnistyles();
    const { height: windowHeight } = useWindowDimensions();
    const [groupOpen, setGroupOpen] = React.useState(false);
    const [sortOpen, setSortOpen] = React.useState(false);
    const iconColor = props.disabled ? theme.colors.text.tertiary : theme.colors.text.secondary;
    const selectedIconColor = theme.colors.accent.blue;
    const effectiveFolderSortMode = resolveEffectiveSessionListFolderSortMode({
        orderingMode: props.orderingMode,
        folderSortMode: props.folderSortMode,
    });
    const folderSortLockedByOrdering = props.orderingMode !== 'custom';

    const groupItems = React.useMemo((): DropdownMenuItem[] => [
        {
            id: 'session-view-flat',
            testID: 'session-view-flat',
            category: t('sessionsList.viewOptions'),
            title: t('sessionsList.noGrouping'),
            icon: <Icon name="list" size={ICON_SIZE.sm} color={iconColor} />,
            rightElement: props.statusGrouping === 'none' && props.machineViewMode === 'flat'
                ? <Icon name="check" size={ICON_SIZE.sm} color={selectedIconColor} /> : null,
        },
        {
            id: 'session-view-original',
            testID: 'session-view-original',
            category: t('sessionsList.viewOptions'),
            title: t('sessionsList.machineViewOriginal'),
            icon: <Icon name="list" size={ICON_SIZE.sm} color={iconColor} />,
            rightElement: props.statusGrouping === 'none' && props.machineViewMode === 'original'
                ? <Icon name="check" size={ICON_SIZE.sm} color={selectedIconColor} /> : null,
        },
        {
            id: 'session-view-machine',
            testID: 'session-view-machine',
            category: t('sessionsList.viewOptions'),
            title: t('sessionsList.machineViewGrouped'),
            icon: <Icon name="desktop" size={ICON_SIZE.sm} color={iconColor} />,
            rightElement: props.statusGrouping === 'none' && props.machineViewMode === 'machine'
                ? <Icon name="check" size={ICON_SIZE.sm} color={selectedIconColor} /> : null,
        },
        {
            id: 'session-view-repository',
            testID: 'session-view-repository',
            category: t('sessionsList.viewOptions'),
            title: t('sessionsList.repositoryView'),
            icon: <Icon name="git-branch" size={ICON_SIZE.sm} color={iconColor} />,
            rightElement: props.statusGrouping === 'none' && props.machineViewMode === 'repository'
                ? <Icon name="check" size={ICON_SIZE.sm} color={selectedIconColor} /> : null,
        },
        ...(props.machineViewMode === 'repository' && props.statusGrouping === 'none' ? [{
            id: 'session-repository-refresh',
            testID: 'session-repository-refresh',
            category: t('sessionsList.viewOptions'),
            title: t('sessionsList.repositoryRefresh'),
            icon: <Icon name="arrow-clockwise" size={ICON_SIZE.sm} color={iconColor} />,
            disabled: props.repositoryRefreshing,
        }] : []),
        ...(['none', 'agent', 'ticket'] as const).map((mode): DropdownMenuItem => ({
            id: `status-group:${mode}`,
            testID: `session-list-status-group-${mode}`,
            category: t('sessionsList.statusOrganization.groupTitle'),
            title: mode === 'none' ? t('sessionsList.statusOrganization.restoreGrouping') : mode === 'agent' ? t('sessionsList.statusOrganization.agentGroup') : t('sessionsList.statusOrganization.ticketGroup'),
            subtitle: mode === 'none' ? undefined : t('sessionsList.statusOrganization.description'),
            rightElement: mode !== 'none' && props.statusGrouping === mode ? <Icon name="check" size={ICON_SIZE.sm} color={selectedIconColor} /> : null,
        })),
        {
            id: props.folderViewMode === 'tree' ? 'folder-view-off' : 'folder-view-tree',
            testID: 'session-folder-view-toggle',
            category: t('sessionsList.folderVisibility'),
            title: props.folderViewMode === 'tree'
                ? t('sessionsList.folderViewOff')
                : t('sessionsList.folderViewTree'),
            icon: <Icon name="folder" size={ICON_SIZE.sm} color={iconColor} />,
            disabled: props.disabled,
        },
        {
            id: props.hideInactiveSessions ? 'show-inactive' : 'hide-inactive',
            category: t('sessionsList.filters'),
            title: props.hideInactiveSessions
                ? t('sessionsList.showInactiveSessions')
                : t('sessionsList.hideInactiveSessions'),
            icon: <Icon name="funnel-simple" size={ICON_SIZE.sm} color={iconColor} />,
        },
    ], [
        iconColor,
        props.disabled,
        props.folderViewMode,
        props.hideInactiveSessions,
        props.machineViewMode,
        props.repositoryRefreshing,
        props.statusGrouping,
        selectedIconColor,
    ]);

    const sortItems = React.useMemo((): DropdownMenuItem[] => [
        ...(['agent', 'ticket'] as const).map((mode): DropdownMenuItem => ({
            id: `status-sort:${mode}`,
            testID: `session-list-status-sort-${mode}`,
            category: t('sessionsList.orderingMode.title'),
            title: mode === 'agent' ? t('sessionsList.statusOrganization.agentSort') : t('sessionsList.statusOrganization.ticketSort'),
            rightElement: props.statusSorting === mode ? <Icon name="check" size={ICON_SIZE.sm} color={selectedIconColor} /> : null,
        })),
        ...SESSION_LIST_ORDERING_MODES_V1.map((mode): DropdownMenuItem => ({
            id: mode,
            testID: `session-list-ordering-mode-${mode}`,
            category: t('sessionsList.orderingMode.title'),
            title: getOrderingModeTitle(mode),
            icon: <Icon name={mode === 'custom' ? 'list' : mode === 'created' ? 'calendar' : 'clock'} size={ICON_SIZE.sm} color={iconColor} />,
            rightElement: props.statusSorting === 'none' && props.orderingMode === mode
                ? <Icon name="check" size={ICON_SIZE.sm} color={selectedIconColor} /> : null,
        })),
        ...(['foldersFirst', 'mixed'] as const).map((mode): DropdownMenuItem => ({
            id: `${FOLDER_SORT_MODE_ACTION_PREFIX}${mode}`,
            testID: mode === 'foldersFirst' ? 'session-folder-sort-mode-folders-first' : 'session-folder-sort-mode-mixed',
            category: t('sessionsList.folderSortMode'),
            title: mode === 'foldersFirst' ? t('sessionsList.folderSortFoldersFirst') : t('sessionsList.folderSortMixed'),
            subtitle: folderSortLockedByOrdering
                ? t('sessionsList.folderSortDisabledInDateMode')
                : mode === 'foldersFirst'
                    ? t('sessionsList.folderSortFoldersFirstDescription')
                    : props.machineViewMode === 'machine'
                        ? t('sessionsList.folderSortMixedDescriptionMachineView')
                        : t('sessionsList.folderSortMixedDescription'),
            icon: <Icon name={mode === 'foldersFirst' ? 'folder' : 'arrows-down-up'} size={ICON_SIZE.sm} color={iconColor} />,
            disabled: props.disabled || folderSortLockedByOrdering,
            rightElement: effectiveFolderSortMode === mode
                ? <Icon name="check" size={ICON_SIZE.sm} color={selectedIconColor} /> : null,
        })),
    ], [effectiveFolderSortMode, folderSortLockedByOrdering, iconColor, props.disabled, props.machineViewMode, props.orderingMode, props.statusSorting, selectedIconColor]);

    const handleSelect = React.useCallback((itemId: string) => {
        if (itemId.startsWith('status-group:')) {
            const mode = itemId.slice('status-group:'.length); if (mode === 'none' || mode === 'agent' || mode === 'ticket') props.onStatusGroupingChange(mode);
            return;
        }
        if (itemId.startsWith('status-sort:')) {
            const mode = itemId.slice('status-sort:'.length); if (mode === 'agent' || mode === 'ticket') props.onStatusSortingChange(mode);
            return;
        }
        if (itemId === 'session-view-repository') { props.onStatusGroupingChange('none'); props.onMachineViewModeChange('repository'); return; }
        if (itemId === 'session-view-flat') { props.onStatusGroupingChange('none'); props.onMachineViewModeChange('flat'); return; }
        if (itemId === 'session-repository-refresh') { if (!props.repositoryRefreshing) props.onRepositoryRefresh?.(); return; }
        if (itemId === 'session-view-original' || itemId === 'session-view-machine') {
            props.onStatusGroupingChange('none');
            props.onMachineViewModeChange(itemId === 'session-view-machine' ? 'machine' : 'original');
            return;
        }
        const orderingMode = resolveOrderingModeAction(itemId);
        if (orderingMode) {
            props.onStatusSortingChange('none');
            props.onOrderingModeChange(orderingMode);
            return;
        }
        const folderSortMode = resolveFolderSortModeAction(itemId);
        if (folderSortMode) {
            if (props.orderingMode !== 'custom') return;
            props.onFolderSortModeChange(folderSortMode);
            return;
        }
        if (itemId === 'folder-view-tree') {
            props.onFolderViewModeChange('tree');
            return;
        }
        if (itemId === 'folder-view-off') {
            props.onFolderViewModeChange('off');
            return;
        }
        if (itemId === 'hide-inactive') {
            props.onHideInactiveSessionsChange(true);
            return;
        }
        if (itemId === 'show-inactive') {
            props.onHideInactiveSessionsChange(false);
        }
    }, [props]);

    return (
        <>
        <DropdownMenu
            open={groupOpen}
            onOpenChange={(next) => { setGroupOpen(next); if (next) setSortOpen(false); }}
            items={groupItems}
            onSelect={handleSelect}
            selectedId={props.statusGrouping === 'none' ? `session-view-${props.machineViewMode}` : `status-group:${props.statusGrouping}`}
            placement="left"
            variant="slim"
            matchTriggerWidth={false}
            maxWidthCap={260}
            maxHeightCap={windowHeight}
            showCategoryTitles={true}
            popoverPortalWebTarget="body"
            trigger={({ toggle }) => (
                <PressableSurface
                    testID="session-list-group-menu-trigger"
                    accessibilityRole="button"
                    accessibilityLabel={t('sessionsList.groupMenu')}
                    webTooltip={t('sessionsList.groupMenu')}
                    onPress={(event) => {
                        event?.stopPropagation?.();
                        toggle();
                    }}
                    hitSlop={8}
                >
                    <Icon name="stack" size={ICON_SIZE.sm} color={iconColor} />
                </PressableSurface>
            )}
        />
        <DropdownMenu
            open={sortOpen}
            onOpenChange={(next) => { setSortOpen(next); if (next) setGroupOpen(false); }}
            items={sortItems}
            onSelect={handleSelect}
            selectedId={props.statusSorting === 'none' ? props.orderingMode : `status-sort:${props.statusSorting}`}
            placement="left"
            variant="slim"
            matchTriggerWidth={false}
            maxWidthCap={260}
            maxHeightCap={windowHeight}
            showCategoryTitles={true}
            popoverPortalWebTarget="body"
            trigger={({ toggle }) => (
                <PressableSurface
                    testID="session-list-sort-menu-trigger"
                    accessibilityRole="button"
                    accessibilityLabel={t('sessionsList.sortMenu')}
                    webTooltip={t('sessionsList.sortMenu')}
                    onPress={(event) => {
                        event?.stopPropagation?.();
                        toggle();
                    }}
                    hitSlop={8}
                >
                    <Icon name="arrows-down-up" size={ICON_SIZE.sm} color={iconColor} />
                </PressableSurface>
            )}
        />
        </>
    );
}
