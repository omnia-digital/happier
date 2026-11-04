import * as React from 'react';

import { TokenStorage } from '@/auth/storage/tokenStorage';
import { scmRepositoryService } from '@/scm/scmRepositoryService';
import type { ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import { areServerProfileIdentifiersEquivalent } from '@/sync/domains/server/serverProfiles';
import { useActiveServerAccountScope } from '@/sync/domains/state/storage';

export type ServerAccountScopes = Readonly<Record<string, ServerAccountScope | undefined>>;

/**
 * The account behind each Home, keyed by the given server id, with '' for the active Home.
 * A foreign Home's account sits behind an asynchronous local credential read, so it stays
 * undefined until that read lands. This never initiates SCM or RPC work.
 */
export function useServerAccountScopes(serverIds: readonly string[]): ServerAccountScopes {
    const activeScope = useActiveServerAccountScope();
    const serverIdsKey = JSON.stringify([...new Set(serverIds)].sort());
    const readKey = JSON.stringify([activeScope, serverIdsKey]);
    const [resolved, setResolved] = React.useState<{ readKey: string; values: ServerAccountScopes } | null>(null);
    const activeScopeRef = React.useRef(activeScope); activeScopeRef.current = activeScope;

    React.useEffect(() => {
        let cancelRead = () => {};
        const read = () => {
            cancelRead();
            let current = true;
            cancelRead = () => { current = false; };
            setResolved(null);
            // The active Home is answered below, and a settled read would re-render the session screen.
            const foreignServerIds = (JSON.parse(serverIdsKey) as string[])
                .filter(serverId => !activeScopeRef.current || !areServerProfileIdentifiersEquivalent(serverId, activeScopeRef.current.serverId));
            if (foreignServerIds.length === 0) return;
            void Promise.all(foreignServerIds.map(async serverId => {
                try { return [serverId, await scmRepositoryService.resolveScopeForServer(serverId) ?? undefined] as const; }
                catch (error) { console.warn('Could not read the local Home account scope', error); return [serverId, undefined] as const; }
            })).then(entries => { if (current) setResolved({ readKey, values: Object.fromEntries(entries) }); });
        };
        const unsubscribe = TokenStorage.subscribeCredentialChanges(read);
        read();
        return () => { cancelRead(); unsubscribe(); };
    }, [readKey, serverIdsKey]);

    const result: Record<string, ServerAccountScope | undefined> = resolved?.readKey === readKey ? { ...resolved.values } : {};
    if (activeScope) {
        result[''] = activeScope;
        result[activeScope.serverId] = activeScope;
        for (const serverId of JSON.parse(serverIdsKey) as string[]) {
            if (areServerProfileIdentifiersEquivalent(serverId, activeScope.serverId)) result[serverId] = activeScope;
        }
    }
    // Consumers key caches on this object, and a read that confirms what is known changes nothing.
    const serialized = JSON.stringify(Object.entries(result).filter(([, scope]) => scope).sort(([a], [b]) => a.localeCompare(b)));
    return React.useMemo(() => Object.fromEntries(JSON.parse(serialized) as [string, ServerAccountScope][]), [serialized]);
}
