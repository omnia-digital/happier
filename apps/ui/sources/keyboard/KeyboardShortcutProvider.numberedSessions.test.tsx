import React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';
import type { Settings } from '@/sync/domains/settings/settings';

const testState = vi.hoisted(() => ({
    modalActive: false,
    settings: {
        keyboardShortcutsV2Enabled: true,
        keyboardSingleKeyShortcutsEnabled: true,
        keyboardShortcutOverridesV1: {},
        keyboardShortcutDisabledCommandIdsV1: [],
    } as Partial<Settings>,
}));

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});

vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    const base = createModalModuleMock().module;
    return {
        ...base,
        useOptionalModal: () => ({ isKeyboardLiftSuppressedByModal: testState.modalActive }),
    };
});

vi.mock('@/sync/domains/state/storage', async () => {
    const { settingsDefaults } = await import('@/sync/domains/settings/settings');
    const { createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
    const readSnapshot = () => ({ settings: { ...settingsDefaults, ...testState.settings } });
    const storage = Object.assign(
        ((selector?: (value: ReturnType<typeof readSnapshot>) => unknown) => {
            const snapshot = readSnapshot();
            return typeof selector === 'function' ? selector(snapshot) : snapshot;
        }),
        {
            getState: readSnapshot,
            getInitialState: readSnapshot,
            setState: () => undefined,
            subscribe: () => () => undefined,
            destroy: () => undefined,
        },
    );
    return createStorageModuleStub({ storage });
});

vi.mock('@/components/sessions/agentInput/subscribeToIosHardwareShiftEnter', () => ({
    subscribeToNativeHardwareKeyboardEvents: () => null,
}));

type EventListener = (event: any) => void;

function installDomEventTargets() {
    const windowListeners = new Map<string, Set<EventListener>>();
    const documentListeners = new Map<string, Set<EventListener>>();
    const makeTarget = (listeners: Map<string, Set<EventListener>>) => ({
        addEventListener: (type: string, listener: EventListener) => {
            const group = listeners.get(type) ?? new Set<EventListener>();
            group.add(listener);
            listeners.set(type, group);
        },
        removeEventListener: (type: string, listener: EventListener) => listeners.get(type)?.delete(listener),
        dispatchEvent: (event: { type: string }) => {
            for (const listener of listeners.get(event.type) ?? []) listener(event);
        },
    });
    const windowTarget = makeTarget(windowListeners);
    const documentTarget = { ...makeTarget(documentListeners), visibilityState: 'visible' };
    vi.stubGlobal('window', windowTarget);
    vi.stubGlobal('document', documentTarget);
    vi.stubGlobal('navigator', { platform: 'MacIntel' });
    return { windowTarget, documentTarget };
}

function keyEvent(input: Partial<KeyboardEvent> & { type?: string }): KeyboardEvent & { type: string } {
    return {
        type: input.type ?? 'keydown',
        key: '',
        code: '',
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        repeat: false,
        isComposing: false,
        defaultPrevented: false,
        target: null,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        ...input,
    } as KeyboardEvent & { type: string };
}

describe('KeyboardShortcutProvider numbered sessions', () => {
    beforeEach(() => {
        testState.modalActive = false;
        testState.settings = {
            keyboardShortcutsV2Enabled: true,
            keyboardSingleKeyShortcutsEnabled: true,
            keyboardShortcutOverridesV1: {},
            keyboardShortcutDisabledCommandIdsV1: [],
        };
    });

    afterEach(() => {
        standardCleanup();
        vi.unstubAllGlobals();
    });

    it('dispatches Command-number and clears held hints on key release, blur, and hidden', async () => {
        const { windowTarget, documentTarget } = installDomEventTargets();
        const { KeyboardShortcutProvider, useKeyboardShortcutHandlers } = await import('./KeyboardShortcutProvider');
        const navigate = vi.fn();
        const heldChanges: boolean[] = [];
        function Sidebar() {
            useKeyboardShortcutHandlers({ 'session.number.1': navigate }, {
                onCommandHeldChange: (held) => heldChanges.push(held),
            });
            return React.createElement('Sidebar');
        }
        await renderScreen(<KeyboardShortcutProvider handlers={{}}><Sidebar /></KeyboardShortcutProvider>);

        await act(async () => { windowTarget.dispatchEvent(keyEvent({ key: 'Meta', code: 'MetaLeft', metaKey: true })); });
        expect(heldChanges.at(-1)).toBe(true);
        await act(async () => { windowTarget.dispatchEvent(keyEvent({ key: '1', code: 'Digit1', metaKey: true })); });
        expect(navigate).toHaveBeenCalledTimes(1);

        await act(async () => { windowTarget.dispatchEvent(keyEvent({ type: 'keyup', key: 'Meta' })); });
        expect(heldChanges.at(-1)).toBe(false);
        await act(async () => { windowTarget.dispatchEvent(keyEvent({ key: 'Meta', metaKey: true })); });
        await act(async () => { windowTarget.dispatchEvent({ type: 'blur' }); });
        expect(heldChanges.at(-1)).toBe(false);
        await act(async () => { windowTarget.dispatchEvent(keyEvent({ key: 'Meta', metaKey: true })); });
        documentTarget.visibilityState = 'hidden';
        await act(async () => { documentTarget.dispatchEvent({ type: 'visibilitychange' }); });
        expect(heldChanges.at(-1)).toBe(false);
    });

    it('does not take numbered navigation from editable fields, menus, or repeating keys', async () => {
        const { windowTarget } = installDomEventTargets();
        const { KeyboardShortcutProvider, useKeyboardShortcutHandlers } = await import('./KeyboardShortcutProvider');
        const navigate = vi.fn();
        function Sidebar() {
            useKeyboardShortcutHandlers({ 'session.number.1': navigate });
            return React.createElement('Sidebar');
        }
        await renderScreen(<KeyboardShortcutProvider handlers={{}}><Sidebar /></KeyboardShortcutProvider>);
        const editableTarget = { tagName: 'TEXTAREA', isContentEditable: false, closest: () => null } as unknown as EventTarget;
        const menuTarget = {
            tagName: 'BUTTON',
            isContentEditable: false,
            closest: (selector: string) => selector.includes('[role="menu"]') ? {} : null,
        } as unknown as EventTarget;
        const terminalTarget = {
            tagName: 'DIV',
            isContentEditable: false,
            closest: (selector: string) => selector.includes('data-keyboard-shortcuts-owned') ? {} : null,
        } as unknown as EventTarget;
        await act(async () => {
            windowTarget.dispatchEvent(keyEvent({ key: '1', code: 'Digit1', metaKey: true, target: editableTarget }));
            windowTarget.dispatchEvent(keyEvent({ key: '1', code: 'Digit1', metaKey: true, target: menuTarget }));
            windowTarget.dispatchEvent(keyEvent({ key: '1', code: 'Digit1', metaKey: true, target: terminalTarget }));
            windowTarget.dispatchEvent(keyEvent({ key: '1', code: 'Digit1', metaKey: true, repeat: true }));
        });
        expect(navigate).not.toHaveBeenCalled();
    });

    it('clears held hints and defers navigation when a modal becomes active', async () => {
        const { windowTarget } = installDomEventTargets();
        const { KeyboardShortcutProvider, useKeyboardShortcutHandlers } = await import('./KeyboardShortcutProvider');
        const navigate = vi.fn();
        const heldChanges: boolean[] = [];
        function Sidebar() {
            useKeyboardShortcutHandlers({ 'session.number.1': navigate }, {
                onCommandHeldChange: (held) => heldChanges.push(held),
            });
            return React.createElement('Sidebar');
        }
        const render = () => <KeyboardShortcutProvider handlers={{}}><Sidebar /></KeyboardShortcutProvider>;
        const screen = await renderScreen(render());
        await act(async () => { windowTarget.dispatchEvent(keyEvent({ key: 'Meta', metaKey: true })); });
        expect(heldChanges.at(-1)).toBe(true);

        testState.modalActive = true;
        await act(async () => { screen.tree.update(render()); });
        expect(heldChanges.at(-1)).toBe(false);
        await act(async () => { windowTarget.dispatchEvent(keyEvent({ key: '1', code: 'Digit1', metaKey: true })); });
        expect(navigate).not.toHaveBeenCalled();
    });

    it('clears held hints when keyboard shortcuts are disabled', async () => {
        const { windowTarget } = installDomEventTargets();
        const { KeyboardShortcutProvider, useKeyboardShortcutHandlers } = await import('./KeyboardShortcutProvider');
        const heldChanges: boolean[] = [];
        function Sidebar() {
            useKeyboardShortcutHandlers({ 'session.number.1': vi.fn() }, {
                onCommandHeldChange: (held) => heldChanges.push(held),
            });
            return React.createElement('Sidebar');
        }
        const render = () => <KeyboardShortcutProvider handlers={{}}><Sidebar /></KeyboardShortcutProvider>;
        const screen = await renderScreen(render());
        await act(async () => { windowTarget.dispatchEvent(keyEvent({ key: 'Meta', metaKey: true })); });
        expect(heldChanges.at(-1)).toBe(true);

        testState.settings = { ...testState.settings, keyboardShortcutsV2Enabled: false };
        await act(async () => { screen.tree.update(render()); });
        expect(heldChanges.at(-1)).toBe(false);
    });

    it('lists only active numbered commands in shortcut help', async () => {
        const { windowTarget } = installDomEventTargets();
        const { Modal } = await import('@/modal');
        const { KeyboardShortcutProvider, useKeyboardShortcutHandlers } = await import('./KeyboardShortcutProvider');
        function Sidebar() {
            useKeyboardShortcutHandlers({ 'session.number.1': vi.fn(), 'session.number.3': vi.fn() });
            return React.createElement('Sidebar');
        }
        await renderScreen(<KeyboardShortcutProvider handlers={{}}><Sidebar /></KeyboardShortcutProvider>);

        await act(async () => {
            windowTarget.dispatchEvent(keyEvent({ key: '?', code: 'Slash', shiftKey: true }));
        });
        expect(Modal.alertAsync).toHaveBeenCalledTimes(1);
        const [, body] = vi.mocked(Modal.alertAsync).mock.calls[0] ?? [];
        expect(String(body)).toContain('Visible sessions');
        expect(String(body)).toContain('Cmd+1, Cmd+3');
        expect(String(body)).not.toContain('Cmd+2');
    });
});
