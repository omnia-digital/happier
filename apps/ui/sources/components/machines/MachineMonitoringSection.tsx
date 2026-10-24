import * as React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { MACHINE_METRICS_REFRESH_MS, type MachineMetricsSnapshot } from '@happier-dev/protocol/capabilities';
import { useActiveServerAccountScope, useAllMachines } from '@/sync/domains/state/storage';
import { useMachineMetrics, useMachineMetricsPolling } from '@/hooks/machine/useMachineMetrics';
import { getMachineDisplayName, isMachineOnline } from '@/utils/sessions/machineUtils';
import { MachineDisplayGlyph } from '@/components/sessions/SessionMachineIdentity';
import { Text } from '@/components/ui/text/Text';
import { Icon } from '@/components/ui/icons/Icon';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import type { ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import { formatByteSize } from '@/utils/files/formatByteSize';

type Metric = { status: 'available'; usagePercent: number } | { status: 'unavailable'; reason: string };
const percent = (value: number) => `${Math.round(value)}%`;
const value = (metric: Metric | undefined) => metric?.status === 'available' ? percent(metric.usagePercent) : '—';
function unavailableReason(metric: { status: string; reason?: string } | undefined): string {
    if (metric?.reason === 'permission-denied') return t('machineMonitoring.permissionDenied');
    if (metric?.reason === 'unsupported-platform') return t('machineMonitoring.unsupportedPlatform');
    if (metric?.reason === 'no-supported-gpu') return t('machineMonitoring.noGpuInterface');
    if (metric?.reason === 'invalid-data') return t('machineMonitoring.invalidData');
    return t('machineMonitoring.unavailable');
}

/** Static disclosure mounts no machine joins, polling or row subscriptions while closed. */
export const MachineMonitoringSection = React.memo(function MachineMonitoringSection() {
    const [expanded, setExpanded] = React.useState(true);
    const { theme } = useUnistyles();
    return <View style={styles.section} testID="machine-monitoring">
        <Pressable testID="machine-monitoring-toggle" accessibilityRole="button" accessibilityLabel={t('machineMonitoring.title')}
            accessibilityState={{ expanded }} onPress={() => setExpanded((previous) => !previous)} style={styles.heading}>
            <Text style={styles.title}>{t('machineMonitoring.title')}</Text>
            <Icon name={expanded ? 'caret-down' : 'caret-right'} size={14} color={theme.colors.text.secondary} />
        </Pressable>
        {expanded ? <MachineMonitoringExpanded /> : null}
    </View>;
});

function MachineMonitoringExpanded() {
    const scope = useActiveServerAccountScope();
    return scope ? <MachineMonitoringMachines serverId={scope.serverId} accountId={scope.accountId} /> : null;
}

function MachineMonitoringMachines({ serverId, accountId }: ServerAccountScope) {
    const machines = useAllMachines();
    const scope = React.useMemo(() => ({ serverId, accountId }), [serverId, accountId]);
    const targets = machines.map((machine) => ({ machineId: machine.id, online: isMachineOnline(machine) }));
    useMachineMetricsPolling(scope, targets);
    return <ScrollView style={styles.rows} contentContainerStyle={styles.rowsContent}>
        {!machines.length ? <Text style={styles.secondary}>{t('machineMonitoring.empty')}</Text> : machines.map((machine) => <MachineMonitoringRow
            key={`${serverId}:${accountId}:${machine.id}`} serverId={serverId} accountId={accountId}
            machineId={machine.id} name={getMachineDisplayName(machine) ?? machine.id} online={isMachineOnline(machine)}
        />)}
        <Text style={styles.secondary}>{t('machineMonitoring.cadence')}</Text>
    </ScrollView>;
}

const MachineMonitoringRow = React.memo(function MachineMonitoringRow({ serverId, accountId, machineId, name, online }: ServerAccountScope & {
    machineId: string; name: string; online: boolean;
}) {
    const { theme } = useUnistyles();
    const scope = React.useMemo(() => ({ serverId, accountId }), [serverId, accountId]);
    const entry = useMachineMetrics(scope, machineId);
    const [expanded, setExpanded] = React.useState(false);
    const snapshot = entry.snapshot;
    const stale = snapshot !== null && (!online || entry.status !== 'ready' || entry.receivedAt === null || Date.now() - entry.receivedAt >= MACHINE_METRICS_REFRESH_MS);
    const stateLabel = !online ? t('status.offline') : entry.status === 'unsupported' ? t('machineMonitoring.olderCli')
        : entry.status === 'error' ? t('machineMonitoring.readFailed') : entry.refreshing || !snapshot ? t('machineMonitoring.loading') : t('status.online');
    const gpu = snapshot?.gpu;
    const gpuValues = gpu?.status === 'available' ? gpu.devices.map((device) => value(device.utilization)).join('/') : '—';
    const loadValues = snapshot?.load.status === 'available' ? snapshot.load.averages.map((number) => number.toFixed(2)).join('/') : '—';
    const metrics = [
        `${t('machineMonitoring.cpu')} ${value(snapshot?.cpu)}`,
        `${t('machineMonitoring.memory')} ${value(snapshot?.memory)}`,
        `${t('machineMonitoring.gpu')} ${gpuValues}`,
        `${t('machineMonitoring.storage')} ${value(snapshot?.storage)}`,
        `${t('machineMonitoring.load')} ${loadValues}`,
    ];
    return <View style={styles.machine} testID={`machine-monitoring-${machineId}`}>
        <Pressable accessibilityRole="button" accessibilityLabel={`${name}. ${stateLabel}. ${metrics.join('. ')}${stale ? `. ${t('machineMonitoring.stale')}` : ''}`}
            accessibilityState={{ expanded }} onPress={() => setExpanded((previous) => !previous)} testID={`machine-monitoring-${machineId}-details`}>
            <View style={styles.identity}>
                <MachineDisplayGlyph serverId={serverId} machineId={machineId} size={14} color={theme.colors.text.secondary} />
                <Text style={styles.name} numberOfLines={1}>{name}</Text>
                <Text style={styles.secondary}>{online ? t('status.online') : t('status.offline')}</Text>
            </View>
            <View style={styles.metrics}>{metrics.map((label, index) => <Text key={index} style={styles.metric}>{label}</Text>)}</View>
            {stale ? <Text style={styles.secondary}>{t('machineMonitoring.stale')}</Text> : null}
            {entry.status !== 'ready' || entry.refreshing ? <Text style={styles.secondary}>{stateLabel}</Text> : null}
        </Pressable>
        {expanded ? <View style={styles.details}>
            <Text style={styles.secondary}>{t('machineMonitoring.cpuDefinition')} {snapshot?.cpu.status === 'available' ? `${(snapshot.cpu.sampleMs / 1000).toFixed(2)} s` : unavailableReason(snapshot?.cpu)}</Text>
            <Text style={styles.secondary}>{t('machineMonitoring.memoryDefinition')} {snapshot?.memory.status === 'available'
                ? `${formatByteSize(snapshot.memory.usedBytes)} / ${formatByteSize(snapshot.memory.totalBytes)}` : unavailableReason(snapshot?.memory)}</Text>
            <Text style={styles.secondary}>{t('machineMonitoring.gpuDefinition')}</Text>
            {gpu?.status === 'available' ? gpu.devices.map((device) => <Text key={device.id} style={styles.secondary}>
                {device.name} · {device.id} · {device.utilization.status === 'available' ? percent(device.utilization.usagePercent) : unavailableReason(device.utilization)}
            </Text>) : <Text style={styles.secondary}>{unavailableReason(gpu)}</Text>}
            <Text style={styles.secondary}>{t('machineMonitoring.storageDefinition')} {snapshot?.storage.status === 'available'
                ? `${formatByteSize(snapshot.storage.usedBytes)} / ${formatByteSize(snapshot.storage.totalBytes)}` : unavailableReason(snapshot?.storage)}</Text>
            {snapshot?.storage.status === 'available' ? <Text style={styles.secondary}>{t('machineMonitoring.volume', { volume: snapshot.storage.volume, path: snapshot.storage.filesystemPath })}</Text> : null}
            <Text style={styles.secondary}>{t('machineMonitoring.loadDefinition')} {snapshot?.load.status === 'available' ? loadValues : unavailableReason(snapshot?.load)}</Text>
            {snapshot ? <Text style={styles.secondary}>{t('machineMonitoring.sampledAt', { time: new Date(snapshot.sampledAt).toLocaleString() })}</Text> : null}
        </View> : null}
    </View>;
});

const styles = StyleSheet.create((theme) => ({
    section: { flexShrink: 1, maxHeight: '35%', paddingHorizontal: 12, paddingBottom: 8 },
    heading: { minHeight: 36, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    title: { ...Typography.default('semiBold'), color: theme.colors.text.secondary },
    rows: { flexShrink: 1 },
    rowsContent: { gap: 10 },
    machine: { gap: 6 },
    identity: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 28 },
    name: { flex: 1, ...Typography.default('semiBold'), color: theme.colors.text.primary },
    metrics: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 10, rowGap: 2 },
    metric: { ...Typography.mono(), color: theme.colors.text.secondary },
    secondary: { ...Typography.default(), color: theme.colors.text.secondary },
    details: { gap: 6, paddingVertical: 6 },
}));
