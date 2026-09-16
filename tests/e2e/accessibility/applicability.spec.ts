import { test, expect } from '../../../fixtures/qa-test';
import { planAccessibilityChecks } from '../../../scripts/accessibility/applicability';
import { A11Y_DISCLAIMER } from '../../../scripts/accessibility/types';

/**
 * Record checks that would require inventing chrome or claiming WCAG certification.
 * These are documented NOT_APPLICABLE — not passes.
 */
test.describe('accessibility applicability @accessibility', () => {
  test('reports state this is automated QA-level a11y, not WCAG certification', () => {
    expect(A11Y_DISCLAIMER).toMatch(/not a COMPLETE MANUAL ACCESSIBILITY AUDIT/i);
    expect(A11Y_DISCLAIMER).toMatch(/do not constitute complete WCAG 2\.x conformance/i);
  });

  for (const check of planAccessibilityChecks().filter((row) => row.status === 'NOT_APPLICABLE')) {
    test(`${check.name} is NOT_APPLICABLE`, () => {
      test.info().annotations.push({ type: 'NOT_APPLICABLE', description: check.reason });
      expect(check.status).toBe('NOT_APPLICABLE');
      expect(check.reason.length).toBeGreaterThan(0);
    });
  }
});
