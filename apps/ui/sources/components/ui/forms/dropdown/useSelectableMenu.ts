import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TextInput } from 'react-native';
import type { SelectableMenuCategory, SelectableMenuItem } from './selectableMenuTypes';
import { t } from '@/text';

function toCategoryId(title: string): string {
    return title.toLowerCase().replace(/\s+/g, '-');
}

function groupByCategory(items: ReadonlyArray<SelectableMenuItem>, defaultCategory: string): SelectableMenuCategory[] {
    const grouped = items.reduce((acc, item) => {
        const category = item.category || defaultCategory;
        if (!acc[category]) acc[category] = [];
        acc[category]!.push(item);
        return acc;
    }, {} as Record<string, SelectableMenuItem[]>);

    return Object.entries(grouped).map(([title, groupedItems]) => ({
        id: toCategoryId(title),
        title,
        items: groupedItems,
    }));
}

export const CREATE_ITEM_ID = '__create__';

export const selectableMenuKeyboardKeys = {
    previous: 'ArrowUp',
    next: 'ArrowDown',
    activate: 'Enter',
    close: 'Escape',
} as const;

export function getSelectableMenuChoiceKeyboardHint(surface: 'web' | 'native'): string | undefined {
    if (surface !== 'web') return undefined;
    const arrowLabel = (key: typeof selectableMenuKeyboardKeys.previous | typeof selectableMenuKeyboardKeys.next) =>
        key === 'ArrowUp' ? '↑' : '↓';
    return `${arrowLabel(selectableMenuKeyboardKeys.previous)}${arrowLabel(selectableMenuKeyboardKeys.next)} ${selectableMenuKeyboardKeys.activate}`;
}

