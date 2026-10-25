import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { AgentInputProviderUsageBadge } from '@/components/sessions/agentInput/components/AgentInputProviderUsageBadge';
import { AgentInputContentPopover } from '@/components/sessions/agentInput/components/AgentInputContentPopover';
import { Text } from '@/components/ui/text/Text';
import { PressableSurface } from '@/components/ui/interaction/PressableSurface';
import { Typography } from '@/constants/Typography';
import { useConnectedServiceQuotaSnapshots } from '@/hooks/server/connectedServices/useConnectedServiceQuotaSnapshots';
import {
    useProviderAccountUsageDiscovery,
    useProviderAccountUsageSnapshotState,
} from '@/hooks/server/connectedServices/useProviderAccountUsageSnapshots';
import { connectedServiceProfileKey, resolveConnectedServiceProfileLabel } from '@/sync/domains/connectedServices/connectedServiceProfilePreferences';
import { computeConnectedServiceQuotaGaugeViewModel } from '@/sync/domains/connectedServices/connectedServiceQuotaGauge';
import { connectedServiceQuotaGaugeFormatter } from '@/sync/domains/connectedServices/connectedServiceQuotaGaugeFormatter';
import { isQuotaGaugeWindowMode } from '@/sync/domains/connectedServices/quotaGaugeWindows';
import { selectProviderUsageDisplaySnapshot } from '@/sync/domains/connectedServices/accountUsage/selectors';
import { resolveDefaultServiceIdForProvider } from '@/sync/domains/connectedServices/accountUsage/projection';
import { nowServerMs } from '@/sync/runtime/time';
import { useIsDataReady, useLocalSettingMutable, useProfile, useSetting } from '@/sync/store/hooks';
import { t } from '@/text';
import type { ProviderAccountUsageRecordSummaryV1 } from '@happier-dev/protocol';
import { formatSidebarNativeUsageIdentity, selectSidebarProviderUsageAccount, type SidebarProviderUsageOption } from './selectSidebarProviderUsageAccount';

type ProviderId = 'claude' | 'codex';
const PROVIDERS = [
    { id: 'claude' as const, name: 'Claude' },
    { id: 'codex' as const, name: 'Codex' },
];

type Discovery = ReturnType<typeof useProviderAccountUsageDiscovery>;

