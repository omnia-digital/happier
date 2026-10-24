/**
 * NewSessionPathSelectionContent — popover-shaped wrapper around the new
 * `PathSelectionList` adapter. Used by both the agent-input path popover (via
 * the popover's `renderContent`) and the dedicated new-session path picker
 * screen.
 *
 * Migration note (Phase 11.4): this file previously rendered the legacy
 * `PathSelector` with the search field below the input. SelectionList unifies the
 * input + search into a single field, so the "below input" search header is
 * not part of the new model — fuzzy filtering happens through the same input
 * that types paths. Callers no longer need to pass `searchQuery` /
 * `onChangeSearchQuery` / legacy picker-search props. Other survival
 * behaviors (favorites, recents, machine-aware browse, pre-browse hook) are
 * preserved end-to-end.
 */

import * as React from 'react';
import type { MachineFileBrowserIdentity } from '@/sync/domains/input/machineFileBrowser';
import { View, type ViewStyle } from 'react-native';

import { layout } from '@/components/ui/layout/layout';
import { resolvePopoverSelectionListHeightBehavior } from '@/components/ui/selectionList';
import {
    normalizeDirectoryFavoritePaths,
    resolveDirectoryFavoriteComparisonKey,
    toggleHomeAwareDirectoryFavorite,
} from '@/components/sessions/new/hooks/favoriteDirectoriesToggle';
import type { PathTargetPlatform } from '@/utils/path/browseSegments';

import { PathSelectionList } from './PathSelectionList';
import type { PathSelectionInitialSuggestionMode } from './createPathSelectionInputBehavior';

export type NewSessionPathSelectionContentProps = Readonly<{
    machineHomeDir: string;
    /** Current absolute (or `~/`-relative) path that seeds the picker input. */
    selectedPath: string;
    /**
     * Popover callers use history-first so opening the path chip shows saved
     * locations before machine folder suggestions. Dedicated picker surfaces
     * omit this to preserve direct browse-from-selected-path behavior.
     */
    initialSuggestionMode?: PathSelectionInitialSuggestionMode;
    /** Called when the user commits a path (Enter, row tap, or browse modal). */
    onCommit: (path: string) => void;
    /** Called while the user edits the path input, before commit closes the popover. */
    onChangeDraftSelectedPath?: (path: string) => void;
    recentPaths: ReadonlyArray<string>;
    favoriteDirectories: ReadonlyArray<string>;
    unassignedFavorites?: ReadonlyArray<string>;
    onAssignUnassignedFavorite?: (path: string) => void;
    machineId: string | null;
    serverId?: string | null;
    targetScopeKey?: string | null;
    browserIdentity?: MachineFileBrowserIdentity | null;
    /** Machine platform (NEVER `navigator.platform`). Defaults to 'auto'. */
    machinePlatform?: PathTargetPlatform;
    onRequestClose?: () => void;
    onBeforeBrowseMachinePath?: () => void | Promise<void>;
    /**
     * RUX-3: when provided, every path row (favorites, recents, in-folder)
     * exposes a star-toggle button that flips its membership in
     * `favoriteDirectories`. Receives the absolute path. The orchestrator is
     * responsible for persisting via `useSettingMutable('favoriteDirectories')`.
     */
    onToggleFavoriteDirectory?: (absolutePath: string) => void;
    /**
     * RUX-8: forwarded to `PathSelectionList` (then to `SelectionList`) so the
     * popover body clamps to the available height (header + body + footer fit
     * inside `maxHeight`). When omitted (e.g. full-screen embed in
     * `/new/pick/path`), the list is unconstrained.
     */
    maxHeight?: number;
}>;