export function useSelectableMenu(params: {
    items: ReadonlyArray<SelectableMenuItem>;
    onRequestClose: () => void;
    initialSelectedId?: string | null;
    onCreateItem?: ((query: string) => void) | null;
    createItemFactory?: ((query: string) => Omit<SelectableMenuItem, 'id'>) | null;
    /**
     * When true, the menu can start with no highlighted item (`selectedIndex = -1`).
     * This is useful for touch-first context menus on native where an initial highlight
     * reads as a "selected" row even before the user interacts.
     */
    allowEmptySelection?: boolean;
}) {
    const [searchQuery, setSearchQuery] = useState('');
    const allowEmptySelection = params.allowEmptySelection === true;
    const [selectedIndex, setSelectedIndex] = useState<number>(() => (allowEmptySelection ? -1 : 0));
    const inputRef = useRef<TextInput>(null);

    const allItemsRaw = useMemo(() => params.items, [params.items]);
    const defaultCategoryTitle = t('dropdown.category.general');
    const resultsCategoryTitle = t('dropdown.category.results');

    const filteredCategories = useMemo((): SelectableMenuCategory[] => {
        const query = searchQuery.trim().toLowerCase();

        if (!query) {
            return groupByCategory(allItemsRaw, defaultCategoryTitle);
        }

        const filtered = allItemsRaw.filter((item) => {
            const titleMatch = item.title.toLowerCase().includes(query);
            const subtitleMatch = item.subtitle?.toLowerCase().includes(query) ?? false;
            return titleMatch || subtitleMatch;
        });

        if (filtered.length === 0) {
            if (params.onCreateItem) {
                const queryText = searchQuery.trim();
                const createItem = params.createItemFactory
                    ? params.createItemFactory(queryText)
                    : { title: `${t('dropdown.createItem.prefix')} "${queryText}"` };
                return [{
                    id: '__create_category__',
                    title: '',
                    items: [{ id: CREATE_ITEM_ID, ...createItem }],
                }];
            }
            return [];
        }
        return groupByCategory(filtered, resultsCategoryTitle);
    }, [allItemsRaw, defaultCategoryTitle, params.createItemFactory, params.onCreateItem, resultsCategoryTitle, searchQuery]);

    const allItems = useMemo(() => {
        return filteredCategories.flatMap((c) => c.items);
    }, [filteredCategories]);
    const selectionItemsRef = useRef(allItems);
    selectionItemsRef.current = allItems;
    const selectionAvailabilitySignature = useMemo(
        () => JSON.stringify(allItems.map((item) => [item.id, item.disabled === true])),
        [allItems],
    );

    const firstEnabledIndex = useCallback((): number => {
        for (let i = 0; i < allItems.length; i += 1) {
            if (!allItems[i]?.disabled) return i;
        }
        return allowEmptySelection ? -1 : 0;
    }, [allItems, allowEmptySelection]);

    const lastEnabledIndex = useCallback((): number => {
        for (let i = allItems.length - 1; i >= 0; i -= 1) {
            if (!allItems[i]?.disabled) return i;
        }
        return allowEmptySelection ? -1 : 0;
    }, [allItems, allowEmptySelection]);

    const isEnabledIndex = useCallback((idx: number) => {
        const item = allItems[idx];
        return Boolean(item && !item.disabled);
    }, [allItems]);

    const clampToEnabled = useCallback((idx: number): number => {
        if (allowEmptySelection && idx === -1) return -1;
        if (allItems.length === 0) return allowEmptySelection ? -1 : 0;
        if (idx < 0 || idx >= allItems.length) return firstEnabledIndex();
        if (isEnabledIndex(idx)) return idx;
        return firstEnabledIndex();
    }, [allItems.length, allowEmptySelection, firstEnabledIndex, isEnabledIndex]);

    // Item details may refresh while the menu is open; only a changed choice set
    // or an explicit query/preference change should reset the highlighted row.
    useEffect(() => {
        const availableItems = selectionItemsRef.current;
        const preferredId = params.initialSelectedId ?? null;
        if (preferredId) {
            const idx = availableItems.findIndex((item) => item.id === preferredId && !item.disabled);
            if (idx >= 0) {
                setSelectedIndex(idx);
                return;
            }
        }
        const firstEnabled = availableItems.findIndex((item) => !item.disabled);
        setSelectedIndex(allowEmptySelection ? -1 : Math.max(0, firstEnabled));
    }, [selectionAvailabilitySignature, allowEmptySelection, params.initialSelectedId, searchQuery]);

    const moveSelection = useCallback((dir: -1 | 1) => {
        if (allItems.length === 0) return;
        if (allowEmptySelection && selectedIndex === -1) {
            setSelectedIndex(dir === 1 ? firstEnabledIndex() : lastEnabledIndex());
            return;
        }
        let next = selectedIndex;
        for (let step = 0; step < allItems.length; step += 1) {
            next = Math.min(allItems.length - 1, Math.max(0, next + dir));
            if (isEnabledIndex(next)) {
                setSelectedIndex(next);
                return;
            }
        }
    }, [allItems.length, allowEmptySelection, firstEnabledIndex, isEnabledIndex, lastEnabledIndex, selectedIndex]);

    const handleKeyPress = useCallback((key: string, onActivate: (item: SelectableMenuItem) => void) => {
        switch (key) {
            case selectableMenuKeyboardKeys.close:
                params.onRequestClose();
                break;
            case selectableMenuKeyboardKeys.next:
                moveSelection(1);
                break;
            case selectableMenuKeyboardKeys.previous:
                moveSelection(-1);
                break;
            case selectableMenuKeyboardKeys.activate:
                if (selectedIndex >= 0 && isEnabledIndex(selectedIndex) && allItems[selectedIndex]) {
                    onActivate(allItems[selectedIndex]!);
                }
                break;
        }
    }, [allItems, isEnabledIndex, moveSelection, params, selectedIndex]);

    const handleSearchChange = useCallback((text: string) => setSearchQuery(text), []);

    return {
        searchQuery,
        selectedIndex,
        selectedItemId: selectedIndex >= 0 ? allItems[selectedIndex]?.id ?? null : null,
        filteredCategories,
        inputRef,
        handleSearchChange,
        handleKeyPress,
        setSelectedIndex: (idx: number) => setSelectedIndex(clampToEnabled(idx)),
    };
}
