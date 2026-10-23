import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { View } from 'react-native';

import { PressableSurface } from '@/components/ui/interaction/PressableSurface';
import { createSessionModeActionChip } from './createSessionModeActionChip';

describe('createSessionModeActionChip', () => {
    it('uses the current mode for its icon-only button name and web tooltip', () => {
        const anchorRef = React.createRef<View>();
        const onPress = vi.fn();
        const element = createSessionModeActionChip({
            anchorRef,
            tint: '#fff',
            label: 'Planning',
            accessibilityLabel: 'Mode: Planning',
            chipStyle: () => ({ padding: 8 }),
            iconName: 'list-checks',
            onPress,
        });

        expect(React.isValidElement(element)).toBe(true);
        const chip = element as React.ReactElement<React.ComponentProps<typeof PressableSurface>>;
        expect(chip.type).toBe(PressableSurface);
        expect(chip.props.anchorRef).toBe(anchorRef);
        expect(chip.props.webTooltip).toBe('Planning');
        expect(chip.props.accessibilityLabel).toBe('Mode: Planning');
        expect(chip.props.onPress).toBe(onPress);
        expect(chip.props.children).toEqual(expect.objectContaining({ props: expect.objectContaining({ name: 'list-checks' }) }));
    });
});
