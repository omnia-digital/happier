import { describe, expect, it } from 'vitest';
import { applyLocalSettings, localSettingsParse } from './localSettings';
import { LOCAL_SETTING_DEFINITIONS } from './registry/local/localSettingDefinitions';

describe('local session list machine view', () => {
    it('defaults to the original view and survives both local view selections across reload', () => {
        expect(LOCAL_SETTING_DEFINITIONS.sessionListMachineViewV1.storageScope).toBe('local');
        const original = localSettingsParse(null);
        expect(original.sessionListMachineViewV1).toBe('original');

        const machine = applyLocalSettings(original, { sessionListMachineViewV1: 'machine' });
        expect(localSettingsParse(JSON.parse(JSON.stringify(machine))).sessionListMachineViewV1).toBe('machine');

        const restored = applyLocalSettings(machine, { sessionListMachineViewV1: 'original' });
        expect(localSettingsParse(JSON.parse(JSON.stringify(restored))).sessionListMachineViewV1).toBe('original');
    });

    it('stores machine text visibility independently of machine glyph visibility', () => {
        const defaults = localSettingsParse(null);
        expect(LOCAL_SETTING_DEFINITIONS.sessionListShowMachineLabel.storageScope).toBe('local');
        expect(defaults.sessionListShowMachineIdentity).toBe(true);
        expect(defaults.sessionListShowMachineLabel).toBe(true);
        const iconOnly = applyLocalSettings(defaults, { sessionListShowMachineLabel: false });
        const reloaded = localSettingsParse(JSON.parse(JSON.stringify(iconOnly)));
        expect(reloaded.sessionListShowMachineIdentity).toBe(true);
        expect(reloaded.sessionListShowMachineLabel).toBe(false);
        const noIdentity = applyLocalSettings(reloaded, { sessionListShowMachineIdentity: false });
        expect(noIdentity.sessionListShowMachineLabel).toBe(false);
    });
});
