import * as React from 'react';
import { Platform, Pressable, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import type { CustomModalInjectedProps } from '@/modal';
import { useModalCardChrome } from '@/modal/components/card/useModalCardChrome';
import { t } from '@/text';
import { Text } from '@/components/ui/text/Text';
import { useAllMachines, useMachineListByServerId, useSessionListViewData, useSessionListViewDataByServerId } from '@/sync/store/hooks';
import { useResolvedActiveServerSelection } from '@/hooks/server/useEffectiveServerSelection';
import { resolveSessionListSourceData } from '@/sync/domains/session/listing/sessionListPresentation';
import type { SessionListViewItem } from '@/sync/domains/session/listing/sessionListViewData';
import type { NavigateToSessionOptions } from '@/hooks/session/useNavigateToSession';
import { sync } from '@/sync/sync';
import { fetchRemainingSelectedServerSessions } from '@/sync/runtime/orchestration/concurrentSessionCache';
import { useFeatureEnabled } from '@/hooks/server/useFeatureEnabled';
import { listServerProfiles, resolveServerProfileScopeId } from '@/sync/domains/server/serverProfiles';
import { useMemorySearchOnMachine } from '@/components/sessions/memorySearch/useMemorySearchOnMachine';
import { getSessionDisplayTitle } from '@/utils/sessions/sessionUtils';

import { CommandPaletteInput } from './CommandPaletteInput';
import { CommandPaletteResults } from './CommandPaletteResults';
import { useCommandPalette } from './useCommandPalette';
import { Command } from './types';

export type CommandPaletteProps = CustomModalInjectedProps & Readonly<{
    commands: Command[];
    navigateToSession: (sessionId: string, options?: NavigateToSessionOptions) => void | Promise<void>;
}>;

const stylesheet = StyleSheet.create((theme) => ({
    body: {
        flex: 1,
        minHeight: 0,
        width: '100%',
    },
    searchScope: {
        color: theme.colors.text.secondary,
        paddingHorizontal: 32,
        paddingTop: 10,
    },
    modeRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        paddingHorizontal: 32,
        paddingTop: 12,
    },
    modeButton: {
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 8,
        backgroundColor: theme.colors.surface.inset,
    },
    modeButtonSelected: {
        backgroundColor: theme.colors.surface.pressedOverlay,
    },
}));

