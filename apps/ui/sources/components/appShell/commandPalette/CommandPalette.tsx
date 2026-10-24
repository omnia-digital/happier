import * as React from 'react';
import { Platform, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import type { CustomModalInjectedProps } from '@/modal';
import { useModalCardChrome } from '@/modal/components/card/useModalCardChrome';
import { t } from '@/text';
import { Text } from '@/components/ui/text/Text';
import { useSessionListViewData, useSessionListViewDataByServerId } from '@/sync/store/hooks';
import { useResolvedActiveServerSelection } from '@/hooks/server/useEffectiveServerSelection';
import { resolveSessionListSourceData } from '@/sync/domains/session/listing/sessionListPresentation';
import type { SessionListViewItem } from '@/sync/domains/session/listing/sessionListViewData';
import type { NavigateToSessionOptions } from '@/hooks/session/useNavigateToSession';
import { sync } from '@/sync/sync';

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
    const activeData = useSessionListViewData();
    const byServerId = useSessionListViewDataByServerId(selection.enabled ? selection.allowedServerIds : []);
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

    const {
        searchQuery,
        selectedIndex,
        filteredCategories,
        inputRef,
        handleSearchChange,
        handleSelectCommand,
        handleKeyPress,
        setSelectedIndex,
    } = useCommandPalette(props.commands, props.onClose, sessionItems, selection.activeServerId, props.navigateToSession);

    const [historySearchFailed, setHistorySearchFailed] = React.useState(false);
    const searchDemanded = searchQuery.trim().length > 0;
    const sessionListReady = activeData !== null;
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

    // Only render on web
    if (Platform.OS !== 'web') {
        return null;
    }

    return (
        <View style={styles.body}>
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
            <CommandPaletteResults
                categories={filteredCategories}
                selectedIndex={selectedIndex}
                onSelectCommand={handleSelectCommand}
                onSelectionChange={setSelectedIndex}
            />
        </View>
    );
}
