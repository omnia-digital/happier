import { afterEach, describe, expect, it, vi } from 'vitest';

import { installRepositoryScmCommonModuleMocks } from './repositoryScmTestHelpers';
import { createPartialStorageModuleMock } from '@/dev/testkit/mocks/storage';

const storageGetStateMock = vi.hoisted(() => vi.fn());

installRepositoryScmCommonModuleMocks({
    storage: async (importOriginal) => createPartialStorageModuleMock(importOriginal, {
        storage: {
            getState: storageGetStateMock,
        },
    }),
});

describe('resolveRepoScmMachinePathRequest', () => {
    it('leaves a foreign Home tilde path for daemon expansion instead of borrowing the active machine home', async () => {
        storageGetStateMock.mockReturnValue({
            profileScope: { serverId: 'b', accountId: 'b' },
            machines: { same: { id: 'same', metadata: { homeDir: '/other' } } },
        });
        const { resolveRepoScmMachinePathRequest } = await import('./resolveRepoScmMachinePathRequest');
        expect(resolveRepoScmMachinePathRequest({ machineId: 'same', path: '~/repo', scope: { serverId: 'a', accountId: 'a' } })).toEqual({
            machineId: 'same', resolvedPath: '~/repo', repoIdentityKey: 'same:~/repo',
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('trims machine/path input and resolves tilde paths against the machine home directory', async () => {
        storageGetStateMock.mockReturnValue({
            machines: {
                'machine-a': {
                    id: 'machine-a',
                    metadata: {
                        homeDir: '/Users/tester',
                    },
                },
            },
        } as any);

        const { resolveRepoScmMachinePathRequest } = await import('./resolveRepoScmMachinePathRequest');
        expect(resolveRepoScmMachinePathRequest({
            machineId: '  machine-a  ',
            path: '  ~/repo  ',
        })).toEqual({
            machineId: 'machine-a',
            resolvedPath: '/Users/tester/repo',
            repoIdentityKey: 'machine-a:/Users/tester/repo',
        });
    });

    it('normalizes Windows home-relative paths to a single repo identity shape', async () => {
        storageGetStateMock.mockReturnValue({
            machines: {
                'machine-a': {
                    id: 'machine-a',
                    metadata: {
                        homeDir: 'C:\\Users\\tester',
                    },
                },
            },
        } as any);

        const { resolveRepoScmMachinePathRequest } = await import('./resolveRepoScmMachinePathRequest');
        expect(resolveRepoScmMachinePathRequest({
            machineId: 'machine-a',
            path: '~/repo/subdir',
        })).toEqual({
            machineId: 'machine-a',
            resolvedPath: 'C:\\Users\\tester\\repo\\subdir',
            repoIdentityKey: 'machine-a:C:\\Users\\tester\\repo\\subdir',
        });
        expect(resolveRepoScmMachinePathRequest({
            machineId: 'machine-a',
            path: '~\\repo\\subdir',
        })).toEqual({
            machineId: 'machine-a',
            resolvedPath: 'C:\\Users\\tester\\repo\\subdir',
            repoIdentityKey: 'machine-a:C:\\Users\\tester\\repo\\subdir',
        });
    });

    it('returns null when machine or path is blank after trimming', async () => {
        const { resolveRepoScmMachinePathRequest } = await import('./resolveRepoScmMachinePathRequest');

        expect(resolveRepoScmMachinePathRequest({
            machineId: '   ',
            path: '/repo',
        })).toBeNull();
        expect(resolveRepoScmMachinePathRequest({
            machineId: 'machine-a',
            path: '   ',
        })).toBeNull();
    });
});
