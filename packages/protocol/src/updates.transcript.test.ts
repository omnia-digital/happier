import { describe, expect, it } from 'vitest';

import { EphemeralUpdateSchema, MessageAckResponseSchema, SessionEndAckResponseSchema, UpdateBodySchema } from './updates.js';

describe('updates transcript vNext payloads', () => {
  it('parses message-updated payload', () => {
    const parsed = UpdateBodySchema.safeParse({
      t: 'message-updated',
      sid: 'sess_1',
      message: {
        id: 'm1',
        seq: 1,
        content: { t: 'encrypted', c: 'cipher' },
        localId: 'l1',
        sidechainId: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.t).toBe('message-updated');
  });

  it('parses new-message payloads with sidechainId', () => {
    const parsed = UpdateBodySchema.safeParse({
      t: 'new-message',
      sid: 'sess_1',
      message: {
        id: 'm1',
        seq: 1,
        content: { t: 'encrypted', c: 'cipher' },
        localId: null,
        sidechainId: 'tool_1',
        messageRole: 'user',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.t).toBe('new-message');
    expect(parsed.data.message.messageRole).toBe('user');
  });

  it('parses new-message payloads with trusted message attention impact', () => {
    const parsed = UpdateBodySchema.safeParse({
      t: 'new-message',
      sid: 'sess_1',
      message: {
        id: 'm1',
        seq: 1,
        content: { t: 'encrypted', c: 'cipher' },
        localId: 'provider-quota-wait:openai-codex:happier:reset_at_100',
        messageRole: 'event',
        attentionImpact: {
          affectsUnread: false,
          affectsMeaningfulActivity: false,
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.t).toBe('new-message');
    expect(parsed.data.message.attentionImpact).toEqual({
      affectsUnread: false,
      affectsMeaningfulActivity: false,
    });
  });

  it('rejects new-message payloads with malformed message attention impact', () => {
    const parsed = UpdateBodySchema.safeParse({
      t: 'new-message',
      sid: 'sess_1',
      message: {
        id: 'm1',
        seq: 1,
        content: { t: 'encrypted', c: 'cipher' },
        localId: 'provider-quota-wait:openai-codex:happier:reset_at_100',
        messageRole: 'event',
        attentionImpact: {
          affectsUnread: 'no',
          affectsMeaningfulActivity: false,
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    });

    expect(parsed.success).toBe(false);
  });

  it('rejects new-message payloads with unsupported messageRole values', () => {
    const parsed = UpdateBodySchema.safeParse({
      t: 'new-message',
      sid: 'sess_1',
      message: {
        id: 'm1',
        seq: 1,
        content: { t: 'encrypted', c: 'cipher' },
        localId: null,
        messageRole: 'tool',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    });

    expect(parsed.success).toBe(false);
  });

  it('parses new-message payloads with unknown additional fields (rolling upgrade safety)', () => {
    const parsed = UpdateBodySchema.safeParse({
      t: 'new-message',
      sid: 'sess_1',
      message: {
        id: 'm1',
        seq: 1,
        content: { t: 'encrypted', c: 'cipher' },
        localId: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        extraFieldAddedInFuture: { anything: true },
      },
    });

    expect(parsed.success).toBe(true);
  });

  it('parses execution-run-updated ephemerals', () => {
    const parsed = EphemeralUpdateSchema.safeParse({
      type: 'execution-run-updated',
      sessionId: 'sess_1',
      run: {
        runId: 'run_1',
        callId: 'call_1',
        sidechainId: 'call_1',
        intent: 'review',
        backendTarget: { kind: 'builtInAgent', agentId: 'claude' },
        permissionMode: 'read_only',
        retentionPolicy: 'ephemeral',
        runClass: 'bounded',
        ioMode: 'request_response',
        status: 'running',
        startedAtMs: Date.now(),
      },
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.type).toBe('execution-run-updated');
  });

  it('parses transcript-stream-segment ephemerals', () => {
    const parsed = EphemeralUpdateSchema.safeParse({
      type: 'transcript-stream-segment',
      sessionId: 'sess_1',
      message: {
        localId: 'segment_1',
        sidechainId: 'tool_1',
        content: {
          t: 'plain',
          v: {
            role: 'agent',
            content: {
              type: 'acp',
              provider: 'codex',
              data: { type: 'message', message: 'Hello' },
            },
            meta: {
              happierStreamSegmentV1: {
                v: 1,
                segmentKind: 'assistant',
                segmentLocalId: 'segment_1',
                segmentState: 'streaming',
                startedAtMs: 1_000,
                updatedAtMs: 1_010,
              },
            },
          },
        },
        messageRole: 'agent',
        createdAt: 1_000,
        updatedAt: 1_010,
      },
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.type).toBe('transcript-stream-segment');
    expect(parsed.data.message.localId).toBe('segment_1');
    expect(parsed.data.message.messageRole).toBe('agent');
  });

  it('parses transcript-stream-segment ephemerals with a live-stream tick checkpoint anchor', () => {
    const parsed = EphemeralUpdateSchema.safeParse({
      type: 'transcript-stream-segment',
      sessionId: 'sess_1',
      message: {
        localId: 'segment_1',
        content: { t: 'encrypted', c: 'cipher' },
        messageRole: 'agent',
        tick: 25,
        createdAt: 1_000,
        updatedAt: 1_010,
      },
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.type).toBe('transcript-stream-segment');
    if (parsed.data.type !== 'transcript-stream-segment') return;
    expect(parsed.data.message.tick).toBe(25);
  });

  it('parses transcript-stream-segment-delta ephemerals', () => {
    const parsed = EphemeralUpdateSchema.safeParse({
      type: 'transcript-stream-segment-delta',
      sessionId: 'sess_1',
      message: {
        localId: 'segment_1',
        sidechainId: 'tool_1',
        content: { t: 'encrypted', c: 'cipher-of-delta-only' },
        messageRole: 'agent',
        tick: 3,
        baseLength: 120,
        createdAt: 1_000,
        updatedAt: 1_010,
      },
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.type).toBe('transcript-stream-segment-delta');
    if (parsed.data.type !== 'transcript-stream-segment-delta') return;
    expect(parsed.data.message.tick).toBe(3);
    expect(parsed.data.message.baseLength).toBe(120);
  });

  it('rejects transcript-stream-segment-delta ephemerals without tick/baseLength chaining fields', () => {
    const base = {
      type: 'transcript-stream-segment-delta',
      sessionId: 'sess_1',
      message: {
        localId: 'segment_1',
        content: { t: 'encrypted', c: 'cipher' },
        messageRole: 'agent',
        createdAt: 1_000,
        updatedAt: 1_010,
      },
    };

    expect(EphemeralUpdateSchema.safeParse(base).success).toBe(false);
    expect(
      EphemeralUpdateSchema.safeParse({
        ...base,
        message: { ...base.message, tick: 1 },
      }).success,
    ).toBe(false);
    expect(
      EphemeralUpdateSchema.safeParse({
        ...base,
        message: { ...base.message, tick: 0, baseLength: 0 },
      }).success,
    ).toBe(false);
    expect(
      EphemeralUpdateSchema.safeParse({
        ...base,
        message: { ...base.message, tick: 1, baseLength: -1 },
      }).success,
    ).toBe(false);
  });

  it('parses transcript-stream-segment-delta ephemerals with unknown additional fields (rolling upgrade safety)', () => {
    const parsed = EphemeralUpdateSchema.safeParse({
      type: 'transcript-stream-segment-delta',
      sessionId: 'sess_1',
      message: {
        localId: 'segment_1',
        content: { t: 'plain', v: { role: 'agent', content: { type: 'acp', provider: 'codex', data: { type: 'message', message: 'delta' } } } },
        tick: 1,
        baseLength: 0,
        createdAt: 1_000,
        updatedAt: 1_010,
        futureField: true,
      },
      futureTopLevel: 1,
    });

    expect(parsed.success).toBe(true);
  });

  it('parses direct-session transcript delta ephemerals', () => {
    const parsed = EphemeralUpdateSchema.safeParse({
      type: 'direct-session-transcript-delta',
      sessionId: 'sess_1',
      items: [
        {
          id: 'a2',
          createdAtMs: 1_050,
          localId: 'direct-2',
          raw: {
            type: 'assistant',
            uuid: 'a2',
            message: {
              model: 'm',
              content: [{ type: 'text', text: 'hello from push' }],
            },
          },
        },
      ],
      fromCursor: 'cursor-1',
      nextCursor: 'cursor-2',
      truncated: false,
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.type).toBe('direct-session-transcript-delta');
    expect(parsed.data.items).toHaveLength(1);
    expect(parsed.data.fromCursor).toBe('cursor-1');
  });

  it('rejects non-truncated direct-session cursor advancement without fromCursor', () => {
    const parsed = EphemeralUpdateSchema.safeParse({
      type: 'direct-session-transcript-delta',
      sessionId: 'sess_1',
      items: [],
      nextCursor: 'cursor-2',
      truncated: false,
    });

    expect(parsed.success).toBe(false);
  });

  it('requires anchored cursor advancement for page-limit direct-session deltas', () => {
    expect(EphemeralUpdateSchema.safeParse({
      type: 'direct-session-transcript-delta',
      sessionId: 'sess_1',
      items: [],
      nextCursor: 'cursor-2',
      truncated: true,
      truncationReason: 'page_limit',
    }).success).toBe(false);
    expect(EphemeralUpdateSchema.safeParse({
      type: 'direct-session-transcript-delta',
      sessionId: 'sess_1',
      items: [],
      fromCursor: 'cursor-1',
      nextCursor: null,
      truncated: true,
      truncationReason: 'page_limit',
    }).success).toBe(false);
  });

  it('parses message ack responses with didUpdate', () => {
    const parsed = MessageAckResponseSchema.safeParse({
      ok: true,
      id: 'm1',
      seq: 1,
      localId: 'l1',
      didWrite: false,
      didUpdate: true,
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.ok).toBe(true);
  });

  it('accepts persisted creation time in new message ACKs and older ACKs without it', () => {
    const newAck = MessageAckResponseSchema.parse({
      ok: true,
      id: 'm1',
      seq: 1,
      localId: 'l1',
      createdAt: 42_000,
    });
    const oldAck = MessageAckResponseSchema.parse({
      ok: true,
      id: 'm1',
      seq: 1,
      localId: 'l1',
    });

    expect(newAck.ok && newAck.createdAt).toBe(42_000);
    expect(oldAck.ok && oldAck.createdAt).toBeUndefined();
  });

  it('parses message ack responses with forward-compatible extra fields', () => {
    const parsed = MessageAckResponseSchema.safeParse({
      ok: true,
      id: 'm1',
      seq: 1,
      localId: 'l1',
      didWrite: true,
      extraFromFutureServer: { whatever: true },
    });

    expect(parsed.success).toBe(true);
  });

  it('parses socket session-end ack responses', () => {
    const parsed = SessionEndAckResponseSchema.safeParse({
      ok: true,
      applied: true,
      time: 1234,
      active: false,
      activeAt: null,
      latestTurnId: 'turn-1',
      latestTurnStatus: 'completed',
      latestTurnStatusObservedAt: 1235,
      lastRuntimeIssue: null,
      extraFromFutureServer: true,
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.ok).toBe(true);
    expect(parsed.data.active).toBe(false);
  });

  it('parses socket session-end ack failures', () => {
    const parsed = SessionEndAckResponseSchema.safeParse({
      ok: false,
      error: 'session-not-found',
    });

    expect(parsed.success).toBe(true);
  });

  it('parses update-session payloads with forward-compatible versioned fields', () => {
    const parsed = UpdateBodySchema.safeParse({
      t: 'update-session',
      id: 'sess_1',
      metadata: {
        value: 'cipher',
        version: 1,
        futureField: { ok: true },
      },
      agentState: {
        value: null,
        version: 2,
        anotherFutureField: 'hello',
      },
      active: false,
      activeAt: 1_233,
      archivedAt: 1_234,
    });

    expect(parsed.success).toBe(true);
    expect(parsed.data).toMatchObject({ active: false, activeAt: 1_233 });
  });
});
