export type SelectionListOptionA11yProps = Readonly<{
    id: string;
    role: 'option';
    'aria-selected': boolean;
    'aria-disabled'?: true;
    accessibilityLabel?: string;
    'aria-label'?: string;
}>;

export function buildSelectionListOptionA11yProps(params: Readonly<{
    optionTestId: string;
    isSelected: boolean;
    disabled?: boolean;
    accessibilityLabel?: string;
}>): SelectionListOptionA11yProps {
    const accessibilityLabel = params.accessibilityLabel?.trim() ?? '';
    const base = {
        id: params.optionTestId,
        role: 'option' as const,
        'aria-selected': params.isSelected,
        ...(params.disabled === true ? { 'aria-disabled': true as const } : {}),
    };
    if (!accessibilityLabel) return base;
    return {
        ...base,
        accessibilityLabel,
        'aria-label': accessibilityLabel,
    };
}