function ProviderUsageTile(props: Readonly<{
    providerId: ProviderId;
    providerName: string;
    connectedProfiles: ReadonlyArray<{ profileId: string; status?: unknown }>;
    records: readonly ProviderAccountUsageRecordSummaryV1[];
    discoveryStatus: Discovery['status'];
    profileReady: boolean;
}>) {
    const styles = stylesheet;
    const [choiceByProviderId, setChoiceByProviderId] = useLocalSettingMutable('sidebarProviderUsageChoiceByProviderId');
    const choiceKey = choiceByProviderId[props.providerId] ?? null;
    const [choiceOpen, setChoiceOpen] = React.useState(false);
    const choiceAnchorRef = React.useRef<View | null>(null);
    const defaultProfileByServiceId = useSetting('connectedServicesDefaultProfileByServiceId');
    const profileLabelsByKey = useSetting('connectedServicesProfileLabelByKey');
    const pinnedMeterIdsByKey = useSetting('connectedServicesQuotaPinnedMeterIdsByKey');
    const windowModes = useSetting('sessionProviderUsageGaugeWindowModes');
    const legacyWindowMode = useSetting('sessionProviderUsageGaugeWindowMode');
    const selection = React.useMemo(() => selectSidebarProviderUsageAccount({
        providerId: props.providerId,
        connectedProfiles: props.connectedProfiles,
        nativeRecords: props.records,
        defaultProfileByServiceId,
        choiceKey,
    }), [choiceKey, defaultProfileByServiceId, props.connectedProfiles, props.providerId, props.records]);
    const selected = selection.selected;
    const nativeIds = React.useMemo(() => choiceOpen
        ? selection.options.flatMap((option) => option.kind === 'native' ? [option.recordId] : [])
        : selected?.kind === 'native' ? [selected.recordId] : [], [choiceOpen, selected, selection.options]);
    const native = useProviderAccountUsageSnapshotState(nativeIds);
    const connectedRefs = React.useMemo(() => selected?.kind === 'connected'
        ? [{ serviceId: selected.serviceId, profileId: selected.profileId }]
        : [], [selected]);
    const connected = useConnectedServiceQuotaSnapshots(connectedRefs);
    const connectedKey = selected?.kind === 'connected'
        ? connectedServiceProfileKey({ serviceId: selected.serviceId, profileId: selected.profileId })
        : null;
    const connectedSnapshot = connectedKey ? connected.snapshotsByKey[connectedKey] ?? null : null;
    const snapshotSource = selectProviderUsageDisplaySnapshot({
        providerId: props.providerId,
        metadataRecordIds: nativeIds,
        accountUsageSnapshotsByRecordId: native.snapshotsByRecordId,
        connectedServiceProfileRef: selected?.kind === 'connected'
            ? { serviceId: selected.serviceId, profileId: selected.profileId, provenance: 'connected_binding_profile' }
            : null,
        connectedServiceQuotaView: connectedSnapshot,
    });
    const accountLabel = selected?.kind === 'connected'
        ? resolveConnectedServiceProfileLabel({
            labelsByKey: profileLabelsByKey, serviceId: selected.serviceId, profileId: selected.profileId,
        }) ?? connectedSnapshot?.accountLabel ?? selected.profileId
        : selected?.kind === 'native'
            ? formatSidebarNativeUsageIdentity(selected.record,
                native.snapshotsByRecordId[selected.recordId]?.accountLabel ?? selected.record.recordKey.accountSubjectId)
            : null;
    const windowMode = isQuotaGaugeWindowMode(legacyWindowMode) ? legacyWindowMode : 'most_constrained';
    const gauge = snapshotSource ? computeConnectedServiceQuotaGaugeViewModel({
        snapshot: snapshotSource.snapshot,
        activeModelId: null,
        windowMode,
        windowModes,
        additionalMeterIds: pinnedMeterIdsByKey[connectedServiceProfileKey(snapshotSource.snapshot)] ?? [],
        nowMs: nowServerMs(),
        formatter: connectedServiceQuotaGaugeFormatter,
        providerDisplayName: props.providerName,
        activeAccountDisplayLabel: accountLabel,
    }) : null;
    const nativeStatus = selected?.kind === 'native' ? native.statusByRecordId[selected.recordId] : null;
    const loading = selected?.kind === 'connected'
        ? Boolean(connectedKey && connected.loadingByKey[connectedKey])
        : nativeStatus?.loading ?? false;
    const error = selected?.kind === 'connected'
        ? Boolean(connectedKey && connected.errorByKey[connectedKey])
        : nativeStatus?.error ?? false;
    const sourceLabel = selected?.kind === 'connected'
        ? t('connectedServices.detail.profiles.connected')
        : selected?.kind === 'native' ? t('sidebar.providerUsage.native') : null;
    const emptyStatus = !selected
        ? props.discoveryStatus === 'disabled' ? t('sidebar.providerUsage.disabled')
            : props.discoveryStatus === 'loading' || !props.profileReady ? t('common.loading')
            : props.discoveryStatus === 'unsupported' ? t('sidebar.providerUsage.discoveryUnsupported')
                : props.discoveryStatus === 'error' ? t('common.unavailable')
                    : selection.options.length > 1 ? t('sidebar.providerUsage.chooseAccount') : t('sidebar.providerUsage.noUsageData')
        : loading ? t('common.loading') : error ? t('common.unavailable') : t('common.unavailable');

    const optionLabel = (option: SidebarProviderUsageOption): string => option.kind === 'connected'
        ? `${t('connectedServices.detail.profiles.connected')} · ${resolveConnectedServiceProfileLabel({
            labelsByKey: profileLabelsByKey, serviceId: option.serviceId, profileId: option.profileId,
        }) ?? option.profileId}`
        : `${t('sidebar.providerUsage.native')} · ${formatSidebarNativeUsageIdentity(option.record,
            native.snapshotsByRecordId[option.recordId]?.accountLabel ?? option.record.recordKey.accountSubjectId)}`;

    return (
        <View testID={`sidebar-provider-usage:${props.providerId}`} style={styles.tile}>
            <View style={styles.tileHeading}>
                <Text style={styles.providerName}>{props.providerName}</Text>
                {selection.options.length > 0 ? (
                    <PressableSurface
                        anchorRef={choiceAnchorRef}
                        testID={`sidebar-provider-usage-choice:${props.providerId}`}
                        accessibilityRole="button"
                        accessibilityLabel={`${props.providerName} · ${t('sidebar.providerUsage.chooseAccount')}: ${accountLabel ?? ''}`}
                        accessibilityState={{ expanded: choiceOpen }}
                        onPress={() => setChoiceOpen((open) => !open)}
                        style={styles.choiceButton}
                        focusRingRadius={8}
                        webTooltip={accountLabel ?? t('sidebar.providerUsage.chooseAccount')}
                    >
                        <Text style={styles.choiceText} numberOfLines={1}>
                            {sourceLabel && accountLabel ? `${sourceLabel} · ${accountLabel} ⌄` : `${t('sidebar.providerUsage.chooseAccount')} ⌄`}
                        </Text>
                    </PressableSurface>
                ) : null}
            </View>
            {gauge ? (
                <View style={styles.reading}>
                    <AgentInputProviderUsageBadge
                        viewModel={gauge}
                        testIDPrefix={`sidebar-provider-usage:${props.providerId}`}
                    />
                    {error ? (
                        <Text testID={`sidebar-provider-usage-state:${props.providerId}`} style={styles.status}>
                            {t('sidebar.providerUsage.lastKnownRefreshFailed')}
                        </Text>
                    ) : null}
                </View>
            ) : (
                <Text testID={`sidebar-provider-usage-state:${props.providerId}`} style={styles.status} numberOfLines={1}>
                    {emptyStatus}
                </Text>
            )}
            <AgentInputContentPopover
                open={choiceOpen}
                anchorRef={choiceAnchorRef}
                onRequestClose={() => setChoiceOpen(false)}
                maxWidthCap={340}
                testID={`sidebar-provider-usage-accounts:${props.providerId}`}
                content={(
                    <View style={styles.choiceMenu}>
                        <Text style={styles.menuTitle}>{props.providerName} · {t('sidebar.providerUsage.chooseAccount')}</Text>
                        {selection.options.map((option) => (
                            <PressableSurface
                                key={option.key}
                                testID={`sidebar-provider-usage-option:${props.providerId}:${option.key}`}
                                accessibilityRole="button"
                                accessibilityLabel={optionLabel(option)}
                                accessibilityState={{ selected: selected?.key === option.key }}
                                active={selected?.key === option.key}
                                onPress={() => {
                                    setChoiceByProviderId({ ...choiceByProviderId, [props.providerId]: option.key });
                                    setChoiceOpen(false);
                                }}
                                style={styles.option}
                                focusRingRadius={8}
                                webTooltip={optionLabel(option)}
                            >
                                <Text style={styles.optionText} numberOfLines={1}>{optionLabel(option)}</Text>
                            </PressableSurface>
                        ))}
                        {props.discoveryStatus === 'unsupported' || props.discoveryStatus === 'error' ? (
                            <Text style={styles.status}>
                                {props.discoveryStatus === 'unsupported'
                                    ? t('sidebar.providerUsage.discoveryUnsupported')
                                    : t('sidebar.providerUsage.discoveryError')}
                            </Text>
                        ) : null}
                    </View>
                )}
            />
        </View>
    );
}

