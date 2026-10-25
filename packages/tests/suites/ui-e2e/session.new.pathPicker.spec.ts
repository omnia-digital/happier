/**
 * Phase 11.11 — Path picker UI e2e (agent-input-selection-list-popover-unification).
 *
 * Verifies the migrated `PathSelectionList` surface keeps a stable contract
 * inside the agent-input path popover after the SelectionList unification:
 *   - the popover container mounts under the `path-selection-list` root
 *     testID;
 *   - the in-input search/value field mounts under
 *     `path-selection-list:header:input`;
 *   - the tree-browser escape-hatch button mounts under
 *     `path-selection-list:open-tree-browser` (inside `inputSuffix`, never
 *     the footer);
 *   - the footer renders keyboard hints for navigate / commit / autocomplete
 *     / walk-up (and is suppressed on touch-only viewports — covered by
 *     unit tests, not asserted here because the e2e harness uses a desktop
 *     viewport with a hardware keyboard).
 *   - a folder listed by the isolated daemon can be favorited for the selected
 *     machine and remains visible after reloading the Account settings reader.
 *
 * R2 path-picker correctness fixes (Bug 4a-e) are covered as follows:
 *   - Bug 4a (double-commit): asserted via the vitest case
 *     "Bug 4a: fires onCommit exactly once per row press" in
 *     `apps/ui/sources/components/sessions/new/components/PathSelectionList.test.tsx`.
 *     The e2e spec smoke-verifies the popover wiring and does NOT
 *     re-assert tap-to-commit count (that requires deterministic
 *     RPC mocking which is what the vitest case owns).
 *   - Bug 4b (autocomplete descent): asserted via the vitest case
 *     "Bug 4b: directory kind appends trailing separator …" in
 *     `apps/ui/sources/utils/path/browseSegments.test.ts`.
 *   - Bug 4c (touch drill chevron drills, NOT commits): asserted via
 *     the vitest case "Bug 4c: dynamic-section directory rows expose a
 *     drill-down chevron that does NOT commit".
 *   - Bug 4d (UNC / partial Windows shapes): asserted via the
 *     "Bug 4d: UNC and partial Windows path handling" describe block in
 *     `browseSegments.test.ts`.
 *   - Bug 4e (initialValue resync): asserted via the vitest case
 *     "Bug 4e: resyncs the input value when the parent changes
 *     initialValue identity".
 *
 * The full keyboard journey listed in plan Phase 11.11 (drilling via ghost
 * suffixes, Tab autocomplete preserving shorthand, Backspace walk-up,
 * Enter-commit of resolved-absolute paths, Windows-platform semantics on a
 * remote host, reduced-motion behavior) is exercised in vitest unit tests
 * (`PathSelectionList.test.tsx`, `browseInputBehavior.test.ts`,
 * `browseSegments.test.ts`, `SelectionListInputController.test.tsx`,
 * `useSelectionListAutocomplete.test.ts`) because:
 *   1. The unit tests can deterministically drive the input string and
 *      assert on the path-domain helpers without provisioning a real
 *      remote filesystem;
 *   2. Playwright's keyboard simulation against a real `listDirectory`
 *      RPC is slow and adds little additional signal over the unit
 *      tests for the path-domain transformations;
 *   3. The browser-level keyboard handling (Tab focus management,
 *      reduced-motion, ghost width measurement) is owned by
 *      `SelectionListInputController` and tested there.
 *
 * Anything that requires a real session draft + machine + popover anchor
 * (the popover wiring, the chip → popover → SelectionList composition) is
 * what this e2e spec is for.
 */

import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { accountSettingsParse } from '@happier-dev/protocol';

