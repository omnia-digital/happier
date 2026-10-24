import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderScreen, standardCleanup } from '@/dev/testkit';
import { afterEach } from 'vitest';
import { SessionTicketStatusLabel } from './SessionTicketStatusLabel';

vi.mock('react-native', async () => (await import('@/dev/testkit/mocks/reactNative')).createReactNativeWebMock());
vi.mock('react-native-unistyles', async () => (await import('@/dev/testkit/mocks/unistyles')).createUnistylesMock());

afterEach(standardCleanup);
describe('ticket workflow label', () => {
    it('retains full custom status/key/title in compact accessibility text and distinguishes stale values', async () => {
        const ticket = { v: 1 as const, provider: 'linear' as const, workspaceId: 'team', ticketId: 'uuid', key: 'ENG-123', title: 'A complete long ticket title', url: 'https://linear.app/team/issue/ENG-123' };
        const state = { phase: 'stale' as const, snapshot: { ticket, status: { name: 'Q/A - Development / Approval' }, fetchedAt: 1234 }, error: 'offline' as const };
        const screen = await renderScreen(<SessionTicketStatusLabel ticket={ticket} state={state} testID="ticket" />);
        const label = screen.findByTestId('ticket');
        expect(label?.props.accessibilityLabel).toContain('Q/A - Development / Approval');
        expect(label?.props.accessibilityLabel).toContain(ticket.title);
        expect(screen.getTextContent().toLowerCase()).toContain('stale');
        expect(screen.getTextContent()).toMatch(/^Stale · Q\/A/);
        await screen.update(<SessionTicketStatusLabel ticket={ticket} state={{ ...state, phase: 'ready', error: null }} testID="ticket" />);
        expect(screen.getTextContent()).toContain('Q/A - Development / Approval');
        expect(screen.getTextContent().toLowerCase()).not.toContain('stale');
    });
});
