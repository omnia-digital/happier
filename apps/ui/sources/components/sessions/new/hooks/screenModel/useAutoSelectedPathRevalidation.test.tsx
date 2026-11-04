import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMachineFixture, renderHook } from '@/dev/testkit';

import { useAutoSelectedPathRevalidation } from './useAutoSelectedPathRevalidation';
import { useNewSessionMachinePathState } from './useNewSessionMachinePathState';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type DirectoryAnswer = { ok: true; path: string; entries: []; truncated: false } | { ok: false; error: string };

const machineFilesystemListDirectoryMock = vi.hoisted(() => vi.fn());

// The daemon RPC is the boundary; the file-browser owner and path state stay real.
vi.mock('@/sync/ops/machineFileBrowser', () => ({
    machineFilesystemListRoots: vi.fn(),
    machineFilesystemListDirectory: machineFilesystemListDirectoryMock,
}));

const ENOENT: DirectoryAnswer = { ok: false, error: 'ENOENT: no such file or directory' };
const OFFLINE: DirectoryAnswer = { ok: false, error: 'RPC method not available' };

function answerFor(answers: Readonly<Record<string, DirectoryAnswer>>) {
    machineFilesystemListDirectoryMock.mockImplementation(async (_machineId: string, request: { path: string }) => (
        answers[request.path] ?? { ok: true, path: request.path, entries: [], truncated: false }
    ));
}

const machines = [
    createMachineFixture({ id: 'machine-a', active: true, metadata: { homeDir: '/home/a' } as never }),
    createMachineFixture({ id: 'machine-b', active: true, metadata: { homeDir: '/home/b' } as never }),
];

const recentMachinePaths = [
    { machineId: 'machine-a', path: '/a/repo' },
    { machineId: 'machine-b', path: '/b/old' },
    { machineId: 'machine-b', path: '/b/next' },
];

function useRevalidatedPathState(pathParam: string | null) {
    const state = useNewSessionMachinePathState({
        machines,
        recentMachinePaths,
        machineIdParam: null,
        pathParam,
        persistedMachineId: 'machine-a',
        cacheScopeKey: 'scope',
    });
    useAutoSelectedPathRevalidation({
        machineId: state.selectedMachineId,
        machineHomeDir: machines.find((machine) => machine.id === state.selectedMachineId)?.metadata?.homeDir ?? null,
        selectedPath: state.selectedPath,
        serverId: null,
        targetScopeKey: state.selectedMachineId ? `target:${state.selectedMachineId}` : null,
        browserIdentity: null,
        getAutoSelectedPathFallbacks: state.getAutoSelectedPathFallbacks,
        replaceAutoSelectedPath: state.replaceAutoSelectedPath,
    });
    return state;
}

async function renderState(pathParam: string | null = null) {
    const hook = await renderHook(() => useRevalidatedPathState(pathParam));
    await settle();
    return hook;
}

async function settle() {
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
    });
}

async function switchTo(hook: Awaited<ReturnType<typeof renderState>>, machineId: string) {
    await act(async () => {
        const state = hook.getCurrent();
        state.selectMachine(machineId, state.getBestPathForMachine(machineId));
    });
}

describe('useAutoSelectedPathRevalidation', () => {
    beforeEach(() => {
        machineFilesystemListDirectoryMock.mockReset();
    });

    it('moves off a deleted default to the next recent that exists on the new machine', async () => {
        answerFor({ '/b/old': ENOENT });
        const hook = await renderState();

        await switchTo(hook, 'machine-b');
        await settle();

        expect(hook.getCurrent().selectedPath).toBe('/b/next');
        expect(hook.getCurrent().getRequestedPath()).toBe('/b/next');
        await hook.unmount();
    });

    it('falls back to the Home of that machine when every recent is gone', async () => {
        answerFor({ '/b/old': ENOENT, '/b/next': ENOENT });
        const hook = await renderState();

        await switchTo(hook, 'machine-b');
        await settle();

        expect(hook.getCurrent().selectedPath).toBe('/home/b');
        await hook.unmount();
    });

    it('keeps the default when the machine cannot say whether it exists', async () => {
        answerFor({ '/b/old': OFFLINE });
        const hook = await renderState();

        await switchTo(hook, 'machine-b');
        await settle();

        expect(hook.getCurrent().selectedPath).toBe('/b/old');
        await hook.unmount();
    });

    it('does not replace a path the user typed while the check was in flight', async () => {
        answerFor({ '/b/old': ENOENT });
        const hook = await renderState();

        await switchTo(hook, 'machine-b');
        await act(async () => {
            hook.getCurrent().setDraftSelectedPath('/b/typed');
        });
        await settle();

        expect(hook.getCurrent().getRequestedPath()).toBe('/b/typed');
        await hook.unmount();
    });

    it('ignores a late answer for the machine the user already left', async () => {
        let answerOldPath!: (answer: DirectoryAnswer) => void;
        machineFilesystemListDirectoryMock.mockImplementation((_machineId: string, request: { path: string }) => (
            request.path === '/b/old'
                ? new Promise<DirectoryAnswer>((resolve) => { answerOldPath = resolve; })
                : Promise.resolve({ ok: true, path: request.path, entries: [], truncated: false })
        ));
        const hook = await renderState();

        await switchTo(hook, 'machine-b');
        await settle();
        await switchTo(hook, 'machine-a');
        await settle();
        answerOldPath(ENOENT);
        await settle();

        expect(hook.getCurrent().selectedPath).toBe('/a/repo');
        await hook.unmount();
    });

    it('leaves a path requested by the route for the launch to question', async () => {
        answerFor({ '/a/repo': ENOENT });
        const hook = await renderState('/a/repo');

        expect(hook.getCurrent().selectedPath).toBe('/a/repo');
        await hook.unmount();
    });
});
