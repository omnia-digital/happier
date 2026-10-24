import * as React from 'react';
import type { MemorySearchHitV1, MemorySearchResultV1, MemoryStatusV1 } from '@happier-dev/protocol';

import { fetchDaemonMemoryStatus } from '@/sync/domains/memory/fetchDaemonMemoryStatus';
import { isDaemonMemorySearchUsable } from '@/sync/domains/memory/isDaemonMemorySearchUsable';
import { searchDaemonMemory } from '@/sync/domains/memory/searchDaemonMemory';
import { TokenStorage } from '@/auth/storage/tokenStorage';

export type MemorySearchRunState = 'idle' | 'loading' | 'error' | 'ready';

/** The status gate and result lifecycle shared by the memory screen and palette. */
export function useMemorySearchOnMachine(input: Readonly<{
    enabled: boolean;
    serverId: string;
    machineId: string;
    autoQuery?: string;
}>) {
    const [memoryStatus, setMemoryStatus] = React.useState<MemoryStatusV1 | null>(null);
    const [memoryStatusScope, setMemoryStatusScope] = React.useState('');
    const [memoryStatusLoading, setMemoryStatusLoading] = React.useState(false);
    const [runState, setRunState] = React.useState<MemorySearchRunState>('idle');
    const [hits, setHits] = React.useState<ReadonlyArray<MemorySearchHitV1>>([]);
    const [hitsScope, setHitsScope] = React.useState('');
    const [hitsQuery, setHitsQuery] = React.useState('');
    const [errorCode, setErrorCode] = React.useState<string | null>(null);
    const [credentialRevision, setCredentialRevision] = React.useState(0);
    const credentialEpochRef = React.useRef(0);
    const requestIdRef = React.useRef(0);
    const scopeKey = `${input.enabled}\u0000${input.serverId}\u0000${input.machineId}\u0000${credentialRevision}`;
    const scopeKeyRef = React.useRef(scopeKey);
    scopeKeyRef.current = scopeKey;
    const autoQueryRef = React.useRef(input.autoQuery);
    autoQueryRef.current = input.autoQuery;

    React.useEffect(() => TokenStorage.subscribeCredentialChanges(() => {
        credentialEpochRef.current += 1;
        requestIdRef.current += 1;
        setCredentialRevision((revision) => revision + 1);
    }), []);

    React.useEffect(() => {
        requestIdRef.current += 1;
        setRunState('idle');
        setHits([]);
        setErrorCode(null);
        setMemoryStatus(null);
        setMemoryStatusScope('');
        if (!input.enabled || !input.serverId || !input.machineId) {
            setMemoryStatusLoading(false);
            return;
        }
        let active = true;
        const requestScope = scopeKey;
        const requestCredentialEpoch = credentialEpochRef.current;
        setMemoryStatusLoading(true);
        void fetchDaemonMemoryStatus({ serverId: input.serverId, machineId: input.machineId })
            .then((status) => {
                if (!active || requestScope !== scopeKeyRef.current || requestCredentialEpoch !== credentialEpochRef.current) return;
                setMemoryStatus(status);
                setMemoryStatusScope(requestScope);
            })
            .catch(() => {
                if (!active || requestScope !== scopeKeyRef.current || requestCredentialEpoch !== credentialEpochRef.current) return;
                setMemoryStatus(null);
            })
            .finally(() => {
                if (active && requestScope === scopeKeyRef.current && requestCredentialEpoch === credentialEpochRef.current) setMemoryStatusLoading(false);
            });
        return () => { active = false; requestIdRef.current += 1; };
    }, [input.enabled, input.serverId, input.machineId, credentialRevision, scopeKey]);

    const visibleStatus = memoryStatusScope === scopeKey ? memoryStatus : null;
    const memorySearchUsable = isDaemonMemorySearchUsable(visibleStatus);
    const runSearch = React.useCallback(async (rawQuery: string): Promise<void> => {
        const query = rawQuery.trim();
        if (!input.enabled || !input.serverId || !input.machineId || !query || !memorySearchUsable) return;
        const requestId = ++requestIdRef.current;
        const requestScope = scopeKey;
        const requestCredentialEpoch = credentialEpochRef.current;
        setRunState('loading');
        setHitsScope(requestScope);
        setHitsQuery(query);
        setErrorCode(null);
        try {
            const result: MemorySearchResultV1 = await searchDaemonMemory({
                serverId: input.serverId,
                machineId: input.machineId,
                query,
                scope: { type: 'global' },
                mode: 'auto',
                maxResults: 20,
            });
            if (requestIdRef.current !== requestId || requestScope !== scopeKeyRef.current || requestCredentialEpoch !== credentialEpochRef.current || (autoQueryRef.current !== undefined && autoQueryRef.current.trim() !== query)) return;
            if (result.ok) {
                setHits(result.hits);
                setHitsScope(requestScope);
                setRunState('ready');
            } else {
                setHits([]);
                setErrorCode(result.errorCode);
                setRunState('error');
            }
        } catch {
            if (requestIdRef.current !== requestId || requestScope !== scopeKeyRef.current || requestCredentialEpoch !== credentialEpochRef.current || (autoQueryRef.current !== undefined && autoQueryRef.current.trim() !== query)) return;
            setHits([]);
            setErrorCode(null);
            setRunState('error');
        }
    }, [input.enabled, input.serverId, input.machineId, memorySearchUsable, scopeKey]);

    React.useEffect(() => {
        if (input.autoQuery === undefined) return;
        const query = input.autoQuery.trim();
        requestIdRef.current += 1;
        setHits([]);
        setErrorCode(null);
        setRunState('idle');
        if (!query || !memorySearchUsable) return;
        const timeout = setTimeout(() => { void runSearch(query); }, 300);
        return () => { clearTimeout(timeout); requestIdRef.current += 1; };
    }, [input.autoQuery, memorySearchUsable, runSearch]);

    const resultMatchesQuery = input.autoQuery === undefined || input.autoQuery.trim() === hitsQuery;
    const visibleHits = hitsScope === scopeKey && resultMatchesQuery ? hits : [];
    return {
        memoryStatus: visibleStatus,
        memoryStatusLoading,
        memorySearchUsable,
        runState: hitsScope === scopeKey && resultMatchesQuery ? runState : 'idle' as MemorySearchRunState,
        hits: visibleHits,
        errorCode,
        runSearch,
    };
}
