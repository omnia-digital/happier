import type { InboxSessionState } from '@/hooks/inbox/buildInboxSessionState';
import type { MachineDisplayRenderable } from '@/sync/domains/machines/machineDisplayRenderable';
import { resolveSessionWorkspacePresentation } from '@/sync/domains/session/listing/sessionWorkspacePresentation';

export type InboxSessionContextPresentation = Readonly<{
    machineLabel: string | null;
    machineId: string | null;
    workspaceName: string | null;
}>;

export function buildInboxSessionContextByKey(params: Readonly<{
    sessionByKey: InboxSessionState['sessionByKey'];
    machines: Readonly<Record<string, MachineDisplayRenderable>>;
    workspaceLabelsByServerId: ReadonlyMap<string, Readonly<Record<string, string>>>;
}>): ReadonlyMap<string, InboxSessionContextPresentation> {
    const result = new Map<string, InboxSessionContextPresentation>();
    for (const [key, entry] of params.sessionByKey) {
        const metadata = entry.session.metadata ?? null;
        const presentation = resolveSessionWorkspacePresentation({
            metadata,
            machines: params.machines,
            workspaceLabelsV1: entry.serverId ? params.workspaceLabelsByServerId.get(entry.serverId) : undefined,
        });
        result.set(key, {
            machineLabel: presentation.machineId ? presentation.machineLabel : null,
            machineId: presentation.machineId,
            workspaceName: presentation.displayTitle || null,
        });
    }
    return result;
}
