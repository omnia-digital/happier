import type { IconName } from '@/components/ui/icons/Icon';
type SessionModeOptionLike = Readonly<{
    id: string;
    name: string;
}>;

type SessionModeChipControlLike = Readonly<{
    options: ReadonlyArray<SessionModeOptionLike>;
    selectedId: string;
    label: string;
}>;

export type SessionModeChipPresentation =
    Readonly<{
    iconName: IconName;
    label: string;
}>;

const PLAN_MODE_ALIASES = new Set(['plan', 'planning']);
const BUILD_MODE_ALIASES = new Set(['build']);

function normalizeModeToken(value: string | null | undefined): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase();
    return normalized.length > 0 ? normalized : null;
}

export function resolveSessionModeChipPresentation(
    control: SessionModeChipControlLike,
    buildLabel: string,
    planLabel: string,
): SessionModeChipPresentation {
    const selectedOption = control.options.find((option) => option.id === control.selectedId) ?? null;
    const tokens = [
        normalizeModeToken(control.selectedId === 'default' ? null : control.selectedId),
        normalizeModeToken(control.label),
        normalizeModeToken(selectedOption?.name),
    ].filter((value): value is string => value !== null);

    const isPlan = tokens.some((token) => PLAN_MODE_ALIASES.has(token));
    // A provider's real `default` option is the Build mode. The synthetic default choice used by
    // getSessionModePickerOptions is absent from control.options, so it keeps its existing meaning.
    const isBuild = tokens.some((token) => BUILD_MODE_ALIASES.has(token))
        || selectedOption?.id === 'default';
    const label = selectedOption
        ? resolveSessionModePickerOptionLabel(selectedOption, buildLabel, planLabel)
        : control.label;

    if (isBuild && !isPlan) {
        return {
            iconName: 'rocket-launch',
            label,
        };
    }

    return {
        iconName: isPlan ? 'list-checks' : 'list',
        label,
    };
}

/** Rename the provider's native Default mode only in the composer mode picker. */
export function resolveSessionModePickerOptionLabel(
    option: SessionModeOptionLike,
    buildLabel: string,
    planLabel: string,
): string {
    const normalizedName = normalizeModeToken(option.name);
    if (option.id === 'default' && normalizedName === 'default') return buildLabel;
    if (option.id === 'plan' && (normalizedName === 'plan' || normalizedName === 'planning')) return planLabel;
    return option.name;
}
