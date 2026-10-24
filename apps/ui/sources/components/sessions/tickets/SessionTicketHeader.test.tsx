import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderScreen, standardCleanup } from '@/dev/testkit';

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
});
