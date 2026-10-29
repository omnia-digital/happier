import { test, expect, type Page } from '@playwright/test';
import { join } from 'node:path';

import { createRunDirs } from '../../src/testkit/runDir';
import { startServerLight, type StartedServer } from '../../src/testkit/process/serverLight';
import { resolveUiWebBeforeAllTimeoutMs, startUiWeb, type StartedUiWeb } from '../../src/testkit/process/uiWeb';
import { gotoDomContentLoadedWithRetries, normalizeLoopbackBaseUrl } from '../../src/testkit/uiE2e/pageNavigation';
import { ensureAccountReadyForConnect } from '../../src/testkit/uiE2e/ensureAccountReadyForConnect';

const run = createRunDirs({ runLabel: 'ui-e2e-profile-environment' });

function rowSwitch(page: Page, label: string) {
  return page.getByText(label, { exact: true })
    .locator('xpath=ancestor::*[.//*[@role="switch"]][1]').getByRole('switch');
}

function settingsWrite(page: Page) {
  return page.waitForResponse((response) => /^\/v[12]\/account\/settings$/.test(new URL(response.url()).pathname)
    && response.request().method() === 'POST' && response.status() === 200);
}

test.describe('ui e2e: profile environment editor', () => {
  const suiteDir = run.testDir('profile-environment-suite');
  let server: StartedServer | null = null;
  let ui: StartedUiWeb | null = null;
  let uiBaseUrl = '';

  test.beforeAll(async () => {
    const uiEnv = {
      ...process.env,
      EXPO_PUBLIC_DEBUG: '1',
      EXPO_PUBLIC_HAPPY_STORAGE_SCOPE: `e2e-profile-environment-${run.runId}`,
    };
    test.setTimeout(resolveUiWebBeforeAllTimeoutMs(uiEnv));
    server = await startServerLight({ testDir: suiteDir, dbProvider: 'sqlite' });
    ui = await startUiWeb({ testDir: suiteDir, env: { ...uiEnv, EXPO_PUBLIC_HAPPY_SERVER_URL: server.baseUrl } });
    uiBaseUrl = normalizeLoopbackBaseUrl(ui.baseUrl);
  });

  test.afterAll(async () => {
    test.setTimeout(120_000);
    await ui?.stop();
    await server?.stop();
  });

  test('keeps typed values, source edits and vault clearing after saving and reopening', async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await gotoDomContentLoadedWithRetries(page, `${uiBaseUrl}/?happier_hmr=0`);
    await ensureAccountReadyForConnect({ page });
    const profilesUrl = `${uiBaseUrl}/settings/profiles?happier_hmr=0`;
    await gotoDomContentLoadedWithRetries(page, profilesUrl);
    const addProfile = page.getByTestId('profiles-list-add-profile');
    await addProfile.or(page.getByRole('switch')).first().waitFor({ state: 'visible' });
    if (!(await addProfile.isVisible())) {
      const enableProfiles = page.getByRole('switch');
      await expect(enableProfiles).toHaveAttribute('aria-checked', 'false');
      const saved = settingsWrite(page);
      await enableProfiles.click();
      await saved;
      await expect(addProfile).toBeVisible();
    }
    await addProfile.click();
    const profileName = 'OH12 Environment fixture';
    await page.getByPlaceholder('Enter profile name', { exact: true }).fill(profileName);
    await page.getByText('Add Variable', { exact: true }).click();
    await page.getByPlaceholder('Variable name (e.g., MY_CUSTOM_VAR)', { exact: true }).fill('OH12_VALUE');
    await page.getByPlaceholder('Value (e.g., my-value or ${MY_VAR})', { exact: true }).fill('initial');
    await page.getByText('Save', { exact: true }).first().click();
    const value = page.getByPlaceholder('Value', { exact: true });
    await value.fill('');
    await value.pressSequentially('typed-and-reverted');
    await value.fill('');
    await value.pressSequentially('final-fallback');
    await expect(value).toHaveValue('final-fallback');

    const firstSave = settingsWrite(page);
    await page.getByText('Save', { exact: true }).click();
    await firstSave;
    await gotoDomContentLoadedWithRetries(page, profilesUrl);
    await page.getByText(profileName, { exact: true }).click();
    await expect(value).toHaveValue('final-fallback');

    await rowSwitch(page, 'Use value from machine environment').click();
    await expect(rowSwitch(page, 'Use value from machine environment')).toHaveAttribute('aria-checked', 'true');
    const source = page.getByPlaceholder('Source variable name (e.g., Z_AI_MODEL)', { exact: true });
    await source.fill('OH12_SOURCE');
    await source.fill('');
    await expect(rowSwitch(page, 'Use value from machine environment')).toHaveAttribute('aria-checked', 'true');
    await source.pressSequentially('oh12_other');
    await expect(source).toHaveValue('OH12_OTHER');
    const fallback = page.getByPlaceholder('Default value', { exact: true });
    await expect(fallback).toHaveValue('final-fallback');
    await rowSwitch(page, 'Use secret vault').click();
    await expect(fallback).toHaveCount(0);
    await expect(rowSwitch(page, 'Use secret vault')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByText('Session will receive: OH12_VALUE = final-fallback', { exact: true })).toHaveCount(0);
    const vaultSave = settingsWrite(page);
    await page.getByText('Save', { exact: true }).click();
    await vaultSave;
    await gotoDomContentLoadedWithRetries(page, profilesUrl);
    await page.getByText(profileName, { exact: true }).click();
    await expect(source).toHaveValue('OH12_OTHER');
    await expect(fallback).toHaveCount(0);
    await expect(rowSwitch(page, 'Use secret vault')).toHaveAttribute('aria-checked', 'true');
    await source.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(suiteDir, 'profile-environment-vault-persisted.png'), fullPage: true });
    await rowSwitch(page, 'Use secret vault').click();
    await expect(rowSwitch(page, 'Use secret vault')).toHaveAttribute('aria-checked', 'false');
    await expect(fallback).toHaveValue('');
  });
});
