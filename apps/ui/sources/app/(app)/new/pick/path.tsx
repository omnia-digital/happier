import React, { useState, useMemo } from 'react';
import { View, Pressable, Platform } from 'react-native';
import { Stack, useRouter, useLocalSearchParams, useNavigation } from 'expo-router';
import { Typography } from '@/constants/Typography';
import { useActiveServerAccountScope, useAllMachines, useSessions } from '@/sync/domains/state/storage';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { t } from '@/text';
import { ItemList } from '@/components/ui/lists/ItemList';
import { useStableRecentPathsForMachine } from '@/utils/sessions/useStableRecentPathsForMachine';
import { Text } from '@/components/ui/text/Text';
import { safeRouterBack } from '@/utils/navigation/safeRouterBack';
import { NewSessionScreenPortalScope } from '@/components/sessions/new/navigation/newSessionContainedModalScreen';
import { buildNewSessionPickerFallbackHref, setNewSessionPickerReturnParams } from '@/components/sessions/new/navigation/setNewSessionPickerReturnParams';
import { NewSessionPathSelectionContent } from '@/components/sessions/new/components/NewSessionPathSelectionContent';
import { useMachinePathPreferences } from '@/sync/domains/settings/useMachinePathPreferences';
import { machineMetadataPlatformToTarget } from '@/utils/path/machinePlatform';
import { Icon } from '@/components/ui/icons/Icon';


