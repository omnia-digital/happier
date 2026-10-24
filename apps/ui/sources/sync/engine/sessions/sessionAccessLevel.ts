/** The authenticated v2 server maps an owner to `share: null`; a shared reader has a share role. */
export function resolveSessionAccessLevelFromV2Share(share: unknown): 'view' | 'edit' | 'admin' | undefined {
    if (share === null) return 'admin';
    if (!share || typeof share !== 'object') return undefined;
    const accessLevel = (share as { accessLevel?: unknown }).accessLevel;
    return accessLevel === 'view' || accessLevel === 'edit' || accessLevel === 'admin' ? accessLevel : undefined;
}
