import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import type { CustomModalInjectedProps } from '@/modal';
import { ItemList } from '@/components/ui/lists/ItemList';
import { PathSelectionList } from '@/components/sessions/new/components/PathSelectionList';
import { layout } from '@/components/ui/layout/layout';
import { machineMetadataPlatformToTarget } from '@/utils/path/machinePlatform';
import type { PathTargetPlatform } from '@/utils/path/browseSegments';
import { useAllMachines } from '@/sync/domains/state/storage';
import { useMachinePathPreferences } from '@/sync/domains/settings/useMachinePathPreferences';
import {
    resolveDirectoryFavoriteComparisonKey,
} from '@/components/sessions/new/hooks/favoriteDirectoriesToggle';

export type McpWorkspaceRootPickerModalProps = CustomModalInjectedProps & Readonly<{
    machineId?: string | null;
    serverId?: string | null;
    machineHomeDir: string;
    selectedPath: string;
    onSelectPath: (path: string) => void;
    /**
     * Optional machine platform override (e.g. when this modal is opened for a
     * Windows host but the local UI is on macOS). Defaults to `'auto'` — the
     * adapter will infer from input shape.
     */
    machinePlatform?: PathTargetPlatform | string | null;
}>;

const stylesheet = StyleSheet.create(() => ({
    contentWrapper: {
        width: '100%',
        maxWidth: layout.maxWidth,
        alignSelf: 'center',
    },
}));

export function McpWorkspaceRootPickerModal(props: McpWorkspaceRootPickerModalProps) {
    const styles = stylesheet;
    const machines = useAllMachines();
    const pathPreferences = useMachinePathPreferences({
        serverId: props.serverId,
        machineId: props.machineId,
        machines,
        machineHomeDir: props.machineHomeDir,
    });
    const favoriteDirectories = pathPreferences.favorites;

    const favoriteDirectoryKeys = React.useMemo(() => new Set(
        favoriteDirectories.map((entry) =>
            resolveDirectoryFavoriteComparisonKey(entry, props.machineHomeDir)
        ),
    ), [favoriteDirectories, props.machineHomeDir]);

    const resolvedPlatform: PathTargetPlatform = React.useMemo(() => {
        if (props.machinePlatform === 'unix' || props.machinePlatform === 'windows' || props.machinePlatform === 'auto') {
            return props.machinePlatform;
        }
        if (typeof props.machinePlatform === 'string') {
            return machineMetadataPlatformToTarget(props.machinePlatform);
        }
        return 'auto';
    }, [props.machinePlatform]);

    return (
        <ItemList style={{ paddingTop: 0 }} keyboardShouldPersistTaps="handled">
            <View style={styles.contentWrapper}>
                <PathSelectionList
                    initialValue={props.selectedPath}
                    favorites={favoriteDirectories.map((p) => ({ path: p }))}
                    unassignedFavorites={pathPreferences.unassignedFavorites}
                    onAssignUnassignedFavorite={(path) => { void pathPreferences.assignLegacyFavorite(path); }}
                    recents={[]}
                    machineHomeDir={props.machineHomeDir}
                    machineId={props.machineId ?? null}
                    serverId={props.serverId ?? null}
                    targetScopeKey={pathPreferences.targetKey}
                    machinePlatform={resolvedPlatform}
                    onCommit={(next) => {
                        props.onSelectPath(next);
                        props.onClose();
                    }}
                    onRequestClose={props.onClose}
                    isFavorite={(entry) => favoriteDirectoryKeys.has(
                        resolveDirectoryFavoriteComparisonKey(entry, props.machineHomeDir),
                    )}
                    onToggleFavorite={(entry) => { void pathPreferences.toggleFavorite(entry); }}
                />
            </View>
        </ItemList>
    );
}
