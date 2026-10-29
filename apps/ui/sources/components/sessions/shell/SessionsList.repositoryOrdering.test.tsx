import React from 'react';
import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPartialStorageModuleMock, renderScreen, findGestureByKind } from '@/dev/testkit';
import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { installSessionShellCommonModuleMocks } from './sessionShellTestHelpers';
import type { SessionListViewItem } from '@/sync/domains/session/listing/sessionListViewData';
import type { SessionOrganizationSnapshot } from '@happier-dev/protocol';

const boundary = vi.hoisted(() => ({
    source: [] as SessionListViewItem[],
    serverId: '',
    reorder: vi.fn(),
    snapshot: vi.fn(),
    scmSnapshot: vi.fn(),
}));
installSessionShellCommonModuleMocks({
    text: async () => (await import('@/dev/testkit/mocks/text')).createTextModuleMock({ translate: key => key }),
    featureEnabled: async () => ({ useFeatureEnabled: () => true }),
    storage: async (importOriginal) => createPartialStorageModuleMock(importOriginal, {
        useProfile: () => ({ id: 'account' }),
        useSessionListViewData: () => boundary.source,
        useSessionListViewDataByServerId: () => ({}),
    }),
});
vi.mock('@/hooks/server/useEffectiveServerSelection', () => ({ useResolvedActiveServerSelection: () => ({
    enabled: true, presentation: 'grouped', activeServerId: boundary.serverId, allowedServerIds: [boundary.serverId],
}) }));
vi.mock('@/hooks/server/useFeatureDecision', () => ({ useFeatureDecision: () => ({ state: 'enabled' }) }));
vi.mock('@/components/account/RecoveryKeyReminderBanner', () => ({ RecoveryKeyReminderBanner: 'RecoveryKeyReminderBanner' }));
vi.mock('@/components/ui/lists/flashListCompat/SessionListVirtualizedList', async () => {
    const { createCapturingFlashListMock } = await import('@/dev/testkit/mocks/flashList');
    return { SessionListVirtualizedList: createCapturingFlashListMock({ renderItems: true, memoizeItems: true }).module.FlashList };
});
vi.mock('react-native-reanimated', async () => (await import('@/dev/testkit/mocks/reanimated')).createReanimatedModuleMock());
vi.mock('react-native-gesture-handler', async () => (await import('@/dev/testkit/mocks/gestureHandler')).createGestureHandlerMock());
vi.mock('react-native-worklets', () => ({ scheduleOnRN: (fn: (...args: unknown[]) => unknown, ...args: unknown[]) => fn(...args) }));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaInsetsContext: React.createContext({ top: 0, bottom: 0, left: 0, right: 0 }), useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
vi.mock('@/components/ui/forms/dropdown/DropdownMenu', () => ({ DropdownMenu: (props: Record<string, unknown>) => React.createElement('DropdownMenu', props) }));
vi.mock('@/sync/ops/scm/machineScm', () => ({ machineScmStatusSnapshot: boundary.scmSnapshot, machineScmWorktreesEnrichment: vi.fn() }));
vi.mock('@/sync/api/session/sessionOrganizationApi', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/sync/api/session/sessionOrganizationApi')>(),
    reorderSessionOrganization: boundary.reorder,
    fetchSessionOrganizationSnapshot: boundary.snapshot,
}));

