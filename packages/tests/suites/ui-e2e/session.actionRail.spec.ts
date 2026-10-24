import { test, expect, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { createRunDirs } from '../../src/testkit/runDir';
import { startServerLight, type StartedServer } from '../../src/testkit/process/serverLight';
import { resolveUiWebScriptFetchTotalTimeoutMs, startUiWeb, type StartedUiWeb } from '../../src/testkit/process/uiWeb';
import { type StartedDaemon } from '../../src/testkit/daemon/daemon';
import { fakeClaudeFixturePath } from '../../src/testkit/fakeClaude';
import { gotoDomContentLoadedWithRetries, normalizeLoopbackBaseUrl } from '../../src/testkit/uiE2e/pageNavigation';
import { mutateUiE2eLocalSettings } from '../../src/testkit/uiE2e/localSettingsStorage';
import { mutateUiE2eScopedAccountSettings } from '../../src/testkit/uiE2e/scopedAccountSettingsStorage';
import { createGitRepoWithChanges, execGit } from '../../src/testkit/uiE2e/gitRepoFixtures';
import { spawnSessionFromDaemon } from '../../src/testkit/uiE2e/spawnSessionFromDaemon';
import { toTestIdSafeValue } from '../../src/testkit/uiE2e/testIdSafeValue';
import { waitForInitialAppUi } from '../../src/testkit/uiE2e/waitForInitialAppUi';
import { ensureAccountReadyForConnect } from '../../src/testkit/uiE2e/ensureAccountReadyForConnect';
import { authenticateAndStartDaemon } from '../../src/testkit/uiE2e/authenticateAndStartDaemon';
import { appendBrowserDiagnostics, collectBrowserDiagnostics } from '../../src/testkit/uiE2e/browserDiagnostics';
import { createSessionWithCiphertexts, fetchSessionV2 } from '../../src/testkit/sessions';
import { encryptLegacyBase64 } from '../../src/testkit/messageCrypto';
import { parseAckFrame, buildAckFrame } from '../../src/testkit/uiE2e/desktopSetup/relayMachineRpcTap';

const run = createRunDirs({ runLabel: 'ui-e2e' });

function detailsPaneLocator(page: Page) {
  return page
    .getByTestId('multi-pane-details-docked')
    .or(page.getByTestId('multi-pane-details-overlay'));
}

function rightPaneLocator(page: Page) {
  return page
    .getByTestId('multi-pane-right-docked')
    .or(page.getByTestId('multi-pane-right-overlay'));
}

type SessionMessageTimestampRecord = Readonly<{
  id: string;
  messageRole: 'user' | 'agent' | null;
  createdAt: number;
}>;

function readSessionMessageTimestampRecords(value: unknown): SessionMessageTimestampRecord[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid session messages response');
  const messages = (value as Record<string, unknown>).messages;
  if (!Array.isArray(messages)) throw new Error('missing session messages');
  return messages.flatMap((message) => {
    if (!message || typeof message !== 'object' || Array.isArray(message)) return [];
    const record = message as Record<string, unknown>;
    if (typeof record.id !== 'string' || typeof record.createdAt !== 'number' || !Number.isFinite(record.createdAt)) return [];
    const messageRole = record.messageRole === 'user' || record.messageRole === 'agent' ? record.messageRole : null;
    return [{ id: record.id, messageRole, createdAt: record.createdAt }];
  });
}

async function formatStoredMessageTimestamp(page: Page, createdAt: number): Promise<string> {
  return page.evaluate((timestamp) => new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp)), createdAt);
}

