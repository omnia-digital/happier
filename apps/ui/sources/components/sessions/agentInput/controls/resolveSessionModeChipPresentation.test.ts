import { describe, expect, it } from 'vitest';

import { resolveSessionModeChipPresentation, resolveSessionModePickerOptionLabel } from './resolveSessionModeChipPresentation';

const buildLabel = 'Build';
const planLabel = 'Planning';

function control(selectedId: string, label = selectedId) {
    return {
        selectedId,
        label,
        options: [{ id: selectedId, name: label }],
    };
}

describe('resolveSessionModeChipPresentation', () => {
    it('draws build mode with the launching rocket', () => {
        // The plain `rocket` sits upright and reads as a static object next to the rest of the chip
        // row; `rocket-launch` is the angled one with the trail, which reads as an action.
        expect(resolveSessionModeChipPresentation(control('build'), buildLabel, planLabel).iconName).toBe('rocket-launch');
    });

    it('presents the provider default mode as Build with its distinct icon', () => {
        expect(resolveSessionModeChipPresentation(control('default', 'Default'), buildLabel, planLabel)).toEqual({
            iconName: 'rocket-launch',
            label: 'Build',
        });
    });

    it('draws plan mode with the checklist glyph, distinct from the build icon', () => {
        expect(resolveSessionModeChipPresentation(control('plan'), buildLabel, planLabel).iconName).toBe('list-checks');
    });

    it('recognizes a provider Planning label as the plan mode', () => {
        expect(resolveSessionModeChipPresentation(control('plan', 'Planning'), buildLabel, planLabel)).toEqual({
            iconName: 'list-checks',
            label: planLabel,
        });
    });

    it('uses the generic list icon for an unknown mode', () => {
        expect(resolveSessionModeChipPresentation(control('whatever'), buildLabel, planLabel).iconName).toBe('list');
    });

    it('prefers plan when a mode reads as both', () => {
        expect(resolveSessionModeChipPresentation({
            selectedId: 'build',
            label: 'plan',
            options: [{ id: 'build', name: 'build' }],
        }, buildLabel, planLabel).iconName).toBe('list-checks');
    });

    it('renames only the native default and recognized plan options', () => {
        expect(resolveSessionModePickerOptionLabel({ id: 'default', name: 'Default' }, buildLabel, planLabel)).toBe(buildLabel);
        expect(resolveSessionModePickerOptionLabel({ id: 'plan', name: 'Planning' }, buildLabel, planLabel)).toBe(planLabel);
        expect(resolveSessionModePickerOptionLabel({ id: 'custom', name: 'Default' }, buildLabel, planLabel)).toBe('Default');
        expect(resolveSessionModePickerOptionLabel({ id: 'default', name: 'Use permission setting' }, buildLabel, planLabel)).toBe('Use permission setting');
    });
});
