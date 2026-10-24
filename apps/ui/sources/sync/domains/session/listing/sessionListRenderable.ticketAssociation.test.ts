import { describe, expect, it } from 'vitest';
import { createSessionFixture } from '@/dev/testkit';
import { buildSessionListShellViewItemSignature } from '@/sync/store/hooks';
import { buildSessionListRenderableFromSession, didSessionListRenderableEmbeddedListRowFieldsChange } from './sessionListRenderable';

const association = { v: 1 as const, ticket: { v: 1 as const, provider: 'linear' as const, workspaceId: 'fixture', ticketId: 'uuid', key: 'DEV-1', title: 'Fixture', url: 'https://linear.app/fixture/issue/DEV-1' }, reader: { machineId: 'machine', mcpServerId: 'source', directory: '/repo' } };
describe('ticket association reaches frozen and other-Home shell rows', () => {
    it('publishes add/change/remove through embedded metadata while ignoring a value-equivalent clone', () => {
        const before = buildSessionListRenderableFromSession(createSessionFixture());
        const linked = { ...before, metadata: { ...before.metadata!, sessionTicketV1: association } };
        expect(didSessionListRenderableEmbeddedListRowFieldsChange(before, linked)).toBe(true);
        expect(didSessionListRenderableEmbeddedListRowFieldsChange(linked, { ...linked, metadata: { ...linked.metadata!, sessionTicketV1: structuredClone(association) } })).toBe(false);
        const changed = { ...linked, metadata: { ...linked.metadata!, sessionTicketV1: { ...association, reader: { ...association.reader, mcpServerId: 'other' } } } };
        expect(didSessionListRenderableEmbeddedListRowFieldsChange(linked, changed)).toBe(true);
        expect(didSessionListRenderableEmbeddedListRowFieldsChange(linked, before)).toBe(true);
    });
    it('invalidates shell identity only when association value changes', () => {
        const session = buildSessionListRenderableFromSession(createSessionFixture());
        const before = { type: 'session' as const, serverId: 'other-home', session };
        const linked = { ...before, session: { ...session, metadata: { ...session.metadata!, sessionTicketV1: association } } };
        expect(buildSessionListShellViewItemSignature(linked)).not.toBe(buildSessionListShellViewItemSignature(before));
        expect(buildSessionListShellViewItemSignature({ ...linked, session: { ...linked.session, metadata: { ...linked.session.metadata!, sessionTicketV1: structuredClone(association) } } })).toBe(buildSessionListShellViewItemSignature(linked));
    });
});
