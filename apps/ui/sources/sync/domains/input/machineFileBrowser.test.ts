import { describe, expect, it, vi } from 'vitest';

import {
    clearCachedMachineFileBrowserEntries,
    clearCachedMachineFileBrowserRoots,
    getCachedMachineFileBrowserEntries,
    getCachedMachineFileBrowserRoots,
    listMachineFileBrowserDirectoryEntries,
    listMachineFileBrowserRoots,
    warmMachineFileBrowserDirectoryCache,
} from './machineFileBrowser';

let activeScope = { serverId: 'server-1', accountId: 'account-a' };

vi.mock('@/sync/domains/scope/activeServerAccountScope', () => ({
    getActiveServerAccountScope: () => activeScope,
}));

vi.mock('@/sync/ops/machineFileBrowser', () => ({
    machineFilesystemListRoots: vi.fn(),
    machineFilesystemListDirectory: vi.fn(),
}));

describe('machineFileBrowser domain', () => {
    it('sorts and caches roots and directory entries', async () => {
        const ops = await import('@/sync/ops/machineFileBrowser');
        (ops.machineFilesystemListRoots as any).mockReset();
        (ops.machineFilesystemListDirectory as any).mockReset();
        clearCachedMachineFileBrowserEntries({ machineId: 'machine-1' });
        clearCachedMachineFileBrowserRoots({ machineId: 'machine-1' });
        (ops.machineFilesystemListRoots as any).mockResolvedValueOnce({
            ok: true,
            roots: [{ id: '/', label: '/', path: '/' }],
        });
        (ops.machineFilesystemListDirectory as any).mockResolvedValueOnce({
            ok: true,
            path: '/Users/leeroy',
            entries: [
                { name: 'b.txt', path: '/Users/leeroy/b.txt', type: 'file' },
                { name: 'A', path: '/Users/leeroy/A', type: 'directory' },
            ],
            truncated: false,
        });

        const roots = await listMachineFileBrowserRoots({ machineId: 'machine-1', serverId: 'server-1', targetScopeKey: 'account-1' });
        const directory = await listMachineFileBrowserDirectoryEntries({
            machineId: 'machine-1',
            directoryPath: '/Users/leeroy',
            includeFiles: true,
            serverId: 'server-1',
            targetScopeKey: 'account-1',
        });

        expect(roots).toEqual({
            ok: true,
            roots: [{ id: '/', label: '/', path: '/' }],
        });
        expect(directory.ok).toBe(true);
        if (directory.ok) {
            expect(directory.entries.map((entry) => `${entry.type}:${entry.name}`)).toEqual([
                'directory:A',
                'file:b.txt',
            ]);
        }
        expect(getCachedMachineFileBrowserRoots({ machineId: 'machine-1', serverId: 'server-1', targetScopeKey: 'account-1' })).toEqual([{ id: '/', label: '/', path: '/' }]);
        expect(getCachedMachineFileBrowserEntries({ machineId: 'machine-1', serverId: 'server-1', targetScopeKey: 'account-1', directoryPath: '/Users/leeroy' })).not.toBeNull();
    });

    it('dedupes in-flight warm requests and clears machine-scoped caches independently', async () => {
        const ops = await import('@/sync/ops/machineFileBrowser');
        (ops.machineFilesystemListDirectory as any).mockReset();
        clearCachedMachineFileBrowserEntries({ machineId: 'machine-1' });
        clearCachedMachineFileBrowserRoots({ machineId: 'machine-1' });
        let resolveDirectory!: (value: unknown) => void;
        (ops.machineFilesystemListDirectory as any).mockReturnValueOnce(new Promise((resolve) => {
            resolveDirectory = resolve;
        }));

        const first = warmMachineFileBrowserDirectoryCache({
            machineId: 'machine-1',
            directoryPath: '/Users/leeroy',
            includeFiles: false,
            targetScopeKey: 'account-1',
        });
        const second = warmMachineFileBrowserDirectoryCache({
            machineId: 'machine-1',
            directoryPath: '/Users/leeroy',
            includeFiles: false,
            targetScopeKey: 'account-1',
        });

        expect(ops.machineFilesystemListDirectory).toHaveBeenCalledTimes(1);

        resolveDirectory({
            ok: true,
            path: '/Users/leeroy',
            entries: [{ name: 'Documents', path: '/Users/leeroy/Documents', type: 'directory' }],
            truncated: false,
        });

        await first;
        await second;

        clearCachedMachineFileBrowserEntries({ machineId: 'machine-1' });
        clearCachedMachineFileBrowserRoots({ machineId: 'machine-1' });

        expect(getCachedMachineFileBrowserEntries({ machineId: 'machine-1', directoryPath: '/Users/leeroy' })).toBeNull();
        expect(getCachedMachineFileBrowserRoots({ machineId: 'machine-1' })).toBeNull();
    });

    it('keeps machine browse caches isolated by server scope and preserves truncation in warm cache', async () => {
        const ops = await import('@/sync/ops/machineFileBrowser');
        (ops.machineFilesystemListDirectory as any).mockReset();
        clearCachedMachineFileBrowserEntries({ machineId: 'machine-1' });

        (ops.machineFilesystemListDirectory as any)
            .mockResolvedValueOnce({
                ok: true,
                path: '/Users/leeroy',
                entries: [{ name: 'Documents', path: '/Users/leeroy/Documents', type: 'directory' }],
                truncated: true,
            })
            .mockResolvedValueOnce({
                ok: true,
                path: '/Users/leeroy',
                entries: [{ name: 'Downloads', path: '/Users/leeroy/Downloads', type: 'directory' }],
                truncated: false,
            });

        const serverOne = await listMachineFileBrowserDirectoryEntries({
            machineId: 'machine-1',
            serverId: 'server-1',
            directoryPath: '/Users/leeroy',
            includeFiles: false,
            targetScopeKey: 'account-1',
        });
        const serverTwo = await listMachineFileBrowserDirectoryEntries({
            machineId: 'machine-1',
            serverId: 'server-2',
            directoryPath: '/Users/leeroy',
            includeFiles: false,
            targetScopeKey: 'account-1',
        });

        const warmedServerOne = await warmMachineFileBrowserDirectoryCache({
            machineId: 'machine-1',
            serverId: 'server-1',
            directoryPath: '/Users/leeroy',
            includeFiles: false,
            targetScopeKey: 'account-1',
        });

        expect(serverOne).toEqual({
            ok: true,
            entries: [{ name: 'Documents', path: '/Users/leeroy/Documents', type: 'directory' }],
            truncated: true,
        });
        expect(serverTwo).toEqual({
            ok: true,
            entries: [{ name: 'Downloads', path: '/Users/leeroy/Downloads', type: 'directory' }],
            truncated: false,
        });
        expect(warmedServerOne).toEqual(serverOne);
        expect(ops.machineFilesystemListDirectory).toHaveBeenCalledTimes(2);
    });

    it('does not reuse directory results across accounts on the same Home and machine', async () => {
        const ops = await import('@/sync/ops/machineFileBrowser');
        (ops.machineFilesystemListDirectory as any).mockReset();
        clearCachedMachineFileBrowserEntries({ machineId: 'machine-1' });
        (ops.machineFilesystemListDirectory as any).mockResolvedValueOnce({
            ok: true,
            path: '/repo',
            entries: [{ name: 'private', path: '/repo/private', type: 'directory' }],
            truncated: false,
        });
        await listMachineFileBrowserDirectoryEntries({
            machineId: 'machine-1', serverId: 'server-1', targetScopeKey: 'account-a',
            directoryPath: '/repo', includeFiles: false,
        });
        expect(getCachedMachineFileBrowserEntries({
            machineId: 'machine-1', serverId: 'server-1', targetScopeKey: 'account-a',
            directoryPath: '/repo', includeFiles: false,
        })).toEqual([{ name: 'private', path: '/repo/private', type: 'directory' }]);
        expect(getCachedMachineFileBrowserEntries({
            machineId: 'machine-1', serverId: 'server-1', targetScopeKey: 'account-b',
            directoryPath: '/repo', includeFiles: false,
        })).toBeNull();
    });

    it('rejects a late directory result after the viewer Account changes', async () => {
        activeScope = { serverId: 'server-1', accountId: 'account-a' };
        const ops = await import('@/sync/ops/machineFileBrowser');
        (ops.machineFilesystemListDirectory as any).mockReset();
        clearCachedMachineFileBrowserEntries({ machineId: 'machine-1' });
        let finish!: (value: unknown) => void;
        (ops.machineFilesystemListDirectory as any).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));

        const identity = {
            viewerScope: { serverId: 'server-1', accountId: 'account-a' },
            target: { serverId: 'server-1', accountId: 'account-a', machineId: 'machine-1' },
        };
        const pending = listMachineFileBrowserDirectoryEntries({
            machineId: 'machine-1', serverId: 'server-1', browserIdentity: identity,
            directoryPath: '/repo', includeFiles: false,
        });
        expect(ops.machineFilesystemListDirectory).toHaveBeenCalledWith(
            'machine-1', { path: '/repo', includeFiles: false },
            { serverId: 'server-1', accountId: 'account-a' },
        );
        activeScope = { serverId: 'server-1', accountId: 'account-b' };
        finish({
            ok: true, path: '/repo', truncated: false,
            entries: [{ name: 'private', path: '/repo/private', type: 'directory' }],
        });
        expect(await pending).toMatchObject({ ok: false });
        expect(getCachedMachineFileBrowserEntries({
            machineId: 'machine-1', serverId: 'server-1', browserIdentity: identity,
            directoryPath: '/repo', includeFiles: false,
        })).toBeNull();
        activeScope = { serverId: 'server-1', accountId: 'account-a' };
        expect(getCachedMachineFileBrowserEntries({
            machineId: 'machine-1', serverId: 'server-1', browserIdentity: identity,
            directoryPath: '/repo', includeFiles: false,
        })).toBeNull();
    });
});
