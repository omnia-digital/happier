import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, renderScreen, standardCleanup } from '@/dev/testkit';
import { storage } from '@/sync/domains/state/storageStore';
import { useMachineDisplayColor } from '@/sync/store/hooks';
import { withMachineDisplayColor } from '@/sync/domains/machines/machineDisplayIconPreference';
import { lightTheme } from '@/theme';
import { Icon } from '@/components/ui/icons/Icon';
import { MachineDisplayGlyph } from './SessionMachineIdentity';

vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});

describe('machine glyph color', () => {
    let previous: ReturnType<typeof storage.getState>;
    beforeEach(() => {
        previous = storage.getState();
        storage.setState({ localSettings: { ...previous.localSettings, machineDisplayColorByMachineV1: {}, machineDisplayIconByMachineV1: {} } });
    });
    afterEach(() => { standardCleanup(); storage.setState(previous, true); });

    const setColor = (serverId: string, machineId: string, color: 'blue' | 'purple' | 'automatic') => {
        storage.setState((state) => ({ localSettings: {
            ...state.localSettings,
            machineDisplayColorByMachineV1: withMachineDisplayColor(state.localSettings.machineDisplayColorByMachineV1, serverId, machineId, color),
        } }));
    };

    it('renders the scoped color and returns to the caller foreground after reset', async () => {
        const screen = await renderScreen(<MachineDisplayGlyph serverId="server-a" machineId="machine-a" size={14} color={lightTheme.colors.text.secondary} />);
        const color = () => screen.root.findByType(Icon).props.color;
        expect(color()).toBe(lightTheme.colors.text.secondary);
        await act(async () => setColor('server-a', 'machine-a', 'blue'));
        expect(color()).toBe(lightTheme.colors.accent.blue);
        await act(async () => setColor('server-b', 'machine-a', 'purple'));
        expect(color()).toBe(lightTheme.colors.accent.blue);
        await act(async () => setColor('server-a', 'machine-a', 'automatic'));
        expect(color()).toBe(lightTheme.colors.text.secondary);
    });

    it('does not rerender subscribers when another machine or server changes color', async () => {
        let renders = 0;
        const hook = await renderHook(() => { renders += 1; return useMachineDisplayColor('server-a', 'machine-a'); });
        const settled = renders;
        await act(async () => setColor('server-a', 'machine-b', 'blue'));
        await act(async () => setColor('server-b', 'machine-a', 'purple'));
        expect(renders).toBe(settled);
        await act(async () => setColor('server-a', 'machine-a', 'blue'));
        expect(hook.getCurrent()).toBe('blue');
        expect(renders).toBeGreaterThan(settled);
    });
});
