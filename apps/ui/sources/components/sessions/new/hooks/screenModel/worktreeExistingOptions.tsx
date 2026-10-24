import * as React from 'react';
import { View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import {
    type SelectionListOption,
    type SelectionListStatusVariant,
} from '@/components/ui/selectionList';
import { StatusPill as BaseStatusPill, type StatusPillVariant } from '@/components/ui/status/StatusPill';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';

import { buildWorktreeCheckoutOptionId } from '@/components/sessions/new/modules/worktreeCheckoutOptionId';

import { NEW_SESSION_WORKTREE_STALE_THRESHOLD_MS } from './_constants';
import { pathsAreSameWorktree } from './worktreePathComparison';
import type { WorktreeSelectionListBuilderParams } from './buildWorktreeSelectionListSteps';
import { Icon } from '@/components/ui/icons/Icon';

const WORKTREE_ROW_ICON_SIZE = 16;

function formatWorktreeRelativeAge(atMs: number, nowMs: number): string {
    const elapsedMs = Math.max(0, nowMs - atMs);
    const minuteMs = 60_000;
    const hourMs = 60 * minuteMs;
    const dayMs = 24 * hourMs;
    if (elapsedMs < minuteMs) return t('time.nowShort');
    if (elapsedMs < hourMs) return t('time.minutesAgoShort', { count: Math.floor(elapsedMs / minuteMs) });
    if (elapsedMs < dayMs) return t('time.hoursAgoShort', { count: Math.floor(elapsedMs / hourMs) });
    return t('time.daysAgoShort', { count: Math.floor(elapsedMs / dayMs) });
}

function WorktreeRelativeTimeText(props: Readonly<{
    atMs: number;
    nowMs: number;
    testID?: string;
}>): React.ReactElement {
    const { theme } = useUnistyles();
    return (
        <Text
            testID={props.testID}
            style={[Typography.tabular(), { color: theme.colors.text.secondary }]}
        >
            {formatWorktreeRelativeAge(props.atMs, props.nowMs)}
        </Text>
    );
}

const STATUS_VARIANT_MAP: Readonly<Record<SelectionListStatusVariant, StatusPillVariant>> = {
    clean: 'success',
    dirty: 'warning',
    stale: 'neutral',
    info: 'info',
    neutral: 'neutral',
};

function WorktreeStatusPill(props: Readonly<{
    variant: SelectionListStatusVariant;
    label: string;
    count?: number;
    testID?: string;
}>): React.ReactElement {
    return (
        <BaseStatusPill
            variant={STATUS_VARIANT_MAP[props.variant]}
            label={props.label}
            count={props.count}
            testID={props.testID}
            variantTestID={props.testID ? `${props.testID}:variant:${props.variant}` : undefined}
        />
    );
}

/**
 * Pure derivation: status variant for a worktree row.
 *
 * Returns `null` when:
 *   - The SCM provided neither field (back-compat with older snapshots that don't carry
 *     status enrichment), OR
 *   - `changeCount` is undefined regardless of `lastActivityAt` (FR4-5).
 *
 * The FR4-5 rule is essential when `git status --porcelain -z` fails while `git log` succeeds
 * for the same worktree: without it, we'd render a misleading clean/stale pill despite the
 * dirty state being unknown. The age accessory (`RelativeTimeText`) stays independent and may
 * still render — age is meaningful even when the status pill is suppressed.
 */
export function resolveWorktreeStatusVariant(args: Readonly<{
    changeCount: number | undefined;
    lastActivityAt: number | undefined;
    nowMs: number;
}>): SelectionListStatusVariant | null {
    if (args.changeCount === undefined) {
        return null;
    }
    if (args.changeCount > 0) return 'dirty';
    if (
        args.lastActivityAt !== undefined
        && args.nowMs - args.lastActivityAt > NEW_SESSION_WORKTREE_STALE_THRESHOLD_MS
    ) {
        return 'stale';
    }
    return 'clean';
}

export function buildExistingWorktreeOptions(
    params: WorktreeSelectionListBuilderParams,
): ReadonlyArray<SelectionListOption> {
    const worktrees = params.snapshot?.repo.worktrees ?? [];
    return worktrees
        .filter((worktree) => {
            if (worktree.isMain === true) return false;
            // No Worktree owns the main repository path. A selected non-main
            // checkout is still an Existing Worktree and remains selectable on
            // reopen (notably when configuring a fork from that checkout).
            return !pathsAreSameWorktree(worktree.path, params.currentDirPath, params.machineHomeDir);
        })
        .map((worktree) => {
            const label = worktree.branch ?? worktree.path;
            const variant = resolveWorktreeStatusVariant({
                changeCount: worktree.changeCount,
                lastActivityAt: worktree.lastActivityAt,
                nowMs: params.nowMs,
            });
            // Pill rendering: pass `count` xor a short suffix `label` so the pill never
            // duplicates the count (the wrapper renders `<count> <label>`; passing a
            // pre-formatted "3 changes" alongside `count={3}` would print "3 3 changes").
            const dirtyChangeCount = variant === 'dirty' ? worktree.changeCount : undefined;
            const pillLabel = variant === 'dirty'
                ? t('newSession.worktree.statusPill.changesSuffix', { count: dirtyChangeCount ?? 0 })
                : variant === 'stale'
                    ? t('newSession.worktree.statusPill.idle')
                    : t('newSession.worktree.statusPill.clean');
            // The relative-age text and the status pill sit in a gapped row so
            // they read as two distinct accessories (the age is secondary text;
            // the pill carries the status colour) rather than colliding.
            const accessory = (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    {worktree.lastActivityAt !== undefined ? (
                        <WorktreeRelativeTimeText
                            atMs={worktree.lastActivityAt}
                            nowMs={params.nowMs}
                            testID={`worktree-row-age:${worktree.path}`}
                        />
                    ) : null}
                    {variant !== null ? (
                        <WorktreeStatusPill
                            variant={variant}
                            label={pillLabel}
                            count={dirtyChangeCount}
                            testID={`worktree-row-status:${worktree.path}`}
                        />
                    ) : null}
                </View>
            );
            // The row id MUST be derived through the shared
            // `buildWorktreeCheckoutOptionId` owner so it matches the chip
            // model's `selectedOptionId` byte-for-byte; otherwise a selected
            // existing worktree fails to highlight / scroll into view on reopen
            // whenever the raw path needs normalization (trailing slash, mixed
            // separators).
            return {
                id: buildWorktreeCheckoutOptionId(worktree.path),
                label,
                subtitle: worktree.path,
                icon: <Icon name="graph" size={WORKTREE_ROW_ICON_SIZE} color={params.rowIconColor} />,
                rightAccessory: accessory,
                onSelect: () => params.onSelectExistingWorktree(worktree.path),
            } satisfies SelectionListOption;
        });
}
