import { describe, expect, it } from 'vitest';
import { applyLocalSettings, localSettingsParse } from './localSettings';
import { LOCAL_SETTING_DEFINITIONS } from './registry/local/localSettingDefinitions';

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