import { createRunDirs } from '../../src/testkit/runDir';
import { createIsolatedCliTestEnv } from '../../src/testkit/process/cliTestEnv';
import { startServerLight, type StartedServer } from '../../src/testkit/process/serverLight';
import { startUiWeb, type StartedUiWeb } from '../../src/testkit/process/uiWeb';
import { type StartedDaemon } from '../../src/testkit/daemon/daemon';
import { authenticateAndStartDaemon } from '../../src/testkit/uiE2e/authenticateAndStartDaemon';
import { readCliAccessKey } from '../../src/testkit/cliAccessKey';
import { waitForDaemonMachineIdFromCliSettings } from '../../src/testkit/uiE2e/daemonMachineId';
import { readUiE2eScopedAccountSettings } from '../../src/testkit/uiE2e/scopedAccountSettingsStorage';
import { upsertEncryptedAccountSettingsV2 } from '../../src/testkit/accountSettings';
import { gotoDomContentLoadedWithRetries } from '../../src/testkit/uiE2e/pageNavigation';
import { enableEnhancedSessionWizard } from '../../src/testkit/uiE2e/enableEnhancedSessionWizard';

const run = createRunDirs({ runLabel: 'ui-e2e' });

test.describe('ui e2e: /new path picker (Phase 11 SelectionList migration)', () => {
    test.describe.configure({ mode: 'serial' });

    const suiteDir = run.testDir('new-session-path-picker-suite');
    const cliHomeDir = resolve(join(suiteDir, 'cli-home'));
    const scrollCliHomeDir = resolve(join(suiteDir, 'scroll-cli-home'));
    const favoriteDir = resolve(join(suiteDir, 'oh64-favorite-dir'));

    let server: StartedServer | null = null;
    let ui: StartedUiWeb | null = null;
    let uiBaseUrl: string | null = null;
    let daemon: StartedDaemon | null = null;
    let scrollDaemon: StartedDaemon | null = null;

    test.beforeAll(async () => {
        test.setTimeout(540_000);
        await mkdir(cliHomeDir, { recursive: true });
        await mkdir(favoriteDir, { recursive: true });

        server = await startServerLight({ testDir: suiteDir });
        ui = await startUiWeb({
            testDir: suiteDir,
            env: {
                ...process.env,
                EXPO_PUBLIC_HAPPY_SERVER_URL: server.baseUrl,
            },
        });
        uiBaseUrl = ui.baseUrl;
    });

    test.afterAll(async () => {
        try { await scrollDaemon?.stop?.(); } catch { /* best-effort */ }
        try { await daemon?.stop?.(); } catch { /* best-effort */ }
        try { await ui?.stop?.(); } catch { /* best-effort */ }
        try { await server?.stop?.(); } catch { /* best-effort */ }
    });

    test('the path popover browses and persists a selected-machine favorite', async ({ page }) => {
        if (!server || !ui || !uiBaseUrl) {
            throw new Error('test infra failed to start');
        }
        test.setTimeout(180_000);

        daemon = await authenticateAndStartDaemon({
            page,
            testDir: suiteDir,
            cliHomeDir,
            serverUrl: server.baseUrl,
            uiBaseUrl,
            initialUiGotoTimeoutMs: 420_000,
            initialUiReadyTimeoutMs: 420_000,
            terminalConnectUrlTimeoutMs: 90_000,
            daemonStartupTimeoutMs: 180_000,
            extraEnv: createIsolatedCliTestEnv({ homeDir: cliHomeDir }),
            inheritProcessEnv: false,
        });

        await enableEnhancedSessionWizard({ page, baseUrl: uiBaseUrl });
        await gotoDomContentLoadedWithRetries(page, `${uiBaseUrl}/new`, 60_000);

        // Open the agent-input path chip → popover.
        await page.getByTestId('agent-input-path-chip').click();
        const activePopover = page.getByTestId('agent-input-content-popover');
        await expect(activePopover).toHaveCount(1, { timeout: 30_000 });

        // The new PathSelectionList surface mounts under the path-selection-list root testID.
        await expect(activePopover.getByTestId('path-selection-list')).toBeVisible({ timeout: 30_000 });
        // The input prefix/value field is part of the SelectionList header.
        await expect(activePopover.getByTestId('path-selection-list:header:input')).toBeVisible();
        // The open-tree-browser escape hatch lives inside the input suffix slot (NOT the footer).
        await expect(activePopover.getByTestId('path-selection-list:open-tree-browser')).toBeVisible();
        // The legacy PathSelector testIDs are gone.
        await expect(page.getByTestId('path-selector-input')).toHaveCount(0);

        // Browse the isolated test directory through the actual daemon, then save a
        // favorite through the selected machine's Account settings writer.
        await activePopover.getByTestId('path-selection-list:header:input').fill(`${suiteDir}/`);
        const directoryRow = activePopover.getByTestId(`path-selection-list:path-root:option:in-folder:${favoriteDir}`);
        await expect(directoryRow).toBeVisible({ timeout: 60_000 });
        await directoryRow.getByRole('button', { name: 'Add to favorites' }).click();
        await expect(activePopover.getByTestId(`path-selection-list:path-root:option:favorite:${favoriteDir}`)).toBeVisible({ timeout: 60_000 });

        await gotoDomContentLoadedWithRetries(page, `${uiBaseUrl}/new?happier_hmr=0`, 60_000);
        await page.getByTestId('agent-input-path-chip').click();
        await expect(page.getByTestId('agent-input-content-popover')
            .getByTestId(`path-selection-list:path-root:option:favorite:${favoriteDir}`))
            .toBeVisible({ timeout: 60_000 });
    });

    test('scrolls an overflowing selected-machine path list inside the New Session popover', async ({ page }, testInfo) => {
        if (!server || !ui || !uiBaseUrl) throw new Error('test infra failed to start');
        test.setTimeout(180_000);

        const dirs = Array.from({ length: 14 }, (_, index) => resolve(join(suiteDir, `scroll-path-${String(index).padStart(2, '0')}`)));
        const recentDirs = Array.from({ length: 3 }, (_, index) => resolve(join(suiteDir, `recent-path-${index}`)));
        await Promise.all([...dirs, ...recentDirs].map((path) => mkdir(path, { recursive: true })));
        await mkdir(scrollCliHomeDir, { recursive: true });
        scrollDaemon = await authenticateAndStartDaemon({
            page,
            testDir: suiteDir,
            cliHomeDir: scrollCliHomeDir,
            serverUrl: server.baseUrl,
            uiBaseUrl,
            initialUiGotoTimeoutMs: 420_000,
            initialUiReadyTimeoutMs: 420_000,
            terminalConnectUrlTimeoutMs: 90_000,
            daemonStartupTimeoutMs: 180_000,
            extraEnv: createIsolatedCliTestEnv({ homeDir: scrollCliHomeDir }),
            inheritProcessEnv: false,
        });
        const machineId = await waitForDaemonMachineIdFromCliSettings({ cliHomeDir: scrollCliHomeDir });
        const accessKey = await readCliAccessKey(scrollCliHomeDir);
        if (!accessKey) throw new Error('expected isolated daemon access key');
        // Read only this isolated browser fixture's generated encryption secret;
        // the account settings endpoint is the real persisted preference boundary.
        const secretBase64Url = await page.evaluate(() => {
            const keys = Object.keys(localStorage).filter((key) => key.startsWith('auth_credentials__srv_'));
            if (keys.length !== 1) throw new Error('expected one isolated fixture account');
            const credentials: unknown = JSON.parse(localStorage.getItem(keys[0]!) ?? '{}');
            if (!credentials || typeof credentials !== 'object' || !('secret' in credentials)
                || typeof credentials.secret !== 'string') throw new Error('missing isolated fixture encryption secret');
            return credentials.secret;
        });
        const fixtureSecret = Uint8Array.from(Buffer.from(secretBase64Url, 'base64url'));

        await page.setViewportSize({ width: 900, height: 480 });
        await enableEnhancedSessionWizard({ page, baseUrl: uiBaseUrl });
        await gotoDomContentLoadedWithRetries(page, `${uiBaseUrl}/new?happier_hmr=0`, 60_000);
        await page.getByTestId('agent-input-path-chip').click();
        const popover = page.getByTestId('agent-input-content-popover');
        const input = popover.getByTestId('path-selection-list:header:input');
        await input.fill(`${suiteDir}/`);
        const firstRow = popover.getByTestId(`path-selection-list:path-root:option:in-folder:${dirs[0]}`);
        await expect(firstRow).toBeVisible({ timeout: 60_000 });
        await firstRow.getByRole('button', { name: 'Add to favorites' }).click();
        await expect(popover.getByTestId(`path-selection-list:path-root:option:favorite:${dirs[0]}`)).toHaveCount(1);
        await input.press('Escape');
        await expect(popover).toHaveCount(0);
        await gotoDomContentLoadedWithRetries(page, `${uiBaseUrl}/new?happier_hmr=0`, 60_000);
        const pathChip = page.getByTestId('agent-input-path-chip');
        await pathChip.click();
        await expect(popover).toHaveCount(1);
        await expect(popover.getByTestId(`path-selection-list:path-root:option:favorite:${dirs[0]}`)).toHaveCount(1);
        await popover.getByTestId('path-selection-list:header:input').press('Escape');
        await expect(popover).toHaveCount(0);
        const currentSettings = await readUiE2eScopedAccountSettings({ page });
        const rawPreferences = currentSettings.machinePathPreferencesByTargetV1;
        if (!rawPreferences || typeof rawPreferences !== 'object' || Array.isArray(rawPreferences)) {
            throw new Error('missing selected-machine path preference record');
        }
        const targetKeys = Object.keys(rawPreferences).filter((key) => {
            try {
                const scope: unknown = JSON.parse(key);
                return Array.isArray(scope) && scope.length === 3 && scope[2] === machineId;
            } catch { return false; }
        });
        if (targetKeys.length !== 1) throw new Error('expected exactly one selected-machine path preference record');
        await upsertEncryptedAccountSettingsV2({
            baseUrl: server.baseUrl,
            token: accessKey.token,
            secret: fixtureSecret,
            settings: accountSettingsParse({
                ...currentSettings,
                machinePathPreferencesByTargetV1: {
                    ...rawPreferences,
                    [targetKeys[0]!]: { favorites: dirs, recentPaths: recentDirs },
                },
            }),
        });
        await gotoDomContentLoadedWithRetries(page, `${uiBaseUrl}/new?happier_hmr=0`, 60_000);
        await pathChip.click();
        await expect(popover).toHaveCount(1);
        await expect(popover.getByTestId(`path-selection-list:path-root:option:recent:${recentDirs[0]}`)).toHaveCount(1);
        const selectedPathBefore = await pathChip.textContent();
        const scroll = popover.getByTestId('path-selection-list:bodyScroll');
        const lastRecent = popover.getByTestId(`path-selection-list:path-root:option:recent:${recentDirs.at(-1)}`);
        await expect(lastRecent).toHaveCount(1);
        const footer = popover.getByTestId('path-selection-list:footerFrame');
        await expect(footer).toBeVisible();
        const readModalScrollOffsets = () => pathChip.evaluate((element) => {
            const offsets: number[] = [];
            for (let parent = element.parentElement; parent; parent = parent.parentElement) {
                if (parent.scrollHeight > parent.clientHeight + 1) offsets.push(parent.scrollTop);
            }
            return offsets;
        });
        const modalOffsetsBefore = await readModalScrollOffsets();
        await scroll.hover();
        await page.mouse.wheel(0, -1600);
        await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBe(0);
        const before = await scroll.evaluate((element) => ({
            top: element.scrollTop,
            client: element.clientHeight,
            content: element.scrollHeight,
            page: window.scrollY,
            active: document.activeElement?.getAttribute('aria-activedescendant') ?? null,
        }));
        await page.screenshot({ path: testInfo.outputPath('oh73-path-scroll-before.png') });
        expect(before.content - before.client).toBeGreaterThan(100);
        await page.mouse.wheel(0, 1600);
        await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(before.top);
        const after = await scroll.evaluate((element) => ({
            top: element.scrollTop,
            client: element.clientHeight,
            content: element.scrollHeight,
            page: window.scrollY,
            active: document.activeElement?.getAttribute('aria-activedescendant') ?? null,
        }));
        expect(after.content).toBe(before.content);
        expect(after.client).toBe(before.client);
        expect(after.active).toBe(before.active);
        expect(await page.evaluate(() => window.scrollY)).toBe(before.page);
        expect(await readModalScrollOffsets()).toEqual(modalOffsetsBefore);
        expect(await pathChip.textContent()).toBe(selectedPathBefore);
        const lastRecentRect = await lastRecent.boundingBox();
        const scrollRect = await scroll.boundingBox();
        const footerRect = await footer.boundingBox();
        const shortPickerRect = await popover.getByTestId('path-selection-list').boundingBox();
        expect(lastRecentRect).not.toBeNull();
        expect(scrollRect).not.toBeNull();
        expect(footerRect).not.toBeNull();
        expect(shortPickerRect).not.toBeNull();
        expect(shortPickerRect!.y).toBeGreaterThanOrEqual(0);
        expect(shortPickerRect!.y + shortPickerRect!.height).toBeLessThanOrEqual(
            await page.evaluate(() => window.innerHeight),
        );
        expect(lastRecentRect!.y).toBeGreaterThanOrEqual(scrollRect!.y);
        expect(lastRecentRect!.y + lastRecentRect!.height).toBeLessThanOrEqual(footerRect!.y);
        await lastRecent.hover();
        await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
        const bottomOffset = await scroll.evaluate((element) => element.scrollTop);
        await page.mouse.wheel(0, 800);
        await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBe(bottomOffset);
        expect(await page.evaluate(() => window.scrollY)).toBe(before.page);
        expect(await readModalScrollOffsets()).toEqual(modalOffsetsBefore);
        await expect(popover).toHaveCount(1);
        await page.screenshot({ path: testInfo.outputPath('oh73-path-scroll-after.png') });
        await page.mouse.wheel(0, -1600);
        await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBe(0);
        await page.mouse.wheel(0, 1600);
        await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
        await lastRecent.click();
        await expect(popover).toHaveCount(0);
        await expect(pathChip).toContainText('recent-path-2');

        await page.setViewportSize({ width: 1200, height: 800 });
        await pathChip.click();
        await expect(popover).toHaveCount(1);
        await expect.poll(async () => {
            const rect = await popover.getByTestId('path-selection-list').boundingBox();
            return rect?.y ?? Number.NEGATIVE_INFINITY;
        }).toBeGreaterThanOrEqual(0);
        const normalPickerRect = await popover.getByTestId('path-selection-list').boundingBox();
        expect(normalPickerRect).not.toBeNull();
        expect(normalPickerRect!.y).toBeGreaterThanOrEqual(0);
        expect(normalPickerRect!.y + normalPickerRect!.height).toBeLessThanOrEqual(
            await page.evaluate(() => window.innerHeight),
        );
        await page.screenshot({ path: testInfo.outputPath('oh73-path-normal-open.png') });
        const normalInput = popover.getByTestId('path-selection-list:header:input');
        await normalInput.fill('scroll-path-13');
        const searchedFavorite = popover.getByTestId(`path-selection-list:path-root:option:favorite:${dirs.at(-1)}`);
        await expect(searchedFavorite).toBeVisible();
        await normalInput.press('ArrowDown');
        await expect.poll(() => normalInput.getAttribute('aria-activedescendant'))
            .toContain(`favorite:${dirs.at(-1)}`);
        await normalInput.press('Enter');
        await expect(popover).toHaveCount(0);
        await expect(pathChip).toContainText('scroll-path-13');
        await page.screenshot({ path: testInfo.outputPath('oh73-path-normal-search-commit.png') });
    });
});
