import { describe, expect, it, vi } from 'vitest';
import type { SessionTicketAssociationV1 } from '@happier-dev/protocol';
import { createSessionTicketStatusOwner } from './sessionTicketStatusOwner';

const context = { targetServerId: 'home', targetServerUrl: 'http://fixture.local', targetAccountId: 'account' };
const link: SessionTicketAssociationV1 = { v: 1, ticket: { v: 1, provider: 'linear', workspaceId: 'fixture', ticketId: 'uuid', key: 'DEV-1', title: 'Fixture', url: 'https://linear.app/fixture/issue/DEV-1' }, reader: { machineId: 'machine', mcpServerId: 'mcp', directory: '/fixture' } };
const snapshot = { ticket: link.ticket, status: { name: 'Q/A - Dev', order: 3 }, fetchedAt: 1 };

describe('one ticket demand owner before and after row visibility', () => {
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
        expect(read).toHaveBeenCalledOnce();
        expect(owner.retain({ ...context, targetAccountId: 'other' }, link).entry).not.toBe(first.entry);
        expect(owner.retain({ ...context, targetServerUrl: 'http://other.local' }, link).entry).not.toBe(first.entry);
        first.release(); second.release(); finish(snapshot); await pending;
        expect(first.entry.getSnapshot().snapshot).toBeNull(); expect(commit).not.toHaveBeenCalled();
        const renewed = owner.retain(context, link); expect(renewed.created).toBe(true);
    });
});