const credentials = { token: `e30.${btoa(JSON.stringify({ sub: 'account' }))}.signature` };
let persisted: SessionOrganizationSnapshot;
let unrelatedOrderEntries: SessionOrganizationSnapshot['orderEntries'];
beforeEach(async () => {
    await (await import('@/dev/testkit')).resetBrowserSessionDraftPersistenceForTest();
    const { upsertServerProfile } = await import('@/sync/domains/server/serverProfiles');
    const { TokenStorage } = await import('@/auth/storage/tokenStorage');
    const { storage } = await import('@/sync/domains/state/storage');
    const { repositoryWorkspaceKey } = await import('@/sync/domains/session/listing/sessionRepositoryIdentity');
    const { buildSessionListViewData } = await import('@/sync/domains/session/listing/sessionListViewData');
    const { buildSessionListRenderableFromSession } = await import('@/sync/domains/session/listing/sessionListRenderable');
    boundary.serverId = upsertServerProfile({ serverUrl: 'https://repository-order.example.test', name: 'Order Home' }).id;
    vi.spyOn(TokenStorage, 'getCredentialsForServerUrl').mockResolvedValue(credentials);
    const scope = { serverId: boundary.serverId, accountId: 'account' };
    const sessions = Object.fromEntries([['a', 'machine-1'], ['a2', 'machine-1'], ['b', 'machine-2']].map(([id, machineId], index) => [id,
        createSessionFixture({ id, serverId: scope.serverId, active: true, createdAt: index + 1,
            metadata: { machineId, path: machineId === 'machine-1' ? '/checkout-a' : '/checkout-b', host: machineId } as never }),
    ]));
    const state = storage.getState();
    storage.setState({ profileScope: scope, sessions, settings: { ...state.settings,
        sessionListOrderingModeV1: 'custom', sessionListSectionModeV1: 'activity', sessionFolderViewModeV1: 'tree',
        sessionListActiveGroupingV1: 'project', sessionListInactiveGroupingV1: 'project',
        sessionListAttentionPromotionModeV1: 'off', sessionListWorkingPlacementModeV1: 'off',
    }, localSettings: { ...state.localSettings, sessionListMachineViewV1: 'repository', sessionListFolderSortModeV1: 'mixed',
        sessionRepositoryAssociationsV1: Object.fromEntries([['machine-1', '/checkout-a'], ['machine-2', '/checkout-b']].map(([machineId, path]) => [
            repositoryWorkspaceKey({ ...scope, machineId, path }), { identity: 'example.com/team/repo', label: 'Repository', rootPath: path, worktreePaths: [] },
        ])),
    } });
    boundary.source = buildSessionListViewData(Object.fromEntries(Object.entries(sessions).map(([id, session]) => [id, buildSessionListRenderableFromSession(session)])), {}, {
        groupInactiveSessionsByProject: true, activeGroupingV1: 'project', serverScope: { serverId: scope.serverId }, sessionTargetState: { sessions },
    });
    const { projectSessionListMachineView } = await import('./view-state/projectSessionListMachineView');
    const originalScope = boundary.source.find(item => item.type === 'header' && item.workspaceScopeHint?.machineId === 'machine-2')?.groupKey;
    const machineScope = projectSessionListMachineView(boundary.source, {}).find(item => item.type === 'header' && item.headerKind === 'machine')?.groupKey;
    expect(originalScope).toBeTruthy();
    expect(machineScope).toBeTruthy();
    unrelatedOrderEntries = [originalScope!, machineScope!].map(scopeKey => ({ scopeKind: 'group', scopeKey, itemKind: 'session', itemKey: 'b', sortKey: '00000001' }));
    persisted = { schemaVersion: 1, version: 1, pins: [], folders: [], folderAssignments: [], tags: [], tagAssignments: [], orderEntries: unrelatedOrderEntries, labels: [] };
    storage.getState().clearSessionOrganizationForServer(scope.serverId);
    storage.getState().applySessionOrganizationSnapshot(scope.serverId, persisted);
    boundary.reorder.mockReset();
    boundary.reorder.mockImplementation(async ({ request }) => {
        const orderEntries = request.entries.map((entry: object) => ({ ...entry, scopeKind: request.scopeKind, scopeKey: request.scopeKey }));
        persisted = { ...persisted, version: persisted.version + 1, orderEntries: [
            ...persisted.orderEntries.filter(entry => entry.scopeKey !== request.scopeKey), ...orderEntries,
        ] };
        return { orderEntries };
    });
    boundary.snapshot.mockImplementation(async () => ({ snapshot: persisted }));
});

function visibleIds(screen: Awaited<ReturnType<typeof renderScreen>>) {
    return screen.root.findAll(node => typeof node.type === 'string' && typeof node.props.testID === 'string'
        && node.props.testID.startsWith('session-list-item-')).map(row => row.props.testID.slice('session-list-item-'.length));
}

