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
});
