import { describe, expect, it } from 'vitest';
import { buildProviderAccountUsageRecordId, type ProviderAccountUsageRecordSummaryV1 } from '@happier-dev/protocol';
import { selectSidebarProviderUsageAccount } from './selectSidebarProviderUsageAccount';

function native(accountSubjectId: string): ProviderAccountUsageRecordSummaryV1 {
    const recordKey = { providerId: 'claude', accountSubjectId, subjectKind: 'account', quotaScope: 'account' } as const;
    return { recordId: buildProviderAccountUsageRecordId(recordKey), recordKey,
        payloadMode: 'plain_json_v1', status: 'ok', fetchedAt: 1000, staleAfterMs: 60_000 };
}

describe('selectSidebarProviderUsageAccount', () => {
    it('requires an explicit choice for multiple native accounts and never chooses the freshest', () => {
        const first = native('personal');
        const second = { ...native('work'), fetchedAt: 2000 };
        const input = { providerId: 'claude' as const, connectedProfiles: [], nativeRecords: [first, second],
            defaultProfileByServiceId: {}, choiceKey: null };
        expect(selectSidebarProviderUsageAccount(input).selected).toBeNull();
        expect(selectSidebarProviderUsageAccount({ ...input, choiceKey: `native:${first.recordId}` }).selected).toMatchObject({
            kind: 'native', recordId: first.recordId,
        });
    });

    it('uses the configured connected profile default without merging native records', () => {
        const input = { providerId: 'claude' as const,
            connectedProfiles: [{ profileId: 'personal', status: 'healthy' }, { profileId: 'work', status: 'healthy' }],
            nativeRecords: [native('native')],
            defaultProfileByServiceId: { 'claude-subscription': 'work' }, choiceKey: null };
        expect(selectSidebarProviderUsageAccount(input).selected).toMatchObject({ kind: 'connected', profileId: 'work' });
        expect(selectSidebarProviderUsageAccount(input).options).toHaveLength(3);
    });
});
