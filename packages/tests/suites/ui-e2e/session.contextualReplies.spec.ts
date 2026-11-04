import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { test, expect, type Page } from '@playwright/test';
import type { Request } from '@playwright/test';
import { SESSION_RPC_METHODS } from '@happier-dev/protocol/rpc';

import { createRunDirs } from '../../src/testkit/runDir';
import { startServerLight, type StartedServer } from '../../src/testkit/process/serverLight';
import { resolveUiWebBeforeAllTimeoutMs, startUiWeb, type StartedUiWeb } from '../../src/testkit/process/uiWeb';
import { type StartedDaemon } from '../../src/testkit/daemon/daemon';
import { createSessionFromNewSessionComposer, reloadCreatedSessionFromNewSessionComposer } from '../../src/testkit/uiE2e/createSessionFromNewSessionComposer';
import { fakeClaudeEchoResponseText, fakeClaudeEchoResponseTextFromSha256, fakeClaudeFixturePath, readFakeClaudeLogEvents } from '../../src/testkit/fakeClaude';
import { gotoDomContentLoadedWithRetries, normalizeLoopbackBaseUrl } from '../../src/testkit/uiE2e/pageNavigation';
import { ensureAccountReadyForConnect } from '../../src/testkit/uiE2e/ensureAccountReadyForConnect';
import { authenticateAndStartDaemon } from '../../src/testkit/uiE2e/authenticateAndStartDaemon';
import { waitForDaemonMachineIdFromCliSettings } from '../../src/testkit/uiE2e/daemonMachineId';
import { appendBrowserDiagnostics, collectBrowserDiagnostics } from '../../src/testkit/uiE2e/browserDiagnostics';

const run = createRunDirs({ runLabel: 'ui-e2e' });

type MessageReplyTarget = Readonly<{
  sessionId: string;
  messageId: string;
  role: 'user' | 'assistant';
  seq?: number;
  transcriptBlockIndex?: number;
}>;

function parseReplyTargetFromSessionRpcFrame(frame: string): MessageReplyTarget | null {
  if (!frame.startsWith('42')) return null;
  try {
    const arrayStart = frame.indexOf('[');
    if (arrayStart < 0) return null;
    const socketEvent: unknown = JSON.parse(frame.slice(arrayStart));
    if (!Array.isArray(socketEvent)) return null;
    let meta: unknown = null;
    if (socketEvent[0] === 'rpc-call') {
      const call = socketEvent[1];
      if (!call || typeof call !== 'object' || Array.isArray(call)) return null;
      const record = call as Record<string, unknown>;
      if (typeof record.method !== 'string' || !record.method.endsWith(`:${SESSION_RPC_METHODS.SESSION_USER_MESSAGE_SEND}`)) return null;
      const params = record.params;
      if (!params || typeof params !== 'object' || Array.isArray(params)) return null;
      meta = (params as Record<string, unknown>).meta;
    } else if (socketEvent[0] === 'message') {
      const messagePayload = socketEvent[1];
      if (!messagePayload || typeof messagePayload !== 'object' || Array.isArray(messagePayload)) return null;
      const messageRecord = messagePayload as Record<string, unknown>;
      const message = messageRecord.message;
      if (!message || typeof message !== 'object' || Array.isArray(message)) return null;
      const messageRecordValue = message as Record<string, unknown>;
      const value = messageRecordValue.v;
      if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
      if (messageRecordValue.t !== 'plain') return null;
      meta = (value as Record<string, unknown>).meta;
    } else {
      return null;
    }
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;
    const candidate = (meta as Record<string, unknown>).happierMessageReplyV1;
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
    const target = candidate as Record<string, unknown>;
    if (typeof target.sessionId !== 'string' || typeof target.messageId !== 'string'
      || (target.role !== 'user' && target.role !== 'assistant')) return null;
    return {
      sessionId: target.sessionId,
      messageId: target.messageId,
      role: target.role,
      ...(typeof target.seq === 'number' ? { seq: target.seq } : {}),
      ...(typeof target.transcriptBlockIndex === 'number' ? { transcriptBlockIndex: target.transcriptBlockIndex } : {}),
    };
  } catch {
    return null;
  }
}

