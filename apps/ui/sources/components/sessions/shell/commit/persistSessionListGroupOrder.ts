import { resolveSessionOrganizationMutationScope } from '@/sync/domains/session/organization/mutationScope';
import { buildSessionOrganizationReorderRequestFromGroupOrder } from '@/sync/domains/session/organization/viewState';
import { reorderSessionOrganization } from '@/sync/ops/sessionOrganization';

export type SessionListGroupOrderScope = Readonly<{ serverId: string; accountId?: string }>;

type OrderMap = Readonly<Record<string, readonly string[] | undefined>>;
export async function persistSessionListGroupOrder(input: Readonly<{
    currentOrder: OrderMap;
    nextOrder: OrderMap;
    defaultServerId: string | null;
    groupScopes?: Readonly<Record<string, readonly SessionListGroupOrderScope[] | null>>;
}>): Promise<void> {
    const changed = Object.entries(input.nextOrder).filter(([key, values]) => {
        const current = input.currentOrder[key] ?? [];
        const next = values ?? [];
        return current.length !== next.length || current.some((value, index) => value !== next[index]);
    });
    await Promise.all(changed.map(async ([scopeKey, itemKeys]) => {
        const scopes = input.groupScopes?.[scopeKey];
        if (scopes === null) throw new Error('Session organization account scope is unavailable');
        const targets = scopes ?? [{ serverId: input.defaultServerId }];
        await Promise.all(targets.map(async target => {
            const resolved = await resolveSessionOrganizationMutationScope(target.serverId, 'accountId' in target ? target.accountId : undefined);
            if (!resolved.ok) throw new Error('Session organization account scope is unavailable');
            const request = buildSessionOrganizationReorderRequestFromGroupOrder({
                serverId: resolved.scope.serverId, scopeKey, itemKeys: itemKeys ?? [],
            });
            if (request) await reorderSessionOrganization({ ...resolved.scope, request });
        }));
    }));
}
