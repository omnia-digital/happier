import { isSessionListHomeOrderMoveCompatible, isSessionListTreeDestinationCompatible } from './isSessionListTreeDestinationCompatible';
import { resolveTreeInstruction, type TreeDropResult, type WindowPointer } from '@/components/ui/treeDragDrop';
import { resolveSessionListIndexFolderDragEligibility } from '@/sync/domains/session/listing/sessionListIndex';
import { SESSION_FOLDER_MAX_DEPTH } from '@/sync/domains/session/folders/constants';

import type {
    SessionListFolderSortMode,
    SessionListInstructionBlockReason,
    SessionListTreeDragSource,
    SessionListTreeDropResult,
    SessionListTreeModel,
} from './sessionListTreeTypes';
import { DEFAULT_SESSION_LIST_FOLDER_SORT_MODE } from './sessionListTreeTypes';
import { resolveSessionListFolderSortModeDropResult } from './resolveSessionListFolderSortModeDrop';

function blocked(reason: SessionListInstructionBlockReason): SessionListTreeDropResult {
    return {
        instruction: { kind: 'blocked', reason: 'workspace-scope-mismatch' },
        visual: { kind: 'none' },
        sessionListBlockReason: reason,
    };
}

export function resolveSessionListDragEligibilityBlock(params: Readonly<{
    source: SessionListTreeDragSource;
    tree: SessionListTreeModel;
    foldersFeatureEnabled: boolean;
}>): SessionListInstructionBlockReason | null {
    if (params.source.metadata.kind === 'workspace-root') return null;

    const eligibility = resolveSessionListIndexFolderDragEligibility(params.source.metadata.item, {
        foldersFeatureEnabled: params.foldersFeatureEnabled || params.tree.containerMetadataById.get(params.source.metadata.containerId)?.displayOrderOnly === true,
    });
    if (eligibility.reason === 'eligible') return null;
    if (eligibility.reason === 'feature-disabled') return 'feature-disabled';
    if (eligibility.reason === 'direct-session') return 'direct-session';
    return 'unsupported-item';
}

export function resolveSessionListInstruction(params: Readonly<{
    tree: SessionListTreeModel;
    source: SessionListTreeDragSource;
    pointer: WindowPointer | null;
    foldersFeatureEnabled: boolean;
    folderSortMode?: SessionListFolderSortMode;
    maxDepth?: number;
}>): SessionListTreeDropResult {
    const eligibilityBlock = resolveSessionListDragEligibilityBlock({
        source: params.source,
        tree: params.tree,
        foldersFeatureEnabled: params.foldersFeatureEnabled,
    });
    if (eligibilityBlock) return blocked(eligibilityBlock);

    const allowsDestination = (container: Parameters<typeof isSessionListTreeDestinationCompatible>[1] | null | undefined) => Boolean(container
        && isSessionListTreeDestinationCompatible(params.source.metadata, container)
        && (params.foldersFeatureEnabled || (container.displayOrderOnly && container.containerId === params.source.metadata.containerId)));

    const resolved: TreeDropResult = resolveTreeInstruction({
        rows: params.tree.rows,
        dropZones: params.tree.dropZones,
        source: params.source,
        pointer: params.pointer,
        rules: {
            maxDepth: params.maxDepth ?? SESSION_FOLDER_MAX_DEPTH,
            canMoveToRoot: (_source, zone) => {
                if (params.source.metadata.kind === 'workspace-root') {
                    return params.tree.containerMetadataById.get(zone.containerId)?.kind === 'workspace-order'
                        && zone.containerId === params.source.metadata.containerId;
                }
                const container = params.tree.containerMetadataById.get(zone.containerId);
                return allowsDestination(container);
            },
            canNestInto: (_source, targetId) => {
                if (params.source.metadata.kind === 'workspace-root') return false;
                const target = params.tree.rowMetadataById.get(targetId);
                if (!target) return false;
                if (target.kind === 'session') return false;
                const container = target.childContainerId ? params.tree.containerMetadataById.get(target.childContainerId) : null;
                return allowsDestination(container);
            },
            canReorderAround: (_source, target) => {
                const targetMetadata = params.tree.rowMetadataById.get(target.id);
                if (!targetMetadata) return false;
                if (params.source.metadata.kind === 'workspace-root') {
                    return targetMetadata.kind === 'workspace-root'
                        && targetMetadata.containerId === params.source.metadata.containerId;
                }
                if (targetMetadata.kind === 'workspace-root') return false;
                const container = params.tree.containerMetadataById.get(targetMetadata.containerId);
                return allowsDestination(container);
            },
        },
    });

    const result = resolveSessionListFolderSortModeDropResult({
        tree: params.tree,
        source: params.source,
        result: resolved,
        folderSortMode: params.folderSortMode ?? DEFAULT_SESSION_LIST_FOLDER_SORT_MODE,
    });
    return isSessionListHomeOrderMoveCompatible(params.tree, params.source.metadata, result.instruction)
        ? result
        : { instruction: { kind: 'blocked', reason: 'workspace-scope-mismatch' }, visual: { kind: 'none' } };
}