function parseReplyTargetFromPlainHttpRequest(request: Request): MessageReplyTarget | null {
  const pathname = new URL(request.url()).pathname;
  if (request.method() !== 'POST' || !(/\/messages$|\/pending$/u).test(pathname)) return null;
  try {
    const body = request.postDataJSON() as { content?: { t?: unknown; v?: unknown } };
    if (body.content?.t !== 'plain' || !body.content.v || typeof body.content.v !== 'object' || Array.isArray(body.content.v)) return null;
    const meta = (body.content.v as Record<string, unknown>).meta;
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;
    const candidate = (meta as Record<string, unknown>).happierMessageReplyV1;
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
    const target = candidate as Record<string, unknown>;
    if (typeof target.sessionId !== 'string' || typeof target.messageId !== 'string'
      || (target.role !== 'user' && target.role !== 'assistant')) return null;
    return {
      sessionId: target.sessionId,
      messageId: target.messageId,
      role: target.role,
      ...(typeof target.seq === 'number' ? { seq: target.seq } : {}),
      ...(typeof target.transcriptBlockIndex === 'number' ? { transcriptBlockIndex: target.transcriptBlockIndex } : {}),
    };
  } catch {
    return null;
  }
}

async function selectThemePreference(page: Page, uiBaseUrl: string, preference: 'dark' | 'light'): Promise<void> {
  await gotoDomContentLoadedWithRetries(page, `${uiBaseUrl}/settings/appearance?happier_hmr=0`, 180_000);
  await page.getByTestId('settings-theme-selector-trigger').click();
  const option = page.getByTestId(`dropdown-option-${preference}`);
  await expect(option).toBeVisible({ timeout: 30_000 });
  await option.click();
  await expect.poll(() => page.evaluate(() => {
    const raw = window.localStorage.getItem('mmkv.default\\local-settings');
    return raw ? (JSON.parse(raw) as Record<string, unknown>).themePreference : null;
  })).toBe(preference);
}

