import { describe, expect, it } from 'vitest';

import { parseGitWorktreeListPorcelain } from './worktreeListParser';

/**
 * FR4-4: `git worktree list --porcelain` does not escape embedded newlines in worktree
 * paths. The validation source used by the enrichment RPC must invoke
 * `git worktree list --porcelain -z` and parse the NUL-separated output so paths
 * containing newlines remain intact. Each worktree record is a series of
 * `key value` tokens separated by NUL bytes, with an EMPTY NUL-delimited token
 * marking the record boundary.
 */
describe('parseGitWorktreeListPorcelain — NUL (-z) token format', () => {
    it('preserves locked and prunable registration signals for read-only cleanup preflight', () => {
        const worktrees = parseGitWorktreeListPorcelain({
            worktreesOutput: [
                'worktree', '/repo', 'HEAD aaa', 'branch refs/heads/main', '',
                'worktree', '/repo/locked', 'HEAD bbb', 'branch refs/heads/locked', 'locked in use', '',
                'worktree', '/repo/prunable', 'HEAD ccc', 'branch refs/heads/prunable', 'prunable gitdir file points to non-existent location', '',
            ].join('\0'),
            currentWorktreePath: null,
            mainWorktreePath: '/repo',
        });
        expect(worktrees.find((worktree) => worktree.path === '/repo/locked')).toMatchObject({ isLocked: true });
        expect(worktrees.find((worktree) => worktree.path === '/repo/prunable')).toMatchObject({ isPrunable: true });
    });
    it('parses a single worktree record terminated by an empty NUL boundary', () => {
        const input = [
            'worktree /repo',
            'HEAD abc123',
            'branch refs/heads/main',
            '',
        ].join('\0');

        const worktrees = parseGitWorktreeListPorcelain({
            worktreesOutput: input,
            currentWorktreePath: '/repo',
            mainWorktreePath: '/repo',
        });

        expect(worktrees).toHaveLength(1);
        expect(worktrees[0]).toEqual({
            path: '/repo',
            branch: 'main',
            isCurrent: true,
            isMain: true,
        });
    });

    it('parses multiple worktree records separated by empty NUL boundaries', () => {
        const input = [
            'worktree /repo',
            'HEAD abc',
            'branch refs/heads/main',
            '',
            'worktree /repo/.worktrees/feature',
            'HEAD def',
            'branch refs/heads/feature',
            '',
        ].join('\0');

        const worktrees = parseGitWorktreeListPorcelain({
            worktreesOutput: input,
            currentWorktreePath: '/repo',
            mainWorktreePath: '/repo',
        });

        expect(worktrees).toHaveLength(2);
        const paths = worktrees.map((w) => w.path);
        expect(paths).toContain('/repo');
        expect(paths).toContain('/repo/.worktrees/feature');
    });

    it('preserves worktree paths that contain embedded newline characters (the FR4-4 security fix)', () => {
        // Under non-`-z` porcelain, this path would be split across two lines and the
        // parser would only see `/repo/wt/a` — allowing a TOCTOU intersection bypass
        // for a sibling truncated path. With `-z`, the full path is one NUL-delimited token.
        const malicious = '/repo/wt/a\nb';
        const input = [
            `worktree ${malicious}`,
            'HEAD abc',
            'branch refs/heads/main',
            '',
        ].join('\0');

        const worktrees = parseGitWorktreeListPorcelain({
            worktreesOutput: input,
            currentWorktreePath: malicious,
            mainWorktreePath: malicious,
        });

        expect(worktrees).toHaveLength(1);
        expect(worktrees[0]?.path).toBe(malicious);
    });

    it('preserves worktree paths that end with spaces', () => {
        const pathWithTrailingSpaces = '/repo/wt/feature  ';
        const input = [
            'worktree',
            pathWithTrailingSpaces,
            'HEAD abc',
            'branch refs/heads/feature',
            '',
        ].join('\0');

        const worktrees = parseGitWorktreeListPorcelain({
            worktreesOutput: input,
            currentWorktreePath: pathWithTrailingSpaces,
            mainWorktreePath: null,
        });

        expect(worktrees).toHaveLength(1);
        expect(worktrees[0]).toEqual({
            path: pathWithTrailingSpaces,
            branch: 'feature',
            isCurrent: true,
            isMain: false,
        });
    });

    it('preserves worktree paths that end with newline characters', () => {
        const pathWithTrailingNewline = '/repo/wt/feature\n';
        const input = [
            'worktree',
            pathWithTrailingNewline,
            'HEAD abc',
            'branch refs/heads/feature',
            '',
        ].join('\0');

        const worktrees = parseGitWorktreeListPorcelain({
            worktreesOutput: input,
            currentWorktreePath: null,
            mainWorktreePath: pathWithTrailingNewline,
        });

        expect(worktrees).toHaveLength(1);
        expect(worktrees[0]).toEqual({
            path: pathWithTrailingNewline,
            branch: 'feature',
            isCurrent: false,
            isMain: true,
        });
    });

    it('returns empty array for empty input', () => {
        const worktrees = parseGitWorktreeListPorcelain({
            worktreesOutput: '',
            currentWorktreePath: null,
            mainWorktreePath: null,
        });
        expect(worktrees).toEqual([]);
    });

    it('handles a detached worktree record (no branch key)', () => {
        const input = [
            'worktree /repo/.worktrees/detached',
            'HEAD abc123',
            'detached',
            '',
        ].join('\0');

        const worktrees = parseGitWorktreeListPorcelain({
            worktreesOutput: input,
            currentWorktreePath: null,
            mainWorktreePath: null,
        });
        expect(worktrees).toHaveLength(1);
        expect(worktrees[0]?.branch).toBeNull();
        expect(worktrees[0]?.path).toBe('/repo/.worktrees/detached');
    });

    it('sorts worktrees by path for deterministic ordering', () => {
        const input = [
            'worktree /repo/z',
            'HEAD a',
            'branch refs/heads/z',
            '',
            'worktree /repo/a',
            'HEAD b',
            'branch refs/heads/a',
            '',
        ].join('\0');
        const worktrees = parseGitWorktreeListPorcelain({
            worktreesOutput: input,
            currentWorktreePath: null,
            mainWorktreePath: null,
        });
        expect(worktrees.map((w) => w.path)).toEqual(['/repo/a', '/repo/z']);
    });
});
