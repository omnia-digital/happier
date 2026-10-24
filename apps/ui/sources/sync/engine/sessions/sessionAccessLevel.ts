/** Access levels describe shares only. Owned sessions retain the UI's absent-role contract. */
export function resolveSessionAccessLevelFromV2Share(share: unknown): 'view' | 'edit' | 'admin' | undefined {
    if (!share || typeof share !== 'object') return undefined;
    const accessLevel = (share as { accessLevel?: unknown }).accessLevel;
    return accessLevel === 'view' || accessLevel === 'edit' || accessLevel === 'admin' ? accessLevel : undefined;
}
