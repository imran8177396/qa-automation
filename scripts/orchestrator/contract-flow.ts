/**
 * Part 19 contract: 20 named qa:all steps, in order.
 * Extra existing stages (dependencies, content, workflows, collect) still run
 * between these keys; they are not a rewrite of the pipeline.
 *
 * Steps 11–12 share one child process (`scripts/run-performance.ts`, liveness
 * only — never `--authorize-heavy`). The printed rollup splits UI vs JMeter.
 */
export interface ContractNamedStep {
  n: number;
  key: string;
  title: string;
}

export const CONTRACT_NAMED_STEPS: readonly ContractNamedStep[] = [
  { n: 1, key: 'preflight', title: 'Preflight' },
  { n: 2, key: 'discovery', title: 'Discovery' },
  { n: 3, key: 'inventory', title: 'Inventory' },
  { n: 4, key: 'coverage-planning', title: 'Coverage planning' },
  { n: 5, key: 'e2e', title: 'Playwright UI/E2E' },
  { n: 6, key: 'visual', title: 'Visual' },
  { n: 7, key: 'responsive', title: 'Responsive' },
  { n: 8, key: 'cross-browser', title: 'Cross-browser' },
  { n: 9, key: 'accessibility', title: 'Accessibility' },
  { n: 10, key: 'api', title: 'Postman API' },
  { n: 11, key: 'performance', title: 'UI performance' },
  { n: 12, key: 'performance', title: 'JMeter smoke' },
  { n: 13, key: 'security', title: 'Security' },
  { n: 14, key: 'seo', title: 'SEO/content' },
  { n: 15, key: 'analyze', title: 'Failure analysis' },
  { n: 16, key: 'retest', title: 'Retest where appropriate' },
  { n: 17, key: 'coverage', title: 'Coverage' },
  { n: 18, key: 'allure', title: 'Allure' },
  { n: 19, key: 'playwright-reports', title: 'Playwright reports' },
  { n: 20, key: 'report', title: 'Final QA summary' },
];

/** Unique stage keys in contract order (performance appears once). */
export const CONTRACT_STAGE_KEYS: readonly string[] = CONTRACT_NAMED_STEPS.map((step) => step.key).filter(
  (key, index, all) => all.indexOf(key) === index
);

export const REPORTING_STAGE_KEYS = ['allure', 'playwright-reports', 'report'] as const;

export function contractKeysInOrder(stageKeys: string[]): { ok: boolean; violations: string[] } {
  const violations: string[] = [];
  let lastIndex = -1;
  for (const key of CONTRACT_STAGE_KEYS) {
    const index = stageKeys.indexOf(key);
    if (index < 0) {
      violations.push(`Missing contract stage: ${key}`);
      continue;
    }
    if (index <= lastIndex) {
      violations.push(`Contract stage ${key} is out of order`);
    }
    lastIndex = index;
  }
  return { ok: violations.length === 0, violations };
}
