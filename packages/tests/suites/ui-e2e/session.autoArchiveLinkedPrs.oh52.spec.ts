import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

import {
    sealEncryptedDataKeyEnvelopeV1,
    SESSION_RUNTIME_ACTIVITY_SNAPSHOT_EVENT,
    SESSION_RUNTIME_ACTIVITY_CLOSE_EVENT,
    SessionRuntimeActivitySnapshotAckSchema,
    SessionRuntimeActivityCloseAckSchema,
    parseSessionRuntimeActivityProjectionFields,
} from '@happier-dev/protocol';
import { createRunDirs } from '../../src/testkit/runDir';
import { startServerLight, type StartedServer } from '../../src/testkit/process/serverLight';
import { startUiWeb, type StartedUiWeb } from '../../src/testkit/process/uiWeb';
import { type StartedDaemon } from '../../src/testkit/daemon/daemon';
import { authenticateAndStartDaemon } from '../../src/testkit/uiE2e/authenticateAndStartDaemon';
import { gotoDomContentLoadedWithRetries, normalizeLoopbackBaseUrl } from '../../src/testkit/uiE2e/pageNavigation';
import { createSessionWithCiphertexts, fetchSessionV2 } from '../../src/testkit/sessions';
import { encryptLegacyBase64 } from '../../src/testkit/messageCrypto';
import { decryptDataKeyBase64, encryptDataKeyBase64 } from '../../src/testkit/rpcCrypto';
import { readCliAccessKey } from '../../src/testkit/cliAccessKey';
import { readUiE2eScopedAccountSettings } from '../../src/testkit/uiE2e/scopedAccountSettingsStorage';
import { createMachineBoundSessionScopedSocketCollector } from '../../src/testkit/sessionSocketBinding';
import { fetchJson } from '../../src/testkit/http';
import { waitFor } from '../../src/testkit/timing';
import { appendBrowserDiagnostics, collectBrowserDiagnostics } from '../../src/testkit/uiE2e/browserDiagnostics';

const run = createRunDirs({ runLabel: 'ui-e2e' });
const receipt = (phase: string) => console.log(`[oh52-autoarchive] ${new Date().toISOString()} ${phase}`);

