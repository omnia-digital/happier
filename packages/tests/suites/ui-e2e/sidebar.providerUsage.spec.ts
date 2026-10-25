import { test, expect, type Page } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import {
    buildProviderAccountUsageRecordId,
    ProviderAccountUsageSnapshotV1Schema,
    sealProviderAccountUsageSnapshot,
} from '@happier-dev/protocol';

import { fetchJson } from '../../src/testkit/http';
import { startServerLight, type StartedServer } from '../../src/testkit/process/serverLight';
import { startUiWeb, type StartedUiWeb } from '../../src/testkit/process/uiWeb';
import { createRunDirs } from '../../src/testkit/runDir';
import { gotoDomContentLoadedWithRetries, normalizeLoopbackBaseUrl } from '../../src/testkit/uiE2e/pageNavigation';
import { waitForInitialAppUi } from '../../src/testkit/uiE2e/waitForInitialAppUi';
import { ensureAccountReadyForConnect } from '../../src/testkit/uiE2e/ensureAccountReadyForConnect';

const run = createRunDirs({ runLabel: 'ui-e2e' });
const suiteDir = run.testDir('sidebar-provider-usage');

async function browserCredentials(page: Page): Promise<{ token: string; secret: Uint8Array }> {
    const stored = await page.evaluate(() => {
        for (let index = 0; index < localStorage.length; index += 1) {
            const key = localStorage.key(index);
            if (!key?.startsWith('auth_credentials')) continue;
            const raw = localStorage.getItem(key);
            if (!raw) continue;
            const value = JSON.parse(raw) as { token?: unknown; secret?: unknown };
            if (typeof value.token === 'string' && typeof value.secret === 'string') {
                return { token: value.token, secret: value.secret };
            }
        }
        return null;
    });
    if (!stored) throw new Error('Browser account credentials unavailable in isolated fixture');
    return { token: stored.token, secret: Buffer.from(stored.secret, 'base64url') };
}

async function enableUsageUi(page: Page, uiBaseUrl: string): Promise<void> {
    await gotoDomContentLoadedWithRetries(page, `${uiBaseUrl}/settings/features?happier_hmr=0`, 180_000);
    for (const id of ['settings-feature-experiments-toggle', 'settings-feature-toggle-connectedServices',
        'settings-feature-toggle-connectedServices.quotas']) {
        const toggle = page.getByTestId(id);
        await expect(toggle).toBeVisible({ timeout: 60_000 });
        if (await toggle.getAttribute('aria-checked') !== 'true') await toggle.click();
    }
    await gotoDomContentLoadedWithRetries(page, `${uiBaseUrl}/?happier_hmr=0`, 180_000);
    await waitForInitialAppUi({ page, timeoutMs: 180_000 });
}

