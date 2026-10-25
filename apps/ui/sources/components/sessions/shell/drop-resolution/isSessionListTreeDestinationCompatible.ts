import { compareSessionFolderWorkspaceRefs } from '@/sync/domains/session/folders/workspaceRefs';
import { resolveServerProfileScopeIdForIdentifier } from '@/sync/domains/server/serverProfiles';
import type { TreeInstruction } from '@/components/ui/treeDragDrop';
import type { SessionListTreeContainerMetadata, SessionListTreeModel, SessionListTreeRowMetadata } from './sessionListTreeTypes';

/** Display siblings can span checkouts; assigning a real folder cannot. */
export function isSessionListTreeDestinationCompatible(
    source: SessionListTreeRowMetadata,
    destination: SessionListTreeContainerMetadata,
): boolean {
    if (source.rootId !== destination.rootId) return false;
    if (destination.displayOrderOnly) return true;
    return !source.workspace || !destination.workspace || compareSessionFolderWorkspaceRefs(source.workspace, destination.workspace);
}

/** Per-Home ranks cannot reproduce a sibling move that changes the interleaving of Homes. */
export function isSessionListHomeOrderMoveCompatible(
    tree: SessionListTreeModel,
    source: SessionListTreeRowMetadata,
    instruction: TreeInstruction,
): boolean {
    if (instruction.kind !== 'reorder-before' && instruction.kind !== 'reorder-after') return true;
    if (source.containerId !== instruction.containerId) return true;
    const container = tree.containerMetadataById.get(instruction.containerId);
    if (container?.kind !== 'children') return true;

    const children = [...tree.rowMetadataById.values()]
        .filter(row => row.containerId === container.containerId && row.orderKey)
        .sort((a, b) => a.itemIndex - b.itemIndex);
    const sourceIndex = children.findIndex(row => row.rowId === source.rowId);
    const targetIndex = children.findIndex(row => row.rowId === instruction.targetId);
    if (sourceIndex < 0 || targetIndex < 0) return false;
    const canonicalHomes = new Map<string, string>();
    const homeFor = (row: SessionListTreeRowMetadata) => {
        const id = row.serverId ?? '';
        if (!canonicalHomes.has(id)) canonicalHomes.set(id, resolveServerProfileScopeIdForIdentifier(id));
        return canonicalHomes.get(id)!;
    };
    const homes = children.map(homeFor);
    if (homes.some(home => !home)) return false;
    const seen = new Set<string>();
    let previousHome = '';
    for (const home of homes) {
        if (home !== previousHome && seen.has(home)) return false;
        seen.add(home);
        previousHome = home;
    }
    const [moved] = children.splice(sourceIndex, 1);
    const nextTargetIndex = children.findIndex(row => row.rowId === instruction.targetId);
    children.splice(nextTargetIndex + (instruction.kind === 'reorder-after' ? 1 : 0), 0, moved!);
    return children.every((row, index) => homeFor(row) === homes[index]);
}
