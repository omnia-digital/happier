import type { Message } from './messageTypes';
import { z } from 'zod';
import { buildMessageRouteId, resolveSessionMessageRouteId } from './messageRouteIds';
import type { ReducerState } from '@/sync/reducer/reducer';

export type MessageReplyTarget = Readonly<{
    sessionId: string;
    messageId: string;
    role: 'user' | 'assistant';
    seq?: number;
    transcriptBlockIndex?: number;
}>;

export type ReplyableMessage = Extract<Message, { kind: 'user-text' | 'agent-text' }>;

const MessageReplyTargetSchema = z.object({
    sessionId: z.string().min(1),
    messageId: z.string().min(1),
    role: z.enum(['user', 'assistant']),
    seq: z.number().int().nonnegative().optional(),
    transcriptBlockIndex: z.number().int().nonnegative().optional(),
}).strict();

const REPLY_CONTEXT_PREFIX = 'Earlier conversation message (JSON data):\n';
const REPLY_TEXT_SEPARATOR = '\n\nReply to that message:\n';

export class MessageReplySourceUnavailableError extends Error {
    constructor() {
        super('The referenced message context is unavailable.');
        this.name = 'MessageReplySourceUnavailableError';
    }
}

export function readMessageReplyTarget(meta: unknown): MessageReplyTarget | null {
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;
    const parsed = MessageReplyTargetSchema.safeParse((meta as Record<string, unknown>).happierMessageReplyV1);
    return parsed.success ? parsed.data : null;
}

export function createMessageReplyTarget(sessionId: string, message: ReplyableMessage): MessageReplyTarget {
    return {
        sessionId,
        messageId: buildMessageRouteId(message),
        role: message.kind === 'user-text' ? 'user' : 'assistant',
        ...(message.seq !== undefined ? { seq: message.seq } : {}),
        ...(message.transcriptBlockIndex !== undefined ? { transcriptBlockIndex: message.transcriptBlockIndex } : {}),
    };
}

export function resolveMessageReplySource(
    sessionId: string,
    target: MessageReplyTarget,
    messagesById: Readonly<Record<string, Message>>,
    reducerState?: ReducerState | null,
): ReplyableMessage | null {
    if (target.sessionId !== sessionId) return null;
    const matches = (message: Message | undefined): message is ReplyableMessage => {
        if (!message || (message.kind !== 'user-text' && message.kind !== 'agent-text')) return false;
        if ((message.kind === 'user-text' ? 'user' : 'assistant') !== target.role) return false;
        if (target.seq !== undefined && message.seq !== target.seq) return false;
        if (target.transcriptBlockIndex !== undefined && message.transcriptBlockIndex !== target.transcriptBlockIndex) return false;
        return true;
    };
    const internalId = resolveSessionMessageRouteId({ routeMessageId: target.messageId, messagesById, reducerState });
    const indexedMessage = internalId ? messagesById[internalId] : undefined;
    if (matches(indexedMessage)) return indexedMessage;
    // One persisted record can produce several text/tool blocks. The canonical
    // route identifies the record; its seq/block coordinates select the block.
    for (const message of Object.values(messagesById)) {
        if (buildMessageRouteId(message) === target.messageId && matches(message)) return message;
    }
    return null;
}

export function applyMessageReply<T extends { text: string; displayText?: string; metaOverrides?: Record<string, unknown> }>(
    outbound: T,
    target: MessageReplyTarget,
    source: ReplyableMessage,
): T & { displayText: string; metaOverrides: Record<string, unknown> } {
    return {
        ...outbound,
        // JSON keeps source content distinct from the new reply, including source
        // text containing newlines or the human-readable separator itself.
        text: `${REPLY_CONTEXT_PREFIX}${JSON.stringify({ ...target, text: source.text })}${REPLY_TEXT_SEPARATOR}${outbound.text}`,
        displayText: outbound.displayText ?? outbound.text,
        metaOverrides: { ...outbound.metaOverrides, happierMessageReplyV1: target },
    };
}

export function editMessageReplyText(originalText: string, nextText: string, target: MessageReplyTarget): string {
    if (!originalText.startsWith(REPLY_CONTEXT_PREFIX)) throw new MessageReplySourceUnavailableError();
    const separatorIndex = originalText.indexOf(REPLY_TEXT_SEPARATOR, REPLY_CONTEXT_PREFIX.length);
    if (separatorIndex < 0) throw new MessageReplySourceUnavailableError();
    let context: unknown;
    try {
        context = JSON.parse(originalText.slice(REPLY_CONTEXT_PREFIX.length, separatorIndex));
    } catch {
        throw new MessageReplySourceUnavailableError();
    }
    const parsed = MessageReplyTargetSchema.extend({ text: z.string() }).safeParse(context);
    if (!parsed.success) throw new MessageReplySourceUnavailableError();
    const { text: _sourceText, ...identity } = parsed.data;
    if (identity.sessionId !== target.sessionId || identity.messageId !== target.messageId
        || identity.role !== target.role || identity.seq !== target.seq
        || identity.transcriptBlockIndex !== target.transcriptBlockIndex) {
        throw new MessageReplySourceUnavailableError();
    }
    return originalText.slice(0, separatorIndex + REPLY_TEXT_SEPARATOR.length) + nextText;
}
