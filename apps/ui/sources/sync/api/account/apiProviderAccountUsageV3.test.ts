import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildProviderAccountUsageRecordId, PROVIDER_ACCOUNT_SUBSCRIPTION_ACCEPT } from '@happier-dev/protocol';

// Active server selection is an environment boundary; the HTTP adapter and parsing remain real.
vi.mock('@/sync/domains/server/serverRuntime', () => ({
  getActiveServerSnapshot: () => ({ serverId: 'test', serverUrl: 'https://api.example.test', kind: 'custom', generation: 1 }),
}));

afterEach(() => vi.unstubAllGlobals());

describe('provider account usage plaintext transport', () => {
  it('distinguishes an older relay collection-route 404 from authentication failure', async () => {
    const requestUrl = (input: RequestInfo | URL) => input instanceof Request ? input.url : String(input);
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => (
      requestUrl(input).endsWith('/health') || requestUrl(input).endsWith('/v1/auth/ping')
        ? { ok: true, status: 200, json: async () => ({ ok: true }) }
        : { ok: false, status: 404, json: async () => ({ error: 'not_found' }) }
    ));
    vi.stubGlobal('fetch', fetchMock);
    const { listProviderAccountUsageRecords } = await import('./apiProviderAccountUsageV3');
    const credentials = { token: 'token', secret: 'secret' };
    expect(await listProviderAccountUsageRecords(credentials)).toBe('unsupported');
    expect(fetchMock.mock.calls.some(([url]) => requestUrl(url).includes('/v3/connect/provider-account-usage'))).toBe(true);

    fetchMock.mockImplementation(async (input) => (
      requestUrl(input).endsWith('/health') || requestUrl(input).endsWith('/v1/auth/ping')
        ? { ok: true, status: 200, json: async () => ({ ok: true }) }
        : { ok: false, status: 401, json: async () => ({ error: 'unauthorized' }) }
    ));
    await expect(listProviderAccountUsageRecords(credentials)).rejects.toMatchObject({ status: 401 });
  });

  it('restores supplemental subscription and credit facts without losing legacy usage data', async () => {
    const recordKey = { providerId: 'codex', accountSubjectId: 'account', subjectKind: 'account', quotaScope: 'account' } as const;
    const snapshot = {
      v: 1, recordId: buildProviderAccountUsageRecordId(recordKey), recordKey, providerId: 'codex',
      accountSubject: { kind: 'providerSubject', id: 'account' }, observedAtMs: 1_000, fetchedAtMs: 1_000,
      staleAfterMs: 60_000, source: 'providerHttp', confidence: 'confirmed', state: 'loaded_empty', meters: [],
    };
    const subscription = { status: 'none', renewal: 'unknown', observedAtMs: 500, staleAfterMs: 60_000 };
    const recoveryCreditDetails = { saved: {
      remainingCount: 2, appliesToProviderLimitIds: ['seven_day'], unavailableReason: 'paused',
    } };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => String(input).endsWith('/health') || String(input).endsWith('/v1/auth/ping')
        ? { ok: true }
        : {
          content: { t: 'plain', v: snapshot }, subscription, recoveryCreditDetails,
          metadata: { fetchedAt: 1_000, staleAfterMs: 60_000, status: 'ok' },
        },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const { getProviderAccountUsageSnapshotPlain } = await import('./apiProviderAccountUsageV3');
    const result = await getProviderAccountUsageSnapshotPlain({ token: 'token', secret: 'secret' }, { recordId: snapshot.recordId });
    expect(result).toEqual({ ...snapshot, subscription, recoveryCreditDetails });
    const usageRequest = fetchMock.mock.calls.find(([url]) => String(url).includes('/provider-account-usage/'));
    expect(new Headers(usageRequest?.[1]?.headers).get('Accept')).toBe(PROVIDER_ACCOUNT_SUBSCRIPTION_ACCEPT);
  });
});
