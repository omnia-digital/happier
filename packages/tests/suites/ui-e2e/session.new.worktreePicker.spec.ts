/** New/existing worktree intent, draft continuity and real launch cwd through the canonical composer. */

import { test, expect, type Page } from '@playwright/test';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { createRunDirs } from '../../src/testkit/runDir';
import { startServerLight, type StartedServer } from '../../src/testkit/process/serverLight';
import { startUiWeb, type StartedUiWeb } from '../../src/testkit/process/uiWeb';
import { type StartedDaemon } from '../../src/testkit/daemon/daemon';
import { authenticateAndStartDaemon } from '../../src/testkit/uiE2e/authenticateAndStartDaemon';
import { gotoDomContentLoadedWithRetries, normalizeLoopbackBaseUrl } from '../../src/testkit/uiE2e/pageNavigation';
import { fakeClaudeFixturePath } from '../../src/testkit/fakeClaude';
import { selectNewSessionAgent } from '../../src/testkit/uiE2e/selectNewSessionAgent';
import { collectBrowserDiagnostics, appendBrowserDiagnostics } from '../../src/testkit/uiE2e/browserDiagnostics';
import { enableEnhancedSessionWizard } from '../../src/testkit/uiE2e/enableEnhancedSessionWizard';

const run = createRunDirs({ runLabel: 'ui-e2e' });
const execFileAsync = promisify(execFile);

async function createGitRepository(path: string): Promise<void> {
    await mkdir(path, { recursive: true });
    await execFileAsync('git', ['init', '--initial-branch=main'], { cwd: path });
    await writeFile(join(path, 'fixture.txt'), 'OH-65 worktree fixture\n');
    await execFileAsync('git', ['add', 'fixture.txt'], { cwd: path });
    await execFileAsync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-m', 'fixture'], { cwd: path });
}

async function selectGitWorkingDirectory(params: Readonly<{
    page: Page;
    repoDir: string;
}>): Promise<void> {
    const pathInput = params.page.getByTestId('path-selection-list:header:input');
    if ((await pathInput.count()) === 0) {
        await expect(params.page.getByTestId('agent-input-path-chip')).toHaveCount(1, { timeout: 60_000 });
        await params.page.getByTestId('agent-input-path-chip').click();
    }

    await expect(pathInput).toBeVisible({ timeout: 60_000 });
    await pathInput.fill(params.repoDir);
    await expect(pathInput).toHaveValue(params.repoDir);
    await pathInput.press('Enter');

    await expect
        .poll(async () => await params.page.getByTestId('new-session-checkout-chip').count(), { timeout: 120_000 })
        .toBe(1);
}

