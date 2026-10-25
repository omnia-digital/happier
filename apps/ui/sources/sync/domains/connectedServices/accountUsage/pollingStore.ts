import type { AuthCredentials } from '@/auth/storage/tokenStorage';
import { isRuntimeActive, subscribeToRuntimeActiveChange } from '@/utils/runtime/isRuntimeActive';
import { getProviderAccountUsageSnapshotSealed } from '@/sync/api/account/apiProviderAccountUsageV2';
import {
  getProviderAccountUsageSnapshotPlain,
  listProviderAccountUsageRecords,
} from '@/sync/api/account/apiProviderAccountUsageV3';
import { openProviderAccountUsageSnapshot } from './openProviderAccountUsageSnapshot';
import {
  readProviderAccountUsageSnapshotFromCache,
  writeProviderAccountUsageSnapshotToCache,
} from './cache';
import type {
  ProviderAccountUsageRecordId,
  ProviderAccountUsageRecordSummaryV1,
  ProviderAccountUsageSnapshotV1,
} from '@happier-dev/protocol';

type AccountMode = 'plain' | 'e2ee';
export type AccountUsagePollContext = Readonly<{
  credentials: AuthCredentials;
  credentialScope: string;
  resolveAccountMode: () => Promise<AccountMode>;
}>;
export type AccountUsageSnapshotStatus = Readonly<{ loading: boolean; error: boolean }>;
export type AccountUsageDiscovery = Readonly<{
  status: 'loading' | 'ready' | 'unsupported' | 'error';
  records: readonly ProviderAccountUsageRecordSummaryV1[] | null;
}>;

const POLL_MS = 30_000;
const ERROR_BACKOFF_MAX_MS = 5 * 60_000;
const EMPTY_SNAPSHOT_STATUS: AccountUsageSnapshotStatus = { loading: false, error: false };
const EMPTY_DISCOVERY: AccountUsageDiscovery = { status: 'loading', records: null };

type SnapshotEntry = {
  key: string;
  recordId: ProviderAccountUsageRecordId;
  context: AccountUsagePollContext;
  retainCount: number;
  nextFetchAtMs: number;
  errors: number;
  controller: AbortController | null;
  timer: ReturnType<typeof setTimeout> | null;
  view: AccountUsageSnapshotStatus;
};
type DiscoveryEntry = {
  context: AccountUsagePollContext;
  retainCount: number;
  nextFetchAtMs: number;
  errors: number;
  controller: AbortController | null;
  timer: ReturnType<typeof setTimeout> | null;
  view: AccountUsageDiscovery;
};

const snapshots = new Map<string, SnapshotEntry>();
const snapshotListeners = new Map<string, Set<() => void>>();
const discoveryListeners = new Map<string, Set<() => void>>();
const discoveries = new Map<string, DiscoveryEntry>();
let activeCredentialScope = '';
let runtimeActiveDetach: (() => void) | null = null;

function watchRuntimeActivity(): void {
  if (runtimeActiveDetach) return;
  runtimeActiveDetach = subscribeToRuntimeActiveChange(() => {
    if (!isRuntimeActive()) {
      for (const entry of snapshots.values()) {
        if (entry.timer) clearTimeout(entry.timer);
        entry.timer = null;
      }
      for (const entry of discoveries.values()) {
        if (entry.timer) clearTimeout(entry.timer);
        entry.timer = null;
      }
      return;
    }
    for (const entry of snapshots.values()) scheduleSnapshot(entry);
    for (const [scope, entry] of discoveries) scheduleDiscovery(scope, entry);
  });
}

function stopRuntimeWatcherWhenIdle(): void {
  if (snapshots.size > 0 || discoveries.size > 0) return;
  runtimeActiveDetach?.();
  runtimeActiveDetach = null;
}

function backoffMs(errors: number): number {
  return Math.min(ERROR_BACKOFF_MAX_MS, POLL_MS * 2 ** Math.max(0, errors - 1));
}

function emit(listeners: Map<string, Set<() => void>>, key: string): void {
  for (const listener of listeners.get(key) ?? []) listener();
}

