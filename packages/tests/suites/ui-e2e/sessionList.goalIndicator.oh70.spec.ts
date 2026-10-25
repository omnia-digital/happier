import { expect, test } from '@playwright/test';

import { createRunDirs } from '../../src/testkit/runDir';
import { createTestAuthMtls } from '../../src/testkit/auth';
import { fetchJson } from '../../src/testkit/http';
import { repoRootDir } from '../../src/testkit/paths';
import { registerMachineIdentity } from '../../src/testkit/machineIdentity';
import { upsertPlainAccountSettingsV2 } from '../../src/testkit/accountSettings';
import { startServerLight, type StartedServer } from '../../src/testkit/process/serverLight';
import { resolveUiWebBeforeAllTimeoutMs, startUiWeb, type StartedUiWeb } from '../../src/testkit/process/uiWeb';
import { gotoDomContentLoadedWithRetries, normalizeLoopbackBaseUrl } from '../../src/testkit/uiE2e/pageNavigation';
import { startForwardedHeaderProxy } from '../../src/testkit/uiE2e/forwardedHeaderProxy';
import { waitForInitialAppUi } from '../../src/testkit/uiE2e/waitForInitialAppUi';
import { mutateUiE2eLocalSettings } from '../../src/testkit/uiE2e/localSettingsStorage';
import { appendBrowserDiagnostics, collectBrowserDiagnostics } from '../../src/testkit/uiE2e/browserDiagnostics';

const run = createRunDirs({ runLabel: 'ui-e2e-oh70-goal-indicator' });
const machineId = `oh70-machine-${run.runId.slice(-8)}`;
const identity = {
    email: `oh70-goals-${run.runId}@example.com`,
    issuer: 'happier-ui-e2e-oh70-goal-indicator',
    fingerprint: `oh70-goals-${run.runId}`,
} as const;

type GoalState = 'active' | 'complete' | 'paused';

