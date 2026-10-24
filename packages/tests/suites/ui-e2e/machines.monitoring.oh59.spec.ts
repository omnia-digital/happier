import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { encodePlainMachineStoredContent, MACHINE_PLAIN_DATA_KEY_MARKER } from '@happier-dev/protocol';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';
import { collectHostMetrics } from '../../../../apps/cli/src/integrations/systemMetrics/collectHostMetrics';
import { createRunDirs } from '../../src/testkit/runDir';
import { createTestAuthMtls } from '../../src/testkit/auth';
import { registerMachineIdentity } from '../../src/testkit/machineIdentity';
import { upsertPlainAccountSettingsV2 } from '../../src/testkit/accountSettings';
import { startServerLight, type StartedServer } from '../../src/testkit/process/serverLight';
import { resolveUiWebBeforeAllTimeoutMs, startUiWeb, type StartedUiWeb } from '../../src/testkit/process/uiWeb';
import { createMachineScopedSocketCollector, type SocketCollector } from '../../src/testkit/socketClient';
import { startForwardedHeaderProxy } from '../../src/testkit/uiE2e/forwardedHeaderProxy';
import { gotoDomContentLoadedWithRetries, normalizeLoopbackBaseUrl } from '../../src/testkit/uiE2e/pageNavigation';
import { waitForInitialAppUi } from '../../src/testkit/uiE2e/waitForInitialAppUi';
import { createPlainSession } from '../../src/testkit/uiE2e/sessionFoldersDrag';
import { collectBrowserDiagnostics, appendBrowserDiagnostics } from '../../src/testkit/uiE2e/browserDiagnostics';

const run = createRunDirs({ runLabel: 'ui-e2e-oh59-machine-monitoring' });
const LOCAL = 'oh59-actual-local-host';
const LEGACY = 'oh59-legacy-cli-fixture';
const OFFLINE = 'oh59-offline-fixture';
const identity = { email: `oh59-${run.runId}@example.com`, issuer: 'happier-ui-e2e-oh59', fingerprint: `oh59-${run.runId}` };