function subscribe(listeners: Map<string, Set<() => void>>, key: string, listener: () => void): () => void {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(listener);
  return () => {
    set?.delete(listener);
    if (set?.size === 0) listeners.delete(key);
  };
}

function activateScope(scope: string): void {
  if (scope === activeCredentialScope) return;
  activeCredentialScope = scope;
  for (const entry of snapshots.values()) {
    entry.controller?.abort();
    if (entry.timer) clearTimeout(entry.timer);
  }
  for (const entry of discoveries.values()) {
    entry.controller?.abort();
    if (entry.timer) clearTimeout(entry.timer);
  }
  snapshots.clear();
  discoveries.clear();
  stopRuntimeWatcherWhenIdle();
}

export function accountUsageSnapshotKey(scope: string, recordId: string): string {
  return `${scope}\u0000${recordId}`;
}

export function getAccountUsageSnapshotStatus(key: string): AccountUsageSnapshotStatus {
  return snapshots.get(key)?.view ?? EMPTY_SNAPSHOT_STATUS;
}

export function subscribeAccountUsageSnapshotStatus(key: string, listener: () => void): () => void {
  return subscribe(snapshotListeners, key, listener);
}

function publishSnapshot(entry: SnapshotEntry, view: AccountUsageSnapshotStatus): void {
  if (entry.view.loading === view.loading && entry.view.error === view.error) return;
  entry.view = view;
  emit(snapshotListeners, entry.key);
}

function scheduleSnapshot(entry: SnapshotEntry): void {
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = null;
  if (entry.retainCount === 0 || entry.controller || activeCredentialScope !== entry.context.credentialScope) return;
  if (!isRuntimeActive()) {
    watchRuntimeActivity();
    return;
  }
  if (entry.nextFetchAtMs <= Date.now()) {
    void loadSnapshot(entry);
    return;
  }
  entry.timer = setTimeout(() => {
    entry.timer = null;
    void loadSnapshot(entry);
  }, Math.max(0, entry.nextFetchAtMs - Date.now()));
}

async function loadSnapshot(entry: SnapshotEntry): Promise<void> {
  if (entry.controller || entry.retainCount === 0 || activeCredentialScope !== entry.context.credentialScope) return;
  const controller = new AbortController();
  entry.controller = controller;
  publishSnapshot(entry, { loading: true, error: entry.view.error });
  try {
    const mode = await entry.context.resolveAccountMode();
    if (controller.signal.aborted) return;
    let opened: ProviderAccountUsageSnapshotV1 | null = null;
    if (mode === 'plain') {
      opened = await getProviderAccountUsageSnapshotPlain(entry.context.credentials, { recordId: entry.recordId }, { signal: controller.signal });
    }
    if (!opened && !controller.signal.aborted) {
      const sealed = await getProviderAccountUsageSnapshotSealed(entry.context.credentials, { recordId: entry.recordId }, { signal: controller.signal });
      opened = sealed ? openProviderAccountUsageSnapshot(entry.context.credentials, sealed.sealed) : null;
    }
    if (controller.signal.aborted || activeCredentialScope !== entry.context.credentialScope || snapshots.get(entry.key) !== entry) return;
    if (opened?.recordId === entry.recordId) {
      writeProviderAccountUsageSnapshotToCache({ credentialScope: entry.context.credentialScope, snapshot: opened });
    }
    entry.errors = 0;
    entry.nextFetchAtMs = Date.now() + (opened ? Math.max(POLL_MS, opened.staleAfterMs) : POLL_MS);
    publishSnapshot(entry, { loading: false, error: false });
  } catch {
    if (controller.signal.aborted || activeCredentialScope !== entry.context.credentialScope || snapshots.get(entry.key) !== entry) return;
    entry.errors += 1;
    entry.nextFetchAtMs = Date.now() + backoffMs(entry.errors);
    publishSnapshot(entry, { loading: false, error: true });
  } finally {
    if (entry.controller === controller) entry.controller = null;
    scheduleSnapshot(entry);
  }
}