export function DesktopSidebarProviderUsage() {
    const styles = stylesheet;
    const profile = useProfile();
    const profileReady = useIsDataReady() && profile !== null;
    const discovery = useProviderAccountUsageDiscovery();
    const services = profile?.connectedServicesV2 ?? [];
    return (
        <View testID="desktop-sidebar-provider-usage" style={styles.row}>
            {PROVIDERS.map((provider) => (
                <ProviderUsageTile
                    key={provider.id}
                    providerId={provider.id}
                    providerName={provider.name}
                    connectedProfiles={services.find((service) => service.serviceId === resolveDefaultServiceIdForProvider(provider.id))?.profiles ?? []}
                    records={discovery.records ?? []}
                    discoveryStatus={discovery.status}
                    profileReady={profileReady}
                />
            ))}
        </View>
    );
}

const stylesheet = StyleSheet.create((theme) => ({
    row: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, width: '100%', paddingTop: 2 },
    tile: { flex: 1, minWidth: 0, gap: 3 },
    tileHeading: { flexDirection: 'column', alignItems: 'flex-start', gap: 1, minWidth: 0 },
    providerName: { ...Typography.pillLabel(), color: theme.colors.text.primary },
    choiceButton: { minHeight: 24, justifyContent: 'center', maxWidth: '100%', borderRadius: 8 },
    choiceText: { ...Typography.pillLabel(), color: theme.colors.text.secondary },
    reading: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 22 },
    status: { ...Typography.pillLabel(), color: theme.colors.text.tertiary },
    choiceMenu: { padding: 12, gap: 8 },
    menuTitle: { ...Typography.pillLabel(), color: theme.colors.text.secondary },
    option: { minHeight: 36, justifyContent: 'center', paddingHorizontal: 8, borderRadius: 8 },
    optionText: { ...Typography.default(), color: theme.colors.text.primary },
}));