test.describe('ui e2e: /new worktree picker (Phase 5 SelectionList migration)', () => {
    test.describe.configure({ mode: 'serial' });

    const suiteDir = run.testDir('new-session-worktree-picker-suite');
    const cliHomeDir = resolve(join(suiteDir, 'cli-home'));
    const fakeClaudeLogPath = resolve(join(suiteDir, 'fake-claude.jsonl'));
    const worktreeRepoDir = resolve(join(suiteDir, 'worktree-picker-repo'));

    let server: StartedServer | null = null;
    let ui: StartedUiWeb | null = null;
    let uiBaseUrl: string | null = null;
    let daemon: StartedDaemon | null = null;

    test.beforeAll(async () => {
        test.setTimeout(540_000);
        await mkdir(cliHomeDir, { recursive: true });
        await createGitRepository(worktreeRepoDir);

        server = await startServerLight({
            testDir: suiteDir,
            dbProvider: 'sqlite',
            extraEnv: {
                HAPPIER_BUILD_FEATURES_DENY: 'sharing.contentKeys',
            },
        });
        ui = await startUiWeb({
            testDir: suiteDir,
            env: {
                ...process.env,
                EXPO_PUBLIC_HAPPY_SERVER_URL: server.baseUrl,
                EXPO_PUBLIC_HAPPY_STORAGE_SCOPE: `e2e-${run.runId}`,
            },
        });
        uiBaseUrl = normalizeLoopbackBaseUrl(ui.baseUrl);
    });

    test.afterAll(async () => {
        try { await daemon?.stop?.(); } catch { /* best-effort */ }
        try { await ui?.stop?.(); } catch { /* best-effort */ }
        try { await server?.stop?.(); } catch { /* best-effort */ }
    });

    test('selects fresh worktree intent, preserves it on reopen/reload, then launches in that checkout', async ({ page }, testInfo) => {
        const diagnostics = collectBrowserDiagnostics({ page });
        try {
        if (!server || !ui || !uiBaseUrl) {
            throw new Error('test infra failed to start');
        }
        test.setTimeout(300_000);

        await gotoDomContentLoadedWithRetries(page, `${uiBaseUrl}/?happier_hmr=0`, 240_000);
        daemon = await authenticateAndStartDaemon({
            page,
            testDir: suiteDir,
            cliHomeDir,
            serverUrl: server.baseUrl,
            uiBaseUrl,
            terminalConnectUrlTimeoutMs: 180_000,
            daemonStartupTimeoutMs: 180_000,
            extraEnv: { HAPPIER_CLAUDE_PATH: fakeClaudeFixturePath(), HAPPIER_E2E_FAKE_CLAUDE_LOG: fakeClaudeLogPath },
        });

        await enableEnhancedSessionWizard({ page, baseUrl: uiBaseUrl, timeoutMs: 180_000 });
        await gotoDomContentLoadedWithRetries(page, `${uiBaseUrl}/new?happier_hmr=0`, 120_000);
        await expect(page.getByTestId('new-session-composer-input')).toBeVisible({ timeout: 60_000 });

        const draftText = 'worktree picker pointer smoke';
        await page.getByTestId('new-session-composer-input').fill(draftText);
        await expect(page.getByTestId('new-session-composer-input')).toHaveValue(draftText);
        await selectGitWorkingDirectory({ page, repoDir: worktreeRepoDir });

        // Open the agent-input checkout chip → SelectionList popover.
        await expect(page.getByTestId('new-session-checkout-chip')).toHaveCount(1, { timeout: 60_000 });
        await page.getByTestId('new-session-checkout-chip').click();
        expect(new URL(page.url()).pathname).toBe('/new');
        await expect(page.getByTestId('new-session-composer-input')).toBeVisible();
        await expect(page.getByTestId('new-session-composer-input')).toHaveValue(draftText);

        // The worktree picker mounts inside the shared SelectionList popover shell.
        await expect(page.getByTestId('agent-input-selection-list-popover')).toBeVisible({ timeout: 30_000 });

        // The root step `worktree-root` exposes the quick-actions options by
        // stable ids (`current_path` / `create_git_worktree`). Visible labels
        // are intentionally not asserted here.
        await expect(page.getByTestId('selection-list:worktree-root:option:current_path')).toBeVisible();
        await expect(page.getByTestId('selection-list:worktree-root:option:create_git_worktree')).toBeVisible();

        const list = async () => (await execFileAsync('git', ['worktree', 'list', '--porcelain'], { cwd: worktreeRepoDir })).stdout;
        const initialWorktrees = await list();
        const openPicker = async () => {
            await page.getByTestId('new-session-checkout-chip').click();
            await expect(page.getByTestId('selection-list:worktree-root:option:create_git_worktree')).toBeVisible();
        };
        const choose = async (id: string) => {
            await page.getByTestId(`selection-list:worktree-root:option:${id}`).click();
            await expect(page.getByTestId('agent-input-selection-list-popover')).toBeHidden();
        };
        // Empty existing list is a separate route; New never enters it.
        await page.getByTestId('selection-list:worktree-root:option:existing_git_worktree').click();
        await expect(page.getByTestId('selection-list:header:input')).toBeVisible();
        await page.keyboard.press('Escape');
        await choose('current_path');
        await openPicker();
        await choose('create_git_worktree');
        await openPicker();
        const pending = page.getByTestId('selection-list:worktree-root:option:pending_git_worktree');
        await expect(pending).toBeVisible();
        const pendingName = (await pending.innerText()).split('\n')[0];
        await page.screenshot({ path: testInfo.outputPath('oh65-new-intent.png') });
        expect(await list()).toBe(initialWorktrees);
        await page.keyboard.press('Escape');
        // A restored draft must keep the same creation intent/name.
        await page.reload();
        await expect(page.getByTestId('new-session-checkout-chip')).toBeVisible();
        await openPicker();
        await expect(pending).toContainText(pendingName);
        await choose('current_path');
        await openPicker();
        await choose('create_git_worktree');
        expect(await list()).toBe(initialWorktrees);
        await selectNewSessionAgent({ page, agentId: 'claude' });
        await page.getByTestId('new-session-composer-input').fill(draftText);
        await expect(page.getByTestId('new-session-composer-send')).toBeEnabled();
        await page.getByTestId('new-session-composer-send').click();
        await page.waitForURL((url) => url.pathname.startsWith('/session/'), { timeout: 180_000 });
        await expect.poll(async () => (await list()).split('worktree ').length - 1, { timeout: 60_000 }).toBe(2);
        const worktreePaths = (await list()).split('\n').filter((line) => line.startsWith('worktree ')).map((line) => line.slice(9));
        const newPath = worktreePaths.find((path) => path !== worktreeRepoDir)!;
        await expect.poll(async () => {
            const events = (await readFile(fakeClaudeLogPath, 'utf8').catch(() => '')).split('\n').filter(Boolean).map((line) => JSON.parse(line));
            return events.some((event) => event.type === 'invocation' && event.cwd === newPath && !event.argv.includes('--version'));
        }, { timeout: 120_000 }).toBe(true);
        await writeFile(testInfo.outputPath('oh65-worktree-proof.txt'), await list());
        await page.screenshot({ path: testInfo.outputPath('oh65-launched-worktree.png') });
        } catch (error) { throw appendBrowserDiagnostics(error, diagnostics()); }
    });
});
