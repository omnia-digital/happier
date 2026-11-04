import { describe, expect, it } from 'vitest';

import { repositoryWorkspaceKey, type SessionRepositoryAssociations } from './sessionRepositoryIdentity';
import { resolveSessionWorkspacePresentation } from './sessionWorkspacePresentation';

const machines = {
    m1: {
        id: 'm1',
        active: true,
        activeAt: 0,
        updatedAt: 0,
        revokedAt: null,
        metadataVersion: 1,
        metadata: {
            host: 'machine',
            homeDir: '/Users/lee',
        },
    },
};

describe('resolveSessionWorkspacePresentation', () => {
    it('uses the workspace basename as the default display title while preserving the display path', () => {
        const presentation = resolveSessionWorkspacePresentation({
            metadata: {
                machineId: 'm1',
                path: '/Users/lee/Documents/Development/happier/remote-dev',
                homeDir: '/Users/lee',
            },
            machines,
        });

        expect(presentation.displayPath).toBe('~/Documents/Development/happier/remote-dev');
        expect(presentation.displayTitle).toBe('remote-dev');
    });

    it('keeps custom workspace labels above basename and full-path display settings', () => {
        const base = resolveSessionWorkspacePresentation({
            metadata: {
                machineId: 'm1',
                path: '/Users/lee/Documents/Development/happier/remote-dev',
                homeDir: '/Users/lee',
            },
            machines,
        });

        const presentation = resolveSessionWorkspacePresentation({
            metadata: {
                machineId: 'm1',
                path: '/Users/lee/Documents/Development/happier/remote-dev',
                homeDir: '/Users/lee',
            },
            machines,
            workspaceLabelsV1: {
                [base.workspaceKey]: 'Preview app',
            },
            workspacePathDisplayModeV1: 'path',
        });

        expect(presentation.displayTitle).toBe('Preview app');
        expect(presentation.hasCustomLabel).toBe(true);
    });

    it('can display the formatted full path when the account setting requests it', () => {
        const presentation = resolveSessionWorkspacePresentation({
            metadata: {
                machineId: 'm1',
                path: '/Users/lee/Documents/Development/happier/remote-dev',
                homeDir: '/Users/lee',
            },
            machines,
            workspacePathDisplayModeV1: 'path',
        });

        expect(presentation.displayTitle).toBe('~/Documents/Development/happier/remote-dev');
    });
});

describe('session identity label', () => {
    const repositoryScope = { serverId: 'server-a', accountId: 'account-a' };
    const worktreeMetadata = { machineId: 'm1', path: '/Users/lee/.worktrees/generated-17', homeDir: '/Users/lee' };
    const rootKey = repositoryWorkspaceKey({ ...repositoryScope, machineId: 'm1', path: '/Users/lee/repo' });
    const association = (label: string, manual?: Readonly<{ identity: string; label: string }>): SessionRepositoryAssociations => ({
        [rootKey]: {
            identity: 'github.com/acme/repo',
            label,
            rootPath: '/Users/lee/repo',
            worktreePaths: ['/Users/lee/.worktrees/generated-17'],
            ...(manual ? { manual } : {}),
        },
    });
    const resolve = (overrides: Partial<Parameters<typeof resolveSessionWorkspacePresentation>[0]> = {}) =>
        resolveSessionWorkspacePresentation({
            metadata: worktreeMetadata,
            machines,
            repositoryScope,
            sessionRepositoryAssociationsV1: association('github.com/acme/repo'),
            ...overrides,
        });

    it('names a worktree after its stored repository instead of the generated directory', () => {
        expect(resolve().identityLabel).toBe('repo');
    });

    it.each([
        ['a POSIX checkout path', '/Users/lee/checkouts/repo-main/'],
        ['a Windows checkout path', 'C:\\Users\\lee\\repo-main'],
        ['a host-qualified remote', 'git.example.com:8443/team/repo-main'],
    ])('reduces %s to its final name', (_case, label) => {
        expect(resolve({ sessionRepositoryAssociationsV1: association(label) }).identityLabel).toBe('repo-main');
    });

    it('prefers the manual repository choice over the discovered one', () => {
        expect(resolve({
            sessionRepositoryAssociationsV1: association('github.com/acme/repo', { identity: 'github.com/acme/chosen', label: 'github.com/acme/chosen' }),
        }).identityLabel).toBe('chosen');
    });

    it('keeps an explicit workspace label above the repository name', () => {
        const { workspaceKey } = resolve();
        expect(resolve({ workspaceLabelsV1: { [workspaceKey]: 'Preview app' } }).identityLabel).toBe('Preview app');
    });

    it('stays a name when the account shows full workspace paths', () => {
        expect(resolve({ workspacePathDisplayModeV1: 'path' }).identityLabel).toBe('repo');
        expect(resolve({ workspacePathDisplayModeV1: 'path', sessionRepositoryAssociationsV1: {} }).identityLabel).toBe('generated-17');
    });

    it.each([
        ['another account', { serverId: 'server-a', accountId: 'account-b' }],
        ['another server', { serverId: 'server-b', accountId: 'account-a' }],
        ['an unknown account', null],
    ])('does not read an association stored for %s', (_case, scope) => {
        expect(resolve({ repositoryScope: scope }).identityLabel).toBe('generated-17');
    });

    it('falls back to the final segment of a Windows directory', () => {
        expect(resolve({
            metadata: { machineId: 'm1', path: 'C:\\work\\client-app\\', homeDir: 'C:\\Users\\lee' },
            sessionRepositoryAssociationsV1: {},
        }).identityLabel).toBe('client-app');
    });

    it('invents nothing when neither an association nor a directory is known', () => {
        expect(resolve({ metadata: null }).identityLabel).toBe('');
    });
});