test.describe('ui e2e: session action rail', () => {
  test.describe.configure({ mode: 'serial' });

  const suiteDir = run.testDir('session-action-rail-suite');
  const cliHomeDir = resolve(join(suiteDir, 'cli-home'));

  let server: StartedServer | null = null;
  let ui: StartedUiWeb | null = null;
  let uiBaseUrl: string | null = null;
  let daemon: StartedDaemon | null = null;

  test.beforeAll(async () => {
    // Expo web bundling + first-run Metro startup can exceed 7 minutes on cold caches.
    // Keep this generous to avoid flaking the suite before we even reach UI assertions.
    test.setTimeout(900_000);
    await mkdir(cliHomeDir, { recursive: true });
    await writeFile(resolve(join(cliHomeDir, 'AGENTS.md')), '# UI e2e fixture\n', 'utf8');

    server = await startServerLight({
      testDir: suiteDir,
      dbProvider: 'sqlite',
      extraEnv: {
        HAPPIER_BUILD_FEATURES_DENY: 'sharing.contentKeys',
        HAPPIER_FEATURE_AUTH_LOGIN__KEY_CHALLENGE_ENABLED: '1',
        HAPPIER_FEATURE_TERMINAL_EMBEDDED_PTY__ENABLED: '1',
        HAPPIER_E2E_PROVIDER_USE_SERVER_SOURCE_ENTRYPOINT: '1',
      },
    });

    ui = await startUiWeb({
      testDir: suiteDir,
      env: {
        ...process.env,
        EXPO_PUBLIC_DEBUG: '1',
        EXPO_PUBLIC_HAPPIER_SOCKET_FORCE_WEBSOCKET: '1',
        EXPO_PUBLIC_HAPPY_SERVER_URL: server.baseUrl,
        EXPO_PUBLIC_HAPPY_STORAGE_SCOPE: `e2e-${run.runId}`,
        // On cold caches, the initial Metro web bundle can take >2 minutes; avoid aborting the request
        // before it has a chance to complete (which can cause repeated restarts and flakiness).
        HAPPIER_E2E_UI_WEB_SCRIPT_FETCH_TIMEOUT_MS: process.env.HAPPIER_E2E_UI_WEB_SCRIPT_FETCH_TIMEOUT_MS ?? '420000',
      },
    });

    uiBaseUrl = normalizeLoopbackBaseUrl(ui.baseUrl);
  });

  test.afterAll(async () => {
    test.setTimeout(120_000);
    await daemon?.stop().catch(() => {});
    await ui?.stop().catch(() => {});
    await server?.stop().catch(() => {});
  });

  test('resolves a legacy message ACK through authenticated stored history before and after reload', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    if (!server || !uiBaseUrl) throw new Error('missing server/ui fixtures');
    const diagnostics = collectBrowserDiagnostics({ page });
    const omittedTimes: Array<{ id: string; localId: string; createdAt: number }> = [];
    // server-v0.2.17 (a2c45c86804b24e60ac0b76146a3ef36dfcaa15b) omits
    // ACK.createdAt but serves the same authenticated by-local-id route. Emulate only
    // that wire difference; persistence, auth, HTTP lookup, Sync and rendering stay real.
    await page.routeWebSocket((url) => url.pathname === '/v1/updates/', (route) => {
      const upstream = route.connectToServer();
      upstream.onMessage((packet) => {
        const parsed = typeof packet === 'string' ? parseAckFrame(packet) : null;
        const ack = parsed?.ack as Record<string, unknown> | null | undefined;
        if (parsed && ack?.ok === true && typeof ack.id === 'string'
          && typeof ack.localId === 'string' && typeof ack.seq === 'number' && typeof ack.createdAt === 'number') {
          omittedTimes.push({ id: ack.id, localId: ack.localId, createdAt: ack.createdAt });
          const { createdAt: _storedTime, ...legacyAck } = ack;
          route.send(buildAckFrame(parsed.ackId, legacyAck));
          return;
        }
        route.send(packet);
      });
    });
    try {
      await gotoDomContentLoadedWithRetries(page, uiBaseUrl);
      await waitForInitialAppUi({ page, browserDiagnostics: diagnostics });
      await ensureAccountReadyForConnect({ page, timeoutMs: 120_000 });
      // Read only this isolated browser fixture's generated credentials.
      const access = await page.evaluate(() => {
        const keys = Object.keys(localStorage).filter((key) => key.startsWith('auth_credentials__srv_'));
        if (keys.length !== 1) throw new Error('Expected one isolated fixture account');
        const credentials = JSON.parse(localStorage.getItem(keys[0]!) ?? '{}');
        if (typeof credentials.token !== 'string' || typeof credentials.secret !== 'string') throw new Error('Missing fixture credentials');
        return { token: credentials.token as string, secret: credentials.secret as string };
      });
      const secret = Uint8Array.from(Buffer.from(access.secret, 'base64url'));
      const { sessionId } = await createSessionWithCiphertexts({
        baseUrl: server.baseUrl,
        token: access.token,
        metadataCiphertextBase64: encryptLegacyBase64({ path: suiteDir, host: 'Timestamp fixture', version: '0.2.16', flavor: 'claude' }, secret),
      });
      // Explicit immediate-send in agent_queue mode takes the socket path for an
      // inactive session; ordinary Send intentionally queues it instead.
      expect((await fetchSessionV2(server.baseUrl, access.token, sessionId)).active).toBe(false);
      await mutateUiE2eScopedAccountSettings({ page, settingsPatch: {
        sessionMessageSendMode: 'agent_queue',
        keyboardShortcutsV2Enabled: true,
        keyboardShortcutOverridesV1: { 'composer.sendImmediate': [{ binding: 'Alt+Enter' }] },
      } });
      await gotoDomContentLoadedWithRetries(page, `${uiBaseUrl}/session/${sessionId}`);
      const prompt = `legacy ACK timestamp ${run.runId}`;
      await page.getByTestId('session-composer-input').fill(prompt);
      const lookupResponse = page.waitForResponse((response) => new URL(response.url()).pathname.startsWith(`/v2/sessions/${sessionId}/messages/by-local-id/`));
      await expect(page.getByTestId('session-composer-send')).toBeEnabled();
      await page.getByTestId('session-composer-input').press('Alt+Enter');
      const response = await lookupResponse;
      expect(response.status()).toBe(200);
      expect(omittedTimes).toHaveLength(1);
      const stored = (await response.json()).message;
      expect(stored).toMatchObject(omittedTimes[0]!);
      const expectedTime = await formatStoredMessageTimestamp(page, stored.createdAt);
      const message = page.locator('[data-testid^="transcript-message-"]').filter({ hasText: prompt });
      await expect(message).toHaveCount(1);
      await expect(message.locator('[data-testid^="transcript-message-timestamp-text:"]')).toHaveText(expectedTime);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(message).toHaveCount(1);
      await expect(message.locator('[data-testid^="transcript-message-timestamp-text:"]')).toHaveText(expectedTime);
      await testInfo.attach('legacy-ack-stored-timestamp', {
        body: JSON.stringify({ wireEmulation: 'server-v0.2.17 ACK without createdAt', message: omittedTimes[0], expectedTime, lookupStatus: response.status() }),
        contentType: 'application/json',
      });
      await page.screenshot({ path: testInfo.outputPath('legacy-ack-timestamp-after-reload.png') });
    } catch (error) {
      throw appendBrowserDiagnostics(error, diagnostics());
    }
  });

  test('opens independent panes and preserves access across responsive layouts', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    if (!server || !uiBaseUrl) throw new Error('missing server/ui fixtures');

    const browserDiagnostics = collectBrowserDiagnostics({ page });

    let runDaemon: StartedDaemon | null = null;
    try {
      await page.setViewportSize({ width: 1920, height: 900 });
      await gotoDomContentLoadedWithRetries(page, uiBaseUrl);
      await waitForInitialAppUi({ page, browserDiagnostics });

      await ensureAccountReadyForConnect({ page, timeoutMs: 120_000 });

      const testDir = resolve(join(suiteDir, 't1-review-scroll'));
      await mkdir(testDir, { recursive: true });

      const fakeClaudeLogPath = resolve(join(testDir, 'fake-claude.jsonl'));
      const fakeClaudePath = fakeClaudeFixturePath();

      runDaemon = await authenticateAndStartDaemon({
        page,
        testDir,
        cliHomeDir,
        serverUrl: server.baseUrl,
        uiBaseUrl,
        extraEnv: {
          HOME: cliHomeDir,
          // Machine-scoped RPC (used as a fallback when a newly-spawned session has no encryption context yet)
          // must be allowed to read the repo fixture directory.
          HAPPIER_MACHINE_RPC_WORKING_DIRECTORY: testDir,
          HAPPIER_CLAUDE_PATH: fakeClaudePath,
          HAPPIER_E2E_FAKE_CLAUDE_LOG: fakeClaudeLogPath,
          HAPPIER_E2E_FAKE_CLAUDE_SESSION_ID: `fake-claude-session-${run.runId}`,
          HAPPIER_E2E_FAKE_CLAUDE_INVOCATION_ID: `fake-claude-invocation-${run.runId}`,
        },
      });
      daemon = runDaemon;

      const repoDir = resolve(join(testDir, 'repo'));
      await createGitRepoWithChanges({ repoDir, fileCount: 100 });

      execGit(repoDir, ['branch', '-m', 'rail-tooltip-fixture']);

      const sessionId = await spawnSessionFromDaemon({ daemon: runDaemon, directory: repoDir });
      const sessionUrl = `${uiBaseUrl}/session/${sessionId}`;

      await mutateUiE2eScopedAccountSettings({ page, experiments: true, featureToggles: { 'terminal.embeddedPty': true } });
      await mutateUiE2eLocalSettings({ page, settingsPatch: { themePreference: 'light', embeddedTerminalDockLocation: 'bottom', uiContentWidthMode: 'compact', uiFontScale: 1.5, devModeEnabled: false } });
      await page.goto(sessionUrl, { waitUntil: 'domcontentloaded' });
      const rail = page.getByTestId('session-action-rail');
      const review = page.getByTestId('session-action-rail:review');
      const files = page.getByTestId('session-action-rail:files');
      await expect(rail).toBeVisible({ timeout: 180_000 });
      await expect(rail).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      for (const edge of ['top', 'right', 'bottom', 'left']) {
        await expect(rail).toHaveCSS(`border-${edge}-width`, '0px');
      }
      await expect(page.getByTestId('session-header-right-sidebar-button')).toHaveCount(0);
      for (const action of ['subagents', 'transcript-navigation', 'terminal']) {
        await expect(page.getByTestId(`session-header-${action}-button`)).toHaveCount(0);
      }
      await expect(page.getByTestId('session-action-rail:agents')).toBeVisible();
      await expect(page.getByTestId('session-action-rail:navigation')).toBeVisible();
      await expect(page.getByTestId('session-action-rail:terminal')).toBeVisible();
      // These live dimensions prove the current rail bundle is loaded and its targets remain compact.
      expect((await rail.boundingBox())?.width).toBe(44);
      expect((await review.boundingBox())?.width).toBe(36);
      expect((await review.boundingBox())?.height).toBe(36);
      expect((await review.locator('svg').boundingBox())?.width).toBe(18);
      await expect(rightPaneLocator(page)).toHaveCount(0);
      await expect(detailsPaneLocator(page)).toHaveCount(0);
      const composer = page.getByTestId('session-composer-input');
      const prompt = `action rail alignment ${run.runId}`;
      await composer.fill(prompt);
      const send = page.getByTestId('session-composer-send');
      await expect(send).toBeEnabled({ timeout: 60_000 });
      await send.click();
      await expect(page.getByText('FAKE_CLAUDE_OK_1').first()).toBeVisible({ timeout: 180_000 });
      await expect(page.locator('[data-testid^="transcript-message-"]').first()).toBeVisible({ timeout: 60_000 });

      await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(uiBaseUrl).origin });
      await page.getByTestId('session-header-action-menu-trigger').click();
      const pinAction = page.getByTestId('dropdown-option-ui_session_pin');
      await expect(pinAction).toBeVisible();
      await pinAction.click();
      await page.goto(uiBaseUrl, { waitUntil: 'domcontentloaded' });
      await waitForInitialAppUi({ page, browserDiagnostics });
      await expect(page.getByTestId('session-list-header:pinned-v1')).toBeVisible({ timeout: 60_000 });
      await page.goto(sessionUrl, { waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('session-header-action-menu-trigger')).toBeVisible({ timeout: 60_000 });
      await page.getByTestId('session-header-action-menu-trigger').click();
      await expect(page.getByTestId('dropdown-option-ui_session_unpin')).toBeVisible();
      await page.getByTestId('dropdown-option-session_copyDebugInformation').click();
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain(`Happier session ID: ${sessionId}`);

      await test.step('stored message timestamps stay visible and accessible in compact large text', async () => {
        await page.setViewportSize({ width: 390, height: 844 });
        const userMessage = page.locator('[data-testid^="transcript-message-"]').filter({ hasText: prompt }).first();
        const assistantMessage = page.locator('[data-testid^="transcript-message-"]').filter({ hasText: 'FAKE_CLAUDE_OK_1' }).first();
        await expect(userMessage).toBeVisible();
        await expect(assistantMessage).toBeVisible();

        const userTestId = await userMessage.getAttribute('data-testid');
        const assistantTestId = await assistantMessage.getAttribute('data-testid');
        if (!userTestId || !assistantTestId) throw new Error('missing transcript message test id');
        const userMessageId = userTestId.replace(/^transcript-message-/, '');
        const assistantMessageId = assistantTestId.replace(/^transcript-message-/, '');
        const userTimestamp = page.getByTestId(`transcript-message-timestamp:${userMessageId}`);
        const assistantTimestamp = page.getByTestId(`transcript-message-timestamp:${assistantMessageId}`);
        const userActionSlot = page.getByTestId(`transcript-message-actions:${userMessageId}`);

        await expect(userTimestamp).toBeVisible();
        await expect(assistantTimestamp).toBeVisible();
        await expect(userActionSlot).toHaveCSS('opacity', '0');
        const userTimestampText = await page.getByTestId(`transcript-message-timestamp-text:${userMessageId}`).innerText();
        const assistantTimestampText = await page.getByTestId(`transcript-message-timestamp-text:${assistantMessageId}`).innerText();
        expect(userTimestampText).not.toBe('');
        expect(assistantTimestampText).not.toBe('');
        await expect(userTimestamp).toHaveAttribute('aria-label', userTimestampText);

        await userTimestamp.hover();
        const userTimestampTooltip = page.getByRole('tooltip').filter({ hasText: userTimestampText });
        await expect(userTimestampTooltip).toBeVisible();
        await page.mouse.move(0, 0);
        await page.keyboard.press('Tab');
        await userTimestamp.focus();
        await expect(userTimestampTooltip).toBeVisible();

        const userTimestampBox = await userTimestamp.boundingBox();
        const assistantTimestampBox = await assistantTimestamp.boundingBox();
        expect(userTimestampBox?.width).toBeGreaterThan(0);
        expect(userTimestampBox?.height).toBeGreaterThan(0);
        expect(assistantTimestampBox?.width).toBeGreaterThan(0);
        expect(assistantTimestampBox?.height).toBeGreaterThan(0);
        await testInfo.attach('stored-message-timestamps', {
          body: JSON.stringify({ userTimestampText, assistantTimestampText, transcriptRowId: userMessageId, viewport: { width: 390, height: 844 }, uiFontScale: 1.5 }),
          contentType: 'application/json',
        });

        await userTimestamp.blur();
        await page.mouse.move(0, 0);
        await page.screenshot({ path: testInfo.outputPath('message-timestamps-compact-large-text.png') });
        const storedMessagesResponse = page.waitForResponse((response) => {
          const url = new URL(response.url());
          return response.request().method() === 'GET'
            && url.pathname === `/v1/sessions/${sessionId}/messages`
            && response.ok();
        });
        await page.reload({ waitUntil: 'domcontentloaded' });
        await waitForInitialAppUi({ page, browserDiagnostics });
        const storedMessages = readSessionMessageTimestampRecords(await (await storedMessagesResponse).json());
        // Transcript row ids are reducer-local; the server response has the
        // durable ids. This fixture sends one user message and receives one
        // assistant message, so each role identifies the exact stored row.
        const storedUserMessages = storedMessages.filter((message) => message.messageRole === 'user');
        const storedAssistantMessages = storedMessages.filter((message) => message.messageRole === 'agent');
        if (storedUserMessages.length !== 1 || storedAssistantMessages.length !== 1) {
          throw new Error(`expected one stored user and assistant message, got ${storedUserMessages.length} and ${storedAssistantMessages.length}`);
        }
        const [storedUserMessage] = storedUserMessages;
        const [storedAssistantMessage] = storedAssistantMessages;
        expect(userTimestampText).toBe(await formatStoredMessageTimestamp(page, storedUserMessage.createdAt));
        expect(assistantTimestampText).toBe(await formatStoredMessageTimestamp(page, storedAssistantMessage.createdAt));
        await expect(page.getByText(prompt, { exact: true })).toBeVisible({ timeout: 60_000 });
        await expect(page.getByText('FAKE_CLAUDE_OK_1', { exact: true })).toBeVisible({ timeout: 60_000 });
        const reloadedUserTestId = await page.locator('[data-testid^="transcript-message-"]').filter({ hasText: prompt }).first().getAttribute('data-testid');
        const reloadedAssistantTestId = await page.locator('[data-testid^="transcript-message-"]').filter({ hasText: 'FAKE_CLAUDE_OK_1' }).first().getAttribute('data-testid');
        if (!reloadedUserTestId || !reloadedAssistantTestId) throw new Error('missing reloaded transcript message test id');
        const reloadedUserMessageId = reloadedUserTestId.replace(/^transcript-message-/, '');
        const reloadedAssistantMessageId = reloadedAssistantTestId.replace(/^transcript-message-/, '');
        await expect(page.getByTestId(`transcript-message-timestamp-text:${reloadedUserMessageId}`)).toHaveText(userTimestampText);
        await expect(page.getByTestId(`transcript-message-timestamp-text:${reloadedAssistantMessageId}`)).toHaveText(assistantTimestampText);
        await page.setViewportSize({ width: 1920, height: 900 });
      });

      const measureHeaderAlignment = async () => page.evaluate(() => {
        const avatar = document.querySelector('[data-testid="session-header-avatar"]')!;
        const info = document.querySelector('[data-testid="session-header-info-button"]')!;
        const headerRow = avatar.parentElement!;
        const wrapper = headerRow.parentElement!;
        const candidates = Array.from(document.querySelectorAll('[data-testid^="transcript-message-"] div'));
        const cappedRow = candidates.find((node) => {
          const style = getComputedStyle(node);
          return style.maxWidth === '850px' && node.getBoundingClientRect().width > 0;
        });
        if (!cappedRow) throw new Error('missing visible width-capped transcript row');
        const row = cappedRow.getBoundingClientRect();
        const outer = wrapper.getBoundingClientRect();
        const avatarRect = avatar.getBoundingClientRect();
        const infoRect = info.getBoundingClientRect();
        return { avatarLeft: avatarRect.left, transcriptLeft: row.left + 16,
          actionsRight: infoRect.right, originalActionsRight: outer.right - Math.max(0, (outer.width - 850) / 2) - 16,
          outerWidth: outer.width, rowWidth: row.width };
      });
      await expect.poll(async () => {
        const geometry = await measureHeaderAlignment();
        return Math.abs(geometry.avatarLeft - geometry.transcriptLeft);
      }).toBeLessThanOrEqual(1);
      const wideHeaderGeometry = await measureHeaderAlignment();
      expect(Math.abs(wideHeaderGeometry.actionsRight - wideHeaderGeometry.originalActionsRight)).toBeLessThanOrEqual(1);
      await testInfo.attach('closed-pane-header-geometry', { body: JSON.stringify(wideHeaderGeometry), contentType: 'application/json' });
      await page.screenshot({ path: testInfo.outputPath('rail-closed-header-alignment.png') });
      await review.click();
      await expect(detailsPaneLocator(page)).toBeVisible();
      await expect(rightPaneLocator(page)).toHaveCount(0);
      const reviewTab = page.getByTestId(`session-details-tab-${toTestIdSafeValue('scmReview:working')}`);
      await expect(reviewTab).toBeVisible();
      await review.click();
      await expect(detailsPaneLocator(page)).toHaveCount(0);
      await review.click();
      await expect(reviewTab).toBeVisible();
      await test.step('Review content loads without opening the sidebar', async () => {
        await expect(page.getByTestId('scm-review-list')).toBeVisible({ timeout: resolveUiWebScriptFetchTotalTimeoutMs(process.env) });
        await expect(rightPaneLocator(page)).toHaveCount(0);
      });
      await files.click();
      await expect(rightPaneLocator(page)).toBeVisible();
      await expect(detailsPaneLocator(page)).toBeVisible();
      await expect(page.getByTestId('session-rightpanel-close')).toHaveCount(0);
      // Badge stays compact while the tooltip exposes all 101 tracked changed files.
      await expect(page.getByTestId('session-action-rail:git:badge')).toHaveText('99+', { timeout: 60_000 });
      const gitAction = page.getByTestId('session-action-rail:git');
      await gitAction.hover();
      const gitTooltip = page.getByTestId('session-action-rail:git-tooltip');
      await expect(gitTooltip).toBeVisible();
      const changedCount = gitTooltip.getByText('Changed files: 101', { exact: true });
      const addedLines = gitTooltip.getByText('+460', { exact: true });
      const removedLines = gitTooltip.getByText('−240', { exact: true });
      const branch = gitTooltip.getByText('Branch: rail-tooltip-fixture', { exact: true });
      await expect(changedCount).toBeVisible();
      await expect(addedLines).toBeVisible();
      await expect(removedLines).toBeVisible();
      await expect(branch).toBeVisible();
      const countBox = (await changedCount.boundingBox())!;
      const addedBox = (await addedLines.boundingBox())!;
      const branchBox = (await branch.boundingBox())!;
      expect(addedBox.y).toBeGreaterThanOrEqual(countBox.y + countBox.height);
      expect(branchBox.y).toBeGreaterThanOrEqual(addedBox.y + addedBox.height);
      const addedColor = await addedLines.evaluate((node) => getComputedStyle(node).color);
      const removedColor = await removedLines.evaluate((node) => getComputedStyle(node).color);
      expect(addedColor).not.toBe(removedColor);
      expect(addedColor).not.toBe(await changedCount.evaluate((node) => getComputedStyle(node).color));
      await page.screenshot({ path: testInfo.outputPath('git-rich-tooltip-hover.png') });
      await page.mouse.move(0, 0);
      await files.focus();
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Shift+Tab');
      await expect(gitAction).toBeFocused();
      await expect(branch).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath('git-rich-tooltip-keyboard.png') });
      await gitAction.blur();
      await page.mouse.move(0, 0);
      await review.blur();
      await expect(review).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      const activeMarker = review.locator('div').filter({ hasNot: page.locator('svg') });
      expect(await activeMarker.evaluateAll((nodes) => nodes.some((node) => {
        const style = getComputedStyle(node);
        return style.position === 'absolute' && style.width === '2px' && style.backgroundColor !== 'rgba(0, 0, 0, 0)';
      }))).toBe(true);
      await page.screenshot({ path: testInfo.outputPath('rail-light-wide.png') });
      await review.hover();
      await expect(review).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      const tooltip = page.getByRole('tooltip');
      await expect(tooltip).toBeVisible();
      const tooltipBox = await tooltip.boundingBox();
      const reviewBox = await review.boundingBox();
      expect(tooltipBox!.x + tooltipBox!.width).toBeLessThanOrEqual(reviewBox!.x);
      expect(reviewBox!.x - tooltipBox!.x - tooltipBox!.width).toBeLessThanOrEqual(12);
      await page.screenshot({ path: testInfo.outputPath('rail-tooltip.png') });
      await review.focus();
      await expect(review).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(files).toBeFocused();
      await page.screenshot({ path: testInfo.outputPath('rail-keyboard-focus.png') });
      const terminal = page.getByTestId('session-action-rail:terminal');
      await expect(terminal).toBeVisible();
      await terminal.click();
      await expect(page.getByTestId('multi-pane-bottom-dock')).toBeVisible();
      await terminal.click();
      await expect(page.getByTestId('multi-pane-bottom-dock')).toHaveCount(0);
      await mutateUiE2eLocalSettings({ page, settingsPatch: { themePreference: 'dark' } });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(rail).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId('scm-review-list')).toBeVisible({ timeout: resolveUiWebScriptFetchTotalTimeoutMs(process.env) });
      await expect(page.getByTestId('repository-tree-row-src')).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath('rail-dark-wide.png') });
      await review.click();
      await expect(detailsPaneLocator(page)).toHaveCount(0);
      await page.setViewportSize({ width: 900, height: 900 });
      await expect(rail).toBeVisible();
      await page.getByTestId('session-action-rail:git').click();
      await review.click();
      await expect(page.getByTestId('multi-pane-details-overlay')).toBeVisible();
      // The host parks the right pane mounted to preserve its state while Review occludes it.
      await expect(page.getByTestId('multi-pane-right-overlay').locator('..')).toHaveCSS('opacity', '0');
      await files.click();
      await expect(detailsPaneLocator(page)).toHaveCount(0);
      await expect(rightPaneLocator(page)).toBeVisible();
      await expect(page.getByTestId('repository-tree-row-src')).toBeVisible({ timeout: 60_000 });
      await page.screenshot({ path: testInfo.outputPath('rail-narrow-files.png') });
      await mutateUiE2eLocalSettings({ page, settingsPatch: { embeddedTerminalDockLocation: 'sidebar' } });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(terminal).toBeVisible({ timeout: 60_000 });
      await terminal.click();
      await expect(rightPaneLocator(page)).toBeVisible();
      await review.click();
      await expect(page.getByTestId('multi-pane-details-overlay')).toBeVisible();
      // The host parks the right pane mounted to preserve its state while Review occludes it.
      await expect(page.getByTestId('multi-pane-right-overlay').locator('..')).toHaveCSS('opacity', '0');
      await terminal.click();
      await expect(detailsPaneLocator(page)).toHaveCount(0);
      await expect(rightPaneLocator(page)).toBeVisible();
      await review.click();
      await expect(reviewTab).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath('rail-narrow-review.png') });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(sessionUrl, { waitUntil: 'domcontentloaded' });
      const mobileBar = page.getByTestId(`session-cockpit-tabbar-${sessionId}`);
      await expect(mobileBar).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId('session-header-terminal-button')).toHaveCount(0);
      await expect(page.getByTestId('session-cockpit-tab-terminal')).toBeVisible();
      const mobileTabs = mobileBar.getByRole('tab');
      expect(await mobileTabs.count()).toBeGreaterThanOrEqual(5);
      const mobileBoxes = await mobileTabs.evaluateAll((tabs) => tabs.map((tab) => {
        const rect = tab.getBoundingClientRect();
        return { x: rect.x, width: rect.width };
      }));
      for (const [index, box] of mobileBoxes.entries()) {
        expect(box.width).toBeGreaterThanOrEqual(44);
        if (index > 0) {
          const previous = mobileBoxes[index - 1]!;
          expect(Math.abs(box.x - previous.x - previous.width)).toBeLessThanOrEqual(1);
        }
      }
      await page.screenshot({ path: testInfo.outputPath('mobile-cockpit-spacing.png') });
      await mutateUiE2eScopedAccountSettings({ page, settingsPatch: { mobileWorkspaceExperienceV1: 'classic' } });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('session-header-terminal-button')).toBeVisible({ timeout: 60_000 });
      await expect(mobileBar).toHaveCount(0);
      await page.screenshot({ path: testInfo.outputPath('mobile-classic-header-fallback.png') });
    } catch (error) {
      throw appendBrowserDiagnostics(error, browserDiagnostics());
    } finally {
      await runDaemon?.stop().catch(() => {});
      if (daemon === runDaemon) daemon = null;
    }
  });
});
