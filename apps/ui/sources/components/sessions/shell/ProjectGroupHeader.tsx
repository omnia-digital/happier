import React from 'react';
import { Platform, Pressable, View } from 'react-native';
import { Image } from 'expo-image';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { GestureDetector } from 'react-native-gesture-handler';
import type { UseSessionInlineDragResult } from './useSessionInlineDrag';

import { DropdownMenu, type DropdownMenuItem } from '@/components/ui/forms/dropdown/DropdownMenu';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import type { SessionListViewItem } from '@/sync/domains/state/storage';
import { t } from '@/text';
import { useWorkspaceFavicon } from './useWorkspaceFavicon';
import type { RepositoryCheckout, RepositoryAssociationChoice } from '@/sync/domains/session/listing/sessionRepositoryIdentity';
import { Icon } from '@/components/ui/icons/Icon';

const WORKSPACE_FAVICON_SIZE = 16;
const WORKSPACE_FAVICON_RADIUS = 4;
const workspaceFaviconImageStyle = {
    width: WORKSPACE_FAVICON_SIZE,
    height: WORKSPACE_FAVICON_SIZE,
    borderRadius: WORKSPACE_FAVICON_RADIUS,
};

const webReorderHandleStyle = { width: 24, height: 24 };

const stylesheet = StyleSheet.create((theme) => ({
    section: {
        backgroundColor: theme.colors.background.canvas,
        paddingHorizontal: 24,
        paddingTop: 10,
        paddingBottom: 5,
    },
    row: {
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        justifyContent: 'space-between' as const,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: 'transparent',
    },
    titleRow: {
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        gap: 6,
        flex: 1,
        minWidth: 0,
    },
    title: {
        fontSize: 12,
        fontWeight: '600',
        color: theme.colors.text.secondary,
        flexShrink: 1,
        ...Typography.default('semiBold'),
    },
    pathTitleWeb: {
        writingDirection: 'rtl' as const,
        textAlign: 'left' as const,
    },
    pathTitleTextWeb: {
        writingDirection: 'ltr' as const,
        unicodeBidi: 'isolate' as const,
    },
    subtitle: {
        fontSize: 11,
        color: theme.colors.text.secondary,
        marginTop: 2,
        ...Typography.default(),
    },
    faviconFrame: {
        width: WORKSPACE_FAVICON_SIZE,
        minWidth: WORKSPACE_FAVICON_SIZE,
        maxWidth: WORKSPACE_FAVICON_SIZE,
        height: WORKSPACE_FAVICON_SIZE,
        minHeight: WORKSPACE_FAVICON_SIZE,
        maxHeight: WORKSPACE_FAVICON_SIZE,
        flexShrink: 0,
        borderRadius: WORKSPACE_FAVICON_RADIUS,
        backgroundColor: theme.colors.surface.base,
        overflow: 'hidden' as const,
    },
    content: {
        flex: 1,
        minWidth: 0,
    },
    inlineActions: {
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        gap: 2,
        flexShrink: 0,
    },
    trailingActions: {
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        flexShrink: 0,
        marginLeft: 8,
    },
    actionButton: {
        width: 18,
        height: 14,
        alignItems: 'center' as const,
        justifyContent: 'center' as const,
        borderRadius: 999,
        marginLeft: 4,
    },
    chevron: {
        width: 16,
        alignItems: 'center' as const,
        justifyContent: 'center' as const,
        color: theme.colors.text.secondary,
    },
    hoverHiddenChevron: {
        opacity: 0,
    },
    hoverVisibleChevron: {
        opacity: 1,
    },
}));