async function writeNativeUsage(params: Readonly<{
    baseUrl: string;
    token: string;
    secret: Uint8Array;
    providerId: 'claude' | 'codex';
    accountSubjectId: string;
    accountLabel: string;
    remaining: number;
}>): Promise<string> {
    const now = Date.now();
    const recordKey = {
        providerId: params.providerId,
        accountSubjectId: params.accountSubjectId,
        subjectKind: 'account' as const,
        quotaScope: 'account' as const,
    };
    const recordId = buildProviderAccountUsageRecordId(recordKey);
    const snapshot = ProviderAccountUsageSnapshotV1Schema.parse({
        v: 1, recordId, recordKey, providerId: params.providerId,
        accountSubject: { kind: 'providerSubject', id: params.accountSubjectId },
        accountLabel: params.accountLabel,
        observedAtMs: now, fetchedAtMs: now, staleAfterMs: 60_000,
        source: 'runtimeSignal', confidence: 'confirmed', state: 'loaded_data',
        meters: [{
            meterId: 'weekly', label: 'Weekly', used: 100 - params.remaining, limit: 100,
            remainingPct: params.remaining, usedPct: 100 - params.remaining,
            unit: 'count', utilizationPct: 100 - params.remaining, resetsAt: now + 3_600_000,
            status: 'ok', details: { limitCategory: 'usage_limit' },
        }],
    });
    const response = await fetchJson<{ success?: boolean }>(`${params.baseUrl}/v2/connect/provider-account-usage/${recordId}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${params.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            recordKey,
            sealed: sealProviderAccountUsageSnapshot({
                material: { type: 'legacy', secret: params.secret }, snapshot, randomBytes,
            }),
            metadata: { fetchedAt: now, staleAfterMs: snapshot.staleAfterMs, status: 'ok' },
        }),
        timeoutMs: 20_000,
    });
    expect(response.status).toBe(200);
    expect(response.data?.success).toBe(true);
    return recordId;
}

test.describe('sidebar provider subscription usage', () => {
    let server: StartedServer | null = null;
    let ui: StartedUiWeb | null = null;
    let uiBaseUrl: string | null = null;

    test.beforeAll(async () => {
        test.setTimeout(540_000);
        await mkdir(suiteDir, { recursive: true });
        server = await startServerLight({
            testDir: suiteDir, dbProvider: 'sqlite',
            extraEnv: {
                HAPPIER_FEATURE_AUTH_LOGIN__KEY_CHALLENGE_ENABLED: '1',
                HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY: 'optional',
                HAPPIER_FEATURE_CONNECTED_SERVICES__ENABLED: '1',
                HAPPIER_FEATURE_CONNECTED_SERVICES_QUOTAS__ENABLED: '1',
            },
        });
        ui = await startUiWeb({
            testDir: suiteDir,
            env: {
                ...process.env,
                HAPPIER_E2E_UI_WEB_EXPORT_NAMESPACE: 'oh72-sidebar-provider-usage',
                EXPO_PUBLIC_DEBUG: '1',
                EXPO_PUBLIC_HAPPY_SERVER_URL: server.baseUrl,
                EXPO_PUBLIC_HAPPY_STORAGE_SCOPE: `e2e-sidebar-provider-usage-${run.runId}`,
            },
        });
        uiBaseUrl = normalizeLoopbackBaseUrl(ui.baseUrl);
    });

    test.afterAll(async () => {
        test.setTimeout(60_000);
        await ui?.stop().catch(() => {});
        await server?.stop().catch(() => {});
    });

    test('shows both providers without a selected chat and requires a native account choice', async ({ page }) => {
        test.setTimeout(240_000);
        if (!server || !uiBaseUrl) throw new Error('Missing isolated UI fixtures');
        await page.setViewportSize({ width: 1440, height: 900 });
        await gotoDomContentLoadedWithRetries(page, `${uiBaseUrl}/?happier_hmr=0`, 180_000);
        await waitForInitialAppUi({ page, timeoutMs: 180_000 });
        await ensureAccountReadyForConnect({ page, timeoutMs: 120_000 });
        await enableUsageUi(page, uiBaseUrl);
        const auth = await browserCredentials(page);
        const personal = await writeNativeUsage({ baseUrl: server.baseUrl, ...auth,
            providerId: 'claude', accountSubjectId: 'claude-personal', accountLabel: 'Claude Personal', remaining: 29 });
        const work = await writeNativeUsage({ baseUrl: server.baseUrl, ...auth,
            providerId: 'claude', accountSubjectId: 'claude-work', accountLabel: 'Claude Work', remaining: 66 });
        await writeNativeUsage({ baseUrl: server.baseUrl, ...auth,
            providerId: 'codex', accountSubjectId: 'codex-personal', accountLabel: 'Codex Personal', remaining: 0 });

        await page.reload({ waitUntil: 'domcontentloaded' });
        await expect(page.getByTestId('desktop-sidebar-provider-usage')).toBeVisible({ timeout: 60_000 });
        await expect(page.getByTestId('sidebar-provider-usage-state:claude')).toContainText('Choose account');
        await expect(page.getByTestId('sidebar-provider-usage:codex-value')).toHaveText('0');
        await page.getByTestId('sidebar-provider-usage-choice:claude').click();
        await page.getByTestId(`sidebar-provider-usage-option:claude:native:${personal}`).click();
        await expect(page.getByTestId('sidebar-provider-usage:claude-value')).toHaveText('29');
        await expect(page.getByTestId('sidebar-provider-usage-choice:claude')).toContainText('Claude Personal');
        await page.getByTestId('sidebar-provider-usage:claude-badge').click();
        await expect(page.getByTestId('sidebar-provider-usage:claude-popover')).toContainText('Weekly');
        await page.getByTestId('sidebar-provider-usage-choice:claude').click();
        await page.getByTestId(`sidebar-provider-usage-option:claude:native:${work}`).click();
        await expect(page.getByTestId('sidebar-provider-usage:claude-value')).toHaveText('66');
        await expect(page.getByTestId('sidebar-provider-usage:codex-value')).toHaveText('0');

        await page.setViewportSize({ width: 250, height: 800 });
        await expect(page.getByTestId('sidebar-inbox-button')).toBeVisible();
        await expect(page.getByTestId('desktop-sidebar-updates-button')).toBeVisible();
        await expect(page.getByTestId('desktop-sidebar-provider-usage')).toBeVisible();
        await page.screenshot({ path: `${suiteDir}/sidebar-provider-usage-narrow.png` });
        await page.emulateMedia({ colorScheme: 'dark' });
        await page.screenshot({ path: `${suiteDir}/sidebar-provider-usage-dark.png` });
    });
});
