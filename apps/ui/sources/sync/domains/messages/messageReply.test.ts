import { describe, expect, it } from 'vitest';

import { applyMessageReply, createMessageReplyTarget, editMessageReplyText, readMessageReplyTarget, resolveMessageReplySource } from './messageReply';
import type { AgentTextMessage, UserTextMessage } from './messageTypes';
import { createReducer, reducer } from '@/sync/reducer/reducer';
import type { NormalizedMessage } from '@/sync/typesRaw';

const earlier: AgentTextMessage = {
    kind: 'agent-text', id: 'earlier', realID: 'record-a', seq: 3, transcriptBlockIndex: 1,
    localId: null, createdAt: 1, text: 'Use the first approach',
};

describe('contextual message replies', () => {
    it('resolves persisted reply relationships after independently reducing the same raw multi-block source again', () => {
        const raw: NormalizedMessage = {
            id: 'persisted-source-record', seq: 3, localId: null, createdAt: 1, role: 'agent', isSidechain: false,
            content: [
                { type: 'text', text: 'First source block', uuid: 'text-1', parentUUID: null },
                { type: 'tool-call', id: 'tool-1', name: 'Read', input: {}, description: 'Read source', uuid: 'tool-uuid', parentUUID: null },
                { type: 'text', text: 'Second source block', uuid: 'text-2', parentUUID: null },
            ],
        };
        const firstState = createReducer();
        const firstMessages = reducer(firstState, [raw]).messages;
        const secondState = createReducer();
        const secondMessages = reducer(secondState, [raw]).messages;
        const firstBlocks = firstMessages.filter((message): message is AgentTextMessage => message.kind === 'agent-text');
        const secondBlocks = secondMessages.filter((message): message is AgentTextMessage => message.kind === 'agent-text');
        expect(firstBlocks).toHaveLength(2);
        expect(secondBlocks).toHaveLength(2);
        expect(firstBlocks[0]?.id).not.toBe(secondBlocks[0]?.id);
        const rehydratedById = Object.fromEntries(secondMessages.map((message) => [message.id, message]));
        for (const [index, source] of firstBlocks.entries()) {
            const target = JSON.parse(JSON.stringify(createMessageReplyTarget('s1', source)));
            expect(target.messageId).toBe('server:persisted-source-record');
            expect(resolveMessageReplySource('s1', target, rehydratedById, secondState)).toBe(secondBlocks[index]);
        }
    });

    it('resolves the selected earlier block by identity, never by similar or latest text', () => {
        const similar = { ...earlier, id: 'similar', seq: 8, text: earlier.text };
        const latest = { ...earlier, id: 'latest', seq: 9, text: 'Use the latest approach' };
        const target = createMessageReplyTarget('s1', earlier);
        expect(resolveMessageReplySource('s1', target, { earlier, similar, latest })).toBe(earlier);
        expect(resolveMessageReplySource('s2', target, { earlier })).toBeNull();
        expect(resolveMessageReplySource('s1', target, { similar, latest })).toBeNull();
        expect(resolveMessageReplySource('s1', target, { earlier: { ...earlier, transcriptBlockIndex: 2 } })).toBeNull();
    });

    it('puts exact identity and the full source into actual input, preserving visible draft and other metadata', () => {
        const longSource = { ...earlier, text: 'long source\n'.repeat(1000) + 'source ending' };
        const target = createMessageReplyTarget('s1', longSource);
        const outbound = applyMessageReply({
            text: 'Yes\n\n[attached file context]', displayText: 'Yes', metaOverrides: { attachments: ['a'], happier: { kind: 'custom' } },
        }, target, longSource);
        expect(outbound.text).toContain(JSON.stringify({ ...target, text: longSource.text }));
        expect(outbound.text).toContain('Yes\n\n[attached file context]');
        expect(outbound.displayText).toBe('Yes');
        expect(outbound.metaOverrides).toEqual({ attachments: ['a'], happier: { kind: 'custom' }, happierMessageReplyV1: target });
    });

    it('preserves the actual full user source context separately from its display text', () => {
        const user: UserTextMessage = { ...earlier, kind: 'user-text', text: 'hidden prompt context', displayText: 'What about the first approach?' };
        const target = createMessageReplyTarget('s1', user);
        const outbound = applyMessageReply({ text: 'Follow up' }, target, user);
        expect(outbound.displayText).toBe('Follow up');
        expect(outbound.text).toContain('hidden prompt context');
    });

    it('accepts additive reply metadata while leaving legacy and malformed metadata inert', () => {
        const target = createMessageReplyTarget('s1', earlier);
        expect(readMessageReplyTarget({ happierMessageReplyV1: target })).toEqual(target);
        expect(readMessageReplyTarget({ displayText: 'legacy message' })).toBeNull();
        expect(readMessageReplyTarget({ happierMessageReplyV1: { ...target, role: 'tool' } })).toBeNull();
        expect(readMessageReplyTarget({ happierMessageReplyV1: { ...target, seq: -1 } })).toBeNull();
    });

    it('edits a queued reply without losing its already captured source context or accepting a different identity', () => {
        const target = createMessageReplyTarget('s1', earlier);
        const original = applyMessageReply({ text: 'Original reply' }, target, earlier);
        const edited = editMessageReplyText(original.text, 'Changed reply', target);
        expect(edited).toContain(JSON.stringify({ ...target, text: earlier.text }));
        expect(edited).toContain('Changed reply');
        expect(edited).not.toContain('Original reply');
        expect(() => editMessageReplyText(original.text, 'Changed reply', { ...target, messageId: 'other' })).toThrow();
        expect(() => editMessageReplyText('missing source context', 'Changed reply', target)).toThrow();
    });
});