export const ProjectGroupHeader = React.memo(function ProjectGroupHeader(props: Readonly<{
    item: Extract<SessionListViewItem, { type: 'header' }>;
    hasMultipleMachines: boolean;
    workspaceLabelsV1: Record<string, string>;
    workspaceFaviconsEnabled?: boolean;
    workspaceMachineSubtitlesEnabled?: boolean;
    dragHandleGesture?: UseSessionInlineDragResult['gesture'];
    reorderEnabled?: boolean;
    onMoveUp?: () => void;
    onMoveDown?: () => void;
    onRenameWorkspace: (workspaceKey: string, currentLabel: string) => void;
    onResetWorkspaceName: (workspaceKey: string) => void;
    onCreateSession: (checkout?: RepositoryCheckout) => void;
    onAddFolder: (checkout?: RepositoryCheckout) => void | Promise<void>;
    getRepositoryAssociationChoices?: (checkout: RepositoryCheckout) => readonly RepositoryAssociationChoice[];
    onAssociateRepository?: (checkout: RepositoryCheckout, choice: RepositoryAssociationChoice | 'new' | null) => Promise<void>;
    collapsed: boolean;
    onToggleCollapse: () => void;
    headerTestId: string;
}>) {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const {
        item,
        hasMultipleMachines,
        workspaceLabelsV1,
        workspaceFaviconsEnabled = false,
        workspaceMachineSubtitlesEnabled = true,
        onRenameWorkspace,
        onResetWorkspaceName,
        onCreateSession,
        onAddFolder,
        collapsed,
        onToggleCollapse,
        headerTestId,
    } = props;
    const [isRowHovered, setIsRowHovered] = React.useState(false);
    const [isActionsHovered, setIsActionsHovered] = React.useState(false);
    const [menuOpen, setMenuOpen] = React.useState(false);
    const isWeb = Platform.OS === 'web';
    const showHoverActions = !isWeb || isRowHovered || isActionsHovered || menuOpen;
    const showChevron = !isWeb || collapsed || showHoverActions;
    const workspaceKey = item.workspaceKey ?? '';
    const reorderHandleKey = item.groupKey ?? workspaceKey;
    const customLabel = workspaceKey ? workspaceLabelsV1[workspaceKey] : undefined;
    const displayTitle = customLabel || item.title;
    const hasCustomLabel = Boolean(customLabel);
    const shouldUseStartEllipsis = !hasCustomLabel && isWeb;
    const nativeEllipsizeMode = !isWeb && !hasCustomLabel ? 'head' : 'tail';
    const actionIconColor = theme.colors.text.secondary;
    const checkouts = item.repository?.checkouts;
    const canCreateSession = typeof onCreateSession === 'function' && Boolean(item.workspaceScopeHint || checkouts?.length);
    const favicon = useWorkspaceFavicon({
        enabled: workspaceFaviconsEnabled,
        serverId: item.workspaceScopeHint?.serverId ?? item.serverId ?? null,
        machineId: item.workspaceScopeHint?.machineId ?? null,
        workspacePath: item.workspaceScopeHint?.rootPath ?? null,
    });

    const menuItems = React.useMemo((): DropdownMenuItem[] => {
        if (checkouts) {
            const checkoutItem = (checkout: RepositoryCheckout, index: number, action: string): DropdownMenuItem => ({
                id: `${action}:${index}`, title: checkout.machineLabel ?? checkout.machineId, subtitle: checkout.path,
            });
            const items: DropdownMenuItem[] = [
                { id: 'repository-new-session', title: t('machine.launchNewSessionInDirectory'), submenu: {
                    items: checkouts.map((checkout, index) => checkoutItem(checkout, index, 'repository-new-session')),
                } },
                { id: 'repository-add-folder', title: t('sessionsList.addFolder'), submenu: {
                    items: checkouts.map((checkout, index) => checkoutItem(checkout, index, 'repository-add-folder')),
                } },
                { id: 'repository-associate', title: t('sessionsList.repositoryAssociate'), submenu: {
                    items: checkouts.map((checkout, index) => ({
                        ...checkoutItem(checkout, index, 'repository-associate'),
                        submenu: { items: [
                            ...(menuOpen ? props.getRepositoryAssociationChoices?.(checkout) ?? [] : []).map(choice => ({
                                id: `repository-associate:${index}:choice:${encodeURIComponent(choice.identity)}`, title: choice.label,
                            })),
                            { id: `repository-associate:${index}:new`, title: t('sessionsList.repositoryNewGroup') },
                            { id: `repository-associate:${index}:automatic`, title: t('sessionsList.repositoryAutomatic') },
                        ] },
                    })),
                } },
            ];
            if (props.onMoveUp) items.push({ id: 'move-up', title: t('common.moveUp') });
            if (props.onMoveDown) items.push({ id: 'move-down', title: t('common.moveDown') });
            return items;
        }
        const items: DropdownMenuItem[] = [
            {
                id: 'add-folder',
                title: t('sessionsList.addFolder'),
                icon: <Icon name="folder-open" size={16} color={actionIconColor} />,
                disabled: !canCreateSession,
            },
            {
                id: 'rename',
                title: t('sessionsList.renameWorkspace'),
                icon: <Icon name="pencil" size={16} color={actionIconColor} />,
            },
        ];
        if (props.onMoveUp) items.push({ id: 'move-up', title: t('common.moveUp') });
        if (props.onMoveDown) items.push({ id: 'move-down', title: t('common.moveDown') });
        if (hasCustomLabel) {
            items.push({
                id: 'reset',
                title: t('sessionsList.resetWorkspaceName'),
                icon: <Icon name="arrow-clockwise" size={16} color={actionIconColor} />,
            });
        }
        return items;
    }, [checkouts, menuOpen, props.getRepositoryAssociationChoices, hasCustomLabel, actionIconColor, canCreateSession, props.onMoveUp, props.onMoveDown]);

    const handleMenuSelect = React.useCallback(async (itemId: string) => {
        if (itemId.startsWith('repository-')) {
            const [action, indexRaw, selection, encodedIdentity] = itemId.split(':');
            const checkout = checkouts?.[Number(indexRaw)];
            if (!checkout) return;
            if (action === 'repository-new-session') onCreateSession(checkout);
            else if (action === 'repository-add-folder') await onAddFolder(checkout);
            else if (action === 'repository-associate') {
                const choice = selection === 'new' ? 'new' : selection === 'automatic' ? null
                    : props.getRepositoryAssociationChoices?.(checkout).find(value => value.identity === decodeURIComponent(encodedIdentity ?? ''));
                if (choice !== undefined) await props.onAssociateRepository?.(checkout, choice);
            }
            return;
        }
        if (itemId === 'add-folder') {
            await onAddFolder();
        } else if (itemId === 'rename') {
            onRenameWorkspace(workspaceKey, displayTitle);
        } else if (itemId === 'move-up') {
            props.onMoveUp?.();
        } else if (itemId === 'move-down') {
            props.onMoveDown?.();
        } else if (itemId === 'reset') {
            onResetWorkspaceName(workspaceKey);
        }
    }, [checkouts, onCreateSession, props.getRepositoryAssociationChoices, props.onAssociateRepository, workspaceKey, displayTitle, onAddFolder, onRenameWorkspace, onResetWorkspaceName, props.onMoveUp, props.onMoveDown]);

    const chevronColor = theme.colors.text.secondary;
    return (
        <View style={styles.section}>
            <View
                style={styles.row}
                onPointerEnter={isWeb ? () => setIsRowHovered(true) : undefined}
                onPointerLeave={isWeb ? () => setIsRowHovered(false) : undefined}
            >
                <Pressable
                    style={styles.content}
                    onPress={onToggleCollapse}
                    testID={headerTestId}
                    accessibilityRole="button"
                    accessibilityLabel={displayTitle}
                    onHoverIn={isWeb ? () => setIsRowHovered(true) : undefined}
                    onHoverOut={isWeb ? () => setIsRowHovered(false) : undefined}
                >
                    <View style={styles.titleRow}>
                        {favicon ? (
                            <View testID="session-list-workspace-favicon" style={styles.faviconFrame}>
                                <Image
                                    source={{ uri: favicon.uri }}
                                    style={[workspaceFaviconImageStyle]}
                                    contentFit="cover"
                                    accessibilityIgnoresInvertColors
                                />
                            </View>
                        ) : null}
                        <Text
                            style={shouldUseStartEllipsis
                                ? [styles.title, styles.pathTitleWeb]
                                : styles.title}
                            numberOfLines={1}
                            ellipsizeMode={shouldUseStartEllipsis ? undefined : nativeEllipsizeMode}
                        >
                            {shouldUseStartEllipsis ? (
                                <Text style={styles.pathTitleTextWeb}>
                                    {displayTitle}
                                </Text>
                            ) : displayTitle}
                        </Text>
                        <View
                            style={styles.inlineActions}
                            onPointerEnter={isWeb ? () => setIsActionsHovered(true) : undefined}
                            onPointerLeave={isWeb ? () => setIsActionsHovered(false) : undefined}
                        >
                            <View
                                style={[
                                    styles.chevron,
                                    isWeb && !showChevron ? styles.hoverHiddenChevron : styles.hoverVisibleChevron,
                                ]}
                            >
                                <Icon
                                    name={collapsed ? 'caret-right' : 'caret-down'}
                                    size={14}
                                    color={chevronColor}
                                />
                            </View>
                        </View>
                    </View>
                    {workspaceMachineSubtitlesEnabled && hasMultipleMachines && item.subtitle ? (
                        <Text style={styles.subtitle}>{item.subtitle}</Text>
                    ) : null}
                </Pressable>
                <View style={styles.trailingActions}>
                    {props.reorderEnabled !== false && reorderHandleKey && props.dragHandleGesture ? (
                        <GestureDetector gesture={props.dragHandleGesture}>
                            <View
                                style={[styles.actionButton, webReorderHandleStyle]}
                                testID={`session-workspace-reorder-handle:${reorderHandleKey}`}
                                accessible={false}
                            >
                                <Icon name="list" size={14} color={actionIconColor} />
                            </View>
                        </GestureDetector>
                    ) : props.reorderEnabled !== false && showHoverActions && reorderHandleKey ? (
                        <Pressable
                            style={styles.actionButton}
                            testID={`session-workspace-reorder-handle:${reorderHandleKey}`}
                            accessible={false}
                            onPress={(event) => event?.stopPropagation?.()}
                            hitSlop={8}
                        >
                            <Icon name="list" size={14} color={actionIconColor} />
                        </Pressable>
                    ) : null}
                    {(showHoverActions || props.dragHandleGesture) && (workspaceKey || checkouts?.length) ? (
                        <DropdownMenu
                            open={menuOpen}
                            onOpenChange={setMenuOpen}
                            items={menuItems}
                            onSelect={handleMenuSelect}
                            placement="left"
                            variant="slim"
                            matchTriggerWidth={false}
                            maxWidthCap={220}
                            showCategoryTitles={false}
                            popoverPortalWebTarget="body"
                            trigger={({ toggle }) => (
                                <Pressable
                                    testID={`session-workspace-menu-trigger:${reorderHandleKey}`}
                                    style={styles.actionButton}
                                    onPress={(event) => {
                                        (event as any)?.stopPropagation?.();
                                        toggle();
                                    }}
                                    onHoverIn={isWeb ? () => setIsActionsHovered(true) : undefined}
                                    onHoverOut={isWeb ? () => setIsActionsHovered(false) : undefined}
                                    accessibilityRole="button"
                                    accessibilityLabel={t('common.moreActions')}
                                    hitSlop={8}
                                >
                                    <Icon name="dots-three" size={14} color={actionIconColor} />
                                </Pressable>
                            )}
                        />
                    ) : null}
                    {canCreateSession ? (
                        <Pressable
                            style={styles.actionButton}
                            onPress={(event) => {
                                (event as any)?.stopPropagation?.();
                                if (checkouts && checkouts.length > 1) setMenuOpen(true);
                                else onCreateSession(checkouts?.[0]);
                            }}
                            accessibilityRole="button"
                            accessibilityLabel={t('machine.launchNewSessionInDirectory')}
                            hitSlop={8}
                        >
                            <Icon name="plus" size={14} color={actionIconColor} />
                        </Pressable>
                    ) : null}
                </View>
            </View>
        </View>
    );
});
