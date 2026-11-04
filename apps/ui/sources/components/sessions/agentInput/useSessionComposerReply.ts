import * as React from 'react';

import type { MessageReplyTarget } from '@/sync/domains/messages/messageReply';

export const SessionMessageReplyActionContext = React.createContext<((target: MessageReplyTarget) => void) | null>(null);
export type SessionComposerReplyIntent = Readonly<{ target: MessageReplyTarget | null }>;

export function useSessionComposerReply(scopeKey: string, sessionId: string) {
    const key = JSON.stringify([scopeKey, sessionId]);
    const [intents, setIntents] = React.useState<Readonly<Record<string, SessionComposerReplyIntent>>>({});
    const intentsRef = React.useRef(intents);
    const restorableTargetsRef = React.useRef<Record<string, MessageReplyTarget>>({});
    const update = React.useCallback((ownerKey: string, target: MessageReplyTarget | null) => {
        const next = { ...intentsRef.current, [ownerKey]: { target } };
        intentsRef.current = next;
        setIntents(next);
    }, []);
    const select = React.useCallback((target: MessageReplyTarget) => {
        if (target.sessionId !== sessionId) return;
        delete restorableTargetsRef.current[key];
        update(key, target);
    }, [key, sessionId, update]);
    const clearIfCurrent = React.useCallback((target: MessageReplyTarget) => {
        if (intentsRef.current[key]?.target !== target) return false;
        update(key, null);
        restorableTargetsRef.current[key] = target;
        return true;
    }, [key, update]);
    const restoreIfEmpty = React.useCallback((target: MessageReplyTarget) => {
        if (target.sessionId !== sessionId || intentsRef.current[key]?.target || restorableTargetsRef.current[key] !== target) return;
        delete restorableTargetsRef.current[key];
        update(key, target);
    }, [key, sessionId, update]);
    const cancel = React.useCallback(() => {
        delete restorableTargetsRef.current[key];
        update(key, null);
    }, [key, update]);
    const captureIntent = React.useCallback((): SessionComposerReplyIntent => {
        const existing = intentsRef.current[key];
        if (existing) return existing;
        const initial: SessionComposerReplyIntent = { target: null };
        intentsRef.current = { ...intentsRef.current, [key]: initial };
        return initial;
    }, [key]);
    const isCurrentIntent = React.useCallback((intent: SessionComposerReplyIntent) => (
        captureIntent() === intent
    ), [captureIntent]);
    return {
        target: intents[key]?.target ?? null,
        select,
        clearIfCurrent,
        restoreIfEmpty,
        cancel,
        captureIntent,
        isCurrentIntent,
    };
}
