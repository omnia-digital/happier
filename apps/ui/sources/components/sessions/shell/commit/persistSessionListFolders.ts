import { parseToken } from '@/utils/auth/parseToken';
import { readSessionOrganizationFolders } from '@/sync/domains/state/storage';
import type { SessionFolderV1, SessionFoldersV1 } from '@/sync/domains/session/folders';
import type { ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import { resolveSessionOrganizationMutationScope } from '@/sync/domains/session/organization/mutationScope';
import { upsertSessionFolder as upsertSessionOrganizationFolder, deleteSessionFolder as deleteSessionOrganizationFolder } from '@/sync/ops/sessionOrganization';

function buildFolderDisplay(folder: SessionFolderV1): { t: 'plain'; v: { name: string; workspace: SessionFolderV1['workspace'] } } {
    return {
        t: 'plain',
        v: {
            name: folder.name,
            workspace: folder.workspace,
        },
    };
}

function areFolderDefinitionsEqual(left: SessionFolderV1, right: SessionFolderV1): boolean {
    return left.name === right.name
        && left.parentId === right.parentId
        && (left.sortKey ?? null) === (right.sortKey ?? null)
        && JSON.stringify(left.workspace) === JSON.stringify(right.workspace);
}

/** Capture the folder's account before opening an edit prompt; the writer rechecks it. */
export async function resolveSessionListFolderMutationTarget(serverId: string | null | undefined, expectedAccountId?: string) {
    const resolved = await resolveSessionOrganizationMutationScope(serverId, expectedAccountId);
    if (!resolved.ok) return null;
    return {
        scope: { serverId: resolved.scope.serverId, accountId: parseToken(resolved.scope.credentials.token) },
        current: readSessionOrganizationFolders(resolved.scope.serverId),
    };
}

export async function persistSessionListFolders(input: Readonly<{
    current: SessionFoldersV1;
    next: SessionFoldersV1;
    serverId: string | null;
    scope?: ServerAccountScope;
}>): Promise<void> {
    const resolved = await resolveSessionOrganizationMutationScope(input.scope?.serverId ?? input.serverId, input.scope?.accountId);
    if (!resolved.ok) throw new Error('Folder account scope is unavailable');
    const mutation = resolved.scope;
    const currentById = new Map((input.current.folders ?? []).map((folder) => [folder.id, folder]));
    const nextById = new Map((input.next.folders ?? []).map((folder) => [folder.id, folder]));
    const tasks: Promise<void>[] = [];
    for (const folder of nextById.values()) {
        const current = currentById.get(folder.id);
        if (current && areFolderDefinitionsEqual(current, folder)) continue;
        tasks.push(upsertSessionOrganizationFolder({
            ...mutation,
            request: {
                folderId: folder.id,
                folderKey: folder.id,
                parentFolderId: folder.parentId,
                parentFolderKey: folder.parentId,
                sortKey: folder.sortKey ?? null,
                display: buildFolderDisplay(folder),
            },
        }));
    }
    for (const folder of currentById.values()) {
        if (nextById.has(folder.id)) continue;
        tasks.push(deleteSessionOrganizationFolder({
            ...mutation,
            request: {
                folderId: folder.id,
                assignmentBehavior: 'moveAssignmentsToParent',
            },
        }));
    }
    await Promise.all(tasks);
}
