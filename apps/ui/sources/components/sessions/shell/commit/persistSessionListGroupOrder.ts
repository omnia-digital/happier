import type { ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import { resolveSessionOrganizationMutationScope } from '@/sync/domains/session/organization/mutationScope';
import { buildSessionOrganizationReorderRequestFromGroupOrder } from '@/sync/domains/session/organization/viewState';
import { reorderSessionOrganization } from '@/sync/ops/sessionOrganization';

type OrderMap = Readonly<Record<string, readonly string[] | undefined>>;
export async function persistSessionListGroupOrder(input: Readonly<{
    currentOrder: OrderMap;
    nextOrder: OrderMap;
    defaultServerId: string | null;
    repositoryScopes?: Readonly<Record<string, ServerAccountScope | null>>;
}>): Promise<void> {
    const changed = Object.entries(input.nextOrder).filter(([key, values]) => {
        const current = input.currentOrder[key] ?? [];
        const next = values ?? [];
        return current.length !== next.length || current.some((value, index) => value !== next[index]);
    });
    await Promise.all(changed.map(async ([scopeKey, itemKeys]) => {
        const repositoryScope = input.repositoryScopes?.[scopeKey];
        if (repositoryScope === null) throw new Error('Repository account scope is unavailable');
        const resolved = await resolveSessionOrganizationMutationScope(repositoryScope?.serverId ?? input.defaultServerId, repositoryScope?.accountId);
        if (!resolved.ok) throw new Error('Session organization account scope is unavailable');
        const request = buildSessionOrganizationReorderRequestFromGroupOrder({
            serverId: resolved.scope.serverId, scopeKey, itemKeys: itemKeys ?? [],
        });
        if (request) await reorderSessionOrganization({ ...resolved.scope, request });
    }));
}
