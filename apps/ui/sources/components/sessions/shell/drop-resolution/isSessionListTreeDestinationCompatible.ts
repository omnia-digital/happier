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

/** Build once from metadata emitted in item order; invalid/interleaved containers have no positions. */
export function buildSessionListHomeOrderPositions(
    rows: ReadonlyMap<string, SessionListTreeRowMetadata>,
): SessionListTreeModel['homeOrderPositionsByRowId'] {
    const siblingsByContainer = new Map<string, SessionListTreeRowMetadata[]>();
    const canonicalHomes = new Map<string, string>();
    for (const row of rows.values()) {
        if (!row.orderKey || row.kind === 'workspace-root') continue;
        const siblings = siblingsByContainer.get(row.containerId) ?? [];
        siblings.push(row);
        siblingsByContainer.set(row.containerId, siblings);
    }
    const positions = new Map<string, Readonly<{ index: number; first: number; last: number }>>();
    for (const siblings of siblingsByContainer.values()) {
        const ranges = new Map<string, { first: number; last: number }>();
        const homes = siblings.map(row => {
            const id = row.serverId ?? '';
            if (!canonicalHomes.has(id)) canonicalHomes.set(id, resolveServerProfileScopeIdForIdentifier(id));
            return canonicalHomes.get(id)!;
        });
        let valid = true;
        for (let index = 0; index < homes.length; index += 1) {
            const home = homes[index];
            const range = ranges.get(home);
            if (!home || (range && range.last !== index - 1)) {
                valid = false;
                break;
            }
            if (range) range.last = index;
            else ranges.set(home, { first: index, last: index });
        }
        if (!valid) continue;
        siblings.forEach((row, index) => {
            const range = ranges.get(homes[index])!;
            positions.set(row.rowId, { index, first: range.first, last: range.last });
        });
    }
    return positions;
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

    const sourcePosition = tree.homeOrderPositionsByRowId.get(source.rowId);
    const targetPosition = tree.homeOrderPositionsByRowId.get(instruction.targetId);
    if (!sourcePosition || !targetPosition
        || tree.rowMetadataById.get(instruction.targetId)?.containerId !== source.containerId) return false;
    const insertionIndex = targetPosition.index
        - (sourcePosition.index < targetPosition.index ? 1 : 0)
        + (instruction.kind === 'reorder-after' ? 1 : 0);
    // Before the first row of the next Home (or after the last of the previous
    // Home) is valid: only the final position, not the target Home, must match.
    return insertionIndex >= sourcePosition.first && insertionIndex <= sourcePosition.last;
}
