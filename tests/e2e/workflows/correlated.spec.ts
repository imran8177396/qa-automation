import { test, expect, type Page } from '@playwright/test';
import { loadConfig } from '../../../scripts/lib/load-config';
import { buildWorkflowExecutionPlan } from '../../../scripts/correlation/execution-plan';
import { NO_DISCOVERED_XHR_AND_NO_PAIR } from '../../../scripts/correlation/applicability';
import { recordRuntimeCorrelation } from '../../../scripts/correlation/evidence';
import { responseMatchesPair } from '../../../scripts/correlation/pairs';
import type { CorrelatedWorkflow } from '../../../scripts/correlation/resolve';

const plan = buildWorkflowExecutionPlan(loadConfig());

test('@workflow documented correlated configuration', async () => {
  if (plan.correlated.length === 0) {
    expect(
      plan.correlated,
      `UNCOVERED / NOT_APPLICABLE: ${NO_DISCOVERED_XHR_AND_NO_PAIR}. Inferred discovery workflows still execute when present. JSONPlaceholder is not forced into Sauce Demo UI.`
    ).toEqual([]);
    expect(plan.applicability.discoveredXhrCount, 'Sauce Demo REST is not invented when discovery recorded 0 XHR').toBe(0);
    return;
  }
  expect(plan.correlated.length).toBeGreaterThan(0);
});

async function runCorrelatedPair(
  page: Page,
  workflow: CorrelatedWorkflow,
  scope: 'product' | 'framework-self-check'
): Promise<void> {
  const matches = (response: { url(): string; request(): { method(): string } }) =>
    responseMatchesPair(response.url(), response.request().method(), workflow.apiMethod, workflow.apiPath);

  let apiStatus = 0;
  let apiUrl = workflow.apiPath;
  let apiMethod = workflow.apiMethod;

  if (workflow.uiAction) {
    const navigation = await page.goto(workflow.uiPath);
    const navStatus = navigation?.status() ?? 0;
    expect(navStatus, `BLOCKED: UI path ${workflow.uiPath} is not available (HTTP ${navStatus}).`).toBeGreaterThanOrEqual(200);
    expect(navStatus, `BLOCKED: UI path ${workflow.uiPath} is not available (HTTP ${navStatus}).`).toBeLessThan(400);
    const pending = page.waitForResponse(matches, { timeout: 15000 });
    await page.locator(workflow.uiAction).click();
    const api = await pending;
    apiStatus = api.status();
    apiUrl = api.url();
    apiMethod = api.request().method();
  } else {
    const pending = page.waitForResponse(matches, { timeout: 15000 }).catch(() => null);
    const navigation = await page.goto(workflow.uiPath);
    const navStatus = navigation?.status() ?? 0;
    expect(navStatus, `BLOCKED: UI path ${workflow.uiPath} is not available (HTTP ${navStatus}).`).toBeGreaterThanOrEqual(200);
    expect(navStatus, `BLOCKED: UI path ${workflow.uiPath} is not available (HTTP ${navStatus}).`).toBeLessThan(400);
    const api = await pending;
    expect(
      api,
      `No ${workflow.apiMethod} ${workflow.apiPath} was observed after opening ${workflow.uiPath}. Endpoints are not invented.`
    ).toBeTruthy();
    if (api) {
      apiStatus = api.status();
      apiUrl = api.url();
      apiMethod = api.request().method();
    }
  }

  expect(apiStatus, `${workflow.apiMethod} ${workflow.apiPath} status`).toBe(workflow.expectedStatus ?? 200);
  if (workflow.uiResult) {
    await expect(page.locator(workflow.uiResult)).toBeVisible();
  } else {
    await expect(page.locator('body')).toBeVisible();
  }

  const uiActual = workflow.uiResult ? ((await page.locator(workflow.uiResult).textContent()) ?? '').trim() : 'body visible';
  recordRuntimeCorrelation({
    id: workflow.id,
    name: workflow.name,
    scope,
    status: 'PASS',
    request: { url: apiUrl, method: apiMethod, status: apiStatus },
    uiAssertion: {
      locator: workflow.uiResult ?? 'body',
      expected: workflow.uiResult ? 'visible result after API response' : 'body visible',
      actual: uiActual || 'visible',
    },
  });
}

for (const workflow of plan.correlated) {
  test(`@workflow ${workflow.name} — UI action → API → UI`, async ({ page }) => {
    await runCorrelatedPair(page, workflow, 'product');
  });
}

for (const workflow of plan.executable.filter((row) => row.kind === 'fixture-self-check')) {
  test(`@workflow ${workflow.id} ${workflow.name}`, async ({ page }) => {
    const pair = plan.applicability.fixtureSelfCheck.pair;
    await runCorrelatedPair(page, pair, 'framework-self-check');
  });
}

for (const workflow of plan.executable.filter((row) => row.kind === 'inferred-navigation')) {
  test(`@workflow inferred ${workflow.id} ${workflow.name}`, async ({ page }) => {
    const path = workflow.uiPath || '/';
    const response = await page.goto(path);
    const status = response?.status() ?? 0;
    expect(status, `Inferred navigation ${workflow.id} ${path} returned HTTP ${status}`).toBeGreaterThanOrEqual(200);
    expect(status, `Inferred navigation ${workflow.id} ${path} returned HTTP ${status}`).toBeLessThan(400);
    await expect(page.locator('body')).toBeVisible();
  });
}

for (const workflow of plan.gated) {
  test(`@workflow gated ${workflow.id} ${workflow.name} — ${workflow.status}`, () => {
    expect(workflow.status, workflow.reason ?? `${workflow.status}: no reason recorded`).not.toBe('PLANNED');
    expect(workflow.reason, `${workflow.id} must record why it did not execute`).toBeTruthy();
    if (workflow.id === 'WF-CORRELATED' || workflow.id === 'WF-DISCOVERED-NETWORK') {
      expect(workflow.reason, 'N/A evidence must name the missing XHR/pair').toMatch(/no discovered XHR|candidates only|not forced/i);
    }
  });
}