test.describe('ui e2e: contextual message replies', () => {
  test.describe.configure({ mode: 'serial' });

  const suiteDir = run.testDir('session-contextual-replies-suite');
  const cliHomeDir = resolve(join(suiteDir, 'cli-home'));

  let server: StartedServer | null = null;
  let ui: StartedUiWeb | null = null;
  let uiBaseUrl: string | null = null;
  let daemon: StartedDaemon | null = null;

  test.beforeAll(async () => {
    test.setTimeout(resolveUiWebBeforeAllTimeoutMs(process.env));
    await mkdir(cliHomeDir, { recursive: true });
    await writeFile(resolve(join(cliHomeDir, 'AGENTS.md')), '# UI e2e fixture\n', 'utf8');

    server = await startServerLight({
      testDir: suiteDir,
      dbProvider: 'sqlite',
      extraEnv: {
        HAPPIER_BUILD_FEATURES_DENY: 'sharing.contentKeys,providers.claude.unifiedTerminal',
        HAPPIER_FEATURE_AUTH_LOGIN__KEY_CHALLENGE_ENABLED: '1',
        HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY: 'optional',
        HAPPIER_FEATURE_ENCRYPTION__DEFAULT_ACCOUNT_MODE: 'plain',
      },
    });

    ui = await startUiWeb({
      testDir: suiteDir,
      env: {
        ...process.env,
        EXPO_PUBLIC_DEBUG: '1',
        EXPO_PUBLIC_HAPPY_SERVER_URL: server.baseUrl,
        EXPO_PUBLIC_HAPPY_STORAGE_SCOPE: `e2e-${run.runId}`,
        EXPO_PUBLIC_HAPPIER_SOCKET_FORCE_WEBSOCKET: '1',
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

  test('replies to the selected older message with its complete identity and source in agent input', async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    if (!server || !uiBaseUrl) throw new Error('missing server/ui fixtures');
    const browserDiagnostics = collectBrowserDiagnostics({ page });
    const observedReply: { target: MessageReplyTarget | null } = { target: null };

    page.on('websocket', (socket) => {
      if (new URL(socket.url()).pathname !== '/v1/updates/') return;
      socket.on('framesent', ({ payload }) => {
        const frame = typeof payload === 'string' ? payload : Buffer.isBuffer(payload) ? payload.toString('utf8') : null;
        if (!frame) return;
        const target = parseReplyTargetFromSessionRpcFrame(frame);
        if (target) observedReply.target = target;
      });
    });
    page.on('request', (request) => {
      const target = parseReplyTargetFromPlainHttpRequest(request);
      if (target) observedReply.target = target;
    });

    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await gotoDomContentLoadedWithRetries(page, uiBaseUrl);
      await ensureAccountReadyForConnect({ page, timeoutMs: 120_000 });
      await selectThemePreference(page, uiBaseUrl, 'dark');

      const testDir = resolve(join(suiteDir, 't1-contextual-reply'));
      await mkdir(testDir, { recursive: true });
      const fakeClaudeLogPath = resolve(join(testDir, 'fake-claude.jsonl'));

      daemon = await authenticateAndStartDaemon({
        page,
        testDir,
        cliHomeDir,
        serverUrl: server.baseUrl,
        uiBaseUrl,
        extraEnv: {
          ...process.env,
          HOME: cliHomeDir,
          HAPPIER_CLAUDE_PATH: fakeClaudeFixturePath(),
          HAPPIER_E2E_FAKE_CLAUDE_LOG: fakeClaudeLogPath,
          HAPPIER_E2E_FAKE_CLAUDE_SCENARIO: 'echo-user-text',
          HAPPIER_E2E_FAKE_CLAUDE_SESSION_ID: `fake-claude-session-${run.runId}`,
          HAPPIER_E2E_FAKE_CLAUDE_INVOCATION_ID: `fake-claude-invocation-${run.runId}`,
        },
      });

      const machineId = await waitForDaemonMachineIdFromCliSettings({ cliHomeDir, timeoutMs: 120_000 });
      const longSourceText = `OH76_SOURCE_${run.runId} ` + 'The earlier design decision described the blue cedar workspace, its preserved branches, and its tested deployment boundary. '.repeat(14).trimEnd();
      const latestSimilarText = `OH76_LATEST_${run.runId}: The later note also describes the blue cedar workspace, preserved branches, and deployment boundary.`;
      const sourceResponse = fakeClaudeEchoResponseText(longSourceText);
      const latestResponse = fakeClaudeEchoResponseText(latestSimilarText);
      // Preview excerpts are readable Markdown text; transcript/provider assertions below
      // still use the exact raw fixtures. These are explicit golden values for these markers.
      const sourceExcerpt = longSourceText.replace('OH76_SOURCE_', 'OH76SOURCE');
      const latestExcerpt = latestSimilarText.replace('OH76_LATEST_', 'OH76LATEST');
      const assistantExcerpt = latestResponse.replace('FAKE_CLAUDE_ECHO_', 'FAKECLAUDEECHO_');

      const session = await createSessionFromNewSessionComposer({
        page,
        uiBaseUrl,
        machineId,
        prompt: longSourceText,
        readiness: 'first-turn-reload-safe',
      });
      await reloadCreatedSessionFromNewSessionComposer({ page, session });
      await expect(page.getByText(sourceResponse, { exact: true })).toHaveCount(1, { timeout: 180_000 });

      const sourceMessage = page.locator('[data-testid^="transcript-message-"]')
        .filter({ hasText: `OH76_SOURCE_${run.runId}` }).first();
      await expect(sourceMessage).toHaveCount(1, { timeout: 60_000 });
      const sourceTestId = await sourceMessage.getAttribute('data-testid');
      if (!sourceTestId?.startsWith('transcript-message-')) throw new Error('missing source message test id');
      let sourceMessageId = sourceTestId.slice('transcript-message-'.length);

      const latestPrompt = page.locator('textarea[data-testid="session-composer-input"]:visible');
      await latestPrompt.fill(latestSimilarText);
      const send = page.getByTestId('session-composer-send');
      await expect(send).toBeEnabled();
      await send.click();
      await expect(page.getByText(latestResponse, { exact: true })).toHaveCount(1, { timeout: 180_000 });

      const latestAssistantMessage = page.locator('[data-testid^="transcript-message-"]')
        .filter({ hasText: latestResponse }).first();
      await expect(latestAssistantMessage).toHaveCount(1, { timeout: 60_000 });
      await latestAssistantMessage.hover();
      const assistantTestId = await latestAssistantMessage.getAttribute('data-testid');
      if (!assistantTestId?.startsWith('transcript-message-')) throw new Error('missing assistant message test id');
      let assistantMessageId = assistantTestId.slice('transcript-message-'.length);
      const assistantReply = page.getByTestId(`transcript-message-reply:${assistantMessageId}`);
      await expect(assistantReply).toHaveCount(1);
      await expect(assistantReply).toHaveAttribute('aria-label', /.+/);

      const draft = `OH76_DRAFT_${run.runId}: explain the original decision`;
      await latestPrompt.fill(draft);
      await sourceMessage.hover();
      const sourceReply = page.getByTestId(`transcript-message-reply:${sourceMessageId}`);
      await expect(sourceReply).toHaveCount(1);
      await expect(sourceReply).toHaveAttribute('aria-label', /.+/);
      await sourceReply.click();

      const composer = page.locator('textarea[data-testid="session-composer-input"]:visible');
      await expect(composer).toBeFocused();
      await expect(composer).toHaveValue(draft);
      const replyPreview = page.getByTestId('session-composer-reply-preview');
      await expect(replyPreview).toBeVisible();
      const previewAuthor = page.getByTestId('session-composer-reply-preview-author');
      const previewExcerpt = page.getByTestId('session-composer-reply-preview-excerpt');
      await expect(previewAuthor).toContainText('Replying to');
      await expect(previewExcerpt).toHaveText(sourceExcerpt);
      const previewMetrics = await previewExcerpt.evaluate((element) => {
        const renderedBounds = element.getBoundingClientRect();
        const clone = element.cloneNode(true) as HTMLElement;
        clone.style.position = 'fixed';
        clone.style.visibility = 'hidden';
        clone.style.display = 'block';
        clone.style.width = `${renderedBounds.width}px`;
        clone.style.height = 'auto';
        clone.style.maxHeight = 'none';
        clone.style.overflow = 'visible';
        clone.style.setProperty('-webkit-line-clamp', 'unset');
        clone.style.setProperty('-webkit-box-orient', 'initial');
        document.body.appendChild(clone);
        const naturalHeight = clone.getBoundingClientRect().height;
        clone.remove();
        let backgroundColor = '';
        let surface = element.parentElement;
        while (surface && surface !== document.body) {
          const candidate = getComputedStyle(surface).backgroundColor;
          if (candidate !== 'transparent' && candidate !== 'rgba(0, 0, 0, 0)') {
            backgroundColor = candidate;
            break;
          }
          surface = surface.parentElement;
        }
        return {
          text: element.textContent ?? '',
          renderedHeight: renderedBounds.height,
          naturalHeight,
          backgroundColor,
        };
      });
      expect(previewMetrics.text).toBe(sourceExcerpt);
      expect(previewMetrics.renderedHeight).toBeGreaterThan(0);
      expect(previewMetrics.naturalHeight).toBeGreaterThan(previewMetrics.renderedHeight * 2);
      const darkSurfaceChannels = previewMetrics.backgroundColor.match(/\d+(?:\.\d+)?/gu)?.slice(0, 3).map(Number);
      expect(darkSurfaceChannels).toHaveLength(3);
      expect(Math.max(...(darkSurfaceChannels ?? []))).toBeLessThan(180);

      await page.setViewportSize({ width: 390, height: 844 });
      await expect(replyPreview).toBeVisible();
      await expect(previewExcerpt).toHaveText(sourceExcerpt);
      await expect(composer).toHaveValue(draft);
      await page.screenshot({ path: testInfo.outputPath('reply-preview-mobile-dark.png') });

      // Capture the same composed preview in the other real app theme. Theme changes route through
      // Appearance, so reopen the session and select the source again after its view remounts.
      await selectThemePreference(page, uiBaseUrl, 'light');
      const transcriptResponsePromise = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return response.request().method() === 'GET'
          && url.pathname === `/v1/sessions/${encodeURIComponent(session.sessionId)}/messages`
          && response.status() === 200;
      }, { timeout: 60_000 });
      await gotoDomContentLoadedWithRetries(page, `${uiBaseUrl}/session/${encodeURIComponent(session.sessionId)}?happier_hmr=0`, 180_000);
      const transcriptResponse = await transcriptResponsePromise;
      const transcriptPayload = await transcriptResponse.json() as {
        messages?: Array<{ id?: unknown; seq?: unknown; messageRole?: unknown; content?: unknown }>;
      };
      const transcriptRows = transcriptPayload.messages ?? [];
      const serializedSourceText = (row: { content?: unknown }) => JSON.stringify(row.content ?? null);
      const sourceRecord = transcriptRows.find((row) => serializedSourceText(row).includes(longSourceText));
      const latestAssistantRecord = transcriptRows.find((row) => serializedSourceText(row).includes(latestResponse));
      if (typeof sourceRecord?.id !== 'string' || typeof sourceRecord.seq !== 'number') {
        throw new Error('reloaded transcript response did not include the raw source message record');
      }
      if (typeof latestAssistantRecord?.seq !== 'number') {
        throw new Error('reloaded transcript response did not include the latest assistant record');
      }
      const stableSourceMessageId = `server:${sourceRecord.id}`;
      expect(sourceRecord.content).toMatchObject({ t: 'plain' });
      expect(sourceRecord.messageRole).toBe('user');
      expect(sourceRecord.seq).toBeLessThan(latestAssistantRecord.seq);
      await expect(sourceMessage).toBeVisible({ timeout: 60_000 });
      await expect(composer).toHaveValue(draft);
      const reloadedSourceTestId = await sourceMessage.getAttribute('data-testid');
      if (!reloadedSourceTestId?.startsWith('transcript-message-')) throw new Error('missing reloaded source message test id');
      sourceMessageId = reloadedSourceTestId.slice('transcript-message-'.length);
      await sourceMessage.hover();
      await page.getByTestId(`transcript-message-reply:${sourceMessageId}`).click();
      await expect(replyPreview).toBeVisible();
      const lightPreviewColor = await previewExcerpt.evaluate((element) => {
        let surface = element.parentElement;
        while (surface && surface !== document.body) {
          const candidate = getComputedStyle(surface).backgroundColor;
          if (candidate !== 'transparent' && candidate !== 'rgba(0, 0, 0, 0)') return candidate;
          surface = surface.parentElement;
        }
        return '';
      });
      const lightSurfaceChannels = lightPreviewColor.match(/\d+(?:\.\d+)?/gu)?.slice(0, 3).map(Number);
      expect(lightSurfaceChannels).toHaveLength(3);
      expect(Math.min(...(lightSurfaceChannels ?? []))).toBeGreaterThan(180);
      await page.screenshot({ path: testInfo.outputPath('reply-preview-mobile-light.png') });

      // Replacing the source with an assistant message keeps the draft intact; cancel also only clears the target.
      const reloadedAssistantTestId = await latestAssistantMessage.getAttribute('data-testid');
      if (!reloadedAssistantTestId?.startsWith('transcript-message-')) throw new Error('missing reloaded assistant message test id');
      assistantMessageId = reloadedAssistantTestId.slice('transcript-message-'.length);
      await latestAssistantMessage.hover();
      await page.getByTestId(`transcript-message-reply:${assistantMessageId}`).click();
      await expect(previewExcerpt).toHaveText(assistantExcerpt);
      await expect(page.getByTestId('session-composer-reply-preview-author')).toContainText(/assistant/i);
      await expect(composer).toHaveValue(draft);
      await page.getByTestId('session-composer-reply-cancel').click();
      await expect(replyPreview).toHaveCount(0);
      await expect(composer).toHaveValue(draft);

      await sourceMessage.hover();
      await page.getByTestId(`transcript-message-reply:${sourceMessageId}`).click();
      await expect(replyPreview).toBeVisible();

      await expect(send).toBeEnabled();
      await send.click();

      await expect.poll(() => observedReply.target, { timeout: 60_000 }).not.toBeNull();
      const replyTarget = observedReply.target;
      if (!replyTarget) throw new Error('reply submission did not carry source metadata');
      expect(replyTarget).toMatchObject({
        sessionId: session.sessionId,
        messageId: stableSourceMessageId,
        role: 'user',
        seq: sourceRecord.seq,
      });

      await expect(page.getByTestId('session-composer-reply-preview')).toHaveCount(0);
      await expect(composer).toHaveValue('');
      const sentMessage = page.locator('[data-testid^="transcript-message-"]')
        .filter({ hasText: draft }).first();
      await expect(sentMessage).toHaveCount(1, { timeout: 120_000 });
      const sentTestId = await sentMessage.getAttribute('data-testid');
      if (!sentTestId?.startsWith('transcript-message-')) throw new Error('missing sent message test id');
      const sentMessageId = sentTestId.slice('transcript-message-'.length);
      const sentRelationship = page.getByTestId(`transcript-message-reply-source:${sentMessageId}`);
      await expect(sentRelationship).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId(`transcript-message-reply-source:${sentMessageId}-excerpt`)).toHaveText(sourceExcerpt);
      await expect(sentRelationship).not.toContainText(latestExcerpt.slice(0, 32));

      // The sent relationship must resolve after transcript rehydration, when reducer IDs are regenerated.
      await gotoDomContentLoadedWithRetries(page, `${uiBaseUrl}/session/${encodeURIComponent(session.sessionId)}?happier_hmr=0`, 180_000);
      await expect(sentMessage).toHaveCount(1, { timeout: 60_000 });
      const reloadedSentTestId = await sentMessage.getAttribute('data-testid');
      if (!reloadedSentTestId?.startsWith('transcript-message-')) throw new Error('missing reloaded sent message test id');
      const reloadedSentMessageId = reloadedSentTestId.slice('transcript-message-'.length);
      const reloadedSentRelationship = page.getByTestId(`transcript-message-reply-source:${reloadedSentMessageId}`);
      await expect(reloadedSentRelationship).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId(`transcript-message-reply-source:${reloadedSentMessageId}-excerpt`)).toHaveText(sourceExcerpt);
      await expect(reloadedSentRelationship).not.toContainText(latestExcerpt.slice(0, 32));

      const expectedAgentInput = `Earlier conversation message (JSON data):\n${JSON.stringify({ ...replyTarget, text: longSourceText })}\n\nReply to that message:\n${draft}`;
      const expectedAgentInputSha256 = createHash('sha256').update(expectedAgentInput).digest('hex');
      await expect.poll(async () => {
        const events = await readFakeClaudeLogEvents(fakeClaudeLogPath);
        return events.some((event) => event.type === 'sdk_stdin'
          && event.hasUserText === true
          && event.userTextSha256 === expectedAgentInputSha256);
      }, { timeout: 60_000 }).toBe(true);
      await expect(page.getByText(fakeClaudeEchoResponseTextFromSha256(expectedAgentInputSha256), { exact: true }))
        .toHaveCount(1, { timeout: 180_000 });
    } catch (error) {
      throw appendBrowserDiagnostics(error, browserDiagnostics());
    }
  });
});
