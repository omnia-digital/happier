import { describe, expect, it } from 'vitest';
import { resolveSessionAccessLevelFromV2Share } from './sessionAccessLevel';

describe('v2 session share access', () => {
    it('preserves absent owner roles and keeps shared or malformed roles distinct', () => {
        expect(resolveSessionAccessLevelFromV2Share(null)).toBeUndefined();
        expect(resolveSessionAccessLevelFromV2Share({ accessLevel: 'view' })).toBe('view');
        expect(resolveSessionAccessLevelFromV2Share({ accessLevel: 'edit' })).toBe('edit');
        expect(resolveSessionAccessLevelFromV2Share({ accessLevel: 'admin' })).toBe('admin');
        expect(resolveSessionAccessLevelFromV2Share(undefined)).toBeUndefined();
        expect(resolveSessionAccessLevelFromV2Share({ accessLevel: 'owner' })).toBeUndefined();
    });
});
