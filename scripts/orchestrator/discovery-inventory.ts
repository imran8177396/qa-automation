import { classifyElements } from '../inventory/classify-elements';
import type { ElementRecord, ElementType, InventoryResult } from '../inventory/types';
import type { PageMap } from '../discovery/page-map';
import type { UiElementRecord, UiInventory } from '../discovery/ui-scan';
import type { SafetyConfigResolved } from '../core/safety-policy';

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

export function buildDiscoveryInventory(
  pageMap: PageMap,
  ui: UiInventory,
  safety: SafetyConfigResolved
): InventoryResult {
  const records: ElementRecord[] = ui.elements.map((el) => ({
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

  return {
    generatedAt: new Date().toISOString(),
    pages: pageMap.pages.length,
    elements: classifyElements(records, safety),
  };
}
