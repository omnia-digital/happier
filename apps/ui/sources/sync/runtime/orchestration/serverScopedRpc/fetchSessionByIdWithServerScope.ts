import type { AuthCredentials } from '@/auth/storage/tokenStorage';
import type { Session } from '@/sync/domains/state/storageTypes';
import { fetchAndApplySessionById, type SessionByIdEncryption } from '@/sync/engine/sessions/sessionById';
import { runtimeFetchWithServerReachability } from '@/sync/runtime/connectivity/serverReachabilityRuntimeFetch';
import { storage } from '@/sync/domains/state/storage';
import { resolveUiClientEncryptionRequirement } from '@/sync/domains/settings/clientEncryptionRequirement';

import { isServerScopedSessionContextCurrent, resolveServerScopedSessionContext } from './resolveServerScopedSessionContext';

type AppliedSession = Omit<Session, 'presence'> & { presence?: 'online' | number };

function toScopedFetchCredentials(token: string): AuthCredentials {
    return { token, secret: '' };
}

function getScopedSessionByIdEncryption(context: Readonly<{
    decryptEncryptionKey: (value: string) => Promise<Uint8Array | null>;
    initializeSessions: (keys: Map<string, Uint8Array | null>) => Promise<void>;
    getSessionEncryption: (sessionId: string) => unknown;
}>): SessionByIdEncryption {
    return {
        decryptEncryptionKey: (value) => context.decryptEncryptionKey(value),
        initializeSessions: (keys) => context.initializeSessions(keys),
        getSessionEncryption: (sessionId) => {
            const candidate = context.getSessionEncryption(sessionId);
            if (!candidate || typeof candidate !== 'object') {
                return null;
            }

            const maybeEncryption = candidate as Partial<{
                decryptAgentState: (version: number, value: string | null) => Promise<unknown>;
                decryptMetadata: (version: number, value: string) => Promise<unknown>;
            }>;
            if (typeof maybeEncryption.decryptAgentState !== 'function' || typeof maybeEncryption.decryptMetadata !== 'function') {
                return null;
            }

            return {
                decryptAgentState: maybeEncryption.decryptAgentState.bind(candidate),
                decryptMetadata: maybeEncryption.decryptMetadata.bind(candidate),
            };
        },
    };
}

export async function fetchSessionByIdWithServerScope(params: Readonly<{
    sessionId: string;
    serverId?: string | null;
    activeCredentials: AuthCredentials;
    activeEncryption?: SessionByIdEncryption | null;
    sessionDataKeys: Map<string, Uint8Array>;
    sessionDataKeyEnvelopes?: Map<string, string>;
    activeRequest: (path: string, init: RequestInit) => Promise<Response>;
    applySessions: (sessions: AppliedSession[]) => void | boolean;
    getExistingSession?: (sessionId: string) => Session | null | undefined;
    log: { log: (message: string) => void };
    timeoutMs?: number;
    includeTurnsProjection?: boolean;
}>): Promise<Awaited<ReturnType<typeof fetchAndApplySessionById>>> {
    const currentSettings = storage.getState().settings;
    const clientEncryptionRequirement = resolveUiClientEncryptionRequirement({
        syncedSettings: currentSettings,
        localSettings: currentSettings,
    });
    const context = await resolveServerScopedSessionContext({
        serverId: params.serverId ?? null,
        timeoutMs: params.timeoutMs,
    });

    if (context.scope === 'active') {
        if (!params.activeEncryption) {
            throw new Error(`Active session encryption is required to hydrate session ${params.sessionId}`);
        }
        return await fetchAndApplySessionById({
            sessionId: params.sessionId,
            serverId: params.serverId ?? null,
            credentials: params.activeCredentials,
            encryption: params.activeEncryption,
            sessionDataKeys: params.sessionDataKeys,
            sessionDataKeyEnvelopes: params.sessionDataKeyEnvelopes,
            request: params.activeRequest,
            applySessions: params.applySessions,
            getExistingSession: params.getExistingSession,
            log: params.log,
            timeoutMs: params.timeoutMs,
            includeTurnsProjection: params.includeTurnsProjection,
            clientEncryptionRequirement,
        });
    }

    // Scoped encryption belongs to the captured account. Keep its cache changes private until
    // that account is still current at the session commit boundary.
    const sessionId = params.sessionId.trim();
    const cachedKey = params.sessionDataKeys.get(sessionId);
    const cachedEnvelope = params.sessionDataKeyEnvelopes?.get(sessionId);
    const stagedKeys = new Map(cachedKey ? [[sessionId, cachedKey]] : []);
    const stagedEnvelopes = new Map(cachedEnvelope ? [[sessionId, cachedEnvelope]] : []);
    return await fetchAndApplySessionById({
        sessionId: params.sessionId,
        serverId: context.targetServerId,
        credentials: toScopedFetchCredentials(context.token),
        encryption: getScopedSessionByIdEncryption(context.encryption),
        sessionDataKeys: stagedKeys,
        sessionDataKeyEnvelopes: stagedEnvelopes,
        request: async (path: string, init: RequestInit) => {
            return await runtimeFetchWithServerReachability({
                serverUrl: context.targetServerUrl,
                token: context.token,
                url: `${context.targetServerUrl}${path}`,
                init: {
                    ...init,
                    headers: {
                        ...(init.headers ?? {}),
                        Authorization: `Bearer ${context.token}`,
                    },
                },
            });
        },
        applySessions: async (sessions) => {
            if (!await isServerScopedSessionContextCurrent(context)) {
                params.log.log(`[sessionById] Ignoring session ${params.sessionId} after target account changed`);
                return false;
            }
            if (params.applySessions(sessions) === false) return false;
            const key = stagedKeys.get(sessionId);
            if (key) params.sessionDataKeys.set(sessionId, key);
            else params.sessionDataKeys.delete(sessionId);
            const envelope = stagedEnvelopes.get(sessionId);
            if (envelope) params.sessionDataKeyEnvelopes?.set(sessionId, envelope);
            else params.sessionDataKeyEnvelopes?.delete(sessionId);
        },
        getExistingSession: params.getExistingSession,
        log: params.log,
        timeoutMs: params.timeoutMs,
        includeTurnsProjection: params.includeTurnsProjection,
        clientEncryptionRequirement,
    });
}
