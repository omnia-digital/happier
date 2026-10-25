import { useShallow } from 'zustand/react/shallow';

import { getStorage } from '@/sync/domains/state/storageStore';
import { resolveSessionWorkspacePresentationFromState } from '@/sync/ops/sessionMachineTarget';

type PresentationInput = Omit<Parameters<typeof resolveSessionWorkspacePresentationFromState>[0], 'state' | 'machines'>;

/** The header subscribes only to its visible scalars, not machine heartbeats or another Home. */
export function useSessionWorkspacePresentation(input: PresentationInput) {
    return getStorage()(useShallow(state => {
        const presentation = resolveSessionWorkspacePresentationFromState({ ...input, state });
        return {
            machineId: presentation.machineId,
            machineLabel: presentation.machineLabel,
            displayTitle: presentation.displayTitle,
            displayPath: presentation.displayPath,
            hasCustomLabel: presentation.hasCustomLabel,
        };
    }));
}
