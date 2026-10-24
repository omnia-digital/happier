import { describe, expect, it } from 'vitest';
import { settingsParse, SettingsSchema, settingsDefaults, SUPPORTED_SCHEMA_VERSION } from './settings';
import { localSettingsParse } from './localSettings';
import { parseAccountSettings } from './parse/accountSettingsParse';

describe('independent status organization preferences', () => {
    it('defaults off without changing the saved sort or machine/repository presentation', () => {
        expect(settingsParse({ sessionListOrderingModeV1: 'updated' })).toMatchObject({ sessionListOrderingModeV1: 'updated', sessionListStatusSortV1: 'none' });
        expect(localSettingsParse({ sessionListMachineViewV1: 'repository' })).toMatchObject({ sessionListMachineViewV1: 'repository', sessionListStatusGroupingV1: 'none' });
    });
    it.each(['agent', 'ticket'])('persists %s independently through serialization/reload', mode => {
        expect(settingsParse(JSON.parse(JSON.stringify(settingsParse({ sessionListOrderingModeV1: 'created', sessionListStatusSortV1: mode }))))).toMatchObject({ sessionListOrderingModeV1: 'created', sessionListStatusSortV1: mode });
        expect(localSettingsParse(JSON.parse(JSON.stringify(localSettingsParse({ sessionListMachineViewV1: 'machine', sessionListStatusGroupingV1: mode }))))).toMatchObject({ sessionListMachineViewV1: 'machine', sessionListStatusGroupingV1: mode });
    });
    it('retains the additive account choice through the actual older-parser unknown-field contract', () => {
        const olderSchema = SettingsSchema.omit({ sessionListStatusSortV1: true });
        const before = settingsParse({ sessionListStatusSortV1: 'ticket', sessionListOrderingModeV1: 'custom', futureField: { retained: true } });
        const throughOlder = parseAccountSettings({ settings: before, schema: olderSchema, defaults: settingsDefaults, supportedSchemaVersion: SUPPORTED_SCHEMA_VERSION, pruneResult: value => value, debugEnabled: false, isDev: false });
        expect(settingsParse({ ...throughOlder, hideInactiveSessions: true })).toMatchObject({ sessionListStatusSortV1: 'ticket', sessionListOrderingModeV1: 'custom', futureField: { retained: true } });
    });
});
