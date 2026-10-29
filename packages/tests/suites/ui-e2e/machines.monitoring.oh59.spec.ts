import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { encodePlainMachineStoredContent, MACHINE_PLAIN_DATA_KEY_MARKER } from '@happier-dev/protocol';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';
import type { MachineMetricsSnapshot } from '@happier-dev/protocol/capabilities';
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
import { createPlainSession, resolveCanonicalServerIdForUi } from '../../src/testkit/uiE2e/sessionFoldersDrag';
import { collectBrowserDiagnostics, appendBrowserDiagnostics } from '../../src/testkit/uiE2e/browserDiagnostics';
import { mutateUiE2eLocalSettings } from '../../src/testkit/uiE2e/localSettingsStorage';

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
    let canonicalServerId = '';
    const samples: Array<{ machineId: string; cpu: unknown; memory: unknown; storage: unknown; gpu: MachineMetricsSnapshot['gpu']; load: unknown; collectionMs: number; processCpuMs: number; eventLoopActiveMs: number }> = [];
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
        canonicalServerId = await resolveCanonicalServerIdForUi(proxy.baseUrl);
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
            socket.onRpcRequest<Record<string, unknown>, unknown>(async ({ params }) => {
                if (params.id !== 'tool.machineMetrics' || params.method !== 'snapshot') return { ok: false, error: { code: 'unsupported-capability', message: 'Unsupported fixture capability' } };
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
        // Three-minute refresh plus both canonical presence-grace transitions,
        // initial browser readiness and interactive verification share this budget.
        test.setTimeout(600_000);
        const diagnostics = collectBrowserDiagnostics({ page });
        try {
            await page.addInitScript(({ key }) => {
                localStorage.setItem('mmkv.default\\local-settings', JSON.stringify({
                    machineDisplayIconByMachineV1: { [key]: 'cloud' }, machineDisplayColorByMachineV1: { [key]: 'blue' },
                }));
            }, { key: JSON.stringify([canonicalServerId, LOCAL]) });
            await page.setViewportSize({ width: 1440, height: 900 });
            await gotoDomContentLoadedWithRetries(page, `${uiBaseUrl}/?happier_hmr=0`, 300_000);
            await waitForInitialAppUi({ page, timeoutMs: 180_000 });
            const local = page.getByTestId(`machine-monitoring-${LOCAL}`);
            await expect(local).toContainText(/CPU \d+%/, { timeout: 120_000 });
            await expect(page.getByTestId(`machine-monitoring-${LEGACY}`)).toContainText('does not support host metrics');
            // Registration has a real presence timestamp even without a live socket.
            // Wait through the canonical grace + shared one-minute status clock.
            await expect(page.getByTestId(`machine-monitoring-${OFFLINE}`)).toContainText('offline', { timeout: 125_000 });
            const localGlyph = local.locator('svg').first();
            const legacyGlyph = page.getByTestId(`machine-monitoring-${LEGACY}`).locator('svg').first();
            expect(await localGlyph.evaluate((element) => getComputedStyle(element).color)).not.toBe(await legacyGlyph.evaluate((element) => getComputedStyle(element).color));
            expect(await localGlyph.innerHTML()).not.toBe(await legacyGlyph.innerHTML());
            expect(samples).toHaveLength(1);
            expect(localRequests).toBe(1);
            await page.getByTestId(`session-list-item-${selectedSessionId}`).click();
            await expect(page).toHaveURL(new RegExp(`/session/${selectedSessionId}`));
            await expect(local).toContainText('Local Mac · actual host');
            await page.getByTestId(`machine-monitoring-${LOCAL}-details`).click();
            await expect(local).toContainText('Storage capacity used, not I/O');
            await expect(local).toContainText('Volume:');
            if (samples[0].gpu.status === 'available') {
                for (const device of samples[0].gpu.devices) await expect(local).toContainText(device.id);
            } else if (samples[0].gpu.reason === 'no-supported-gpu') {
                await expect(local).toContainText('No supported unprivileged GPU utilization interface');
            }
            await page.setViewportSize({ width: 1000, height: 900 });
            const overflow = await local.evaluate((element) => ({ width: element.clientWidth, scrollWidth: element.scrollWidth }));
            expect(overflow.width).toBeGreaterThan(0);
            expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.width + 1);
            const monitoringBounds = await page.getByTestId('machine-monitoring').boundingBox();
            const newSessionBounds = await page.getByText('Start New Session', { exact: true }).boundingBox();
            expect(monitoringBounds).not.toBeNull(); expect(newSessionBounds).not.toBeNull();
            expect(monitoringBounds!.y + monitoringBounds!.height).toBeLessThanOrEqual(newSessionBounds!.y);
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
            await page.getByText('Start New Session', { exact: true }).click();
            await expect(page).toHaveURL(/\/new(?:\?|$)/);
            await page.goBack();
            await expect(page).toHaveURL(new RegExp(`/session/${selectedSessionId}`));
            await writeFile(join(suiteDir, 'machine-monitoring-measurements.json'), JSON.stringify({ actualHostCount: 1, transport: 'authenticated plain test machine socket; source collector; encrypted registry tested separately', samples }, null, 2));
            await testInfo.attach('machine-monitoring-measurements', { path: join(suiteDir, 'machine-monitoring-measurements.json'), contentType: 'application/json' });
        } catch (error) { throw appendBrowserDiagnostics(error, diagnostics()); }
    });

    test('keeps compact machine rows on one line and expands full readings with pointer and keyboard', async ({ page }, testInfo) => {
        const diagnostics = collectBrowserDiagnostics({ page });
        try {
            await page.setViewportSize({ width: 1440, height: 900 });
            await gotoDomContentLoadedWithRetries(page, `${uiBaseUrl}/?happier_hmr=0`, 300_000);
            await waitForInitialAppUi({ page, timeoutMs: 180_000 });
            const button = page.getByTestId(`machine-monitoring-${LOCAL}-details`);
            const readings = page.getByTestId(`machine-monitoring-${LOCAL}-readings`);
            let baseSummaryFontSize = 0;
            for (const [themePreference, uiFontScale, width] of [['light', 1, 1440], ['dark', 1, 1000], ['dark', 2, 1000]] as const) {
                await mutateUiE2eLocalSettings({ page, settingsPatch: { themePreference, uiFontScale } });
                await page.setViewportSize({ width, height: 900 });
                await page.reload({ waitUntil: 'domcontentloaded' });
                await waitForInitialAppUi({ page, timeoutMs: 180_000 });
                await expect(button).toHaveAttribute('aria-expanded', 'false');
                await expect(button).toHaveAttribute('aria-label', /CPU \d+%/, { timeout: 120_000 });
                await expect(readings).toHaveCount(0);
                const summaryFontSize = await page.getByTestId(`machine-monitoring-${LOCAL}-summary`).evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
                if (!baseSummaryFontSize) baseSummaryFontSize = summaryFontSize;
                console.info('[OH59 measured summary font]', { themePreference, uiFontScale, summaryFontSize });
                expect(summaryFontSize).toBe(baseSummaryFontSize * uiFontScale);
                for (const machineId of [LOCAL, LEGACY]) {
                    const row = page.getByTestId(`machine-monitoring-${machineId}-details`);
                    const name = page.getByTestId(`machine-monitoring-${machineId}-name`);
                    const summary = page.getByTestId(`machine-monitoring-${machineId}-summary`);
                    const nameBox = await name.boundingBox();
                    const summaryBox = await summary.boundingBox();
                    expect(nameBox).not.toBeNull(); expect(summaryBox).not.toBeNull();
                    expect(Math.abs(nameBox!.y + nameBox!.height / 2 - summaryBox!.y - summaryBox!.height / 2)).toBeLessThan(2);
                    const geometry = await row.evaluate((element) => ({ width: element.clientWidth, scrollWidth: element.scrollWidth }));
                    expect(geometry.width).toBeGreaterThan(0);
                    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width + 1);
                    for (const text of [name, summary]) {
                        const line = await text.evaluate((element) => ({ height: element.clientHeight, fontSize: parseFloat(getComputedStyle(element).fontSize) }));
                        expect(line.height).toBeLessThan(line.fontSize * 2);
                    }
                }
                await expect(page.getByTestId(`machine-monitoring-${LEGACY}-summary`)).toContainText('does not support host metrics');
                await expect(page.getByTestId(`machine-monitoring-${LEGACY}-details`)).toHaveAttribute('aria-label', /online.*does not support host metrics/);
                await page.screenshot({ path: join(suiteDir, `compact-${themePreference}-${uiFontScale}.png`) });
                await button.focus();
                await page.keyboard.press('Enter');
                await expect(button).toHaveAttribute('aria-expanded', 'true');
                await expect(button).toBeFocused();
                await expect(readings).toContainText('Local Mac · actual host');
                for (const metric of ['CPU', 'MEM', 'GPU', 'Storage used', 'LA 1/5/15m']) await expect(readings).toContainText(metric);
                await expect(readings).toContainText('Storage capacity used, not I/O');
                await expect(readings).toContainText('Volume:');
                await page.screenshot({ path: join(suiteDir, `expanded-top-${themePreference}-${uiFontScale}.png`) });
                const detailOverflow = await readings.evaluate((element) => ({ width: element.clientWidth, scrollWidth: element.scrollWidth }));
                expect(detailOverflow.scrollWidth).toBeLessThanOrEqual(detailOverflow.width + 1);
                const volume = readings.getByText(/^Volume:/);
                await volume.scrollIntoViewIfNeeded();
                await expect(volume).toBeInViewport({ ratio: 1 });
                await page.screenshot({ path: join(suiteDir, `expanded-${themePreference}-${uiFontScale}.png`) });
                await button.scrollIntoViewIfNeeded();
                await button.focus();
                await page.keyboard.press('Space');
                await expect(button).toHaveAttribute('aria-expanded', 'false');
                await expect(readings).toHaveCount(0);
                await button.click();
                await expect(readings).toBeVisible();
                await button.click();
                await expect(readings).toHaveCount(0);
            }
            await testInfo.attach('compact-dark-large-text', { path: join(suiteDir, 'compact-dark-2.png'), contentType: 'image/png' });
            await testInfo.attach('expanded-dark-large-text', { path: join(suiteDir, 'expanded-dark-2.png'), contentType: 'image/png' });
        } catch (error) { throw appendBrowserDiagnostics(error, diagnostics()); }
    });

    test('renders actual supported GPU identity and utilization in Chrome', async ({ page }, testInfo) => {
        const diagnostics = collectBrowserDiagnostics({ page });
        try {
            await page.setViewportSize({ width: 1000, height: 900 });
            await gotoDomContentLoadedWithRetries(page, `${uiBaseUrl}/?happier_hmr=0`, 300_000);
            await waitForInitialAppUi({ page, timeoutMs: 180_000 });
            const local = page.getByTestId(`machine-monitoring-${LOCAL}`);
            await expect(local).toContainText(/CPU \d+%/, { timeout: 120_000 });
            const gpu = samples.at(-1)!.gpu;
            test.skip(gpu.status !== 'available' || !gpu.devices.some((device) => device.utilization.status === 'available'),
                'This host driver does not expose a supported GPU utilization reading');
            if (gpu.status !== 'available') return;
            await page.getByTestId(`machine-monitoring-${LOCAL}-details`).click();
            for (const device of gpu.devices) {
                await expect(local).toContainText(device.name);
                await expect(local).toContainText(device.id);
                if (device.utilization.status === 'available') {
                    const detail = local.getByText(`${device.name} · ${device.id} · ${Math.round(device.utilization.usagePercent)}%`, { exact: true });
                    await detail.scrollIntoViewIfNeeded();
                    await expect(detail).toBeInViewport({ ratio: 1 });
                }
            }
            await page.screenshot({ path: join(suiteDir, 'machine-monitoring-actual-gpu.png') });
            const measurementPath = join(suiteDir, 'machine-monitoring-actual-gpu.json');
            await writeFile(measurementPath, JSON.stringify({ platform: process.platform,
                transport: 'authenticated plain fixture machine RPC with actual host collector', gpu }, null, 2));
            await testInfo.attach('actual-gpu-reading', { path: measurementPath, contentType: 'application/json' });
        } catch (error) { throw appendBrowserDiagnostics(error, diagnostics()); }
    });
});
