import {
  ASSERTION_PASS_RATE_SCOPE,
  UI_EXECUTION_PASS_RATE_SCOPE,
  type LabelledPassRate,
} from '../pass-rate';

export const NOT_AVAILABLE = 'NOT_AVAILABLE';

/** `55.6% (5/9 UI executions, 1 skipped excluded)` — scope and denominator inline. */
export function formatLabelledPassRate(
  rate: LabelledPassRate,
  extras?: { skipped?: number }
): string {
  if (rate.value == null || rate.denominator === 0) {
    return NOT_AVAILABLE;
  }
  const percent = `${rate.value}%`;
  if (rate.scope === UI_EXECUTION_PASS_RATE_SCOPE) {
    const skipPart =
      extras?.skipped != null
        ? `, ${extras.skipped} skipped excluded`
        : rate.excludesSkipped
          ? ', skipped excluded'
          : '';
    return `${percent} (${rate.numerator}/${rate.denominator} UI executions${skipPart})`;
  }
  if (rate.scope === ASSERTION_PASS_RATE_SCOPE) {
    return `${percent} (${rate.numerator}/${rate.denominator} assertions)`;
  }
  return `${percent} (${rate.numerator}/${rate.denominator} ${rate.scope})`;
}
