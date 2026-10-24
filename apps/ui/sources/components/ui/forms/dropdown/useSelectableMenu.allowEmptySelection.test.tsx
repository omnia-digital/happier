import { describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';

import { renderHook } from '@/dev/testkit';
import type { SelectableMenuItem } from '@/components/ui/forms/dropdown/selectableMenuTypes';
import { installDropdownCommonModuleMocks } from './dropdownTestHelpers';


(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

installDropdownCommonModuleMocks();

describe('useSelectableMenu (allowEmptySelection)', () => {
    it('offers a navigation hint only where the dropdown handles arrow and Enter keys', async () => {
        const { getSelectableMenuChoiceKeyboardHint } = await import('./useSelectableMenu');
        expect(getSelectableMenuChoiceKeyboardHint('web')).toBe('↑↓ Enter');
        expect(getSelectableMenuChoiceKeyboardHint('native')).toBeUndefined();
    });
    it('starts with no highlighted item when enabled and no preferred id exists', async () => {
        const { useSelectableMenu } = await import('./useSelectableMenu');
        const items: SelectableMenuItem[] = [{ id: 'a', title: 'A', left: null, right: null }];

        const hook = await renderHook(() => useSelectableMenu({
            items,
            onRequestClose: () => {},
            allowEmptySelection: true,
        }));

        expect(hook.getCurrent().selectedIndex).toBe(-1);

        await hook.unmount();
    });

    it('skips an informational row and activates a saved choice with the displayed navigation keys', async () => {
        const { getSelectableMenuChoiceKeyboardHint, selectableMenuKeyboardKeys, useSelectableMenu } = await import('./useSelectableMenu');
        const items: SelectableMenuItem[] = [
            { id: 'current', title: 'Current reminder', disabled: true },
            { id: 'saved-a', title: 'Saved A' },
            { id: 'saved-b', title: 'Saved B' },
        ];
        const activate = vi.fn();
        const hook = await renderHook(() => useSelectableMenu({ items, onRequestClose: () => {} }));
        expect(hook.getCurrent().selectedIndex).toBe(1);
        expect(getSelectableMenuChoiceKeyboardHint('web')).toBe('↑↓ Enter');
        await act(async () => hook.getCurrent().handleKeyPress(selectableMenuKeyboardKeys.next, activate));
        expect(hook.getCurrent().selectedIndex).toBe(2);
        await act(async () => hook.getCurrent().handleKeyPress(selectableMenuKeyboardKeys.activate, activate));
        expect(activate).toHaveBeenCalledWith(expect.objectContaining({ id: 'saved-b' }));
        await hook.unmount();
    });
});