export function retainAccountUsageSnapshotPolling(context: AccountUsagePollContext, recordId: ProviderAccountUsageRecordId): () => void {
  activateScope(context.credentialScope);
  watchRuntimeActivity();
  const key = accountUsageSnapshotKey(context.credentialScope, recordId);
  let entry = snapshots.get(key);
  if (!entry) {
    const cached = readProviderAccountUsageSnapshotFromCache({ credentialScope: context.credentialScope, recordId });
    entry = {
      key, recordId, context, retainCount: 0,
      nextFetchAtMs: cached ? cached.fetchedAtMs + Math.max(POLL_MS, cached.staleAfterMs) : 0,
      errors: 0, controller: null, timer: null, view: EMPTY_SNAPSHOT_STATUS,
    };
    snapshots.set(key, entry);
  }
  entry.context = context;
  entry.retainCount += 1;
  scheduleSnapshot(entry);
  return () => {
    if (!entry) return;
    entry.retainCount -= 1;
    if (entry.retainCount > 0) return;
    entry.controller?.abort();
    if (entry.timer) clearTimeout(entry.timer);
    if (snapshots.get(key) === entry) snapshots.delete(key);
    stopRuntimeWatcherWhenIdle();
  };
}

export function getAccountUsageDiscovery(scope: string): AccountUsageDiscovery {
  return discoveries.get(scope)?.view ?? EMPTY_DISCOVERY;
}

export function subscribeAccountUsageDiscovery(scope: string, listener: () => void): () => void {
  return subscribe(discoveryListeners, scope, listener);
}

function publishDiscovery(scope: string, entry: DiscoveryEntry, view: AccountUsageDiscovery): void {
  if (entry.view === view) return;
  entry.view = view;
  emit(discoveryListeners, scope);
}

function scheduleDiscovery(scope: string, entry: DiscoveryEntry): void {
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = null;
  if (entry.retainCount === 0 || entry.controller || activeCredentialScope !== scope) return;
  if (!isRuntimeActive()) {
    watchRuntimeActivity();
    return;
  }
  if (entry.nextFetchAtMs <= Date.now()) {
    void loadDiscovery(scope, entry);
    return;
  }
  entry.timer = setTimeout(() => {
    entry.timer = null;
    void loadDiscovery(scope, entry);
  }, Math.max(0, entry.nextFetchAtMs - Date.now()));
}

async function loadDiscovery(scope: string, entry: DiscoveryEntry): Promise<void> {
  if (entry.controller || entry.retainCount === 0 || activeCredentialScope !== scope) return;
  const controller = new AbortController();
  entry.controller = controller;
  try {
    const result = await listProviderAccountUsageRecords(entry.context.credentials, { signal: controller.signal });
    if (controller.signal.aborted || activeCredentialScope !== scope || discoveries.get(scope) !== entry) return;
    entry.errors = 0;
    entry.nextFetchAtMs = Date.now() + POLL_MS;
    publishDiscovery(scope, entry, result === 'unsupported'
      ? { status: 'unsupported', records: entry.view.records }
      : { status: 'ready', records: result.records });
  } catch {
    if (controller.signal.aborted || activeCredentialScope !== scope || discoveries.get(scope) !== entry) return;
    entry.errors += 1;
    entry.nextFetchAtMs = Date.now() + backoffMs(entry.errors);
    publishDiscovery(scope, entry, { status: 'error', records: entry.view.records });
  } finally {
    if (entry.controller === controller) entry.controller = null;
    scheduleDiscovery(scope, entry);
  }
}

export function retainAccountUsageDiscovery(context: AccountUsagePollContext): () => void {
  activateScope(context.credentialScope);
  watchRuntimeActivity();
  const scope = context.credentialScope;
  let entry = discoveries.get(scope);
  if (!entry) {
    entry = { context, retainCount: 0, nextFetchAtMs: 0, errors: 0, controller: null, timer: null, view: EMPTY_DISCOVERY };
    discoveries.set(scope, entry);
  }
  entry.context = context;
  entry.retainCount += 1;
  scheduleDiscovery(scope, entry);
  return () => {
    if (!entry) return;
    entry.retainCount -= 1;
    if (entry.retainCount > 0) return;
    entry.controller?.abort();
    if (entry.timer) clearTimeout(entry.timer);
    if (discoveries.get(scope) === entry) discoveries.delete(scope);
    stopRuntimeWatcherWhenIdle();
  };
}
