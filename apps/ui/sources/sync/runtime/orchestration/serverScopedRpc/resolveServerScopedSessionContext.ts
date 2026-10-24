import { TokenStorage } from '@/auth/storage/tokenStorage';
import { createEncryptionFromAuthCredentials } from '@/auth/encryption/createEncryptionFromAuthCredentials';
import {
  areServerProfileIdentifiersEquivalent,
  getServerProfileById,
  resolveServerProfileScopeIdForIdentifier,
} from '@/sync/domains/server/serverProfiles';
import { getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';
import { parseToken } from '@/utils/auth/parseToken';

import type { ScopedRpcSessionEncryptionContext } from './serverScopedRpcTypes';

function normalizeId(raw: unknown): string {
  return String(raw ?? '').trim();
}

export type ResolvedServerSessionRpcContext =
  | Readonly<{ scope: 'active'; timeoutMs: number }>
  | Readonly<{
      scope: 'scoped';
      timeoutMs: number;
      targetServerId: string;
      targetServerUrl: string;
      targetAccountId: string;
      token: string;
      encryption: ScopedRpcSessionEncryptionContext;
    }>;

async function buildScopedContext(params: Readonly<{
  serverId: string;
  serverUrl: string;
  timeoutMs: number;
}>): Promise<Extract<ResolvedServerSessionRpcContext, { scope: 'scoped' }>> {
  const credentials = await TokenStorage.getCredentialsForServerUrl(params.serverUrl, { serverId: params.serverId });
  if (!credentials) {
    throw new Error(`No authentication credentials for target server "${params.serverId}"`);
  }

  const encryption = (await createEncryptionFromAuthCredentials(credentials)) as ScopedRpcSessionEncryptionContext;
  return {
    scope: 'scoped',
    timeoutMs: params.timeoutMs,
    targetServerId: params.serverId,
    targetServerUrl: params.serverUrl,
    targetAccountId: parseToken(credentials.token),
    token: credentials.token,
    encryption,
  };
}

export async function resolveServerScopedSessionContext(params: Readonly<{
  serverId?: string | null;
  timeoutMs?: number;
  preferScoped?: boolean;
}>): Promise<ResolvedServerSessionRpcContext> {
  const targetServerId = normalizeId(params.serverId);
  const timeoutMs = typeof params.timeoutMs === 'number' && params.timeoutMs > 0 ? params.timeoutMs : 30_000;
  const activeSnapshot = getActiveServerSnapshot();

  const activeServerId = normalizeId(activeSnapshot.serverId);
  const targetsActiveServer = !targetServerId || areServerProfileIdentifiersEquivalent(targetServerId, activeServerId);
  if (targetsActiveServer) {
    if (params.preferScoped === true) {
      return await buildScopedContext({
        serverId: activeServerId,
        serverUrl: activeSnapshot.serverUrl,
        timeoutMs,
      });
    }
    return { scope: 'active', timeoutMs };
  }

  const resolvedTargetServerId = resolveServerProfileScopeIdForIdentifier(targetServerId);
  const targetProfile = getServerProfileById(resolvedTargetServerId);
  if (!targetProfile) {
    throw new Error(`Target server profile not found for serverId "${resolvedTargetServerId}"`);
  }

  return await buildScopedContext({
    serverId: resolvedTargetServerId,
    serverUrl: targetProfile.serverUrl,
    timeoutMs,
  });
}

type CapturedServerAccountContext = Pick<Extract<ResolvedServerSessionRpcContext, { scope: 'scoped' }>,
  'targetServerId' | 'targetServerUrl' | 'targetAccountId'>;

/** Revalidate the captured Home/account after awaited work. */
export function isServerScopedSessionContextCurrent(context: CapturedServerAccountContext): Promise<boolean> {
  return runWithCurrentServerScopedSessionContext(context, () => {});
}

/** Publish or emit synchronously with the final credential check, without another await gap. */
export async function runWithCurrentServerScopedSessionContext(
  context: CapturedServerAccountContext,
  action: () => void,
): Promise<boolean> {
  let credentialsChanged = false;
  const unsubscribe = TokenStorage.subscribeCredentialChanges(() => { credentialsChanged = true; });
  try {
    let credentials;
    do {
      credentialsChanged = false;
      credentials = await TokenStorage.getCredentialsForServerUrl(context.targetServerUrl, {
        serverId: context.targetServerId,
      });
      // An in-flight storage read can return the preceding credentials. The credential
      // owner tells us when to re-read; same-account token rotation remains valid.
    } while (credentialsChanged);
    const profile = getServerProfileById(context.targetServerId);
    if (!profile || profile.serverUrl !== context.targetServerUrl
      || !credentials || parseToken(credentials.token) !== context.targetAccountId) return false;
    action();
    return true;
  } finally {
    unsubscribe();
  }
}