test.describe('OH52 foreground linked-PR automatic archive', () => {
    const suiteDir = run.testDir('oh52-autoarchive');
    const cliHome = resolve(suiteDir, 'cli-home');
    const providerHome = resolve(suiteDir, 'provider-home');
    const fixtureBin = resolve(suiteDir, 'fixture-bin');
    const repoDir = resolve(suiteDir, 'fixture-repository');
    const ghLog = resolve(suiteDir, 'gh-read.log');
    let server: StartedServer | null = null;
    let ui: StartedUiWeb | null = null;
    let daemon: StartedDaemon | null = null;

    test.beforeAll(async () => {
        test.setTimeout(900_000);
        receipt('setup start');
        await Promise.all([mkdir(cliHome, { recursive: true }), mkdir(providerHome, { recursive: true }), mkdir(fixtureBin, { recursive: true }), mkdir(repoDir, { recursive: true })]);
        execFileSync('git', ['init', '-q', repoDir]);
        execFileSync('git', ['-C', repoDir, 'remote', 'add', 'origin', 'https://github.com/fixture/origin.git']);
        await writeFile(ghLog, '');
        // The isolated daemon sees only this fake gh first on PATH. Every provider read stays local.
        const ghShim = `#!/bin/sh
printf '%s\\n' "$*" >> "$OH52_GH_READ_LOG"
if [ "$1" = auth ] && [ "$2" = status ]; then exit 0; fi
if [ "$1" = pr ] && [ "$2" = view ] && [ "$4" = --repo ]; then
  case "$5" in
    owner/one) printf '%s\\n' '{"number":7,"title":"First merged PR","url":"https://github.com/owner/one/pull/7","state":"MERGED","baseRefName":"main","headRefName":"topic","mergedAt":"2026-10-20T00:00:00Z","isDraft":false,"headRefOid":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}'; exit 0 ;;
    owner/two) printf '%s\\n' '{"number":7,"title":"Second merged PR","url":"https://github.com/owner/two/pull/7","state":"MERGED","baseRefName":"main","headRefName":"topic","mergedAt":"2026-10-20T00:00:00Z","isDraft":false,"headRefOid":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}'; exit 0 ;;
    owner/open) printf '%s\\n' '{"number":9,"title":"Still open PR","url":"https://github.com/owner/open/pull/9","state":"OPEN","baseRefName":"main","headRefName":"topic","mergedAt":null,"isDraft":false,"headRefOid":"cccccccccccccccccccccccccccccccccccccccc"}'; exit 0 ;;
  esac
fi
exit 1
`;
        await writeFile(join(fixtureBin, 'gh'), ghShim, 'utf8');
        await chmod(join(fixtureBin, 'gh'), 0o755);
        server = await startServerLight({ testDir: suiteDir, dbProvider: 'sqlite', extraEnv: {
            HAPPIER_BUILD_FEATURES_DENY: 'sharing.contentKeys',
            HAPPIER_FEATURE_AUTH_LOGIN__KEY_CHALLENGE_ENABLED: '1',
        } });
        receipt('isolated server ready');
        ui = await startUiWeb({ testDir: suiteDir, env: {
            ...process.env,
            EXPO_PUBLIC_HAPPY_SERVER_URL: server.baseUrl,
            EXPO_PUBLIC_HAPPY_STORAGE_SCOPE: `oh52-archive-${run.runId}`,
            HAPPIER_E2E_UI_WEB_EXPORT_NAMESPACE: 'oh52-autoarchive',
        } });
        receipt('isolated UI ready');
    });

    test.afterAll(async () => {
        test.setTimeout(120_000);
        receipt('fixture cleanup start');
        await daemon?.stop().catch(() => {});
        await ui?.stop().catch(() => {});
        await server?.stop().catch(() => {});
        receipt('fixture cleanup complete');
    });

    test('keeps preferences independent and archives only an idle session with every qualified PR merged', async ({ page }, testInfo) => {
        test.setTimeout(600_000);
        if (!server || !ui) throw new Error('isolated fixtures unavailable');
        const diagnostics = collectBrowserDiagnostics({ page });
        try {
            const baseUrl = normalizeLoopbackBaseUrl(ui.baseUrl);
            await page.setViewportSize({ width: 1360, height: 900 });
            await gotoDomContentLoadedWithRetries(page, baseUrl, 240_000);
            daemon = await authenticateAndStartDaemon({ page, testDir: suiteDir, cliHomeDir: cliHome, serverUrl: server.baseUrl, uiBaseUrl: baseUrl,
                extraEnv: {
                    HOME: providerHome, TMPDIR: providerHome, GH_CONFIG_DIR: providerHome,
                    COREPACK_HOME: process.env.COREPACK_HOME ?? join(homedir(), '.cache/node/corepack'),
                    PATH: `${fixtureBin}${delimiter}${process.env.PATH ?? ''}`,
                    OH52_GH_READ_LOG: ghLog,
                    HAPPIER_E2E_CLI_SNAPSHOT_NODE_MODULES_MODE: 'symlink',
                },
            });
            receipt('isolated authentication and daemon ready');
            const access = await page.evaluate(() => {
                const keys = Object.keys(localStorage).filter((key) => key.startsWith('auth_credentials__srv_'));
                if (keys.length !== 1) throw new Error('Expected one isolated Home');
                const credentials = JSON.parse(localStorage.getItem(keys[0]) ?? '{}');
                return { token: credentials.token as string, secret: credentials.secret as string };
            });
            const secret = Uint8Array.from(Buffer.from(access.secret, 'base64url'));
            const readServerRow = async (sessionId: string): Promise<Record<string, unknown>> => {
                const response = await fetchJson<{ session: Record<string, unknown> }>(`${server!.baseUrl}/v2/sessions/${sessionId}`, {
                    headers: { Authorization: `Bearer ${access.token}` },
                });
                if (response.status !== 200 || !response.data?.session) throw new Error(`Fixture session read failed (${response.status})`);
                return response.data.session;
            };
            const readArchivedAt = async (sessionId: string): Promise<number | null> => {
                const value = (await readServerRow(sessionId)).archivedAt;
                if (value === null || typeof value === 'number') return value;
                throw new Error('Fixture archive timestamp is malformed');
            };
            const cliAccess = await readCliAccessKey(cliHome);
            if (!cliAccess || !('encryption' in cliAccess)) throw new Error('Isolated CLI encryption recipient unavailable');
            const loginOutput = await readFile(join(suiteDir, 'cli.auth.login.stdout.log'), 'utf8');
            const machineId = loginOutput.replaceAll(/\u001b\[[0-9;]*m/g, '').match(/Machine ID:\s*([^\s]+)/)?.[1];
            if (!machineId) throw new Error('Isolated daemon machine identity unavailable');
            const keys = new Map<string, Uint8Array>();
            const seed = async (name: string, links: readonly Record<string, unknown>[]) => {
                const dataKey = Uint8Array.from(randomBytes(32));
                const envelope = sealEncryptedDataKeyEnvelopeV1({ dataKey, recipientPublicKey: Uint8Array.from(Buffer.from(cliAccess.encryption.publicKey, 'base64')), randomBytes: (length) => Uint8Array.from(randomBytes(length)) });
                const metadata = { path: repoDir, host: 'OH52 isolated daemon', machineId, name, version: '0.2.16', agentActivityCounts: { live: 0 },
                    sessionPullRequestsV1: { v: 1, links }, unknownOldCliField: { keep: 'preserved' } };
                const { sessionId } = await createSessionWithCiphertexts({ baseUrl: server!.baseUrl, token: access.token,
                    metadataCiphertextBase64: encryptDataKeyBase64(metadata, dataKey), dataEncryptionKeyBase64: Buffer.from(envelope).toString('base64') });
                keys.set(sessionId, dataKey);
                return sessionId;
            };
            const link = (repository: string, number: number) => ({ providerKind: 'github', providerBaseUrl: 'https://github.com', repository, number, url: `https://github.com/${repository}/pull/${number}` });
            const merged = await seed('OH52 merged across repositories', [link('owner/one', 7), link('owner/two', 7)]);
            const unmerged = await seed('OH52 still open', [link('owner/open', 9)]);
            const unknownWork = await seed('OH52 older host without idle proof', [link('owner/one', 7)]);
            receipt('three encrypted sessions seeded with real data-key envelopes');

            const publishIdle = async (sessionId: string) => {
                const { socket } = await createMachineBoundSessionScopedSocketCollector({ baseUrl: server!.baseUrl, token: access.token, sessionId,
                    machineMetadataCiphertext: encryptLegacyBase64({ host: 'OH52 isolated runtime publisher', platform: 'darwin' }, secret) });
                socket.connect();
                try {
                    await waitFor(async () => socket.isConnected(), { timeoutMs: 20_000, context: 'isolated runtime publisher connected' });
                    socket.emit('session-alive', { sid: sessionId, time: Date.now(), thinking: false });
                    await waitFor(async () => (await fetchSessionV2(server!.baseUrl, access.token, sessionId)).active, { timeoutMs: 20_000, context: 'fixture publisher registered' });
                    const ack = SessionRuntimeActivitySnapshotAckSchema.parse(await socket.emitWithAck(SESSION_RUNTIME_ACTIVITY_SNAPSHOT_EVENT, {
                        sessionId, mutationId: randomUUID(), snapshot: { state: 'idle', activeCount: 0 },
                    }));
                    expect(['applied', 'unchanged']).toContain(ack.status);
                    expect(parseSessionRuntimeActivityProjectionFields(await readServerRow(sessionId))).toMatchObject({
                        kind: 'valid', projection: { state: 'idle', activeCount: 0 },
                    });
                    // Match the real CLI clean-close path. A bare disconnect intentionally loses
                    // idle evidence and cannot stand in for an acknowledged completed session.
                    const closed = SessionRuntimeActivityCloseAckSchema.parse(await socket.emitWithAck(SESSION_RUNTIME_ACTIVITY_CLOSE_EVENT, { sessionId }));
                    expect(closed.status).toBe('closed');
                } finally { socket.close(); }
                const ended = await fetchSessionV2(server!.baseUrl, access.token, sessionId);
                expect(ended).toMatchObject({ active: false, pendingCount: 0, pendingBlockedCount: 0 });
                expect(parseSessionRuntimeActivityProjectionFields(await readServerRow(sessionId))).toMatchObject({
                    kind: 'valid', projection: { state: 'idle', activeCount: 0 },
                });
            };
            await publishIdle(merged);
            await publishIdle(unmerged);
            const unknown = await fetchSessionV2(server.baseUrl, access.token, unknownWork);
            expect(unknown.active).toBe(false);
            expect(parseSessionRuntimeActivityProjectionFields(await readServerRow(unknownWork))).not.toMatchObject({
                kind: 'valid', projection: { state: 'idle', activeCount: 0 },
            });
            receipt('real idle snapshots and old-host unknown work verified');

            await gotoDomContentLoadedWithRetries(page, `${baseUrl}/session/${merged}/info`, 120_000);
            await expect(page.getByTestId('session-pr-add')).toBeVisible({ timeout: 120_000 });
            await expect(page.getByTestId('session-pr-change-github-github.com-owner/one-7')).toBeVisible();
            await page.getByTestId('session-pr-add').scrollIntoViewIfNeeded();
            await page.screenshot({ path: testInfo.outputPath('oh52-owner-pr-controls.png') });
            receipt('owned session retains visible PR link and correction controls');

            await gotoDomContentLoadedWithRetries(page, `${baseUrl}/settings/session`, 120_000);
            const autoArchiveToggle = page.getByTestId('settings-session-autoArchiveLinkedPrs-item').getByRole('switch');
            const cleanupToggle = page.getByTestId('settings-session-cleanupOnArchive-item').getByRole('switch');
            await expect(autoArchiveToggle).toHaveAttribute('aria-checked', 'false');
            await expect(cleanupToggle).toHaveAttribute('aria-checked', 'false');
            await expect(page.getByText('every 5 minutes', { exact: false })).toBeVisible();
            await page.getByTestId('settings-session-autoArchiveLinkedPrs-item').click();
            await expect(autoArchiveToggle).toHaveAttribute('aria-checked', 'true');
            await expect(cleanupToggle).toHaveAttribute('aria-checked', 'false');
            await expect.poll(async () => (await readUiE2eScopedAccountSettings({ page })).autoArchiveAfterLinkedPullRequestsMerge).toBe(true);
            await page.screenshot({ path: testInfo.outputPath('oh52-independent-archive-preferences.png') });
            receipt('foreground autoarchive enabled through visible independent preference');

            await expect.poll(async () => readArchivedAt(merged), { timeout: 120_000 }).toEqual(expect.any(Number));
            const archivedAt = await readArchivedAt(merged);
            expect(archivedAt).toEqual(expect.any(Number));
            await expect.poll(async () => {
                const current = await fetchSessionV2(server!.baseUrl, access.token, merged);
                const metadata = decryptDataKeyBase64(current.metadata, keys.get(merged)!) as Record<string, any>;
                return metadata.sessionAutoArchiveHistoryV1?.events?.[0]?.archivedAt;
            }, { timeout: 120_000 }).toBe(archivedAt);
            const mergedMetadata = decryptDataKeyBase64((await fetchSessionV2(server.baseUrl, access.token, merged)).metadata, keys.get(merged)!) as Record<string, any>;
            expect(mergedMetadata.sessionAutoArchiveHistoryV1.events[0].links).toMatchObject([link('owner/one', 7), link('owner/two', 7)]);
            expect(mergedMetadata.unknownOldCliField).toEqual({ keep: 'preserved' });
            expect(await readArchivedAt(unmerged)).toBeNull();
            expect(await readArchivedAt(unknownWork)).toBeNull();
            const reads = await readFile(ghLog, 'utf8');
            expect(reads).toContain('pr view 7 --repo owner/one');
            expect(reads).toContain('pr view 7 --repo owner/two');
            expect(reads).toContain('pr view 9 --repo owner/open');
            receipt('qualified fixture gh reads, confirmed server archive and encrypted history verified');

            await gotoDomContentLoadedWithRetries(page, `${baseUrl}/session/${merged}/info`, 120_000);
            await expect(page.getByText('OH52 merged across repositories', { exact: true }).first()).toBeVisible({ timeout: 120_000 });
            await expect(page.getByTestId('session-pr-autoarchive-history')).toContainText('All linked PRs were verified merged');
            await expect(page.getByTestId('session-pr-autoarchive-history')).toContainText('owner/one #7');
            await expect(page.getByTestId('session-pr-autoarchive-history')).toContainText('owner/two #7');
            await page.screenshot({ path: testInfo.outputPath('oh52-confirmed-autoarchive-history.png') });
            await page.reload();
            await expect(page.getByTestId('session-pr-autoarchive-history')).toBeVisible({ timeout: 120_000 });
            await gotoDomContentLoadedWithRetries(page, `${baseUrl}/session/${unknownWork}/info`, 120_000);
            await expect(page.getByTestId('session-pr-autoarchive-skipped')).toBeVisible({ timeout: 120_000 });
            await expect(page.getByTestId('session-pr-autoarchive-skipped')).toContainText('Older hosts may not report these signals');
            await page.screenshot({ path: testInfo.outputPath('oh52-unknown-work-skipped.png') });
            receipt('rendered archive reason, reload and unknown-work skip verified');
        } catch (error) { throw appendBrowserDiagnostics(error, diagnostics()); }
    });
});
