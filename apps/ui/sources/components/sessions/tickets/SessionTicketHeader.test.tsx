import React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderScreen, standardCleanup } from '@/dev/testkit';

const modalShow = vi.hoisted(() => vi.fn());
vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock({ spies: { show: modalShow } }).module;
});
vi.mock('@/sync/domains/scope/activeServerAccountScope', () => ({
    getActiveServerAccountScope: () => ({ serverId: 'home', accountId: 'account' }),
}));

vi.mock('react-native', async () => (await import('@/dev/testkit/mocks/reactNative')).createReactNativeWebMock());
vi.mock('react-native-unistyles', async () => (await import('@/dev/testkit/mocks/unistyles')).createUnistylesMock());
vi.mock('react-native-svg', () => ({ default: 'Svg', Svg: 'Svg', Path: 'Path', SvgXml: 'SvgXml', G: 'G', Circle: 'Circle', Rect: 'Rect', Defs: 'Defs', ClipPath: 'ClipPath' }));

afterEach(standardCleanup);
describe('session ticket edit rights', () => {
    it('hides linking for a viewer and exposes it for the existing canonical edit grant', async () => {
        const { SessionTicketHeader } = await import('./SessionTicketHeader');
        const props = { sessionId: 'session', metadata: { path: '/repo', host: 'host' }, serverId: 'home' };
        const screen = await renderScreen(<SessionTicketHeader {...props} accessLevel="view" />);
        expect(screen.findByTestId('session-ticket-link')).toBeNull();
        await screen.update(<SessionTicketHeader {...props} accessLevel="edit" />);
        expect(screen.findByTestId('session-ticket-link')?.props.accessibilityRole).toBe('button');
    });

    it('shows a linked identity to a viewer while keeping its change action unavailable', async () => {
        const { SessionTicketHeader } = await import('./SessionTicketHeader');
        const metadata = { path: '/repo', host: 'host', sessionTicketV1: { v: 1, ticket: { v: 1, provider: 'linear', workspaceId: 'team', ticketId: 'uuid', key: 'ENG-1', title: 'Full ticket title', url: 'https://linear.app/team/issue/ENG-1' }, reader: { machineId: 'reader', mcpServerId: 'source', directory: '/repo' } } };
        const screen = await renderScreen(<SessionTicketHeader sessionId="session" metadata={metadata} serverId="missing-fixture-home" accessLevel="view" />);
        expect(screen.findByTestId('session-ticket-open')?.props.accessibilityLabel).toContain('Full ticket title');
        expect(screen.findByTestId('session-ticket-change')).toBeNull();
    });

    it('retires an open linking editor when its captured Home account is no longer active', async () => {
        const { SessionTicketLinkEditor } = await import('./SessionTicketLinkEditor');
        const screen = await renderScreen(<SessionTicketLinkEditor sessionId="session" scope={{ serverId: 'missing-home', accountId: 'missing-account' }} association={null} initialDirectory="/repo" initialMachineId="reader" onClose={() => {}} />);
        expect(screen.getTextContent()).toContain('Home Account changed');
        expect(screen.findByTestId('session-ticket-sources')?.props.disabled).toBe(true);
        expect(screen.findByTestId('session-ticket-url')?.props.editable).toBe(false);
    });

    it('opens ticket linking in a card surface around the existing editor scroll view', async () => {
        const { SessionTicketHeader } = await import('./SessionTicketHeader');
        const screen = await renderScreen(<SessionTicketHeader sessionId="session" metadata={{ path: '/repo', host: 'host', machineId: 'reader' }} serverId="home" accessLevel="edit" />);
        const link = screen.findByTestId('session-ticket-link');
        expect(link).toBeTruthy();
        await act(() => link!.props.onPress());

        const config = modalShow.mock.calls.at(-1)?.[0] as { chrome?: { kind: string; layout?: string; bodyScroll?: string } } | undefined;
        expect(config?.chrome).toMatchObject({
            kind: 'card',
            layout: 'fill',
            bodyScroll: 'none',
        });
    });
});
