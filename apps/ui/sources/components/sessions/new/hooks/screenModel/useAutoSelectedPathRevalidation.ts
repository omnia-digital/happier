import * as React from 'react';

import { probeMachineDirectory, type MachineFileBrowserIdentity } from '@/sync/domains/input/machineFileBrowser';
import { resolveAbsolutePath } from '@/utils/path/pathUtils';
import { fireAndForget } from '@/utils/system/fireAndForget';

/**
 * Checks the path New Session chose by itself against the selected target, and moves to
 * the next saved path of that target when the machine reports it gone. An answer that
 * says nothing about the directory keeps the path; the launch still asks before creating it.
 */
export function useAutoSelectedPathRevalidation(params: Readonly<{
    machineId: string | null;
    machineHomeDir: string | null;
    selectedPath: string;
    serverId?: string | null;
    /** Changes whenever the machine, Home or Account being targeted changes. */
    targetScopeKey: string | null;
    browserIdentity?: MachineFileBrowserIdentity | null;
    getAutoSelectedPathFallbacks: () => ReadonlyArray<string> | null;
    replaceAutoSelectedPath: (expectedPath: string, nextPath: string) => void;
}>): void {
    const latestParamsRef = React.useRef(params);
    latestParamsRef.current = params;
    const { machineId, selectedPath, targetScopeKey } = params;

    React.useEffect(() => {
        const { machineHomeDir, serverId, browserIdentity, getAutoSelectedPathFallbacks } = latestParamsRef.current;
        if (!machineId || !machineHomeDir || !targetScopeKey) return;
        const fallbacks = getAutoSelectedPathFallbacks();
        if (!fallbacks || fallbacks.length === 0) return;

        let superseded = false;
        const probe = (path: string) => probeMachineDirectory({
            machineId,
            directoryPath: resolveAbsolutePath(path, machineHomeDir),
            serverId,
            targetScopeKey,
            browserIdentity,
        });
        const revalidate = async () => {
            if (await probe(selectedPath) !== 'missing') return;
            for (const candidate of fallbacks) {
                if (superseded) return;
                const availability = await probe(candidate);
                if (superseded || availability === 'unknown') return;
                if (availability === 'available') {
                    latestParamsRef.current.replaceAutoSelectedPath(selectedPath, candidate);
                    return;
                }
            }
        };
        fireAndForget(revalidate(), { tag: 'new-session-auto-path-revalidation' });
        return () => { superseded = true; };
    }, [machineId, selectedPath, targetScopeKey]);
}
