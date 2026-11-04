import * as React from 'react';
import {
    resolveNewSessionCheckoutChipModel,
    supportsRepoWorktreeChip,
    type NewSessionCheckoutChipModel,
} from '@/components/sessions/new/modules/newSessionCheckoutChipModel';
import {
    resolveNewSessionCheckoutSelection,
    type NewSessionCheckoutCreationDraft,
    type NewSessionCheckoutMode,
    type NewSessionCheckoutSelection,
} from '@/sync/domains/state/newSessionCheckoutDraft';
import type { ScmWorkingSnapshot } from '@/sync/domains/state/storageTypes';
import { generateWorktreeName } from '@/utils/worktree/generateWorktreeName';

function resolveCheckoutCreationDraftAction(
    action: React.SetStateAction<NewSessionCheckoutCreationDraft | null>,
    current: NewSessionCheckoutCreationDraft | null,
): NewSessionCheckoutCreationDraft | null {
    return typeof action === 'function' ? action(current) : action;
}

export function useNewSessionCheckoutSelectionState(params: Readonly<{
    persistedDraft: unknown;
    tempSessionData?: unknown;
    selectedMachineId: string | null;
    selectedPath: string;
    targetScopeKey?: string | null;
    repoScmSnapshot: ScmWorkingSnapshot | null;
    repoScmSnapshotUnavailable?: boolean;
    defaultCheckoutMode: NewSessionCheckoutMode;
    autoOpenWorktreePickerKey?: string | null;
}>): Readonly<{
    checkoutCreationDraft: NewSessionCheckoutCreationDraft | null;
    /** What a saved draft records: the live draft, or a requested New Worktree this target cannot create yet. */
    persistableCheckoutCreationDraft: NewSessionCheckoutCreationDraft | null;
    setCheckoutCreationDraft: React.Dispatch<React.SetStateAction<NewSessionCheckoutCreationDraft | null>>;
    checkoutSelectionExplicit: boolean;
    checkoutPickerOpen: boolean;
    setCheckoutPickerOpen: React.Dispatch<React.SetStateAction<boolean>>;
    pendingGitWorktreeBaseRefRef: React.MutableRefObject<string | null>;
    pendingGitWorktreeSourceKindRef: React.MutableRefObject<'current' | 'local' | 'remote'>;
    shouldReconcileInitialHydratedCheckoutCreationDraftRef: React.MutableRefObject<boolean>;
    checkoutChipModel: NewSessionCheckoutChipModel;
}> {
    const initialCheckoutSelection = React.useMemo(() => (
        resolveNewSessionCheckoutSelection(params.tempSessionData, params.persistedDraft)
    ), [params.persistedDraft, params.tempSessionData]);

    const [checkoutSelectionState, setCheckoutSelectionState] = React.useState<NewSessionCheckoutSelection>(initialCheckoutSelection);
    const hasLocalCheckoutSelectionAuthorityRef = React.useRef(false);
    const effectiveCheckoutSelection = !hasLocalCheckoutSelectionAuthorityRef.current
        && initialCheckoutSelection.explicitMode !== null
        ? initialCheckoutSelection
        : checkoutSelectionState;
    const checkoutCreationDraft = effectiveCheckoutSelection.checkoutCreationDraft;
    const checkoutSelectionExplicit = effectiveCheckoutSelection.explicitMode !== null;
    const setCheckoutCreationDraft = React.useCallback<React.Dispatch<React.SetStateAction<NewSessionCheckoutCreationDraft | null>>>((next) => {
        setCheckoutSelectionState((current) => ({
            ...current,
            checkoutCreationDraft: resolveCheckoutCreationDraftAction(next, current.checkoutCreationDraft),
        }));
    }, []);
    const setExplicitCheckoutCreationDraft = React.useCallback<React.Dispatch<React.SetStateAction<NewSessionCheckoutCreationDraft | null>>>((next) => {
        hasLocalCheckoutSelectionAuthorityRef.current = true;
        setCheckoutSelectionState((current) => {
            const checkoutCreationDraft = resolveCheckoutCreationDraftAction(next, current.checkoutCreationDraft);
            return {
                checkoutCreationDraft,
                explicitMode: checkoutCreationDraft ? 'git_worktree' : 'current_path',
            };
        });
    }, []);
    const hasAppliedCheckoutDraftEffectRef = React.useRef(false);
    const shouldReconcileInitialHydratedCheckoutCreationDraftRef = React.useRef(initialCheckoutSelection.checkoutCreationDraft !== null);
    const [checkoutPickerOpen, setCheckoutPickerOpen] = React.useState(false);
    const pendingGitWorktreeBaseRefRef = React.useRef<string | null>(null);
    const pendingGitWorktreeSourceKindRef = React.useRef<'current' | 'local' | 'remote'>('current');
    const previousSelectionKeyRef = React.useRef<string | null>(null);
    const lastAutoOpenWorktreePickerKeyRef = React.useRef<string | null>(null);
    const defaultWorktreeNameRef = React.useRef(generateWorktreeName());
    const buildDefaultCheckoutCreationDraft = React.useCallback((): NewSessionCheckoutCreationDraft => ({
        kind: 'git_worktree',
        displayName: defaultWorktreeNameRef.current,
        baseRef: null,
        branchMode: 'new',
    }), []);
    // Persistence has no way to say "requested, no draft": a saved null restores as No Worktree.
    const persistableCheckoutCreationDraft = React.useMemo(() => {
        if (checkoutCreationDraft !== null) return checkoutCreationDraft;
        return effectiveCheckoutSelection.explicitMode === 'git_worktree' ? buildDefaultCheckoutCreationDraft() : null;
    }, [buildDefaultCheckoutCreationDraft, checkoutCreationDraft, effectiveCheckoutSelection.explicitMode]);

    React.useEffect(() => {
        if (!hasAppliedCheckoutDraftEffectRef.current) {
            hasAppliedCheckoutDraftEffectRef.current = true;
            return;
        }
        if (hasLocalCheckoutSelectionAuthorityRef.current) {
            return;
        }
        shouldReconcileInitialHydratedCheckoutCreationDraftRef.current = false;
        setCheckoutSelectionState(initialCheckoutSelection);
    }, [
        initialCheckoutSelection.checkoutCreationDraft,
        initialCheckoutSelection.explicitMode,
    ]);

    const checkoutChipModel = React.useMemo(() => {
        return resolveNewSessionCheckoutChipModel({
            selectedPath: params.selectedPath,
            checkoutCreationDraft,
            repoSnapshot: params.repoScmSnapshot,
            repoSnapshotUnavailable: params.repoScmSnapshotUnavailable,
            worktreeIntentRequested: (effectiveCheckoutSelection.explicitMode ?? params.defaultCheckoutMode) === 'git_worktree',
        });
    }, [
        checkoutCreationDraft,
        effectiveCheckoutSelection.explicitMode,
        params.defaultCheckoutMode,
        params.repoScmSnapshot,
        params.repoScmSnapshotUnavailable,
        params.selectedPath,
    ]);

    React.useEffect(() => {
        const selectedExistingCheckout = checkoutChipModel.selectedOptionId.startsWith('checkout:');
        const gitDetectionAllowsDraft = params.repoScmSnapshot === null || supportsRepoWorktreeChip(params.repoScmSnapshot);
        const shouldPreserveCheckoutCreationDraft = checkoutCreationDraft !== null
            && (
                (
                    !shouldReconcileInitialHydratedCheckoutCreationDraftRef.current
                    || !selectedExistingCheckout
                )
                && gitDetectionAllowsDraft
            );

        if (!shouldPreserveCheckoutCreationDraft && checkoutCreationDraft !== null) {
            shouldReconcileInitialHydratedCheckoutCreationDraftRef.current = false;
            hasLocalCheckoutSelectionAuthorityRef.current = true;
            // Only the draft is invalid when Git detection rejects it. The request stands, so the chip
            // can explain it and a capable target regenerates it, exactly as after a path change.
            const invalidatedExplicitMode = gitDetectionAllowsDraft ? 'current_path' : 'git_worktree';
            setCheckoutSelectionState({
                checkoutCreationDraft: null,
                explicitMode: effectiveCheckoutSelection.explicitMode === null ? null : invalidatedExplicitMode,
            });
        }
    }, [
        checkoutCreationDraft,
        effectiveCheckoutSelection.explicitMode,
        params.repoScmSnapshot,
        checkoutChipModel.selectedOptionId,
    ]);

    React.useEffect(() => {
        const selectionKey = JSON.stringify([params.targetScopeKey ?? null, params.selectedMachineId, params.selectedPath]);
        if (previousSelectionKeyRef.current === null) {
            // Initial account/machine hydration is not a target change. Wait for
            // the first usable target before binding the restored checkout draft.
            if (params.targetScopeKey === null || !params.selectedMachineId || !params.selectedPath) return;
            previousSelectionKeyRef.current = selectionKey;
            return;
        }
        if (previousSelectionKeyRef.current === selectionKey) {
            return;
        }
        previousSelectionKeyRef.current = selectionKey;
        hasLocalCheckoutSelectionAuthorityRef.current = true;
        if (checkoutCreationDraft === null) {
            return;
        }
        shouldReconcileInitialHydratedCheckoutCreationDraftRef.current = false;
        setCheckoutCreationDraft(null);
    }, [checkoutCreationDraft, params.targetScopeKey, params.selectedMachineId, params.selectedPath]);

    React.useEffect(() => {
        if (params.repoScmSnapshot === null || checkoutCreationDraft !== null) return;
        if (
            (effectiveCheckoutSelection.explicitMode ?? params.defaultCheckoutMode) !== 'git_worktree'
            || !supportsRepoWorktreeChip(params.repoScmSnapshot)
        ) {
            return;
        }

        setCheckoutCreationDraft(buildDefaultCheckoutCreationDraft());
    }, [
        buildDefaultCheckoutCreationDraft,
        checkoutCreationDraft,
        effectiveCheckoutSelection.explicitMode,
        params.defaultCheckoutMode,
        params.repoScmSnapshot,
        params.selectedMachineId,
        params.selectedPath,
    ]);

    React.useEffect(() => {
        const autoOpenKey = params.autoOpenWorktreePickerKey ?? null;
        if (!autoOpenKey) {
            return;
        }
        // Open once the target is known either way: the picker is what explains an unavailable New Worktree.
        if (!supportsRepoWorktreeChip(params.repoScmSnapshot) && checkoutChipModel.newWorktreeUnavailableReason === null) {
            return;
        }
        if (lastAutoOpenWorktreePickerKeyRef.current === autoOpenKey) {
            return;
        }
        lastAutoOpenWorktreePickerKeyRef.current = autoOpenKey;
        setCheckoutPickerOpen(true);
    }, [checkoutChipModel.newWorktreeUnavailableReason, params.autoOpenWorktreePickerKey, params.repoScmSnapshot]);

    return {
        checkoutCreationDraft,
        persistableCheckoutCreationDraft,
        setCheckoutCreationDraft: setExplicitCheckoutCreationDraft,
        checkoutSelectionExplicit,
        checkoutPickerOpen,
        setCheckoutPickerOpen,
        pendingGitWorktreeBaseRefRef,
        pendingGitWorktreeSourceKindRef,
        shouldReconcileInitialHydratedCheckoutCreationDraftRef,
        checkoutChipModel,
    };
}
