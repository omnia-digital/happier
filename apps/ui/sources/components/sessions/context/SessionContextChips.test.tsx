import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({ View: 'View' });
});

vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});

vi.mock('@/components/sessions/SessionMachineIdentity', () => ({ MachineDisplayGlyph: 'MachineDisplayGlyph' }));
vi.mock('@/components/ui/text/Text', () => ({ Text: 'Text' }));
vi.mock('@/components/ui/icons/Icon', () => ({ Icon: 'Icon' }));

describe('SessionContextChips', () => {
    it('passes a concrete session machine scope to the shared glyph', async () => {
        const { SessionContextChips } = await import('./SessionContextChips');
        const screen = await renderScreen(<SessionContextChips
            machineLabel="Studio"
            machineId="machine-1"
            serverId="server-b"
            pathLabel={null}
        />);
        expect(screen.root.findByType('MachineDisplayGlyph' as never).props)
            .toMatchObject({ machineId: 'machine-1', serverId: 'server-b' });
    });
});
