import { apiSocket } from '@/sync/api/session/apiSocket';
import type { UpdateMetadataAck } from '@/sync/domains/session/metadata/updateSessionMetadataWithRetry';
import { raceSocketIoAckTimeout } from '@/sync/runtime/socketIoAckTimeout';

import { createEphemeralServerSocketClient } from './createEphemeralServerSocketClient';
import { resolvePreferredServerIdForSessionId } from './resolvePreferredServerIdForSessionId';
import { resolveServerScopedSessionContext, runWithCurrentServerScopedSessionContext } from './resolveServerScopedSessionContext';

export async function emitSessionMetadataUpdateWithServerScope(params: Readonly<{
    sessionId: string;
    expectedVersion: number;
    metadata: string;
    serverId?: string | null;
    accountId?: string | null;
    shouldContinue?: () => boolean;
    timeoutMs?: number;
}>): Promise<UpdateMetadataAck> {
    const assertCurrent = () => { if (params.shouldContinue?.() === false) throw new Error('cancelled'); };
    assertCurrent();
    const accountId = params.accountId?.trim() || null;
    const context = await resolveServerScopedSessionContext({
        serverId: typeof params.serverId === 'string' && params.serverId.trim().length > 0
            ? params.serverId.trim()
            : resolvePreferredServerIdForSessionId(params.sessionId),
        timeoutMs: params.timeoutMs,
        ...(accountId ? { preferScoped: true } : {}),
    });
    assertCurrent();
    if (accountId && (context.scope !== 'scoped' || context.targetAccountId !== accountId)) throw new Error('cancelled');
    const payload = {
        sid: params.sessionId,
        expectedVersion: params.expectedVersion,
        metadata: params.metadata,
    };

    if (context.scope === 'active') {
        return await apiSocket.emitWithAck<UpdateMetadataAck>('update-metadata', payload, { timeoutMs: context.timeoutMs });
    }

    const socket = await createEphemeralServerSocketClient({
        serverUrl: context.targetServerUrl,
        token: context.token,
        timeoutMs: context.timeoutMs,
    });
    try {
        const emit = () => raceSocketIoAckTimeout(
            socket.timeout(context.timeoutMs).emitWithAck('update-metadata', payload) as Promise<UpdateMetadataAck>,
            context.timeoutMs,
        );
        assertCurrent();
        if (accountId) {
            let pending: Promise<UpdateMetadataAck> | null = null;
            const issued = await runWithCurrentServerScopedSessionContext(context, () => { assertCurrent(); pending = emit(); });
            if (!issued || !pending) throw new Error('cancelled');
            return await pending;
        }
        return await emit();
    } finally {
        socket.disconnect();
    }
}
