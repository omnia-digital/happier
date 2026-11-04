import * as React from 'react';

import { probeMachineDirectory, type MachineFileBrowserIdentity } from '@/sync/domains/input/machineFileBrowser';

const NO_MISSING_PATHS: ReadonlySet<string> = new Set();

type MissingSavedPathsResult = Readonly<{
    browseIdentity: string;
    missing: ReadonlySet<string>;
}>;

/**
 * Which saved paths the selected target reports as gone. Results are held against the
 * browse identity they were asked for, so the same path text on another machine, Home
 * or Account starts clean and a late answer cannot mark rows on the new target.
 */
export function useMissingSavedPaths(params: Readonly<{
    paths: ReadonlyArray<string>;
    /** Changes whenever the machine, Home, Account or platform being browsed changes. */
    browseIdentity: string;
    machineId: string | null;
    serverId?: string | null;
    targetScopeKey?: string | null;
    browserIdentity?: MachineFileBrowserIdentity | null;
}>): ReadonlySet<string> {
    const { browseIdentity } = params;
    const [result, setResult] = React.useState<MissingSavedPathsResult>({ browseIdentity, missing: NO_MISSING_PATHS });
    const latestParamsRef = React.useRef(params);
    latestParamsRef.current = params;
    const pathsKey = JSON.stringify(params.paths);

    React.useEffect(() => {
        const { paths, machineId, serverId, targetScopeKey, browserIdentity } = latestParamsRef.current;
        if (machineId === null || paths.length === 0) return;
        let superseded = false;
        void Promise.all(paths.map(async (directoryPath) => ({
            directoryPath,
            availability: await probeMachineDirectory({ machineId, directoryPath, serverId, targetScopeKey, browserIdentity }),
        }))).then((answers) => {
            if (superseded) return;
            const missing = answers.filter((answer) => answer.availability === 'missing').map((answer) => answer.directoryPath);
            setResult({ browseIdentity, missing: missing.length > 0 ? new Set(missing) : NO_MISSING_PATHS });
        });
        return () => { superseded = true; };
    }, [browseIdentity, pathsKey]);

    return result.browseIdentity === browseIdentity ? result.missing : NO_MISSING_PATHS;
}
