import * as React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderSettingsView, standardCleanup } from '@/dev/testkit';
import {
    installSessionSettingsEntryModuleMocks,
    resetSessionSettingsEntryState,
    sessionSettingsEntryState,
} from './sessionSettingsEntryTestHelpers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
installSessionSettingsEntryModuleMocks();

afterEach(() => {
    standardCleanup();
    resetSessionSettingsEntryState();
});

describe('Session Preferences machine row identity', () => {
    it('offers a default-on local toggle and reflects an opt-out immediately', async () => {
        const { default: SessionSettingsScreen } = await import('../../../../app/(app)/settings/session');
        const screen = await renderSettingsView(<SessionSettingsScreen />);
        const item = screen.findByTestId('settings-session-machineIdentity-item');
        const toggle = item?.props.rightElement as React.ReactElement<{ value: boolean; onValueChange: (next: boolean) => void }>;
        expect(toggle.props.value).toBe(true);

        toggle.props.onValueChange(false);
        expect(sessionSettingsEntryState.settingsState.sessionListShowMachineIdentity).toBe(false);
        await screen.update(<SessionSettingsScreen key="after-toggle" />);
        const hiddenItem = screen.findByTestId('settings-session-machineIdentity-item');
        const hiddenToggle = hiddenItem?.props.rightElement as React.ReactElement<{ value: boolean; onValueChange: (next: boolean) => void }>;
        expect(hiddenToggle.props.value).toBe(false);

        hiddenToggle.props.onValueChange(true);
        expect(sessionSettingsEntryState.settingsState.sessionListShowMachineIdentity).toBe(true);
    });
});
