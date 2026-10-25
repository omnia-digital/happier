import type { AuthCredentials } from '@/auth/storage/tokenStorage';
import { serverFetch } from '@/sync/http/client';
import { HappyError } from '@/utils/errors/errors';
import { backoff } from '@/utils/timing/time';

import {
  ProviderAccountUsageRecordIdSchema,
  ProviderAccountUsageRecordListV1Schema,
  PROVIDER_ACCOUNT_SUBSCRIPTION_ACCEPT,
  ProviderAccountUsageSnapshotV1Schema,
  StoredJsonContentEnvelopeSchema,
  type ProviderAccountUsageRecordId,
  type ProviderAccountUsageSnapshotV1,
  type ProviderAccountUsageRecordListV1,
} from '@happier-dev/protocol';
import { z } from 'zod';

function extractErrorCode(json: unknown): string | null {
  if (!json || typeof json !== 'object') return null;
  const obj = json as Record<string, unknown>;
  return typeof obj.error === 'string' ? obj.error : null;
}

const ProviderAccountUsageV3ResponseSchema = z.object({
  content: StoredJsonContentEnvelopeSchema,
  subscription: z.unknown().optional(),
  recoveryCreditDetails: z.unknown().optional(),
  metadata: z.object({
    fetchedAt: z.number().int().nonnegative(),
    staleAfterMs: z.number().int().nonnegative(),
    status: z.enum(['ok', 'unavailable', 'estimated', 'error']),
    refreshRequestedAt: z.number().int().nonnegative().optional(),
  }),
});

/** A missing collection route means this relay predates account-wide discovery. */
export async function listProviderAccountUsageRecords(
  credentials: AuthCredentials,
  opts?: Readonly<{ signal?: AbortSignal }>,
): Promise<ProviderAccountUsageRecordListV1 | 'unsupported'> {
  return await backoff(async () => {
    const response = await serverFetch('/v3/connect/provider-account-usage', {
      method: 'GET',
      signal: opts?.signal,
      headers: { Authorization: `Bearer ${credentials.token}` },
    }, { includeAuth: false });
    if (response.status === 404) return 'unsupported';
    if (!response.ok) {
      throw new HappyError('Failed to discover provider account usage', false, {
        status: response.status,
        kind: 'server',
      });
    }
    const parsed = ProviderAccountUsageRecordListV1Schema.safeParse(await response.json());
    if (!parsed.success) throw new Error('Invalid provider account usage discovery response');
    return parsed.data;
  });
}

export async function getProviderAccountUsageSnapshotPlain(
  credentials: AuthCredentials,
  params: Readonly<{ recordId: ProviderAccountUsageRecordId | string }>,
  opts?: Readonly<{ signal?: AbortSignal }>,
): Promise<ProviderAccountUsageSnapshotV1 | null> {
  const recordId = ProviderAccountUsageRecordIdSchema.parse(params.recordId);
  return await backoff(async () => {
    const response = await serverFetch(
      `/v3/connect/provider-account-usage/${encodeURIComponent(recordId)}`,
      {
        method: 'GET',
        signal: opts?.signal,
        headers: {
          Authorization: `Bearer ${credentials.token}`,
          'Content-Type': 'application/json',
          Accept: PROVIDER_ACCOUNT_SUBSCRIPTION_ACCEPT,
        },
      },
      { includeAuth: false },
    );

    if (response.status === 404) return null;

    if (!response.ok) {
      if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) {
        let message = 'Failed to load provider account usage';
        try {
          const json = await response.json();
          message = extractErrorCode(json) ?? message;
        } catch {
          // ignore
        }
        throw new HappyError(message, false, { status: response.status, kind: 'server' });
      }
      throw new Error(`Failed to load provider account usage: ${response.status}`);
    }

    const json: unknown = await response.json();
    const parsed = ProviderAccountUsageV3ResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new Error('Invalid provider account usage response');
    }

    if (parsed.data.content.t !== 'plain') return null;

    const baseSnapshot = ProviderAccountUsageSnapshotV1Schema.safeParse(parsed.data.content.v);
    const snapshot = baseSnapshot.success && (parsed.data.subscription !== undefined || parsed.data.recoveryCreditDetails !== undefined)
      ? ProviderAccountUsageSnapshotV1Schema.safeParse({
        ...baseSnapshot.data,
        ...(parsed.data.subscription !== undefined ? { subscription: parsed.data.subscription } : {}),
        ...(parsed.data.recoveryCreditDetails !== undefined ? { recoveryCreditDetails: parsed.data.recoveryCreditDetails } : {}),
      })
      : baseSnapshot;
    if (!snapshot.success || snapshot.data.recordId !== recordId) {
      throw new Error('Invalid provider account usage response');
    }
    return snapshot.data;
  });
}
