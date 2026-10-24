import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listSessionTicketSources, readSessionTicket } from './sessionTickets';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc', () => ({ machineRpcWithServerScope: rpc }));
const scope = { serverId: 'home', accountId: 'account' };
const reader = { machineId: 'machine', mcpServerId: 'source', directory: '/repo' };
beforeEach(() => rpc.mockReset());

describe('ticket capability transport', () => {
    it('pins discovery and reads to the captured Home/account and forwards only the fixed read contract', async () => {
        rpc.mockResolvedValueOnce({ protocolVersion: 1, results: { 'tool.ticketReader': { ok: true, checkedAt: 1, data: { available: true } } } })
            .mockResolvedValueOnce({ ok: true, result: { sources: [{ id: 'source', title: 'Authorized source' }] } });
        expect(await listSessionTicketSources(scope, reader.machineId, reader.directory)).toEqual([{ id: 'source', title: 'Authorized source' }]);
        for (const call of rpc.mock.calls) expect(call[0]).toMatchObject({ serverId: scope.serverId, accountId: scope.accountId, machineId: reader.machineId });
        const snapshot = { ticket: { v: 1, provider: 'linear', workspaceId: 'team', ticketId: 'uuid', key: 'ENG-1', title: 'Ticket', url: 'https://linear.app/team/issue/ENG-1' }, status: { name: 'Q/A - Dev' }, fetchedAt: 1 };
        rpc.mockResolvedValueOnce({ ok: true, result: snapshot });
        expect(await readSessionTicket(scope, reader, snapshot.ticket.url)).toEqual(snapshot);
        expect(rpc.mock.calls.at(-1)?.[0]).toMatchObject({ ...scope, machineId: 'machine', payload: { id: 'tool.ticketReader', method: 'read', params: { directory: '/repo', mcpServerId: 'source', url: snapshot.ticket.url } } });
    });
    it('distinguishes an older CLI from revoked access and never exposes arbitrary provider error text', async () => {
        rpc.mockResolvedValueOnce({ ok: false, error: { code: 'unsupported-capability', message: 'Unsupported capability: tool.ticketReader' } });
        await expect(readSessionTicket(scope, reader, 'https://linear.app/team/issue/ENG-1')).rejects.toThrow('unsupported');
        rpc.mockResolvedValueOnce({ ok: false, error: { code: 'access_revoked', message: 'token-bearing external error' } });
        await expect(readSessionTicket(scope, reader, 'https://linear.app/team/issue/ENG-1')).rejects.toThrow('access_revoked');
    });
    it('fails closed when detection is disabled, missing or offline, without invoking sources', async () => {
        for (const [result, code] of [
            [{ protocolVersion: 1, results: { 'tool.ticketReader': { ok: true, checkedAt: 1, data: { available: false } } } }, 'disabled'],
            [{ protocolVersion: 1, results: {} }, 'unsupported'],
            [{ error: 'offline' }, 'offline'],
        ] as const) {
            rpc.mockReset(); rpc.mockResolvedValueOnce(result);
            await expect(listSessionTicketSources(scope, 'machine', '/repo')).rejects.toThrow(code);
            expect(rpc).toHaveBeenCalledOnce();
        }
    });
});
