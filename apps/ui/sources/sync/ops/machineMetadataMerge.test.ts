import { describe, expect, it } from 'vitest';

import { mergeMachineMetadataForVersionMismatch } from './machineMetadataMerge';

describe('mergeMachineMetadataForVersionMismatch', () => {
    it('preserves displayName from intended metadata', () => {
        const merged = mergeMachineMetadataForVersionMismatch({
            latest: { host: 'h', platform: 'win32', happyCliVersion: '1', happyHomeDir: '/h', homeDir: '/u' } as any,
            intended: { displayName: 'My PC' } as any,
            updateDisplayName: true,
        });
        expect((merged as any).displayName).toBe('My PC');
    });

    it('preserves windowsRemoteSessionLaunchMode from intended metadata', () => {
        const merged = mergeMachineMetadataForVersionMismatch({
            latest: { host: 'h', platform: 'win32', happyCliVersion: '1', happyHomeDir: '/h', homeDir: '/u' } as any,
            intended: { windowsRemoteSessionLaunchMode: 'windows_terminal' } as any,
        });
        expect((merged as any).windowsRemoteSessionLaunchMode).toBe('windows_terminal');
    });

    it('preserves latest values when intended fields are undefined', () => {
        const merged = mergeMachineMetadataForVersionMismatch({
            latest: {
                host: 'h',
                platform: 'win32',
                happyCliVersion: '1',
                happyHomeDir: '/h',
                homeDir: '/u',
                displayName: 'Latest',
                windowsRemoteSessionLaunchMode: 'console',
                windowsRemoteSessionConsole: 'hidden',
            } as any,
            intended: {} as any,
        });
        expect((merged as any).displayName).toBe('Latest');
        expect((merged as any).windowsRemoteSessionLaunchMode).toBe('console');
        expect((merged as any).windowsRemoteSessionConsole).toBe('hidden');
    });

    it('clears a custom label on a version conflict while retaining unrelated current metadata', () => {
        const merged = mergeMachineMetadataForVersionMismatch({
            latest: { host: 'current-host', displayName: 'Old label', homeDir: '/current' } as any,
            intended: { host: 'stale-host', displayName: undefined } as any,
            updateDisplayName: true,
        });
        expect(merged).toMatchObject({ host: 'current-host', homeDir: '/current' });
        expect(merged.displayName).toBeUndefined();
    });

    it('preserves a concurrent rename when an unrelated update carries a stale displayName snapshot', () => {
        const merged = mergeMachineMetadataForVersionMismatch({
            latest: { host: 'current-host', displayName: 'New label', windowsRemoteSessionLaunchMode: 'console' } as any,
            intended: { host: 'stale-host', displayName: undefined, windowsRemoteSessionLaunchMode: 'windows_terminal' } as any,
        });
        expect(merged.displayName).toBe('New label');
        expect(merged.windowsRemoteSessionLaunchMode).toBe('windows_terminal');
    });
});
