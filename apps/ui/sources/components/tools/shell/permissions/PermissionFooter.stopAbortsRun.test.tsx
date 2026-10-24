import React from 'react';
import { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { pressTestInstanceAsync, renderScreen } from '@/dev/testkit';
import { installPermissionShellCommonModuleMocks } from './permissionShellTestHelpers';


(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const runtime = vi.hoisted(() => ({
    flavor: 'opencode' as 'claude' | 'codex' | 'opencode' | 'gemini',
    protocol: 'claude' as 'codexDecision' | 'claude',
    setProtocol(protocol: 'codexDecision' | 'claude', flavor: 'claude' | 'codex' | 'opencode' | 'gemini') {
        this.protocol = protocol;
        this.flavor = flavor;
    },
}));

const ops = vi.hoisted(() => ({
    sessionDeny: vi.fn(async (..._args: unknown[]) => {}),
    sessionAbort: vi.fn(async (..._args: unknown[]) => {}),
    sessionRespondToPermission: vi.fn(async (..._args: unknown[]) => ({ ok: true })),
}));

const sessionStore = vi.hoisted(() => ({
    updateSessionPermissionMode: vi.fn((..._args: unknown[]) => {}),
}));

const syncMock = vi.hoisted(() => ({
    sendMessage: vi.fn(async (..._args: unknown[]) => {}),
}));

vi.mock('@expo/vector-icons', () => ({
    Ionicons: 'Ionicons',
}));

installPermissionShellCommonModuleMocks({
    storage: async (importOriginal) => {
        const { createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
        return createStorageModuleStub({
            importOriginal,
            storage: { getState: () => sessionStore },
        });
    },
});

vi.mock('@/sync/ops', () => ({
    sessionAllow: vi.fn(async () => {}),
    sessionAllowWithPermissionUpdates: vi.fn(async () => {}),
    sessionDeny: ops.sessionDeny,
    sessionAbort: ops.sessionAbort,
    sessionRespondToPermission: ops.sessionRespondToPermission,
}));

vi.mock('@/sync/sync', () => ({
    sync: {
        sendMessage: syncMock.sendMessage,
    },
}));

vi.mock('@/agents/catalog/resolve', () => ({
    resolveAgentIdForPermissionUi: () => runtime.flavor,
}));

vi.mock('@/agents/catalog/permissionUiCopy', () => ({
    getPermissionFooterCopy: () => {
        if (runtime.protocol === 'codexDecision') {
            return {
                protocol: 'codexDecision',
                yesAlwaysAllowCommandKey: 'codex.permissions.yesAlwaysAllowCommand',
                yesForSessionKey: 'codex.permissions.yesForSession',
                stopKey: 'codex.permissions.stop',
            };
        }
        return {
            protocol: 'claude',
            yesAllowAllEditsKey: 'claude.permissions.yesAllowAllEdits',
            yesForToolKey: 'claude.permissions.yesForTool',
            stopKey: 'claude.permissions.stop',
        };
    },
}));

describe('PermissionFooter stop action', () => {
    it('routes a Stop decision and abort through one account-capturing operation', async () => {
        runtime.setProtocol('claude', 'claude');
        ops.sessionRespondToPermission.mockClear();
        ops.sessionDeny.mockClear();
        ops.sessionAbort.mockClear();

        const { PermissionFooter } = await import('../permissions/PermissionFooter');
        const screen = await renderScreen(React.createElement(PermissionFooter, {
            permission: { id: 'p-original-account', status: 'pending' },
            sessionId: 's1', toolName: 'Read', toolInput: { filepath: '/etc/hosts' }, metadata: { flavor: 'claude' },
        }));
        await pressTestInstanceAsync(screen.findByProps({ testID: 'permission-footer.stop' }), 'stop button');

        expect(ops.sessionRespondToPermission).toHaveBeenCalledWith({
            sessionId: 's1', request: { id: 'p-original-account', approved: false, decision: 'abort' },
            permissionModeAfterStop: 'read-only',
        });
        expect(ops.sessionDeny).not.toHaveBeenCalled();
        expect(ops.sessionAbort).not.toHaveBeenCalled();
    });
    it.each([
        {
            name: 'codex decision protocol',
            protocol: 'codexDecision' as const,
            flavor: 'codex' as const,
            toolName: 'execute',
            toolInput: { command: 'pwd' },
            shouldSendFollowupPrompt: false,
            shouldAbortRun: false,
            expectedDecision: 'denied' as const,
        },
        {
            name: 'codex decision protocol on non-codex agent',
            protocol: 'codexDecision' as const,
            flavor: 'opencode' as const,
            toolName: 'bash',
            toolInput: { command: 'pwd' },
            shouldSendFollowupPrompt: false,
            shouldAbortRun: true,
            expectedDecision: 'abort' as const,
        },
        {
            name: 'non-codex protocol',
            protocol: 'claude' as const,
            flavor: 'claude' as const,
            toolName: 'Read',
            toolInput: { filepath: '/etc/hosts' },
            shouldSendFollowupPrompt: false,
            shouldAbortRun: true,
            shouldSetReadOnlyMode: true,
            expectedDecision: 'abort' as const,
        },
        {
            name: 'gemini stop/explain should not force read-only mode',
            protocol: 'codexDecision' as const,
            flavor: 'gemini' as const,
            toolName: 'execute',
            toolInput: { command: "bash -lc 'echo hi > /tmp/x'" },
            shouldSendFollowupPrompt: false,
            shouldAbortRun: true,
            shouldSetReadOnlyMode: false,
            expectedDecision: 'abort' as const,
        },
    ])('Stop denies permission and handles run control for $name', async ({ protocol, flavor, toolName, toolInput, shouldSendFollowupPrompt, shouldAbortRun, shouldSetReadOnlyMode, expectedDecision }) => {
        runtime.setProtocol(protocol, flavor);
        ops.sessionDeny.mockClear();
        ops.sessionAbort.mockClear();
        ops.sessionRespondToPermission.mockClear();
        syncMock.sendMessage.mockClear();
        sessionStore.updateSessionPermissionMode.mockClear();

        const { PermissionFooter } = await import('../permissions/PermissionFooter');
        const screen = await renderScreen(React.createElement(PermissionFooter, {
            permission: { id: 'p1', status: 'pending' },
            sessionId: 's1',
            toolName,
            toolInput,
            metadata: { flavor },
        }));

        const buttons = screen.findAllByType('TouchableOpacity' as any);
        const stopButton = buttons.at(-1);
        expect(stopButton).toBeTruthy();

        await pressTestInstanceAsync(stopButton, 'stop button');

        if (shouldAbortRun) {
            expect(ops.sessionRespondToPermission).toHaveBeenCalledWith({
                sessionId: 's1', request: { id: 'p1', approved: false, decision: expectedDecision },
                ...(shouldSetReadOnlyMode ? { permissionModeAfterStop: 'read-only' } : {}),
            });
            expect(ops.sessionDeny).not.toHaveBeenCalled();
        } else {
            expect(ops.sessionDeny).toHaveBeenCalledTimes(1);
            expect(ops.sessionDeny.mock.calls[0]?.[4]).toBe(expectedDecision);
            expect(ops.sessionRespondToPermission).not.toHaveBeenCalled();
        }
        expect(ops.sessionAbort).not.toHaveBeenCalled();
        expect(sessionStore.updateSessionPermissionMode).not.toHaveBeenCalled();
        if (shouldSendFollowupPrompt) {
            expect(syncMock.sendMessage).toHaveBeenCalledTimes(1);
            if (shouldSetReadOnlyMode) {
                expect(sessionStore.updateSessionPermissionMode.mock.invocationCallOrder[0]).toBeLessThan(
                    syncMock.sendMessage.mock.invocationCallOrder[0],
                );
            }
            expect(syncMock.sendMessage.mock.calls[0]?.[0]).toBe('s1');
            expect(String(syncMock.sendMessage.mock.calls[0]?.[1] ?? '')).toMatch(/explain/i);
        } else {
            expect(syncMock.sendMessage).not.toHaveBeenCalled();
        }
    });

    it('dispatches one denial and one abort when Stop is activated twice before React commits', async () => {
        runtime.setProtocol('codexDecision', 'opencode');
        ops.sessionDeny.mockClear();
        ops.sessionAbort.mockClear();
        ops.sessionRespondToPermission.mockClear();

        const { PermissionFooter } = await import('../permissions/PermissionFooter');
        const screen = await renderScreen(React.createElement(PermissionFooter, {
            permission: { id: 'p-double-stop', status: 'pending' },
            sessionId: 's1',
            toolName: 'execute',
            toolInput: { command: 'touch /tmp/permission-stop-test' },
            metadata: { flavor: 'opencode' },
        }));
        const stop = screen.findByProps({ testID: 'permission-footer.stop' });

        await act(async () => {
            await Promise.all([stop.props.onPress(), stop.props.onPress()]);
        });

        expect(ops.sessionRespondToPermission).toHaveBeenCalledTimes(1);
        expect(ops.sessionDeny).not.toHaveBeenCalled();
        expect(ops.sessionAbort).not.toHaveBeenCalled();
    });
});