describe('Repository session order through the mounted shell and canonical organization writer', () => {
    it('persists a flat cross-project reorder through the owning Home and restores it after a view roundtrip', async () => {
        const { SessionsList } = await import('./SessionsList');
        const { storage } = await import('@/sync/domains/state/storage');
        await act(async () => { storage.getState().applyLocalSettings({ sessionListMachineViewV1: 'flat' }); });
        const physical = Object.fromEntries(Object.entries(storage.getState().sessions).map(([id, session]) => [id, session.metadata]));
        const screen = await renderScreen(<SessionsList />);
        expect(visibleIds(screen)).toEqual(['b', 'a2', 'a']);
        const row = screen.findByTestId('session-list-item-b');
        expect(row?.props.accessibilityActions).toContainEqual(expect.objectContaining({ name: 'moveDown' }));
        await act(async () => { row?.props.onAccessibilityAction({ nativeEvent: { actionName: 'moveDown' } }); });
        await vi.waitFor(() => expect(visibleIds(screen)).toEqual(['a2', 'b', 'a']));
        expect(boundary.reorder).toHaveBeenCalledWith(expect.objectContaining({ serverUrl: 'https://repository-order.example.test',
            request: expect.objectContaining({ scopeKind: 'group', scopeKey: expect.stringMatching(/^flat-v1:/),
                entries: [
                    { itemKind: 'session', itemKey: 'a2', sortKey: '00000001' },
                    { itemKind: 'session', itemKey: 'b', sortKey: '00000002' },
                    { itemKind: 'session', itemKey: 'a', sortKey: '00000003' },
                ],
            }),
        }));
        await act(async () => { storage.getState().applyLocalSettings({ sessionListMachineViewV1: 'original' }); });
        await act(async () => { storage.getState().applyLocalSettings({ sessionListMachineViewV1: 'flat' }); });
        expect(visibleIds(screen)).toEqual(['a2', 'b', 'a']);
        expect(Object.fromEntries(Object.entries(storage.getState().sessions).map(([id, session]) => [id, session.metadata]))).toEqual(physical);
        await screen.unmount();
        const { fetchAndApplySessionOrganizationSnapshot } = await import('@/sync/ops/sessionOrganization/fetchSessionOrganizationSnapshot');
        storage.getState().clearSessionOrganizationForServer(boundary.serverId);
        await fetchAndApplySessionOrganizationSnapshot({ credentials, serverId: boundary.serverId, serverUrl: 'https://repository-order.example.test' });
        const restored = await renderScreen(<SessionsList />);
        expect(visibleIds(restored)).toEqual(['a2', 'b', 'a']);
        expect(Object.fromEntries(Object.entries(storage.getState().sessions).map(([id, session]) => [id, session.metadata]))).toEqual(physical);
        await restored.unmount();
    });

    it('updates the mounted header while repository discovery starts and settles without changing its rows', async () => {
        const { SessionsList } = await import('./SessionsList');
        const { SessionListViewMenuButton } = await import('./sessionListViewMenu');
        let finish!: () => void;
        const pending = new Promise<void>(resolve => { finish = resolve; });
        boundary.scmSnapshot.mockImplementation(async (_machineId, request) => {
            await pending;
            return { success: true, snapshot: {
                projectKey: request.cwd, fetchedAt: 1,
                repo: { isRepo: true, rootPath: request.cwd, remotes: [{ name: 'origin', fetchUrl: 'https://example.com/team/repo.git' }] },
                branch: { head: 'main', upstream: null, ahead: 0, behind: 0, detached: false },
                entries: [], hasConflicts: false, stashCount: 0,
                totals: { includedFiles: 0, pendingFiles: 0, untrackedFiles: 0, includedAdded: 0, includedRemoved: 0, pendingAdded: 0, pendingRemoved: 0 },
            } };
        });
        const screen = await renderScreen(<SessionsList />);
        const menu = () => screen.root.findByType(SessionListViewMenuButton);
        expect(menu().props.repositoryRefreshing).toBe(false);
        let refresh!: Promise<void>;
        await act(async () => { refresh = menu().props.onRepositoryRefresh(); });
        expect(menu().props.repositoryRefreshing).toBe(true);
        await act(async () => { finish(); await refresh; });
        expect(menu().props.repositoryRefreshing).toBe(false);
        expect(visibleIds(screen)).toEqual(['a', 'a2', 'b']);
    });

    it.each(['accessibility move action', 'pointer gesture'] as const)('interleaves two checkouts with %s and retains order through activity, view roundtrip, and organization hydration', async (interaction) => {
        const { SessionsList } = await import('./SessionsList');
        const { storage } = await import('@/sync/domains/state/storage');
        const screen = await renderScreen(<SessionsList />);
        expect(visibleIds(screen)).toEqual(['a', 'a2', 'b']);
        const row = screen.findByTestId('session-list-item-b');
        expect(row?.props.accessibilityActions).toContainEqual(expect.objectContaining({ name: 'moveUp' }));
        if (interaction === 'accessibility move action') {
            await act(async () => { row?.props.onAccessibilityAction({ nativeEvent: { actionName: 'moveUp' } }); });
        } else {
            const rows = screen.root.findAll(node => typeof node.props.treeRowId === 'string'
                && typeof node.props.sessionKey === 'string' && typeof node.props.onRegisterTreeRowBounds === 'function');
            expect(rows).toHaveLength(3);
            for (const [index, measuredRow] of rows.entries()) {
                measuredRow.props.onRegisterTreeRowBounds(measuredRow.props.treeRowId, {
                    getBoundingClientRectFn: () => ({ x: 0, y: 100 + index * 60, top: 100 + index * 60, left: 0, width: 400, height: 60 }),
                });
            }
            let rowContent = row;
            while (rowContent && rowContent.props.session?.id !== 'b') rowContent = rowContent.parent;
            const hoverSurface = rowContent?.findAll(node => typeof node.type === 'string'
                && typeof node.props.onPointerEnter === 'function')[0];
            expect(hoverSurface).toBeTruthy();
            await act(async () => { hoverSurface?.props.onPointerEnter({ pointerType: 'mouse' }); });
            expect(rowContent?.findAllByProps({ testID: 'session-item-reorder-handle' }).length).toBeGreaterThan(0);
            const pan = rowContent?.findAll(node => !!node.props.gesture)
                .map(node => findGestureByKind(node.props.gesture, 'pan')).find(Boolean);
            expect(pan).toBeTruthy();
            await act(async () => {
                pan?.__handlers.onTouchesDown?.({ changedTouches: [{ absoluteX: 20, absoluteY: 240 }], allTouches: [{ absoluteX: 20, absoluteY: 240 }] });
                pan?.__handlers.onStart?.({ absoluteX: 20, absoluteY: 240, translationX: 0, translationY: 0 });
                pan?.__handlers.onUpdate?.({ absoluteX: 20, absoluteY: 230, translationX: 0, translationY: -10 });
            });
            await act(async () => {
                const event = { absoluteX: 20, absoluteY: 165, translationX: 0, translationY: -75 };
                pan?.__handlers.onUpdate?.(event);
                pan?.__handlers.onEnd?.(event);
                pan?.__handlers.onFinalize?.(event);
            });
        }
        await vi.waitFor(() => expect(visibleIds(screen)).toEqual(['a', 'b', 'a2']));
        expect(boundary.reorder).toHaveBeenCalledWith(expect.objectContaining({ serverUrl: 'https://repository-order.example.test',
            request: expect.objectContaining({ scopeKind: 'group', scopeKey: expect.stringMatching(/^repository-v1:/),
                entries: [
                    { itemKind: 'session', itemKey: 'a', sortKey: '00000001' },
                    { itemKind: 'session', itemKey: 'b', sortKey: '00000002' },
                    { itemKind: 'session', itemKey: 'a2', sortKey: '00000003' },
                ],
            }),
        }));
        expect(persisted.orderEntries.filter(entry => !entry.scopeKey.startsWith('repository-v1:'))).toEqual(unrelatedOrderEntries);
        const physical = Object.fromEntries(Object.entries(storage.getState().sessions).map(([id, session]) => [id, session.metadata]));
        await act(async () => { storage.getState().applyLocalSettings({ sessionListMachineViewV1: 'original' }); });
        await act(async () => { storage.getState().applyLocalSettings({ sessionListMachineViewV1: 'machine' }); });
        await act(async () => { storage.getState().applyLocalSettings({ sessionListMachineViewV1: 'repository' }); });
        expect(visibleIds(screen)).toEqual(['a', 'b', 'a2']);
        await act(async () => {
            boundary.source = boundary.source.map(item => item.type === 'session' && item.session.id === 'a2'
                ? { ...item, session: { ...item.session, updatedAt: Date.now() } } : item);
            await screen.update(<SessionsList />);
        });
        expect(visibleIds(screen)).toEqual(['a', 'b', 'a2']);
        await screen.unmount();
        const { fetchAndApplySessionOrganizationSnapshot } = await import('@/sync/ops/sessionOrganization/fetchSessionOrganizationSnapshot');
        storage.getState().clearSessionOrganizationForServer(boundary.serverId);
        await fetchAndApplySessionOrganizationSnapshot({ credentials, serverId: boundary.serverId, serverUrl: 'https://repository-order.example.test' });
        const restored = await renderScreen(<SessionsList />);
        expect(visibleIds(restored)).toEqual(['a', 'b', 'a2']);
        expect(Object.fromEntries(Object.entries(storage.getState().sessions).map(([id, session]) => [id, session.metadata]))).toEqual(physical);
        expect(storage.getState().sessionOrganizationFolderAssignmentsBySessionKey).toEqual({});
        await restored.unmount();
    });
});
