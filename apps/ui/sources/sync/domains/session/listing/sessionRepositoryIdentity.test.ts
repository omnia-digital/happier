import { describe, expect, it } from 'vitest';
import { normalizeRepositoryRemote, resolveRepositoryRemote, repositoryWorkspaceKey, readRepositoryAssociation, withRepositoryAssociation } from './sessionRepositoryIdentity';

describe('repository grouping identity', () => {
    it('persists repository mode and scoped worktree associations through the actual local settings parser', async () => {
        const { applyLocalSettings, localSettingsParse } = await import('@/sync/domains/settings/localSettings');
        const workspace = { serverId: 'home', accountId: 'account', machineId: 'machine', path: '/repo' };
        const discovered = { identity: 'github.com/team/repo', label: 'team/repo', rootPath: '/repo', worktreePaths: ['/worktree'] };
        const associations = withRepositoryAssociation({}, workspace, discovered);
        const settings = applyLocalSettings(localSettingsParse(null), {
            sessionListMachineViewV1: 'repository', sessionRepositoryAssociationsV1: associations,
        });
        const reloaded = localSettingsParse(JSON.parse(JSON.stringify(settings)));
        expect(reloaded.sessionListMachineViewV1).toBe('repository');
        expect(readRepositoryAssociation(reloaded.sessionRepositoryAssociationsV1, { ...workspace, path: '/worktree' })).toEqual(discovered);
        expect(readRepositoryAssociation(reloaded.sessionRepositoryAssociationsV1, { ...workspace, accountId: 'other' })).toBeNull();
        expect(readRepositoryAssociation(reloaded.sessionRepositoryAssociationsV1, { ...workspace, serverId: 'other' })).toBeNull();
        expect(readRepositoryAssociation(reloaded.sessionRepositoryAssociationsV1, { ...workspace, machineId: 'other' })).toBeNull();
        expect(readRepositoryAssociation(reloaded.sessionRepositoryAssociationsV1, { ...workspace, path: '/repo-same-name' })).toBeNull();
        expect(Object.keys(reloaded.sessionRepositoryAssociationsV1)).toEqual([repositoryWorkspaceKey(workspace)]);
    });

    it('combines conventional transport aliases without merging namespaces, forks or ports', () => {
        const canonical = 'github.com/owner/project';
        for (const url of ['git@github.com:owner/project.git', 'ssh://git@github.com:22/owner/project.git', 'https://user:secret@GITHUB.com:443/owner/project.git/']) {
            expect(normalizeRepositoryRemote(url)).toBe(canonical);
        }
        expect(normalizeRepositoryRemote('ssh://git@example.com:2222/team/project.git')).toBe('example.com:2222/team/project');
        expect(normalizeRepositoryRemote('https://example.com/team/project')).toBe('example.com/team/project');
        expect(normalizeRepositoryRemote('https://github.com/fork/project')).not.toBe(canonical);
    });

    it('prefers origin, never a shared upstream, and leaves ambiguous or local remotes unresolved', () => {
        expect(resolveRepositoryRemote([
            { name: 'upstream', fetchUrl: 'https://github.com/upstream/repo' },
            { name: 'origin', fetchUrl: 'git@github.com:fork/repo.git' },
        ])).toBe('github.com/fork/repo');
        expect(resolveRepositoryRemote([{ name: 'only', fetchUrl: 'https://example.com/team/repo' }])).toBe('example.com/team/repo');
        expect(resolveRepositoryRemote([{ name: 'one', fetchUrl: 'https://example.com/a/repo' }, { name: 'two', fetchUrl: 'https://example.com/b/repo' }])).toBeNull();
        for (const url of ['ssh://git@127.0.0.1/team/repo', 'ssh://git@[::1]/team/repo', 'https://repo.localhost/team/repo', 'git@work-alias:team/repo', '/home/me/repo', 'file:///home/me/repo', 'C:\\repo', 'https://example.com/a%2Fb/repo']) expect(normalizeRepositoryRemote(url)).toBeNull();
    });
});
