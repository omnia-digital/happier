import type { ScmWorktree } from '@happier-dev/protocol';

/**
 * Parser for `git worktree list --porcelain -z` output.
 *
 * Under `-z`, every porcelain "line" becomes a NUL-terminated token instead of a
 * newline-terminated line, and worktree records are separated by an EMPTY token
 * (i.e. consecutive NUL bytes form the record boundary). Crucially, worktree
 * paths that legitimately contain newline characters or trailing whitespace are
 * preserved verbatim inside their token, whereas non-`-z` porcelain would split
 * a newline-containing path across multiple lines and silently truncate it. The
 * FR4-4 security hardening relies on this property: caller-supplied paths are
 * intersected against the registered worktree set, and a truncated or trimmed
 * path could otherwise admit an unrelated sibling.
 *
 * Token grammar (per worktree record):
 *   worktree <NUL>
 *   <path-bytes>
 *   <NUL>
 *   key <space> value <NUL>     -- zero or more (HEAD, branch, bare, detached, locked, prunable)
 *   <NUL>                       -- empty token = end of record
 *
 * Note: git emits the `worktree` keyword and its path value as TWO tokens
 * (keyword token, then path token). All other keys (`HEAD <oid>`, `branch <ref>`)
 * are single tokens with the value separated by a space.
 */

function normalizeBranchRef(rawBranch: string | null): string | null {
    if (!rawBranch) return null;
    const trimmed = rawBranch.trim();
    if (!trimmed) return null;
    return trimmed.startsWith('refs/heads/') ? trimmed.slice('refs/heads/'.length) : trimmed;
}

function normalizeGitPathToken(rawPath: string | null | undefined): string | null {
    if (rawPath === null || rawPath === undefined || rawPath.length === 0) {
        return null;
    }
    return rawPath;
}

export function parseGitWorktreeListPorcelain(input: {
    worktreesOutput: string;
    currentWorktreePath: string | null;
    mainWorktreePath?: string | null;
}): ReadonlyArray<ScmWorktree> {
    const tokens = input.worktreesOutput.split('\0');
    const currentPath = normalizeGitPathToken(input.currentWorktreePath);
    const mainPath = normalizeGitPathToken(input.mainWorktreePath);
    const worktrees: ScmWorktree[] = [];

    let activePath: string | null = null;
    let activeBranch: string | null = null;
    let activeLocked = false;
    let activePrunable = false;

    const flush = () => {
        const path = normalizeGitPathToken(activePath);
        if (!path) return;
        worktrees.push({
            path,
            branch: normalizeBranchRef(activeBranch),
            isCurrent: currentPath === path,
            isMain: mainPath === path,
            ...(activeLocked ? { isLocked: true } : {}),
            ...(activePrunable ? { isPrunable: true } : {}),
        });
        activePath = null;
        activeBranch = null;
        activeLocked = false;
        activePrunable = false;
    };

    for (let i = 0; i < tokens.length; i += 1) {
        const token = tokens[i] ?? '';
        if (token.length === 0) {
            // Empty token = record boundary.
            flush();
            continue;
        }
        if (token === 'worktree') {
            // Two-token form: `worktree<NUL><path><NUL>`. The path is the next token,
            // which may legitimately contain newline characters.
            flush();
            const pathToken = tokens[i + 1];
            if (pathToken !== undefined) {
                activePath = pathToken;
                i += 1; // Consume the path token.
            }
            continue;
        }
        if (token.startsWith('worktree ')) {
            // Defensive: some git versions or wrapper outputs use the single-token
            // `worktree <path>` form even under -z. Treat it as a record start.
            flush();
            activePath = token.slice('worktree '.length);
            continue;
        }
        if (token.startsWith('branch ')) {
            activeBranch = token.slice('branch '.length);
            continue;
        }
        if (token === 'locked' || token.startsWith('locked ')) {
            activeLocked = true;
            continue;
        }
        if (token === 'prunable' || token.startsWith('prunable ')) {
            activePrunable = true;
            continue;
        }
        // Other keys (HEAD, bare, detached) are ignored for the
        // purpose of producing the ScmWorktree shape.
    }

    flush();

    return worktrees.sort((left, right) => left.path.localeCompare(right.path));
}
