import { describe, expect, it } from 'vitest';

import { SESSION_LIST_ROW_HEIGHT_MINIMAL } from './sessionListRowHeights';
import { resolveSessionListRowHeight } from './sessionListRowDensity';

describe('resolveSessionListRowHeight', () => {
    it('keeps scaled minimal rows tall enough when app item density is compact', () => {
        const fontScale = 1.3;

        expect(resolveSessionListRowHeight({
            compact: true,
            compactMinimal: true,
            isTablet: false,
            platform: 'web',
            itemDensity: 'compact',
            fontScale,
        })).toBe(Math.round(SESSION_LIST_ROW_HEIGHT_MINIMAL * fontScale));
    });
});
