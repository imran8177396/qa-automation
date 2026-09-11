import { classifyElements } from '../../inventory/classify-elements';
import type { ElementRecord, ElementType } from '../../inventory/types';
import type { InventoryResult } from '../../inventory/types';
import type { UiElementRecord, UiInventory } from '../../discovery/ui-scan';
import { resolveSafetyConfig, type SafetyConfigResolved } from '../../core/safety-policy';
import type { QaConfig } from '../../types';

export interface InventoryModel {
  available: boolean;
  totalElements: number;
  byType: Array<{ label: string; count: number }>;
  byRisk: Array<{ label: string; count: number }>;
}

function countBy<T>(items: T[], keyFn: (item: T) => string): Array<{ label: string; count: number }> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = keyFn(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
}

function elementTypeFromUi(el: UiElementRecord): ElementType {
  switch (el.elementType) {
    case 'button':
      return 'button';
    case 'link':
      return 'link';
    case 'textarea':
      return 'textarea';
    case 'select':
      return 'select';
    case 'checkbox':
      return 'checkbox';
    case 'radio':
      return 'radio';
    case 'file-upload':
      return 'file-upload';
    case 'input':
    case 'search':
      switch (el.inputType) {
        case 'email':
          return 'email-input';
        case 'password':
          return 'password-input';
        case 'number':
          return 'number-input';
        case 'tel':
          return 'tel-input';
        case 'date':
          return 'date-input';
        case 'search':
          return 'search-input';
        default:
          return 'text-input';
      }
    default:
      return 'other';
  }
}

function uiToRecords(ui: UiInventory): ElementRecord[] {
  return ui.elements.map((el) => ({
    page: el.page,
    elementId: el.elementId,
    type: elementTypeFromUi(el),
    role: null,
    label: el.accessibleName,
    href: el.href,
    formMethod: el.formMethod,
    isSubmit: el.isSubmit,
    locatorCandidates: el.locatorCandidates,
    visible: el.visible,
    enabled: el.enabled,
    required: el.required,
    risk: 'unknown',
  }));
}

/**
 * Risk labels are assigned by inventory classifyElements(). When inventory.json
 * is missing, the same classifier is applied to UI inventory — labels are not invented.
 */
export function buildInventoryModel(
  inventoryRaw: InventoryResult | null,
  uiInventoryRaw: UiInventory | null,
  config: QaConfig
): InventoryModel {
  const safety: SafetyConfigResolved = resolveSafetyConfig(config.safety);

  if (inventoryRaw?.elements?.length) {
    const needsClassify = inventoryRaw.elements.some((el) => !el.risk);
    const elements = needsClassify ? classifyElements(inventoryRaw.elements, safety) : inventoryRaw.elements;
    return {
      available: true,
      totalElements: elements.length,
      byType: countBy(elements, (el) => el.type),
      byRisk: countBy(elements, (el) => el.risk),
    };
  }

  if (uiInventoryRaw?.elements?.length) {
    const elements = classifyElements(uiToRecords(uiInventoryRaw), safety);
    return {
      available: true,
      totalElements: elements.length,
      byType: countBy(elements, (el) => el.type),
      byRisk: countBy(elements, (el) => el.risk),
    };
  }

  return { available: false, totalElements: 0, byType: [], byRisk: [] };
}