test.describe('OH59 actual local collector through authenticated fixture machine RPC and Chrome', () => {
    const suiteDir = run.testDir('machine-monitoring');
    let server: StartedServer | null = null;
    let ui: StartedUiWeb | null = null;
    let stopProxy: (() => Promise<void>) | null = null;
    let uiBaseUrl = '';
    const sockets = new Map<string, SocketCollector>();
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let selectedSessionId = '';
    const samples: Array<{ machineId: string; cpu: unknown; memory: unknown; storage: unknown; gpu: unknown; load: unknown; collectionMs: number; processCpuMs: number; eventLoopActiveMs: number }> = [];
    let localRequests = 0;

    test.beforeAll(async () => {
        test.setTimeout(resolveUiWebBeforeAllTimeoutMs(process.env));
        await mkdir(suiteDir, { recursive: true });
        server = await startServerLight({ testDir: suiteDir, dbProvider: 'sqlite', extraEnv: {
            HAPPIER_FEATURE_AUTH_LOGIN__KEY_CHALLENGE_ENABLED: '0', HAPPIER_FEATURE_E2EE__KEYLESS_ACCOUNTS_ENABLED: '1',
            HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY: 'optional', HAPPIER_FEATURE_ENCRYPTION__DEFAULT_ACCOUNT_MODE: 'plain',
            HAPPIER_FEATURE_AUTH_MTLS__ENABLED: '1', HAPPIER_FEATURE_AUTH_MTLS__MODE: 'forwarded',
            HAPPIER_FEATURE_AUTH_MTLS__TRUST_FORWARDED_HEADERS: '1', HAPPIER_FEATURE_AUTH_MTLS__AUTO_PROVISION: '1',
            HAPPIER_FEATURE_AUTH_MTLS__IDENTITY_SOURCE: 'san_email', HAPPIER_FEATURE_AUTH_MTLS__ALLOWED_EMAIL_DOMAINS: 'example.com',
            HAPPIER_FEATURE_AUTH_MTLS__ALLOWED_ISSUERS: identity.issuer,
            HAPPIER_FEATURE_AUTH_MTLS__FORWARDED_EMAIL_HEADER: 'x-happier-client-cert-email',
            HAPPIER_FEATURE_AUTH_MTLS__FORWARDED_ISSUER_HEADER: 'x-happier-client-cert-issuer',
            HAPPIER_FEATURE_AUTH_MTLS__FORWARDED_FINGERPRINT_HEADER: 'x-happier-client-cert-sha256',
            HAPPIER_FEATURE_AUTH_UI__AUTO_REDIRECT_ENABLED: '1', HAPPIER_FEATURE_AUTH_UI__AUTO_REDIRECT_PROVIDER_ID: 'mtls',
        } });
        const auth = await createTestAuthMtls(server.baseUrl, identity);
        const proxy = await startForwardedHeaderProxy({ targetBaseUrl: server.baseUrl, identityHeaders: {
            'x-happier-client-cert-email': identity.email, 'x-happier-client-cert-issuer': identity.issuer,
            'x-happier-client-cert-sha256': identity.fingerprint,
        } });
        stopProxy = proxy.stop;
        await upsertPlainAccountSettingsV2({ baseUrl: server.baseUrl, token: auth.token, settings: { experiments: true, sessionListActiveGroupingV1: 'date' } });
        for (const [machineId, displayName] of [[LOCAL, 'Local Mac · actual host'], [LEGACY, 'Older CLI · fixture'], [OFFLINE, 'Offline · fixture']]) {
            await registerMachineIdentity({ baseUrl: server.baseUrl, token: auth.token, machineId,
                metadata: encodePlainMachineStoredContent({ host: machineId, displayName, platform: 'darwin', homeDir: '/fixture', happyHomeDir: '/fixture/.happier', happyCliVersion: machineId === LEGACY ? '0.2.16' : '0.2.17' }),
                dataEncryptionKey: MACHINE_PLAIN_DATA_KEY_MARKER });
            if (machineId === OFFLINE) continue;
            const socket = createMachineScopedSocketCollector(server.baseUrl, auth.token, machineId);
            sockets.set(machineId, socket); socket.connect();
            await expect.poll(() => socket.isConnected(), { timeout: 20_000 }).toBe(true);
            socket.emit('machine-alive', { machineId, time: Date.now() });
            socket.onRpcRequest<Record<string, unknown>, unknown>(async () => {
                if (machineId !== LOCAL) return { ok: false, error: { code: 'unsupported-capability', message: 'Unsupported capability: tool.machineMetrics' } };
                localRequests++;
                const beforeCpu = process.cpuUsage();
                const beforeLoop = performance.eventLoopUtilization();
                const result = await collectHostMetrics(machineId);
                const cpu = process.cpuUsage(beforeCpu);
                samples.push({ machineId, cpu: result.cpu, memory: result.memory, storage: result.storage, gpu: result.gpu, load: result.load,
                    collectionMs: result.collectionMs, processCpuMs: (cpu.user + cpu.system) / 1000,
                    eventLoopActiveMs: performance.eventLoopUtilization(beforeLoop).active });
                return { ok: true, result };
            });
            await socket.rpcRegister(`${machineId}:${RPC_METHODS.CAPABILITIES_INVOKE}`);
        }
        heartbeat = setInterval(() => { for (const [machineId, socket] of sockets) if (socket.isConnected()) socket.emit('machine-alive', { machineId, time: Date.now() }); }, 20_000);
        selectedSessionId = await createPlainSession({ baseUrl: server.baseUrl, token: auth.token, title: 'Session on the older fixture host',
            rootPath: '/fixture/project', machineId: LEGACY, tagPrefix: 'oh59-monitoring' });
        ui = await startUiWeb({ testDir: suiteDir, env: { ...process.env, EXPO_PUBLIC_DEBUG: '1', EXPO_PUBLIC_HAPPY_SERVER_URL: proxy.baseUrl,
            EXPO_PUBLIC_HAPPY_STORAGE_SCOPE: `e2e-oh59-${run.runId}`, HAPPIER_E2E_UI_WEB_MODE: 'export' } });
        uiBaseUrl = normalizeLoopbackBaseUrl(ui.baseUrl);
    });

    test.afterAll(async () => {
        test.setTimeout(120_000);
        if (heartbeat) clearInterval(heartbeat);
        for (const socket of sockets.values()) socket.close();
        await ui?.stop(); await stopProxy?.(); await server?.stop();
    });

    test('shows real host readings independently of the selected session, refreshes after 180s and handles disconnect/reconnect', async ({ page }, testInfo) => {
        test.setTimeout(420_000);
        const diagnostics = collectBrowserDiagnostics({ page });
        try {
            await page.setViewportSize({ width: 1440, height: 900 });
            await gotoDomContentLoadedWithRetries(page, `${uiBaseUrl}/?happier_hmr=0`, 300_000);
            await waitForInitialAppUi({ page, timeoutMs: 180_000 });
            const local = page.getByTestId(`machine-monitoring-${LOCAL}`);
            await expect(local).toContainText(/CPU \d+%/, { timeout: 120_000 });
            await expect(page.getByTestId(`machine-monitoring-${LEGACY}`)).toContainText('does not support host metrics');
            await expect(page.getByTestId(`machine-monitoring-${OFFLINE}`)).toContainText('offline');
            expect(samples).toHaveLength(1);
            expect(localRequests).toBe(1);
            await page.getByTestId(`session-list-item-${selectedSessionId}`).click();
            await expect(page).toHaveURL(new RegExp(`/session/${selectedSessionId}`));
            await expect(local).toContainText('Local Mac · actual host');
            await page.getByTestId(`machine-monitoring-${LOCAL}-details`).click();
            await expect(local).toContainText('Storage capacity used, not I/O');
            await expect(local).toContainText('Volume:');
            if (process.platform === 'darwin') await expect(local).toContainText('No supported unprivileged GPU utilization interface');
            await page.setViewportSize({ width: 1000, height: 900 });
            const overflow = await local.evaluate((element) => ({ width: element.clientWidth, scrollWidth: element.scrollWidth }));
            expect(overflow.width).toBeGreaterThan(0);
            expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.width + 1);
            await page.screenshot({ path: join(suiteDir, 'machine-monitoring-narrow-details.png') });
            await page.getByTestId(`machine-monitoring-${LOCAL}-details`).click();
            // This is the real 180-second product cadence, not a changed build flag or fixture timer.
            await expect.poll(() => samples.length, { timeout: 195_000, intervals: [1000] }).toBe(2);
            expect(localRequests).toBe(2);
            const actualSocket = sockets.get(LOCAL)!;
            actualSocket.disconnect();
            await expect(local).toContainText('offline', { timeout: 125_000 });
            await expect(local).toContainText('Previous reading');
            actualSocket.connect();
            await expect.poll(() => actualSocket.isConnected()).toBe(true);
            await actualSocket.rpcRegister(`${LOCAL}:${RPC_METHODS.CAPABILITIES_INVOKE}`);
            actualSocket.emit('machine-alive', { machineId: LOCAL, time: Date.now() });
            await expect.poll(() => samples.length, { timeout: 30_000 }).toBe(3);
            await expect(local).not.toContainText('Previous reading');
            await page.getByTestId('machine-monitoring-toggle').click();
            await expect(local).toHaveCount(0);
            await page.getByTestId('machine-monitoring-toggle').click();
            await expect(local).toContainText(/CPU \d+%/);
            expect(samples).toHaveLength(3);
            await page.screenshot({ path: join(suiteDir, 'machine-monitoring-reconnected.png') });
            await writeFile(join(suiteDir, 'machine-monitoring-measurements.json'), JSON.stringify({ actualHostCount: 1, transport: 'authenticated plain test machine socket; source collector; encrypted registry tested separately', samples }, null, 2));
            await testInfo.attach('machine-monitoring-measurements', { path: join(suiteDir, 'machine-monitoring-measurements.json'), contentType: 'application/json' });
        } catch (error) { throw appendBrowserDiagnostics(error, diagnostics()); }
    });
});
