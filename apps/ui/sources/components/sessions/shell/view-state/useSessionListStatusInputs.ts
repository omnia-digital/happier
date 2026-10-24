import * as React from 'react';
import { storage, useActiveServerAccountScope } from '@/sync/domains/state/storage';
import type { SessionListViewItem } from '@/sync/domains/session/listing/sessionListViewData';
import { useSessionListRuntimeNowMs, useSessionListRuntimeWake } from '@/hooks/session/sessionListRuntimeClock';
import { createSessionListStatusInputsSelector } from './sessionListStatusInputs';
import { sync } from '@/sync/sync';
import type { SessionTicketStatus } from '@/sync/domains/session/tickets/sessionTicketStatus';
import { sessionListStatusRowKey } from './projectSessionListStatusView';
import { isRuntimeActive, isHostVisible, subscribeToRuntimeActiveChange } from '@/utils/runtime/isRuntimeActive';
import { readHostWindowFocus } from '@/utils/runtime/readHostWindowFocus';

const EMPTY_ITEMS: readonly SessionListViewItem[] = [];
function subscribeInactive() { return () => {}; }
const EMPTY_METADATA_STATES: ReadonlyMap<string, SessionTicketStatus> = new Map();
const metadataDemandActive = () => isRuntimeActive() && isHostVisible() && readHostWindowFocus() !== false;
const subscribeMetadataLifecycle = (listener: () => void) => subscribeToRuntimeActiveChange(listener, { includeWindowFocus: true });
export function useSessionListStatusInputs(items: readonly SessionListViewItem[] | null, activeServerId: string | null | undefined, enabled: boolean, includeAgent: boolean, includeTicket: boolean) {
    const activeScope = useActiveServerAccountScope();
    const demandActive = React.useSyncExternalStore(enabled && includeTicket ? subscribeMetadataLifecycle : subscribeInactive, metadataDemandActive, () => false);
    const runtimeNowMs = useSessionListRuntimeNowMs(enabled && includeAgent);
    const nowRef = React.useRef(runtimeNowMs); nowRef.current = runtimeNowMs;
    const selector = React.useMemo(() => createSessionListStatusInputsSelector(enabled ? items ?? EMPTY_ITEMS : EMPTY_ITEMS, activeServerId, () => nowRef.current, includeAgent), [items, activeServerId, enabled, includeAgent]);
    const getSnapshot = React.useCallback(() => selector(storage.getState()), [selector, runtimeNowMs]);
    const inputs = React.useSyncExternalStore(enabled ? storage.subscribe : subscribeInactive, getSnapshot, getSnapshot);
    const metadataCandidates = enabled && includeTicket && demandActive ? (items ?? []).flatMap(item => {
        if (item.type !== 'session') return [];
        return [{ key: sessionListStatusRowKey(item), sessionId: item.session.id, serverId: item.serverId }];
    }) : [];
    const metadataDemandKey = JSON.stringify([activeScope, [...new Map(metadataCandidates.map(candidate => [candidate.key, candidate])).values()].sort((left, right) => left.key.localeCompare(right.key))]);
    const [metadataProjection, setMetadataProjection] = React.useState<{ key: string; states: ReadonlyMap<string, SessionTicketStatus> }>({ key: '', states: EMPTY_METADATA_STATES });
    React.useEffect(() => {
        let current = true;
        const [, allCandidates] = JSON.parse(metadataDemandKey) as [unknown, Array<{ key: string; sessionId: string; serverId?: string }>];
        // Retain one demand lifetime for this candidate set while individual metadata rows publish.
        // Rebuilding the queue on every successful hydration would duplicate the remaining jobs.
        const candidates = allCandidates.filter(candidate => inputs.ticketAssociations.get(candidate.key) === undefined);
        if (candidates.length === 0) return;
        void sync.ensureSessionListMetadata(candidates, () => current && isRuntimeActive() && isHostVisible() && readHostWindowFocus() !== false).then(results => {
            if (!current) return;
            const observed = selector(storage.getState());
            // Request outcomes only; metadata stays in the canonical scoped session/renderable store.
            setMetadataProjection({ key: metadataDemandKey, states: new Map(results.flatMap((result, index) => result?.kind === 'available' && observed.ticketAssociations.get(candidates[index].key) !== undefined ? [] : [[candidates[index].key, { phase: 'unavailable' as const, snapshot: null, error: null }] as const])) });
        });
        return () => { current = false; };
    }, [metadataDemandKey]);
    useSessionListRuntimeWake(inputs.nextWakeAt, enabled && includeAgent);
    return { ...inputs, runtimeNowMs, metadataStates: metadataProjection.key === metadataDemandKey ? metadataProjection.states : EMPTY_METADATA_STATES };
}
