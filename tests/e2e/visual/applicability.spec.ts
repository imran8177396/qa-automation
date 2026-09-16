import { test } from '../../../fixtures/qa-test';
import { planVisualChecks } from '../../../scripts/visual/applicability';

/**
 * Record checks that would require inventing a page or region.
 * Skipped with reason — not a screenshot pass.
 */
test.describe('visual applicability @visual', () => {
  for (const check of planVisualChecks().filter((row) => row.status === 'NOT_APPLICABLE')) {
    test(`${check.name} is NOT_APPLICABLE`, () => {
      test.info().annotations.push({ type: 'NOT_APPLICABLE', description: check.reason });
      test.skip(true, check.reason);
    });
  }
});
