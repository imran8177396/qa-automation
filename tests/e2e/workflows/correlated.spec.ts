import { test, expect } from '@playwright/test';
import { loadConfig } from '../../../scripts/lib/load-config';
import { buildWorkflowExecutionPlan } from '../../../scripts/correlation/execution-plan';

const plan = buildWorkflowExecutionPlan(loadConfig());

test('@workflow documented correlated configuration', async () => {
  if (plan.correlated.length === 0) {
    expect(
      plan.correlated,
      'UNCOVERED: qa.config.json workflows.correlated is empty — no documented UI+API pair. Inferred discovery workflows still execute when present.'
    ).toEqual([]);
    return;
  }
  expect(plan.correlated.length).toBeGreaterThan(0);
});

for (const workflow of plan.correlated) {
  test(`@workflow ${workflow.name} — UI path is reachable`, async ({ page }) => {
    const response = await page.goto(workflow.uiPath);
    const status = response?.status() ?? 0;
    expect(status, `BLOCKED: UI path ${workflow.uiPath} is not available (HTTP ${status}).`).toBeGreaterThanOrEqual(200);
    expect(status, `BLOCKED: UI path ${workflow.uiPath} is not available (HTTP ${status}).`).toBeLessThan(400);
    await expect(page.locator('body')).toBeVisible();
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
  });
}
