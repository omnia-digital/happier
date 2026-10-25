import * as React from 'react';

import { useAuth } from '@/auth/context/AuthContext';
import { resolveAuthCredentialsScopeKey } from '@/auth/storage/resolveAuthCredentialsScopeKey';
import { useFeatureEnabled } from '@/hooks/server/useFeatureEnabled';
import { useFeatureDecision } from '@/hooks/server/useFeatureDecision';
import {
  readProviderAccountUsageSnapshotFromCache,
  subscribeProviderAccountUsageSnapshotCache,
} from '@/sync/domains/connectedServices/accountUsage/cache';
import {
  accountUsageSnapshotKey,
  getAccountUsageDiscovery,
  getAccountUsageSnapshotStatus,
  retainAccountUsageDiscovery,
  retainAccountUsageSnapshotPolling,
  subscribeAccountUsageDiscovery,
  subscribeAccountUsageSnapshotStatus,
  type AccountUsageDiscovery,
  type AccountUsageSnapshotStatus,
} from '@/sync/domains/connectedServices/accountUsage/pollingStore';
import {
  ProviderAccountUsageRecordIdSchema,
  type ProviderAccountUsageRecordId,
  type ProviderAccountUsageSnapshotV1,
} from '@happier-dev/protocol';
import { useCredentialScopedAccountModeResolver } from './useCredentialScopedAccountModeResolver';

const DISABLED_DISCOVERY = { status: 'disabled', records: null } as const;
const PENDING_DISCOVERY = { status: 'loading', records: null } as const;

function normalizeRecordIds(recordIds: ReadonlyArray<string>): ProviderAccountUsageRecordId[] {
  const ids = new Set<ProviderAccountUsageRecordId>();
  for (const raw of recordIds) {
    const parsed = ProviderAccountUsageRecordIdSchema.safeParse(raw);
    if (parsed.success) ids.add(parsed.data);
  }
  return [...ids].sort();
}

export function useProviderAccountUsageSnapshotState(recordIds: ReadonlyArray<string>): Readonly<{
  snapshotsByRecordId: Record<string, ProviderAccountUsageSnapshotV1 | null>;
  statusByRecordId: Record<string, AccountUsageSnapshotStatus>;
}> {
  const credentials = useAuth().credentials;
  const enabled = useFeatureEnabled('connectedServices.quotas');
  const scope = enabled && credentials ? resolveAuthCredentialsScopeKey(credentials) : '';
  const resolveAccountMode = useCredentialScopedAccountModeResolver({ credentials, credentialScope: scope });
  const signature = normalizeRecordIds(recordIds).join('\u0001');
  const ids = React.useMemo(() => normalizeRecordIds(recordIds), [signature]);
  const context = React.useMemo(() => credentials && scope
    ? { credentials, credentialScope: scope, resolveAccountMode }
    : null, [credentials, scope, resolveAccountMode]);
  const [version, bump] = React.useReducer((value: number) => value + 1, 0);

  React.useEffect(() => {
    if (!context) return;
    const unsubs = [subscribeProviderAccountUsageSnapshotCache({ credentialScope: scope }, bump)];
    for (const id of ids) {
      unsubs.push(subscribeAccountUsageSnapshotStatus(accountUsageSnapshotKey(scope, id), bump));
    }
    const releases = ids.map((id) => retainAccountUsageSnapshotPolling(context, id));
    return () => {
      for (const release of releases) release();
      for (const unsub of unsubs) unsub();
    };
  }, [context, ids, scope]);

  return React.useMemo(() => {
    const snapshotsByRecordId: Record<string, ProviderAccountUsageSnapshotV1 | null> = {};
    const statusByRecordId: Record<string, AccountUsageSnapshotStatus> = {};
    if (!context) return { snapshotsByRecordId, statusByRecordId };
    void version;
    for (const id of ids) {
      snapshotsByRecordId[id] = readProviderAccountUsageSnapshotFromCache({ credentialScope: scope, recordId: id });
      statusByRecordId[id] = getAccountUsageSnapshotStatus(accountUsageSnapshotKey(scope, id));
    }
    return { snapshotsByRecordId, statusByRecordId };
  }, [context, ids, scope, version]);
}

export function useProviderAccountUsageSnapshots(
  recordIds: ReadonlyArray<string>,
): Record<string, ProviderAccountUsageSnapshotV1 | null> {
  return useProviderAccountUsageSnapshotState(recordIds).snapshotsByRecordId;
}

export function useProviderAccountUsageDiscovery(): AccountUsageDiscovery | Readonly<{ status: 'disabled'; records: null }> {
  const credentials = useAuth().credentials;
  const decision = useFeatureDecision('connectedServices.quotas');
  const enabled = decision?.state === 'enabled';
  const scope = enabled && credentials ? resolveAuthCredentialsScopeKey(credentials) : '';
  const resolveAccountMode = useCredentialScopedAccountModeResolver({ credentials, credentialScope: scope });
  const context = React.useMemo(() => credentials && scope
    ? { credentials, credentialScope: scope, resolveAccountMode }
    : null, [credentials, scope, resolveAccountMode]);
  const subscribe = React.useCallback((listener: () => void) => (
    scope ? subscribeAccountUsageDiscovery(scope, listener) : () => {}
  ), [scope]);
  const getSnapshot = React.useCallback(() => (
    scope ? getAccountUsageDiscovery(scope)
      : decision && decision.state !== 'enabled' ? DISABLED_DISCOVERY : PENDING_DISCOVERY
  ), [decision, scope]);
  const discovery = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  React.useEffect(() => context ? retainAccountUsageDiscovery(context) : undefined, [context]);
  return discovery;
}
