import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSessionFixture, renderScreen, standardCleanup } from '@/dev/testkit';
import { storage } from '@/sync/domains/state/storage';
import { createMessageReplyTarget } from '@/sync/domains/messages/messageReply';
import type { NormalizedMessage } from '@/sync/typesRaw';

import { SentMessageReplyPreview } from './MessageReplyPreview';

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});
vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});
vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({ translate: (key) => key });
});

const initialStorage = storage.getState();

describe('sent contextual reply preview', () => {
    afterEach(() => {
        standardCleanup();
        storage.setState(initialStorage, true);
    });

    it('keeps the selected source block inspectable after transcript reset and independent rehydration', async () => {
        const sessionId = 'reply-source-rehydration';
        const raw: NormalizedMessage = {
            id: 'source-server-record', seq: 4, localId: null, createdAt: 1, role: 'agent', isSidechain: false,
            content: [
                { type: 'text', text: 'First source', uuid: 'first-text', parentUUID: null },
                { type: 'tool-call', id: 'read-1', name: 'Read', input: {}, description: 'Read', uuid: 'read-tool', parentUUID: null },
                { type: 'text', text: '**Selected** second source', uuid: 'second-text', parentUUID: null },
            ],
        };
        storage.getState().applySessions([createSessionFixture({ id: sessionId })]);
        storage.getState().applyMessages(sessionId, [raw]);
        const source = Object.values(storage.getState().sessionMessages[sessionId]!.messagesById)
            .find((message) => message.kind === 'agent-text' && message.text.includes('Selected'));
        if (source?.kind !== 'agent-text') throw new Error('Expected the second source block');
        const meta = JSON.parse(JSON.stringify({ happierMessageReplyV1: createMessageReplyTarget(sessionId, source) }));
        const screen = await renderScreen(<SentMessageReplyPreview sessionId={sessionId} messageId="sent-reply" meta={meta} />);
        expect(screen.getTextContent()).toContain('Selected second source');
        expect(screen.getTextContent()).not.toContain('First source');
        await act(async () => storage.getState().resetSessionMessages(sessionId));
        expect(screen.getTextContent()).toContain('session.messageReply.sourceUnavailable');
        await act(async () => { storage.getState().applyMessages(sessionId, [raw]); });
        expect(screen.getTextContent()).toContain('Selected second source');
        expect(screen.getTextContent()).not.toContain('session.messageReply.sourceUnavailable');
        const rehydrated = Object.values(storage.getState().sessionMessages[sessionId]!.messagesById)
            .find((message) => message.kind === 'agent-text' && message.text.includes('Selected'));
        expect(rehydrated?.id).not.toBe(source.id);
        expect(screen.findByTestId('transcript-message-reply-source:sent-reply-excerpt')?.props.numberOfLines).toBe(2);
    });
});