export function CommandPalette(props: CommandPaletteProps) {
    useUnistyles();
    const styles = stylesheet;
    const title = t('settingsFeatures.commandPalette');
    const chrome = React.useMemo(() => ({
        kind: 'card' as const,
        title,
        testID: 'command-palette:modal',
        closeButtonTestID: 'command-palette:close',
        layout: 'fill' as const,
        dimensions: {
            width: 800,
            maxHeightRatio: 0.6,
            size: 'lg' as const,
        },
    }), [title]);

    useModalCardChrome(props.setChrome, chrome);

    const selection = useResolvedActiveServerSelection();
    const memorySearchEnabled = useFeatureEnabled('memory.search');
    const activeData = useSessionListViewData();
    const byServerId = useSessionListViewDataByServerId(selection.enabled ? selection.allowedServerIds : []);
    const activeMachines = useAllMachines();
    const machinesByServerId = useMachineListByServerId();
    const [searchMode, setSearchMode] = React.useState<'titles' | 'content'>('titles');
    const [searchQuery, setSearchQuery] = React.useState('');
    const [contentServerId, setContentServerId] = React.useState('');
    const [contentMachineId, setContentMachineId] = React.useState('');
    const sessionItems = React.useMemo(() => {
        const source = resolveSessionListSourceData({
            enabled: selection.enabled,
            activeServerId: selection.activeServerId,
            activeData,
            byServerId,
            selectedServerIds: selection.allowedServerIds,
        });
        return source?.filter((item): item is Extract<SessionListViewItem, { type: 'session' }> =>
            item.type === 'session' && item.session.archivedAt == null,
        ) ?? [];
    }, [activeData, byServerId, selection.activeServerId, selection.allowedServerIds, selection.enabled]);

    const serverChoices = React.useMemo(() => {
        const profiles = listServerProfiles();
        const serverIds = selection.allowedServerIds.length > 0
            ? selection.allowedServerIds
            : [selection.activeServerId];
        return serverIds.filter(Boolean).map((id) => {
            const profile = profiles.find((candidate) => resolveServerProfileScopeId(candidate) === id);
            return { id, name: profile?.name?.trim() || profile?.serverUrl || id };
        });
    }, [selection.activeServerId, selection.allowedServerIds]);
    const contentServerAllowed = serverChoices.some((choice) => choice.id === contentServerId);
    const contentServerName = serverChoices.find((choice) => choice.id === contentServerId)?.name ?? contentServerId;
    const contentMachines = contentServerId === selection.activeServerId
        ? activeMachines
        : machinesByServerId[contentServerId] ?? [];
    const selectedMachine = contentMachines.find((machine) => machine.id === contentMachineId);
    const contentMachineName = selectedMachine?.metadata?.displayName || selectedMachine?.metadata?.host || contentMachineId;
    const {
        memoryStatusLoading, memorySearchUsable, runState: contentRunState,
        hits: contentHits, errorCode: contentErrorCode,
    } = useMemorySearchOnMachine({
        enabled: memorySearchEnabled && searchMode === 'content' && contentServerAllowed && Boolean(selectedMachine),
        serverId: contentServerAllowed ? contentServerId : '',
        machineId: selectedMachine ? contentMachineId : '',
        autoQuery: searchMode === 'content' ? searchQuery : undefined,
    });

    const contentCommands = React.useMemo((): Command[] => {
        if (searchMode !== 'content' || !memorySearchEnabled) return [];
        if (!contentServerAllowed) {
            return serverChoices.map((server) => ({
                id: `content-home:${server.id}`,
                title: server.name,
                subtitle: t('commandPalette.contentHomeSubtitle'),
                category: t('commandPalette.contentHomesCategory'),
                keepOpen: true,
                action: () => { setContentServerId(server.id); setContentMachineId(''); },
            }));
        }
        if (!selectedMachine) {
            return contentMachines.map((machine) => ({
                id: `content-machine:${contentServerId}:${machine.id}`,
                title: machine.metadata?.displayName || machine.metadata?.host || machine.id,
                subtitle: t('commandPalette.contentMachineSubtitle', { home: contentServerName }),
                category: t('commandPalette.contentMachinesCategory'),
                keepOpen: true,
                action: () => { setContentMachineId(machine.id); },
            }));
        }
        if (contentRunState !== 'ready') return [];
        return contentHits.map((hit, index) => {
            const row = sessionItems.find((item) => item.serverId === contentServerId && item.session.id === hit.sessionId);
            const title = (row && getSessionDisplayTitle(row.session)) || `Session ${hit.sessionId.slice(0, 8)}`;
            return {
                id: `content-hit:${contentServerId}:${contentMachineId}:${hit.sessionId}:${hit.seqFrom}:${index}`,
                title,
                subtitle: t('commandPalette.contentSummary', { summary: hit.summary, machine: contentMachineName, seq: hit.seqFrom }),
                category: t('commandPalette.contentMessagesCategory'),
                action: () => props.navigateToSession(hit.sessionId, { serverId: contentServerId, query: { jumpSeq: hit.seqFrom } }),
            };
        });
    }, [searchMode, memorySearchEnabled, contentServerAllowed, serverChoices, selectedMachine, contentMachines, contentServerId, contentServerName, contentRunState, contentHits, contentMachineId, contentMachineName, sessionItems, props.navigateToSession]);

    const {
        selectedIndex,
        filteredCategories,
        inputRef,
        handleSearchChange,
        handleSelectCommand,
        handleKeyPress,
        setSelectedIndex,
    } = useCommandPalette(props.commands, props.onClose, sessionItems, selection.activeServerId, props.navigateToSession, searchQuery, setSearchQuery, searchMode, contentCommands);

    const [historySearchFailed, setHistorySearchFailed] = React.useState(false);
    const searchDemanded = searchMode === 'titles' && searchQuery.trim().length > 0;
    const sessionListReady = activeData !== null;
    const selectedForeignServerIds = selection.enabled
        ? selection.allowedServerIds.filter((id) => id !== selection.activeServerId)
        : [];
    const selectedForeignServerKey = selectedForeignServerIds.join('\u0000');
    const selectedForeignReady = selectedForeignServerIds.every((id) => byServerId[id] !== undefined);
    React.useEffect(() => {
        if (!searchDemanded || !sessionListReady) {
            setHistorySearchFailed(false);
            return;
        }
        let active = true;
        setHistorySearchFailed(false);
        void sync.fetchRemainingSessions(() => active).catch((error) => {
            if (!active) return;
            console.error('[CommandPalette] Could not load older session titles', error);
            setHistorySearchFailed(true);
        });
        return () => { active = false; };
    }, [searchDemanded, selection.activeServerId, sessionListReady]);
    React.useEffect(() => {
        if (!searchDemanded || !selectedForeignReady || !selectedForeignServerKey) return;
        let active = true;
        void fetchRemainingSelectedServerSessions(selectedForeignServerKey.split('\u0000'), () => active).catch((error) => {
            if (!active) return;
            console.error('[CommandPalette] Could not load older selected-server titles', error);
            setHistorySearchFailed(true);
        });
        return () => { active = false; };
    }, [searchDemanded, selectedForeignReady, selectedForeignServerKey]);

    // Only render on web
    if (Platform.OS !== 'web') {
        return null;
    }

    const contentScope = !contentServerAllowed
        ? t('commandPalette.contentChooseHome')
        : !selectedMachine
            ? t('commandPalette.contentChooseMachine', { home: contentServerName })
            : memoryStatusLoading
                ? t('commandPalette.contentCheckingIndex', { home: contentServerName, machine: contentMachineName })
                : !memorySearchUsable
                    ? t('commandPalette.contentIndexUnavailable', { home: contentServerName, machine: contentMachineName })
                    : contentRunState === 'loading'
                        ? t('commandPalette.contentSearching', { home: contentServerName, machine: contentMachineName })
                        : contentRunState === 'error'
                            ? t('commandPalette.contentSearchFailed', { home: contentServerName, machine: contentMachineName })
                            : contentRunState === 'ready' && contentHits.length === 0
                                ? t('commandPalette.contentNoResults', { home: contentServerName, machine: contentMachineName })
                                : t('commandPalette.contentScope', { home: contentServerName, machine: contentMachineName });

    const switchMode = (mode: 'titles' | 'content') => {
        setSearchMode(mode);
        setSearchQuery('');
        setSelectedIndex(0);
        inputRef.current?.focus();
    };
    const changeContentScope = (changeHome: boolean) => {
        if (changeHome) setContentServerId('');
        setContentMachineId('');
        setSearchQuery('');
        setSelectedIndex(0);
        inputRef.current?.focus();
    };

    return (
        <View style={styles.body}>
            {memorySearchEnabled ? <View style={styles.modeRow}>
                <Pressable
                    testID="command-palette:title-mode"
                    accessibilityRole="button"
                    accessibilityState={{ selected: searchMode === 'titles' }}
                    onPress={() => switchMode('titles')}
                    style={[styles.modeButton, searchMode === 'titles' && styles.modeButtonSelected]}
                >
                    <Text>{t('commandPalette.titleMode')}</Text>
                </Pressable>
                <Pressable
                    testID="command-palette:content-mode"
                    accessibilityRole="button"
                    accessibilityState={{ selected: searchMode === 'content' }}
                    onPress={() => switchMode('content')}
                    style={[styles.modeButton, searchMode === 'content' && styles.modeButtonSelected]}
                >
                    <Text>{t('commandPalette.contentMode')}</Text>
                </Pressable>
                {searchMode === 'content' && contentServerAllowed ? <Pressable
                    testID="command-palette:change-home"
                    accessibilityRole="button"
                    onPress={() => changeContentScope(true)}
                    style={styles.modeButton}
                >
                    <Text>{t('commandPalette.contentChangeHome')}</Text>
                </Pressable> : null}
                {searchMode === 'content' && selectedMachine ? <Pressable
                    testID="command-palette:change-machine"
                    accessibilityRole="button"
                    onPress={() => changeContentScope(false)}
                    style={styles.modeButton}
                >
                    <Text>{t('commandPalette.contentChangeMachine')}</Text>
                </Pressable> : null}
            </View> : null}
            <CommandPaletteInput
                value={searchQuery}
                onChangeText={handleSearchChange}
                onKeyPress={handleKeyPress}
                inputRef={inputRef}
                autoFocus={true}
            />
            {searchDemanded ? <Text testID="command-palette:search-scope" style={styles.searchScope}>
                {t(historySearchFailed ? 'commandPalette.searchUnavailable' : 'commandPalette.searchScope')}
            </Text> : null}
            {searchMode === 'content' ? <Text testID="command-palette:content-scope" style={styles.searchScope}>
                {contentScope}
            </Text> : null}
            <CommandPaletteResults
                categories={filteredCategories}
                selectedIndex={selectedIndex}
                onSelectCommand={handleSelectCommand}
                onSelectionChange={setSelectedIndex}
            />
        </View>
    );
}
