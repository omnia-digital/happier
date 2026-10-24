import { describe, expect, it, vi } from 'vitest';
import type { SessionTicketAssociationV1 } from '@happier-dev/protocol';
import { createSessionTicketStatusOwner } from './sessionTicketStatusOwner';

const context = { targetServerId: 'home', targetServerUrl: 'http://fixture.local', targetAccountId: 'account' };
const link: SessionTicketAssociationV1 = { v: 1, ticket: { v: 1, provider: 'linear', workspaceId: 'fixture', ticketId: 'uuid', key: 'DEV-1', title: 'Fixture', url: 'https://linear.app/fixture/issue/DEV-1' }, reader: { machineId: 'machine', mcpServerId: 'mcp', directory: '/fixture' } };
const snapshot = { ticket: link.ticket, status: { name: 'Q/A - Dev', order: 3 }, fetchedAt: 1 };

describe('one ticket demand owner before and after row visibility', () => {
    it('bounds a large candidate set to one live MCP read per configured reader/source and drops retired queued work', async () => {
        const finish: Array<(value: unknown) => void> = [];
        const read = vi.fn(() => new Promise(resolve => finish.push(resolve)));
        const owner = createSessionTicketStatusOwner(read, async (_context, action) => { action(); return true; });
        const leases = Array.from({ length: 40 }, (_, index) => owner.retain(context, { ...link, ticket: { ...link.ticket, ticketId: 'uuid-' + index, key: 'DEV-' + index, url: 'https://linear.app/fixture/issue/DEV-' + index } }));
        const reads = leases.map(lease => lease.entry.refresh());
        await Promise.resolve();
        expect(read).toHaveBeenCalledTimes(1);
        // Preserve one queued consumer; every other retired row must skip its transport entirely.
        leases.forEach((lease, index) => { if (index !== 1) lease.release(); });
        finish[0]({ ...snapshot, ticket: { ...link.ticket, ticketId: 'uuid-0' } });
        await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
        finish[1]({ ...snapshot, ticket: { ...link.ticket, ticketId: 'uuid-1' } });
        await Promise.all(reads);
        expect(read).toHaveBeenCalledTimes(2);
        expect(leases[1].entry.getSnapshot().snapshot?.status.name).toBe('Q/A - Dev');
        leases[1].release();
    });
    it('shares a retained list read with later row/header subscribers and releases only the last demand', async () => {
        const read = vi.fn(async () => snapshot);
        const owner = createSessionTicketStatusOwner(read, async (_context, action) => { action(); return true; });
        const list = owner.retain(context, link);
        await list.entry.refresh();
        const row = owner.retain(context, link); const header = owner.retain(context, link);
        expect(row.created).toBe(false); expect(header.entry).toBe(list.entry);
        expect(row.entry.getSnapshot().snapshot?.status.name).toBe('Q/A - Dev');
        list.release(); row.release();
        expect(owner.retain(context, link).entry).toBe(header.entry);
        header.release();
        expect(read).toHaveBeenCalledOnce();
    });
    it('separates accounts and Home URLs, coalesces concurrent demands and rejects a retired publication', async () => {
        let finish!: (value: unknown) => void;
        const read = vi.fn(() => new Promise(resolve => { finish = resolve; }));
        const commit = vi.fn(async (_context, action: () => void) => { action(); return true; });
        const owner = createSessionTicketStatusOwner(read, commit);
        const first = owner.retain(context, link); const second = owner.retain(context, link);
        const pending = first.entry.refresh(); void second.entry.refresh();
        await Promise.resolve();
        expect(read).toHaveBeenCalledOnce();
        expect(owner.retain({ ...context, targetAccountId: 'other' }, link).entry).not.toBe(first.entry);
        expect(owner.retain({ ...context, targetServerUrl: 'http://other.local' }, link).entry).not.toBe(first.entry);
        first.release(); second.release(); finish(snapshot); await pending;
        expect(first.entry.getSnapshot().snapshot).toBeNull(); expect(commit).not.toHaveBeenCalled();
        const renewed = owner.retain(context, link); expect(renewed.created).toBe(true);
    });
});
