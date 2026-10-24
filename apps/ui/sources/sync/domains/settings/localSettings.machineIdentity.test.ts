import { describe, expect, it } from 'vitest';
import { applyLocalSettings, localSettingsParse } from './localSettings';
import { LOCAL_SETTING_DEFINITIONS } from './registry/local/localSettingDefinitions';
import { readMachineDisplayIcon, withMachineDisplayIcon } from '@/sync/domains/machines/machineDisplayIconPreference';

describe('local session row machine identity preference', () => {
    it('defaults on, survives a local storage round trip, and can be restored', () => {
        expect(LOCAL_SETTING_DEFINITIONS.sessionListShowMachineIdentity.storageScope).toBe('local');
        expect(localSettingsParse(null).sessionListShowMachineIdentity).toBe(true);

        const hidden = applyLocalSettings(localSettingsParse(null), { sessionListShowMachineIdentity: false });
        expect(localSettingsParse(JSON.parse(JSON.stringify(hidden))).sessionListShowMachineIdentity).toBe(false);

        const shown = applyLocalSettings(hidden, { sessionListShowMachineIdentity: true });
        expect(localSettingsParse(JSON.parse(JSON.stringify(shown))).sessionListShowMachineIdentity).toBe(true);
    });
});

describe('local machine display icons', () => {
    it('persists independent choices by server and machine id, and resets one choice', () => {
        expect(LOCAL_SETTING_DEFINITIONS.machineDisplayIconByMachineV1.storageScope).toBe('local');
        const defaults = localSettingsParse(null);
        expect(readMachineDisplayIcon(defaults.machineDisplayIconByMachineV1, 'server-a', 'machine-a')).toBe('desktop');
        const first = applyLocalSettings(defaults, {
            machineDisplayIconByMachineV1: withMachineDisplayIcon(defaults.machineDisplayIconByMachineV1, 'server-a', 'machine-a', 'laptop'),
        });
        const second = applyLocalSettings(first, {
            machineDisplayIconByMachineV1: withMachineDisplayIcon(first.machineDisplayIconByMachineV1, 'server-b', 'machine-a', 'cloud'),
        });
        const reloaded = localSettingsParse(JSON.parse(JSON.stringify(second)));
        expect(readMachineDisplayIcon(reloaded.machineDisplayIconByMachineV1, 'server-a', 'machine-a')).toBe('laptop');
        expect(readMachineDisplayIcon(reloaded.machineDisplayIconByMachineV1, 'server-b', 'machine-a')).toBe('cloud');
        const reset = applyLocalSettings(reloaded, {
            machineDisplayIconByMachineV1: withMachineDisplayIcon(reloaded.machineDisplayIconByMachineV1, 'server-a', 'machine-a', 'desktop'),
        });
        expect(readMachineDisplayIcon(reset.machineDisplayIconByMachineV1, 'server-a', 'machine-a')).toBe('desktop');
        expect(readMachineDisplayIcon(reset.machineDisplayIconByMachineV1, 'server-b', 'machine-a')).toBe('cloud');
    });
});


describe('local machine display colors', () => {
    it('defaults to no overrides and persists independent colors without changing icon choices', () => {
        const defaults = localSettingsParse(null);
        expect(defaults.machineDisplayColorByMachineV1).toEqual({});
        const saved = applyLocalSettings(defaults, {
            machineDisplayIconByMachineV1: { '["server-a","machine-a"]': 'cloud' },
            machineDisplayColorByMachineV1: {
                '["server-a","machine-a"]': 'blue',
                '["server-b","machine-a"]': 'purple',
                '["server-a","machine-b"]': 'red',
            },
        });
        const reloaded = localSettingsParse(JSON.parse(JSON.stringify(saved)));
        expect(reloaded.machineDisplayColorByMachineV1).toEqual(saved.machineDisplayColorByMachineV1);
        expect(reloaded.machineDisplayColorByMachineV1['["server-b","machine-a"]']).toBe('purple');
        expect(reloaded.machineDisplayIconByMachineV1['["server-a","machine-a"]']).toBe('cloud');
    });
});
