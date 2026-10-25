import type { ProviderAccountUsageRecordSummaryV1 } from '@happier-dev/protocol';
import { resolveConnectedServiceDefaultProfileId } from '@/sync/domains/connectedServices/connectedServiceProfilePreferences';
import { shouldHideQuotaForCredentialStatus } from '@/sync/domains/connectedServices/shouldHideQuotaForCredentialStatus';

type ProviderId = 'claude' | 'codex';
export type SidebarProviderUsageOption =
    | Readonly<{ kind: 'connected'; key: string; serviceId: string; profileId: string }>
    | Readonly<{ kind: 'native'; key: string; recordId: string; record: ProviderAccountUsageRecordSummaryV1 }>;

export function selectSidebarProviderUsageAccount(input: Readonly<{
    providerId: ProviderId;
    connectedProfiles: ReadonlyArray<{ profileId: string; status?: unknown }>;
    nativeRecords: ReadonlyArray<ProviderAccountUsageRecordSummaryV1>;
    defaultProfileByServiceId: Readonly<Record<string, string | undefined>>;
    choiceKey: string | null;
}>): Readonly<{ options: readonly SidebarProviderUsageOption[]; selected: SidebarProviderUsageOption | null }> {
    const serviceId = input.providerId === 'claude' ? 'claude-subscription' : 'openai-codex';
    const connected = input.connectedProfiles
        .filter((profile) => !shouldHideQuotaForCredentialStatus(profile.status))
        .map((profile): SidebarProviderUsageOption => ({
            kind: 'connected', key: `connected:${serviceId}:${profile.profileId}`, serviceId, profileId: profile.profileId,
        }));
    const native = input.nativeRecords
        .filter((record) => record.recordKey.providerId === input.providerId)
        .map((record): SidebarProviderUsageOption => ({
            kind: 'native', key: `native:${record.recordId}`, recordId: record.recordId, record,
        }));
    const options = [...connected, ...native];
    const explicit = options.find((option) => option.key === input.choiceKey);
    if (explicit) return { options, selected: explicit };
    const defaultProfileId = resolveConnectedServiceDefaultProfileId({
        serviceId,
        connectedProfileIds: connected.map((option) => option.kind === 'connected' ? option.profileId : ''),
        defaultProfileByServiceId: input.defaultProfileByServiceId,
    });
    const selected = connected.find((option) => option.kind === 'connected' && option.profileId === defaultProfileId)
        ?? (native.length === 1 ? native[0] : null)
        ?? null;
    return { options, selected };
}
