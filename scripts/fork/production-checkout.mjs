import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const originUrl = 'https://github.com/omnia-digital/happier.git';
const hook = '#!/bin/sh\necho "This is the pull-only production checkout. Work in happier-dev or a feature worktree." >&2\nexit 1\n';
const hookNames = ['pre-commit', 'prepare-commit-msg', 'pre-merge-commit', 'pre-rebase', 'pre-push'];

function run(command, args, cwd, input) {
  const result = spawnSync(command, args, {
    cwd, input, encoding: 'utf8', maxBuffer: Infinity,
    // Reading status must not rewrite the locked index.
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}

function git(repo, ...args) { return run('git', args, repo).trim(); }

function inspect(repoPath) {
  if (process.platform !== 'darwin') throw new Error('This local checkout guard requires macOS file flags.');
  const repo = realpathSync(repoPath);
  if (realpathSync(git(repo, 'rev-parse', '--show-toplevel')) !== repo) throw new Error('Pass the checkout root.');
  const gitDir = join(repo, '.git');
  if (!lstatSync(gitDir).isDirectory() || git(repo, 'worktree', 'list', '--porcelain').split('\n').filter((line) => line.startsWith('worktree ')).length !== 1) {
    throw new Error('Production must be an independent clone without linked worktrees.');
  }
  if (git(repo, 'branch', '--show-current') !== 'production') throw new Error('Production checkout must remain on the production branch.');
  if (git(repo, 'remote', 'get-url', 'origin') !== originUrl) throw new Error(`Production origin must be ${originUrl}`);
  if (git(repo, 'status', '--porcelain=v1', '--untracked-files=all')) throw new Error('Production checkout is dirty; preserve and investigate its uncommitted work before updating.');
  return { repo, gitDir, hooksDir: join(gitDir, 'production-hooks') };
}

function protectionPaths({ repo, gitDir, hooksDir }) {
  const paths = new Set([repo, join(gitDir, 'HEAD'), join(gitDir, 'index'), join(gitDir, 'config'), join(gitDir, 'refs', 'heads'), hooksDir]);
  for (const name of run('git', ['ls-files', '-z'], repo).split('\0').filter(Boolean)) {
    const file = join(repo, name);
    paths.add(file);
    for (let parent = dirname(file); parent !== repo; parent = dirname(parent)) paths.add(parent);
  }
  for (const name of hookNames) paths.add(join(hooksDir, name));
  return [...paths].filter((path) => existsSync(path));
}

function setLocked(paths, locked) {
  // xargs respects the OS argument-size boundary; -h never follows tracked symlinks.
  run('xargs', ['-0', 'chflags', '-h', locked ? 'uchg' : 'nouchg'], undefined, `${paths.join('\0')}\0`);
}

function requireProtection(state) {
  if (git(state.repo, 'config', '--get', 'happier.productionCheckout') !== 'true'
    || git(state.repo, 'config', '--get', 'core.hooksPath') !== state.hooksDir
    || git(state.repo, 'remote', 'get-url', '--push', 'origin') !== 'disabled://production-checkout') {
    throw new Error('Checkout protection is missing or changed; run protect after investigating.');
  }
  for (const name of hookNames) {
    if (readFileSync(join(state.hooksDir, name), 'utf8') !== hook) throw new Error('Production checkout protection hook changed.');
  }
}

export function protectProductionCheckout(repoPath) {
  const state = inspect(repoPath);
  const config = git(state.repo, 'config', '--local', '--list');
  if (config.split('\n').includes('happier.productioncheckout=true')) {
    requireProtection(state);
    setLocked(protectionPaths(state), true);
    return git(state.repo, 'rev-parse', 'HEAD');
  }
  if (config.split('\n').some((line) => line.startsWith('core.hookspath=')) || existsSync(state.hooksDir)) {
    throw new Error('Existing checkout hooks found; refusing to replace them.');
  }
  mkdirSync(state.hooksDir);
  for (const name of hookNames) writeFileSync(join(state.hooksDir, name), hook, { mode: 0o755, flag: 'wx' });
  git(state.repo, 'config', '--local', 'core.hooksPath', state.hooksDir);
  git(state.repo, 'config', '--local', 'remote.origin.pushurl', 'disabled://production-checkout');
  git(state.repo, 'config', '--local', 'pull.ff', 'only');
  git(state.repo, 'config', '--local', 'push.default', 'nothing');
  git(state.repo, 'config', '--local', 'happier.productionCheckout', 'true');
  setLocked(protectionPaths(state), true);
  return git(state.repo, 'rev-parse', 'HEAD');
}

export function updateProductionCheckout(repoPath) {
  const state = inspect(repoPath);
  requireProtection(state);
  // Fetch while locked; network failure cannot leave the source writable.
  git(state.repo, 'fetch', 'origin', 'refs/heads/production:refs/remotes/origin/production');
  const candidate = git(state.repo, 'rev-parse', 'refs/remotes/origin/production');
  git(state.repo, 'merge-base', '--is-ancestor', 'HEAD', candidate);
  if (git(state.repo, 'rev-parse', 'HEAD') === candidate) return candidate;
  const previousPaths = protectionPaths(state);
  try {
    setLocked(previousPaths, false);
    git(state.repo, 'merge', '--ff-only', '--no-edit', '--no-overwrite-ignore', candidate);
  } finally {
    // Also protect files added by the pulled commit, including after a failed merge.
    setLocked([...new Set([...previousPaths.filter((path) => existsSync(path)), ...protectionPaths(state)])], true);
  }
  return git(state.repo, 'rev-parse', 'HEAD');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, repo, ...rest] = process.argv.slice(2);
    if (!repo || rest.length || !['protect', 'update', 'status'].includes(command)) {
      throw new Error('Usage: node scripts/fork/production-checkout.mjs <protect|update|status> /absolute/path/to/happier-production');
    }
    if (command === 'status') {
      const state = inspect(repo);
      requireProtection(state);
      console.log(`Production checkout: ${state.repo}\nCommit: ${git(state.repo, 'rev-parse', 'HEAD')}\nBranch: production\nGit guards: installed`);
    } else {
      const sha = command === 'protect' ? protectProductionCheckout(repo) : updateProductionCheckout(repo);
      console.log(`Production ${command} complete: ${sha}`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