export default React.memo(function PathPickerScreen() {
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const router = useRouter();
    const navigation = useNavigation();
    const params = useLocalSearchParams<{
        dataId?: string;
        draftId?: string;
        machineId?: string;
        selectedPath?: string;
        directory?: string;
        path?: string;
        spawnServerId?: string;
    }>();
    const pickerFallbackHref = React.useMemo(() => buildNewSessionPickerFallbackHref(params), [params]);
    const machines = useAllMachines();
    const sessions = useSessions();
    const activeScope = useActiveServerAccountScope();

    const initialPath = typeof params.selectedPath === 'string' && params.selectedPath.length > 0
        ? params.selectedPath
        : (typeof params.directory === 'string' && params.directory.length > 0
            ? params.directory
            : (typeof params.path === 'string' ? params.path : ''));
    const [customPath, setCustomPathState] = useState(initialPath);
    const customPathRef = React.useRef(customPath);
    const setCustomPath = React.useCallback((next: string) => {
        customPathRef.current = next;
        setCustomPathState(next);
    }, []);
    React.useEffect(() => {
        customPathRef.current = initialPath;
        setCustomPathState(initialPath);
    }, [initialPath]);

    // Get the selected machine
    const machine = useMemo(() => {
        return machines.find(m => m.id === params.machineId);
    }, [machines, params.machineId]);

    const machineHomeDir = machine?.metadata?.homeDir || '/home';
    const pathPreferences = useMachinePathPreferences({
        serverId: params.spawnServerId,
        machineId: machine?.id ?? null,
        machines,
        machineHomeDir,
    });
    const favoriteDirectories = pathPreferences.favorites;

    const onToggleFavoriteDirectory = React.useCallback((absolutePath: string) => {
        void pathPreferences.toggleFavorite(absolutePath);
    }, [pathPreferences.toggleFavorite]);

    // Get recent paths for this machine - prioritize from settings, then fall back to sessions
    const recentPaths = useStableRecentPathsForMachine({
        machineId: params.machineId,
        recentMachinePaths: pathPreferences.target
            ? pathPreferences.recents.map((path) => ({ machineId: pathPreferences.target!.machineId, path }))
            : [],
        sessions: pathPreferences.target?.serverId === activeScope?.serverId
            && pathPreferences.target?.accountId === activeScope?.accountId ? sessions : null,
        cacheScopeKey: pathPreferences.targetKey,
    });


    const handleSelectPath = React.useCallback((pathOverride?: string) => {
        const rawPath = typeof pathOverride === 'string' ? pathOverride : customPathRef.current;
        const pathToUse = rawPath.trim() || machineHomeDir;
        const dataId = typeof params.dataId === 'string' ? params.dataId : undefined;
        const draftId = typeof params.draftId === 'string' ? params.draftId : undefined;
        const spawnServerId = typeof params.spawnServerId === 'string' && params.spawnServerId.trim().length > 0
            ? params.spawnServerId
            : undefined;
        const returnMode = setNewSessionPickerReturnParams({
            navigation,
            router,
            routeParams: { directory: pathToUse },
            replaceParams: {
                ...(dataId ? { dataId } : {}),
                ...(draftId ? { draftId } : {}),
                machineId: params.machineId,
                directory: pathToUse,
                ...(spawnServerId ? { spawnServerId } : {}),
            },
        });
        if (returnMode === 'dispatch') {
            safeRouterBack({ router, navigation, fallbackHref: pickerFallbackHref });
        }
    }, [machineHomeDir, navigation, params.dataId, params.draftId, params.machineId, params.spawnServerId, pickerFallbackHref, router]);

    const handleBackPress = React.useCallback(() => {
        safeRouterBack({ router, navigation, fallbackHref: pickerFallbackHref });
    }, [navigation, pickerFallbackHref, router]);
    const headerTitle = t('newSession.selectPathTitle');
    const headerBackTitle = t('common.back');

    const headerLeft = React.useCallback(() => {
        return (
            <Pressable
                onPress={handleBackPress}
                hitSlop={10}
                style={({ pressed }) => ({
                    marginLeft: 10,
                    opacity: pressed ? 0.7 : 1,
                    padding: 4,
                })}
            >
                <Icon name="caret-left" size={20} color={theme.colors.chrome.header.foreground} />
            </Pressable>
        );
    }, [handleBackPress, theme.colors.chrome.header.foreground]);

    // NOTE: Keep the header actions stable across keystrokes.
    // On iOS containedModal, frequently re-creating `headerRight` as the user types can cause
    // the picker to dismiss/re-present (losing the in-progress TextInput value).
    // The confirm action is safe even when the input is empty because we fall back to homeDir.
    const headerRight = React.useCallback(() => {
        return (
            <Pressable
                testID="new-session-path-picker-confirm"
                onPress={() => handleSelectPath()}
                style={({ pressed }) => ({
                    opacity: pressed ? 0.7 : 1,
                    padding: 4,
                })}
            >
                <Icon
                    name="check"
                    size={24}
                    color={theme.colors.chrome.header.foreground}
                />
            </Pressable>
        );
    }, [handleSelectPath, theme.colors.chrome.header.foreground]);

    const screenOptions = React.useMemo(() => {
        return {
            headerShown: true,
            title: headerTitle,
            headerTitle,
            headerBackTitle,
            presentation: Platform.OS === 'ios' ? 'containedModal' : undefined,
            headerLeft,
            headerRight,
        } as const;
    }, [headerBackTitle, headerLeft, headerRight, headerTitle]);

    if (!machine) {
        return (
            <NewSessionScreenPortalScope>
                <Stack.Screen
                    options={screenOptions}
                />
                <ItemList>
                    <View style={styles.emptyContainer}>
                        <Text style={styles.emptyText}>{t('newSession.noMachineSelected')}</Text>
                    </View>
                </ItemList>
            </NewSessionScreenPortalScope>
        );
    }

    return (
        <NewSessionScreenPortalScope>
            <Stack.Screen
                options={screenOptions}
            />
            <NewSessionPathSelectionContent
                machineHomeDir={machineHomeDir}
                selectedPath={customPath}
                onCommit={(next) => {
                    setCustomPath(next);
                    handleSelectPath(next);
                }}
                recentPaths={recentPaths}
                favoriteDirectories={favoriteDirectories}
                unassignedFavorites={pathPreferences.unassignedFavorites}
                onAssignUnassignedFavorite={(path) => { void pathPreferences.assignLegacyFavorite(path); }}
                onToggleFavoriteDirectory={onToggleFavoriteDirectory}
                machineId={machine.id}
                serverId={typeof params.spawnServerId === 'string' && params.spawnServerId.length > 0 ? params.spawnServerId : null}
                targetScopeKey={pathPreferences.targetKey}
                browserIdentity={pathPreferences.browserIdentity}
                machinePlatform={machineMetadataPlatformToTarget(machine.metadata?.platform)}
            />
        </NewSessionScreenPortalScope>
    );
});

const stylesheet = StyleSheet.create((theme) => ({
    emptyContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
    },
    emptyText: {
        fontSize: 16,
        color: theme.colors.text.secondary,
        textAlign: 'center',
        ...Typography.default(),
    },
}));
