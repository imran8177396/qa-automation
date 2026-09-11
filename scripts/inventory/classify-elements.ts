import { classify, type SafetyConfigResolved } from '../core/safety-policy';
import type { ElementRecord } from './types';

/** Labels each element's risk for reporting — see safety-policy.ts for why this never authorizes anything. */
export function classifyElements(elements: ElementRecord[], safety: SafetyConfigResolved): ElementRecord[] {
  return elements.map((el) => ({
    ...el,
    risk: classify(
      {
        text: el.label ?? undefined,
        href: el.href ?? undefined,
        formMethod: el.formMethod ?? undefined,
        pageUrl: el.page,
        selector: el.locatorCandidates[0],
      },
      safety
    ),
  }));
}