async function createGoalSession(params: Readonly<{
    baseUrl: string;
    token: string;
    title: string;
    status: GoalState;
}>): Promise<string> {
    const tag = `oh70-${params.status}-${run.runId}`;
    const response = await fetchJson<{ session?: { id?: unknown } }>(`${params.baseUrl}/v1/sessions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${params.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            tag,
            encryptionMode: 'plain',
            dataEncryptionKey: null,
            agentState: null,
            metadata: JSON.stringify({
                v: 1,
                name: params.title,
                path: repoRootDir(),
                homeDir: repoRootDir().split('/').slice(0, -1).join('/') || '/',
                host: machineId,
                machineId,
                flavor: 'claude',
                sessionWorkStateV1: {
                    v: 1,
                    backendId: 'claude',
                    updatedAt: Date.now(),
                    primaryItemId: `goal:${params.status}`,
                    items: [{
                        id: `goal:${params.status}`,
                        kind: 'goal',
                        origin: 'vendor',
                        status: params.status,
                        title: `Goal ${params.status} ${run.runId.slice(-4)}`,
                        updatedAt: Date.now(),
                    }],
                },
            }),
        }),
        timeoutMs: 20_000,
    });
    const sessionId = response.data?.session?.id;
    if (response.status !== 200 || typeof sessionId !== 'string') {
        throw new Error(`Failed to seed ${params.status} goal session (status=${response.status})`);
    }
    return sessionId;
}

test.describe('ui e2e: OH-70 sidebar goal indicators', () => {
    test.describe.configure({ mode: 'serial' });
    const suiteDir = run.testDir('goal-indicator');
    let server: StartedServer | null = null;
    let ui: StartedUiWeb | null = null;
    let proxyStop: (() => Promise<void>) | null = null;
    let token: string | null = null;
    let sessionIds: Record<GoalState, string> | null = null;

    test.beforeAll(async () => {
        test.setTimeout(resolveUiWebBeforeAllTimeoutMs(process.env));
        server = await startServerLight({
            testDir: suiteDir,
            dbProvider: 'sqlite',
            extraEnv: {
                HAPPIER_FEATURE_AUTH_LOGIN__KEY_CHALLENGE_ENABLED: '0',
                HAPPIER_FEATURE_E2EE__KEYLESS_ACCOUNTS_ENABLED: '1',
                HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY: 'optional',
                HAPPIER_FEATURE_ENCRYPTION__DEFAULT_ACCOUNT_MODE: 'plain',
                HAPPIER_FEATURE_AUTH_MTLS__ENABLED: '1',
                HAPPIER_FEATURE_AUTH_MTLS__MODE: 'forwarded',
                HAPPIER_FEATURE_AUTH_MTLS__TRUST_FORWARDED_HEADERS: '1',
                HAPPIER_FEATURE_AUTH_MTLS__AUTO_PROVISION: '1',
                HAPPIER_FEATURE_AUTH_MTLS__IDENTITY_SOURCE: 'san_email',
                HAPPIER_FEATURE_AUTH_MTLS__ALLOWED_EMAIL_DOMAINS: 'example.com',
                HAPPIER_FEATURE_AUTH_MTLS__ALLOWED_ISSUERS: identity.issuer,
                HAPPIER_FEATURE_AUTH_MTLS__FORWARDED_EMAIL_HEADER: 'x-happier-client-cert-email',
                HAPPIER_FEATURE_AUTH_MTLS__FORWARDED_ISSUER_HEADER: 'x-happier-client-cert-issuer',
                HAPPIER_FEATURE_AUTH_MTLS__FORWARDED_FINGERPRINT_HEADER: 'x-happier-client-cert-sha256',
                HAPPIER_FEATURE_AUTH_UI__AUTO_REDIRECT_ENABLED: '1',
                HAPPIER_FEATURE_AUTH_UI__AUTO_REDIRECT_PROVIDER_ID: 'mtls',
            },
        });
        const auth = await createTestAuthMtls(server.baseUrl, identity);
        const proxy = await startForwardedHeaderProxy({
            targetBaseUrl: server.baseUrl,
            identityHeaders: {
                'x-happier-client-cert-email': identity.email,
                'x-happier-client-cert-issuer': identity.issuer,
                'x-happier-client-cert-sha256': identity.fingerprint,
            },
        });
        proxyStop = proxy.stop;
        token = auth.token;
        await upsertPlainAccountSettingsV2({
            baseUrl: server.baseUrl,
            token,
            settings: {
                experiments: true,
                sessionListSectionModeV1: 'single',
                hideInactiveSessions: false,
                sessionListOrderingModeV1: 'created',
            },
        });
        await registerMachineIdentity({ baseUrl: server.baseUrl, token, machineId, metadata: 'OH-70 sidebar fixture' });
        const titles = {
            active: `OH-70 pursuing goal session ${run.runId.slice(-5)}`,
            complete: `OH-70 completed goal session ${run.runId.slice(-5)}`,
            paused: `OH-70 paused goal session ${run.runId.slice(-5)}`,
        };
        sessionIds = {
            active: await createGoalSession({ baseUrl: server.baseUrl, token, title: titles.active, status: 'active' }),
            complete: await createGoalSession({ baseUrl: server.baseUrl, token, title: titles.complete, status: 'complete' }),
            paused: await createGoalSession({ baseUrl: server.baseUrl, token, title: titles.paused, status: 'paused' }),
        };
        ui = await startUiWeb({
            testDir: suiteDir,
            env: {
                ...process.env,
                EXPO_PUBLIC_DEBUG: '1',
                EXPO_PUBLIC_HAPPY_SERVER_URL: proxy.baseUrl,
                EXPO_PUBLIC_HAPPY_STORAGE_SCOPE: `oh70-goals-${run.runId}`,
                HAPPIER_E2E_UI_WEB_MODE: 'export',
            },
        });
    });

    test.afterAll(async () => {
        await ui?.stop().catch(() => {});
        await proxyStop?.().catch(() => {});
        await server?.stop().catch(() => {});
    });

    test('shows truthful lifecycle labels and fits indicators in compact light and large-text dark sidebar rows', async ({ page }) => {
        test.setTimeout(300_000);
        if (!server || !ui || !sessionIds || !token) throw new Error('missing isolated goal indicator fixtures');
        const browserDiagnostics = collectBrowserDiagnostics({ page });
        const goalSessionIds = sessionIds;
        await page.setViewportSize({ width: 1440, height: 900 });
        const baseUrl = normalizeLoopbackBaseUrl(ui.baseUrl);
        await gotoDomContentLoadedWithRetries(page, `${baseUrl}/?happier_hmr=0`, 240_000);
        await waitForInitialAppUi({ page, timeoutMs: 180_000 });

        const indicator = (status: GoalState) => page.getByTestId(`session-list-goal-indicator:${goalSessionIds[status]}`);
        const checkMachineHover = async () => {
            const sessionId = goalSessionIds.active;
            const machine = page.getByTestId(`session-list-machine-identity-${sessionId}`);
            await machine.evaluate((element) => {
                element.addEventListener('pointerenter', () => element.setAttribute('data-test-pointer-entered', 'yes'), { once: true });
            });
            const boxBeforeHover = await machine.boundingBox();
            await machine.hover();
            await expect.poll(() => machine.getAttribute('data-test-pointer-entered')).toBe('yes');
            const hoverGeometry = boxBeforeHover ? await page.evaluate(({ x, y, selector }) => {
                const hit = document.elementFromPoint(x, y);
                const identity = hit?.closest(selector);
                return {
                    pointerStillOverMachine: identity !== null,
                    identityBox: document.querySelector<HTMLElement>(selector)?.getBoundingClientRect().toJSON(),
                    hitTestId: hit?.closest<HTMLElement>('[data-testid]')?.dataset.testid ?? null,
                };
            }, {
                x: boxBeforeHover.x + boxBeforeHover.width / 2,
                y: boxBeforeHover.y + boxBeforeHover.height / 2,
                selector: `[data-testid="session-list-machine-identity-${sessionId}"]`,
            }) : null;
            expect(hoverGeometry?.pointerStillOverMachine, JSON.stringify({ boxBeforeHover, hoverGeometry })).toBe(true);
            const tooltip = page.getByTestId(`session-list-machine-identity-${sessionId}-tooltip`);
            await expect(tooltip).toBeVisible();
            await expect(tooltip).toContainText(machineId);
            await page.mouse.move(0, 0);
            await expect(tooltip).toBeHidden();
        };
        const checkRows = async () => {
            for (const [status, expected] of [
                ['active', 'Active'],
                ['complete', 'Complete'],
                ['paused', 'Paused'],
            ] as const) {
                const row = page.getByTestId(`session-list-item-${goalSessionIds[status]}`);
                const goal = indicator(status);
                await expect(row).toBeVisible({ timeout: 60_000 });
                await expect(goal).toBeVisible();
                await expect(goal).toHaveAttribute('aria-label', new RegExp(`Goal ${status}.*${expected}`));
                await expect(page.getByTestId(`session-list-machine-identity-${goalSessionIds[status]}`)).toBeVisible();
                await goal.evaluate((element) => {
                    element.addEventListener('pointerenter', () => element.setAttribute('data-test-pointer-entered', 'yes'), { once: true });
                    element.addEventListener('mouseenter', () => element.setAttribute('data-test-mouse-entered', 'yes'), { once: true });
                });
                const boxBeforeHover = await goal.boundingBox();
                await goal.hover();
                await expect.poll(() => goal.getAttribute('data-test-pointer-entered')).toBe('yes');
                const hoverGeometry = boxBeforeHover ? await page.evaluate(({ x, y, selector }) => {
                    const hit = document.elementFromPoint(x, y);
                    const indicator = hit?.closest(selector);
                    return {
                        pointerStillOverIndicator: indicator !== null,
                        indicatorBox: document.querySelector<HTMLElement>(selector)?.getBoundingClientRect().toJSON(),
                        hitTestId: hit?.closest<HTMLElement>('[data-testid]')?.dataset.testid ?? null,
                    };
                }, {
                    x: boxBeforeHover.x + boxBeforeHover.width / 2,
                    y: boxBeforeHover.y + boxBeforeHover.height / 2,
                    selector: `[data-testid="session-list-goal-indicator:${goalSessionIds[status]}"]`,
                }) : null;
                expect(hoverGeometry?.pointerStillOverIndicator).toBe(true);
                const tooltip = page.getByTestId(`session-list-goal-indicator:${goalSessionIds[status]}-tooltip`);
                await expect(tooltip, JSON.stringify({
                    boxBeforeHover,
                    hoverGeometry,
                    pointerEvents: await goal.evaluate((element) => ({
                        pointer: element.getAttribute('data-test-pointer-entered'),
                        mouse: element.getAttribute('data-test-mouse-entered'),
                        html: element.outerHTML,
                        cssPointerEvents: getComputedStyle(element).pointerEvents,
                    })),
                })).toBeVisible();
                await expect(tooltip, JSON.stringify({ hoverGeometry, rowId: goalSessionIds[status] })).toContainText(`Goal ${status}`);
                await expect(tooltip, JSON.stringify({ hoverGeometry, rowId: goalSessionIds[status] })).toContainText(expected);
                const rowBox = await row.boundingBox();
                if (!rowBox) throw new Error(`goal session row ${goalSessionIds[status]} has no layout box`);
                await page.mouse.move(rowBox.x + rowBox.width - 12, rowBox.y + rowBox.height / 2);
                await expect(tooltip).toBeHidden();
                await expect(row.getByTestId('session-item-more-menu')).toBeVisible();
                await goal.focus();
                await page.keyboard.press('Tab');
                await page.keyboard.press('Shift+Tab');
                expect(await goal.evaluate((element) => document.activeElement === element)).toBe(true);
                await expect(tooltip).toBeVisible();
                const layout = await page.evaluate((id) => {
                    const rowNode = document.querySelector<HTMLElement>(`[data-testid="session-list-item-${id}"]`);
                    const goalNode = document.querySelector<HTMLElement>(`[data-testid="session-list-goal-indicator:${id}"]`);
                    const machineNode = document.querySelector<HTMLElement>(`[data-testid="session-list-machine-identity-${id}"]`);
                    if (!rowNode || !goalNode) throw new Error('goal row or indicator is missing');
                    const rowBox = rowNode.getBoundingClientRect();
                    const goalBox = goalNode.getBoundingClientRect();
                    const machineBox = machineNode?.getBoundingClientRect();
                    const svg = goalNode.querySelector('svg');
                    return {
                        color: svg ? getComputedStyle(svg).color : null,
                        goalInsideRow: goalBox.left >= rowBox.left && goalBox.right <= rowBox.right,
                        machineInsideRow: machineBox ? machineBox.left >= rowBox.left && machineBox.right <= rowBox.right : false,
                    };
                }, goalSessionIds[status]);
                expect(layout.goalInsideRow).toBe(true);
                expect(layout.machineInsideRow).toBe(true);
                expect(layout.color).toBeTruthy();
            }
            const colors = await Promise.all((['active', 'complete', 'paused'] as const).map(async (status) =>
                indicator(status).locator('svg').evaluate((svg) => getComputedStyle(svg).color),
            ));
            expect(new Set(colors).size).toBe(3);
        };
        const checkRowsWithDiagnostics = async () => {
            try {
                await checkRows();
            } catch (error) {
                throw appendBrowserDiagnostics(error, browserDiagnostics());
            }
        };
        const dismissRowTooltips = async () => {
            await page.mouse.move(0, 0);
            await page.evaluate(() => {
                const activeElement = document.activeElement;
                if (activeElement instanceof HTMLElement && activeElement !== document.body) activeElement.blur();
            });
            for (const status of ['active', 'complete', 'paused'] as const) {
                await expect(page.getByTestId(`session-list-goal-indicator:${goalSessionIds[status]}-tooltip`)).toBeHidden();
            }
            await expect(page.getByTestId(`session-list-machine-identity-${goalSessionIds.active}-tooltip`)).toBeHidden();
        };

        await mutateUiE2eLocalSettings({ page, settingsPatch: { themePreference: 'light', uiItemDensity: 'compact', uiFontScale: 1 } });
        await page.reload();
        await waitForInitialAppUi({ page, timeoutMs: 120_000 });
        await checkMachineHover();
        await checkRowsWithDiagnostics();
        await dismissRowTooltips();
        await page.screenshot({ path: `${suiteDir}/oh70-goal-indicators-light-compact.png` });

        await mutateUiE2eLocalSettings({ page, settingsPatch: { themePreference: 'dark', uiItemDensity: 'compact', uiFontScale: 1.3 } });
        await page.reload();
        await waitForInitialAppUi({ page, timeoutMs: 120_000 });
        await checkRowsWithDiagnostics();
        await dismissRowTooltips();
        await page.screenshot({ path: `${suiteDir}/oh70-goal-indicators-dark-large-text.png` });
    });
});
