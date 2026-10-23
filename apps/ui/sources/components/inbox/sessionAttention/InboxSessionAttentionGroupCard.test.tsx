import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { createMachineFixture, createSessionFixture, renderScreen } from '@/dev/testkit';
import { readMachineDisplayIcon, withMachineDisplayIcon } from '@/sync/domains/machines/machineDisplayIconPreference';
import { buildInboxSessionContextByKey } from '../inboxSessionContextPresentation';

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});
vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});
vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock();
});
vi.mock('@/sync/domains/state/storage', async () => {
    const { createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
    const icons = withMachineDisplayIcon(
        withMachineDisplayIcon({}, 'server-a', 'machine-old', 'laptop'),
        'server-a', 'machine-successor', 'cloud',
    );
    return createStorageModuleStub({
        useMachineDisplayIcon: (serverId?: string | null, machineId?: string | null) =>
            readMachineDisplayIcon(icons, serverId, machineId),
    });
});

describe('InboxSessionAttentionGroupCard', () => {
    it('renders the successor machine name and icon together through the context header', async () => {
        const session = createSessionFixture({
            id: 'session-1',
            metadata: { machineId: 'machine-old', path: '/repo', host: 'old-host' },
        });
        const context = buildInboxSessionContextByKey({
            sessionByKey: new Map([['server-a:session-1', { serverId: 'server-a', sessionId: session.id, session }]]),
            machines: {
                'machine-old': createMachineFixture({ id: 'machine-old', replacedByMachineId: 'machine-successor' }),
                'machine-successor': createMachineFixture({ id: 'machine-successor', metadata: { displayName: 'Successor' } }),
            },
            workspaceLabelsByServerId: new Map(),
        }).get('server-a:session-1')!;
        const { InboxSessionAttentionGroupCard } = await import('./InboxSessionAttentionGroupCard');
        const { Icon } = await import('@/components/ui/icons/Icon');

        const screen = await renderScreen(<InboxSessionAttentionGroupCard
            session={session}
            serverId="server-a"
            machineId={context.machineId}
            machineLabel={context.machineLabel}
            workspaceName={context.workspaceName}
            permissionRequests={[]}
            userActionRequests={[]}
            identityDisplay="none"
            onOpenSession={() => {}}
        />);
        const icons = screen.findAllByType(Icon).map((icon) => icon.props.name);

        expect(screen.getTextContent()).toContain('Successor');
        expect(icons).toContain('cloud');
        expect(icons).not.toContain('laptop');
    });
});
