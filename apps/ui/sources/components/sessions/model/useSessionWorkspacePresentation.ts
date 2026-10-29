import { useShallow } from 'zustand/react/shallow';

import { getStorage } from '@/sync/domains/state/storageStore';
import { resolveSessionWorkspacePresentationFromState } from '@/sync/ops/sessionMachineTarget';
import { createProjectForSessionResolver } from '@/sync/runtime/orchestration/projectForSessionResolver';
import { useMachineDisplayScopes } from '@/sync/store/hooks';

type PresentationInput = Omit<Parameters<typeof resolveSessionWorkspacePresentationFromState>[0], 'state' | 'machines'>;

/** The header subscribes only to its visible scalars, not machine heartbeats or another Home. */
export function useSessionWorkspacePresentation(input: PresentationInput) {
    const scopeKey = input.serverId?.trim() || '';
    const scopes = useMachineDisplayScopes(['', scopeKey]);
    return getStorage()(useShallow(state => {
        if (!input.sessionId && !input.metadata) return null;
        const presentation = resolveSessionWorkspacePresentationFromState({
            ...input,
            activeServerId: scopes[''].serverId,
            resolvedMachineScope: scopes[scopeKey],
            state: { ...state, getProjectForSession: createProjectForSessionResolver(state.sessions) },
        });
        return {
            machineId: presentation.machineId,
            machineLabel: presentation.machineLabel,
            displayTitle: presentation.displayTitle,
            displayPath: presentation.displayPath,
            hasCustomLabel: presentation.hasCustomLabel,
        };
    }));
}