export function NewSessionPathSelectionContent(props: NewSessionPathSelectionContentProps) {
    const [optimisticFavoriteDirectories, setOptimisticFavoriteDirectories] = React.useState<ReadonlyArray<string>>(
        () => normalizeDirectoryFavoritePaths(props.favoriteDirectories, props.machineHomeDir),
    );
    React.useEffect(() => {
        setOptimisticFavoriteDirectories((current) => {
            const next = normalizeDirectoryFavoritePaths(
                props.favoriteDirectories,
                props.machineHomeDir,
            );
            if (current.length === next.length && current.every((entry, index) => entry === next[index])) {
                return current;
            }
            return next;
        });
    }, [props.favoriteDirectories, props.machineHomeDir]);

    const visibleFavoriteDirectories = React.useMemo(
        () => normalizeDirectoryFavoritePaths(optimisticFavoriteDirectories, props.machineHomeDir),
        [optimisticFavoriteDirectories, props.machineHomeDir],
    );
    const favorites = React.useMemo(
        () => visibleFavoriteDirectories.map((path) => ({ path })),
        [visibleFavoriteDirectories],
    );

    // The legacy hook did not track per-row `lastUsedAt`; the recents array is
    // already ordered by recency, so synthesize a monotonically descending
    // pseudo-timestamp from the order. Consumers that need real timestamps can
    // pass them through `useNewSessionMachinePathState` updates in the future
    // (Lane H follow-up).
    //
    // R16d (Fix 3): the seed is captured ONCE on first render via useRef so
    // the synthesized `lastUsedAt` values stay stable across rerenders, even
    // when the parent rebuilds the `recentPaths` array on every render. A
    // fresh `Date.now()` per render churns the recents identity downstream
    // and feeds the resolver-identity invalidation cycle (R16a).
    const synthesizedSeedRef = React.useRef<number>(Date.now());
    const favoriteAbsolutePaths = React.useMemo(() => {
        const set = new Set<string>();
        for (const entry of visibleFavoriteDirectories) {
            set.add(resolveDirectoryFavoriteComparisonKey(entry, props.machineHomeDir));
        }
        return set;
    }, [visibleFavoriteDirectories, props.machineHomeDir]);

    const recents = React.useMemo(() => {
        const seed = synthesizedSeedRef.current;
        const seenRecentPaths = new Set<string>();
        return props.recentPaths
            .filter((p) => typeof p === 'string' && p.trim().length > 0)
            .filter((path) => {
                const comparisonKey = resolveDirectoryFavoriteComparisonKey(path, props.machineHomeDir);
                if (favoriteAbsolutePaths.has(comparisonKey)) return false;
                if (seenRecentPaths.has(comparisonKey)) return false;
                seenRecentPaths.add(comparisonKey);
                return true;
            })
            .map((p, index) => ({ path: p, lastUsedAt: seed - index }));
    }, [favoriteAbsolutePaths, props.machineHomeDir, props.recentPaths]);

    // R6 Fix 2: do NOT wrap the path picker in an ItemList. The SelectionList
    // primitive owns its outer popover chrome (background, radius, max-height);
    // wrapping it in an ItemList card produced a settings-list "card inside a
    // list" feel that broke the premium command-bar aesthetic. The flat
    // contentWrapper is enough to apply layout width constraints.
    // RUX-3: build a Set of absolute favorite paths once per favorites change so
    // the per-row predicate is O(1) and stable. The orchestrator owns the
    // persistence API; this component also keeps an optimistic local copy so
    // the open popover updates immediately while settings sync catches up.
    const isFavorite = React.useCallback(
        (absolutePath: string) => favoriteAbsolutePaths.has(
            resolveDirectoryFavoriteComparisonKey(absolutePath, props.machineHomeDir),
        ),
        [favoriteAbsolutePaths, props.machineHomeDir],
    );

    const onToggleFavoriteDirectory = props.onToggleFavoriteDirectory;
    const onToggleFavorite = React.useMemo(() => {
        if (!onToggleFavoriteDirectory) return undefined;
        return (absolutePath: string) => {
            setOptimisticFavoriteDirectories((current) => toggleHomeAwareDirectoryFavorite(
                current,
                absolutePath,
                props.machineHomeDir,
            ));
            onToggleFavoriteDirectory(absolutePath);
        };
    }, [onToggleFavoriteDirectory, props.machineHomeDir]);

    return (
        <View style={styles.contentWrapper}>
            <PathSelectionList
                initialValue={props.selectedPath}
                initialSuggestionMode={props.initialSuggestionMode}
                favorites={favorites}
                unassignedFavorites={props.unassignedFavorites}
                onAssignUnassignedFavorite={props.onAssignUnassignedFavorite}
                recents={recents}
                machineHomeDir={props.machineHomeDir}
                machineId={props.machineId}
                serverId={props.serverId ?? null}
                targetScopeKey={props.targetScopeKey}
                browserIdentity={props.browserIdentity}
                machinePlatform={props.machinePlatform ?? 'auto'}
                onCommit={props.onCommit}
                onChangeDraftPath={props.onChangeDraftSelectedPath}
                onRequestClose={props.onRequestClose ?? (() => {})}
                onBeforeBrowseMachinePath={props.onBeforeBrowseMachinePath}
                isFavorite={onToggleFavorite ? isFavorite : undefined}
                onToggleFavorite={onToggleFavorite}
                maxHeight={props.maxHeight}
                heightBehavior={
                    props.maxHeight === undefined
                        ? undefined
                        : resolvePopoverSelectionListHeightBehavior('stabilizedContentHeight')
                }
            />
        </View>
    );
}

const styles = {
    contentWrapper: {
        width: '100%' as const,
        maxWidth: layout.maxWidth,
        alignSelf: 'center' as const,
    } satisfies ViewStyle,
};
