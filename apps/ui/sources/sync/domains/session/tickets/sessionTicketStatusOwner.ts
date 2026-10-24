import type { SessionTicketAssociationV1 } from '@happier-dev/protocol';
import { createSessionTicketStatusEntry, type TicketReaderTransport } from './sessionTicketStatus';
import { createTaskLimiter, type TaskLimiter } from '@/sync/runtime/orchestration/runTasksWithLimit';

export type SessionTicketStatusContext = Readonly<{ targetServerId: string; targetServerUrl: string; targetAccountId: string }>;
type Entry = ReturnType<typeof createSessionTicketStatusEntry>;

/** The OH-58 shared demand Map, retained by headers, visible rows and status organization. */
export function createSessionTicketStatusOwner(
    read: TicketReaderTransport,
    commitIfCurrent: (context: SessionTicketStatusContext, action: () => void) => Promise<boolean>,
) {
    const entries = new Map<string, { entry: Entry; users: number }>();
    const readers = new Map<string, { limiter: TaskLimiter; jobs: number }>();
    return {
        retain(context: SessionTicketStatusContext, association: SessionTicketAssociationV1) {
            const key = JSON.stringify([context.targetServerId, context.targetAccountId, context.targetServerUrl, association]);
            let shared = entries.get(key);
            const created = !shared;
            if (!shared) {
                const next = { users: 0, entry: null as unknown as Entry };
                const readSerially: TicketReaderTransport = (scope, link) => {
                    // Each configured MCP source is one process resource on its reader machine.
                    // Use the existing limiter rather than allowing one process spawn per linked row.
                    const readerKey = JSON.stringify([context.targetServerUrl, context.targetAccountId, link.reader.machineId, link.reader.mcpServerId]);
                    let reader = readers.get(readerKey);
                    if (!reader) { reader = { limiter: createTaskLimiter(1), jobs: 0 }; readers.set(readerKey, reader); }
                    const captured = reader; captured.jobs++;
                    return captured.limiter.run(async () => {
                        if (next.users === 0) throw new Error('cancelled');
                        return read(scope, link);
                    }).finally(() => { if (--captured.jobs === 0 && readers.get(readerKey) === captured) readers.delete(readerKey); });
                };
                next.entry = createSessionTicketStatusEntry({ serverId: context.targetServerId, accountId: context.targetAccountId }, association, readSerially,
                    () => next.users > 0, action => next.users > 0 ? commitIfCurrent(context, () => { if (next.users > 0) action(); }) : Promise.resolve(false));
                shared = next; entries.set(key, shared);
            }
            shared.users++;
            const retained = shared;
            let released = false;
            return { entry: retained.entry, created, release: () => {
                if (released) return; released = true;
                if (--retained.users === 0 && entries.get(key) === retained) entries.delete(key);
            } };
        },
    };
}
