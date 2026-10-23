import * as React from 'react';
import { act } from 'react-test-renderer';
import { MMKV } from 'react-native-mmkv';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, renderScreen, standardCleanup } from '@/dev/testkit';
import { storage } from '@/sync/domains/state/storageStore';
import { useMachineDisplayColor, useMachineDisplayIcon } from '@/sync/store/hooks';
import { withMachineDisplayColor, withMachineDisplayIcon } from '@/sync/domains/machines/machineDisplayIconPreference';
import { getActiveServerId, setActiveServerId, setServerProfileIdentityForUrl, upsertServerProfile } from '@/sync/domains/server/serverProfiles';
import { lightTheme } from '@/theme';
import { Icon } from '@/components/ui/icons/Icon';
import { MachineDisplayGlyph } from './SessionMachineIdentity';

vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});

describe('machine glyph appearance', () => {
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

    it('uses the active Home for implicit rows and resolves explicit profile aliases without leaking across Homes', async () => {
        const previousServer = getActiveServerId();
        const homeA = upsertServerProfile({ serverUrl: 'https://glyph-active.example.test' });
        const homeB = upsertServerProfile({ serverUrl: 'https://glyph-foreign.example.test' });
        setServerProfileIdentityForUrl(homeA.serverUrl, 'srv_glyph_home_a');
        setServerProfileIdentityForUrl(homeB.serverUrl, 'srv_glyph_home_b');
        setActiveServerId(homeA.id);
        expect(getActiveServerId()).toBe('srv_glyph_home_a');
        try {
            storage.setState((state) => ({ localSettings: {
                ...state.localSettings,
                machineDisplayIconByMachineV1: withMachineDisplayIcon(withMachineDisplayIcon({}, 'srv_glyph_home_a', 'shared-machine', 'laptop'), 'srv_glyph_home_b', 'shared-machine', 'cloud'),
                machineDisplayColorByMachineV1: withMachineDisplayColor(withMachineDisplayColor({}, 'srv_glyph_home_a', 'shared-machine', 'blue'), 'srv_glyph_home_b', 'shared-machine', 'purple'),
            } }));
            const implicit = await renderScreen(<MachineDisplayGlyph machineId="shared-machine" size={14} color={lightTheme.colors.text.secondary} />);
            let foreignRenders = 0;
            const foreign = await renderHook(() => {
                foreignRenders += 1;
                return { icon: useMachineDisplayIcon(homeB.id, 'shared-machine'), color: useMachineDisplayColor(homeB.id, 'shared-machine') };
            });
            expect(implicit.root.findByType(Icon).props).toMatchObject({ name: 'laptop', color: lightTheme.colors.accent.blue });
            expect(foreign.getCurrent()).toEqual({ icon: 'cloud', color: 'purple' });
            const settled = foreignRenders;
            await act(async () => setActiveServerId(homeB.id));
            expect(implicit.root.findByType(Icon).props).toMatchObject({ name: 'cloud', color: lightTheme.colors.accent.purple });
            expect(foreignRenders).toBe(settled);
            await act(async () => setColor('srv_glyph_home_a', 'shared-machine', 'automatic'));
            expect(implicit.root.findByType(Icon).props).toMatchObject({ name: 'cloud', color: lightTheme.colors.accent.purple });
            expect(foreignRenders).toBe(settled);
            await act(async () => setActiveServerId(homeA.id));
            expect(implicit.root.findByType(Icon).props).toMatchObject({ name: 'laptop', color: lightTheme.colors.text.secondary });
        } finally {
            await act(async () => setActiveServerId(previousServer));
        }
    });

    it('updates an explicitly scoped mounted glyph when Home identity is learned', async () => {
        const profile = upsertServerProfile({ serverUrl: 'https://glyph-discovered.example.test' });
        const screen = await renderScreen(<MachineDisplayGlyph serverId={profile.id} machineId="machine-a" size={14} color={lightTheme.colors.text.secondary} />);
        await act(async () => storage.setState((state) => ({ localSettings: {
            ...state.localSettings,
            machineDisplayIconByMachineV1: withMachineDisplayIcon({}, 'srv_glyph_discovered', 'machine-a', 'terminal'),
            machineDisplayColorByMachineV1: withMachineDisplayColor({}, 'srv_glyph_discovered', 'machine-a', 'red'),
        } })));
        expect(screen.root.findByType(Icon).props.name).toBe('desktop');
        await act(async () => { setServerProfileIdentityForUrl(profile.serverUrl, 'srv_glyph_discovered'); });
        expect(screen.root.findByType(Icon).props).toMatchObject({ name: 'terminal', color: lightTheme.colors.accent.red });
        await act(async () => storage.setState((state) => ({ localSettings: {
            ...state.localSettings,
            machineDisplayIconByMachineV1: withMachineDisplayIcon(state.localSettings.machineDisplayIconByMachineV1, 'srv_glyph_discovered', 'machine-a', 'laptop'),
        } })));
        expect(screen.root.findByType(Icon).props).toMatchObject({ name: 'laptop', color: lightTheme.colors.accent.red });
    });

    it('preserves an appearance chosen before identity discovery and resets every proven alias', async () => {
        const profile = upsertServerProfile({ serverUrl: 'https://glyph-before-identity.example.test' });
        const originalIcons = withMachineDisplayIcon({}, profile.id, 'machine-a', 'laptop');
        expect(withMachineDisplayIcon(originalIcons, profile.id, 'machine-a', 'laptop')).toBe(originalIcons);
        storage.setState((state) => ({ localSettings: {
            ...state.localSettings,
            machineDisplayIconByMachineV1: withMachineDisplayIcon({}, profile.id, 'machine-a', 'laptop'),
            machineDisplayColorByMachineV1: withMachineDisplayColor({}, profile.id, 'machine-a', 'blue'),
        } }));
        const screen = await renderScreen(<MachineDisplayGlyph serverId={profile.id} machineId="machine-a" size={14} color={lightTheme.colors.text.secondary} />);
        expect(screen.root.findByType(Icon).props).toMatchObject({ name: 'laptop', color: lightTheme.colors.accent.blue });
        await act(async () => { setServerProfileIdentityForUrl(profile.serverUrl, 'srv_glyph_promoted'); });
        expect(screen.root.findByType(Icon).props).toMatchObject({ name: 'laptop', color: lightTheme.colors.accent.blue });
        // A hydrated map can contain both eras; the canonical entry wins.
        await act(async () => storage.setState((state) => ({ localSettings: {
            ...state.localSettings,
            machineDisplayIconByMachineV1: { ...state.localSettings.machineDisplayIconByMachineV1, '["srv_glyph_promoted","machine-a"]': 'cloud' },
            machineDisplayColorByMachineV1: { ...state.localSettings.machineDisplayColorByMachineV1, '["srv_glyph_promoted","machine-a"]': 'purple' },
        } })));
        expect(screen.root.findByType(Icon).props).toMatchObject({ name: 'cloud', color: lightTheme.colors.accent.purple });
        await act(async () => storage.setState((state) => ({ localSettings: {
            ...state.localSettings,
            machineDisplayIconByMachineV1: withMachineDisplayIcon(state.localSettings.machineDisplayIconByMachineV1, 'srv_glyph_promoted', 'machine-a', 'desktop'),
            machineDisplayColorByMachineV1: withMachineDisplayColor(state.localSettings.machineDisplayColorByMachineV1, 'srv_glyph_promoted', 'machine-a', 'automatic'),
        } })));
        expect(screen.root.findByType(Icon).props).toMatchObject({ name: 'desktop', color: lightTheme.colors.text.secondary });
        expect(storage.getState().localSettings.machineDisplayIconByMachineV1).toEqual({});
        expect(storage.getState().localSettings.machineDisplayColorByMachineV1).toEqual({});
    });

    it('does not reread persisted Home profiles on unrelated store notifications', async () => {
        await renderHook(() => ({ icon: useMachineDisplayIcon('server-a', 'machine-a'), color: useMachineDisplayColor('server-a', 'machine-a') }));
        const reads = vi.spyOn(MMKV.prototype, 'getString');
        try {
            await act(async () => storage.setState((state) => ({ localSettings: {
                ...state.localSettings,
                sessionListShowMachineIdentity: !state.localSettings.sessionListShowMachineIdentity,
            } })));
            expect(reads.mock.calls.filter(([key]) => key === 'server-state-v1')).toEqual([]);
        } finally {
            reads.mockRestore();
        }
    });

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
