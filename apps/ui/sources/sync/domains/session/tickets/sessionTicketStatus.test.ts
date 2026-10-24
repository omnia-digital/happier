import { describe, expect, it, vi } from 'vitest';
import { createSessionTicketStatusEntry, type TicketReaderTransport } from './sessionTicketStatus';
import type { SessionTicketAssociationV1 } from '@happier-dev/protocol';

const association: SessionTicketAssociationV1 = { v: 1, ticket: { v: 1, provider: 'linear', workspaceId: 'team', ticketId: 'uuid', key: 'ENG-123', title: 'Ticket', url: 'https://linear.app/team/issue/ENG-123' }, reader: { machineId: 'reader', mcpServerId: 'linear', directory: '/repo' } };
const scope = { serverId: 'home', accountId: 'account' };
const snapshot = { ticket: association.ticket, status: { id: 'custom', name: 'Q/A - Dev', order: 4 }, fetchedAt: 1234 };

describe('session ticket live projection', () => {
    it('publishes only inside the canonical final Home credential guard', async () => {
        const commit = vi.fn(async (_action: () => void) => false);
        const entry = createSessionTicketStatusEntry(scope, association, async () => snapshot, () => true, commit);
        await entry.refresh();
        expect(commit).toHaveBeenCalledOnce();
        expect(entry.getSnapshot().snapshot).toBeNull();
    });
    it('shares concurrent reads and preserves custom provider status/order for both consumers', async () => {
        let complete!: (value: unknown) => void;
        const transport: TicketReaderTransport = vi.fn(() => new Promise((resolve) => { complete = resolve; }));
        const entry = createSessionTicketStatusEntry(scope, association, transport, () => true);
        const notifications = vi.fn();
        entry.subscribe(notifications);
        const first = entry.refresh();
        const second = entry.refresh();
        expect(transport).toHaveBeenCalledTimes(1);
        expect(entry.getSnapshot().phase).toBe('loading');
        complete(snapshot);
        await Promise.all([first, second]);
        expect(entry.getSnapshot()).toEqual({ phase: 'ready', snapshot, error: null });
        expect(notifications).toHaveBeenCalledTimes(2);
    });

    it('retains a failed refresh as explicitly stale and allows recovery', async () => {
        let response: unknown = snapshot;
        const entry = createSessionTicketStatusEntry(scope, association, async () => { if (response instanceof Error) throw response; return response; }, () => true);
        await entry.refresh();
        response = new Error('access_revoked');
        await entry.refresh();
        expect(entry.getSnapshot()).toEqual({ phase: 'stale', snapshot, error: 'access_revoked' });
        response = { ...snapshot, status: { name: 'Ready for Prod' } };
        await entry.refresh();
        expect(entry.getSnapshot().snapshot?.status.name).toBe('Ready for Prod');
        expect(entry.getSnapshot().phase).toBe('ready');
    });

    it('rejects a different provider ticket and ignores completion after account/Home changes', async () => {
        let current = true;
        const entry = createSessionTicketStatusEntry(scope, association, async () => ({ ...snapshot, ticket: { ...snapshot.ticket, ticketId: 'other' } }), () => current);
        await entry.refresh();
        expect(entry.getSnapshot().error).toBe('identity_mismatch');
        const deferred = createSessionTicketStatusEntry(scope, association, async () => { current = false; return snapshot; }, () => current);
        await deferred.refresh();
        expect(deferred.getSnapshot().snapshot).toBeNull();
    });
});
