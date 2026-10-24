import * as React from 'react';
import { storage } from '@/sync/domains/state/storage';
import type { SessionListViewItem } from '@/sync/domains/session/listing/sessionListViewData';
import { useSessionListRuntimeNowMs, useSessionListRuntimeWake } from '@/hooks/session/sessionListRuntimeClock';
import { createSessionListStatusInputsSelector } from './sessionListStatusInputs';

const EMPTY_ITEMS: readonly SessionListViewItem[] = [];
function subscribeInactive() { return () => {}; }
export function useSessionListStatusInputs(items: readonly SessionListViewItem[] | null, activeServerId: string | null | undefined, enabled: boolean, includeAgent: boolean) {
    const runtimeNowMs = useSessionListRuntimeNowMs(enabled && includeAgent);
    const nowRef = React.useRef(runtimeNowMs); nowRef.current = runtimeNowMs;
    const selector = React.useMemo(() => createSessionListStatusInputsSelector(enabled ? items ?? EMPTY_ITEMS : EMPTY_ITEMS, activeServerId, () => nowRef.current, includeAgent), [items, activeServerId, enabled, includeAgent]);
    const getSnapshot = React.useCallback(() => selector(storage.getState()), [selector, runtimeNowMs]);
    const inputs = React.useSyncExternalStore(enabled ? storage.subscribe : subscribeInactive, getSnapshot, getSnapshot);
    useSessionListRuntimeWake(inputs.nextWakeAt, enabled && includeAgent);
    return { ...inputs, runtimeNowMs };
}
