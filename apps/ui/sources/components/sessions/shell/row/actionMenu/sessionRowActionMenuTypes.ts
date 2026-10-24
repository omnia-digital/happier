import type { DropdownMenuItem } from '@/components/ui/forms/dropdown/DropdownMenu';
import type { SessionActionTarget } from '@/components/sessions/actions/sessionActionTypes';
import type { SessionReminderPresetV1 } from '@/sync/domains/session/organization/sessionReminderPreset';
import type { SessionReminderPresentation } from '@/sync/domains/session/organization/attentionStanding';
import type { KeyboardCommandId } from '@/keyboard/types';

export type SessionRowMoreMenuBuildParams = Readonly<{
    target: SessionActionTarget;
    iconColor: string;
    leadingItems?: readonly DropdownMenuItem[];
    canMoveToFolder?: boolean;
    reminderPresets?: readonly SessionReminderPresetV1[];
    reminder?: SessionReminderPresentation | null;
    reminderNowMs?: number;
    shortcutLabels?: Partial<Record<KeyboardCommandId, string>>;
    reminderChoiceKeyboardHint?: string;
}>;

export type SessionRowActionMenuState = Readonly<{
    tagMenuItems: DropdownMenuItem[];
    handleTagMenuSelect: (tagId: string) => void;
    handleTagMenuCreate: (query: string) => void;
    moreMenuItems: DropdownMenuItem[];
    handleMoreMenuSelect: (itemId: string, options?: Readonly<{ forceArchiveConfirmation?: boolean }>) => Promise<void>;
    contextMenuItems: DropdownMenuItem[];
    handleContextMenuSelect: (itemId: string, options?: Readonly<{ forceArchiveConfirmation?: boolean }>) => Promise<void>;
    mutatingSession: boolean;
}>;
