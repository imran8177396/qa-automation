/**
 * Discovery → generation contract.
 * Discovery writes generation-inventory.json from ScreenInventory rows already built.
 * The planner consumes that inventory (or page-map + ui-inventory) and must not crawl again.
 * Brief example payloads are shape-only — never default data when screens are missing.
 */

import { DISCOVERY_CATEGORIES, type DiscoveryCategory } from './categories';
import { elementCategoryFromKind, type ElementKind } from './element-kind';
import type { PageMap, PageMapEntry } from './page-map';
import type { DiscoveredScreen, ScreenInventory } from './screens';
import { applicableTestTypes, potentialAction } from './test-types';
import type { UiElementRecord, UiInventory } from './ui-scan';

export interface GenerationInventoryElement {
  elementId: string;
  type: string;
  label?: string | null;
  required?: boolean;
  screenId?: string;
  /** Coarse category when present on ScreenInventory (e.g. input + email-input). */
  category?: string;
}

export interface GenerationInventoryScreen {
  screenId: string;
  url: string;
  title?: string;
  elements: GenerationInventoryElement[];
}

export interface GenerationInventory {
  version: '1';
  screens: GenerationInventoryScreen[];
}

const DISCOVERY_CATEGORY_SET = new Set<string>(DISCOVERY_CATEGORIES);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True when value looks like the generation contract (version + screens), not a PageMap. */
export function isGenerationInventory(value: unknown): value is GenerationInventory {
  return isPlainObject(value) && value.version === '1' && Array.isArray(value.screens);
}

/**
 * Map normalized ScreenInventory rows into the generation contract.
 * Reuses existing SCREEN-NNN / ELEMENT-NNN identities — does not invent a parallel id scheme.
 * type stays the detailed ElementKind; category is included when present.
 */
export function toGenerationInventory(screens: ScreenInventory[]): GenerationInventory {
  return {
    version: '1',
    screens: screens.map((screen) => {
      const row: GenerationInventoryScreen = {
        screenId: screen.screenId,
        url: screen.url,
        elements: screen.elements.map((el) => {
          const label =
            el.label !== undefined && el.label !== null
              ? el.label
              : el.accessibleName !== undefined
                ? el.accessibleName
                : undefined;
          const mapped: GenerationInventoryElement = {
            elementId: el.elementId,
            type: String(el.type),
            screenId: el.screenId || screen.screenId,
          };
          if (label !== undefined) mapped.label = label;
          if (el.required !== undefined) mapped.required = el.required;
          if (el.category) mapped.category = el.category;
          return mapped;
        }),
      };
      if (screen.title) row.title = screen.title;
      return row;
    }),
  };
}

function parseElement(raw: unknown, screenIndex: number, elementIndex: number): GenerationInventoryElement {
  if (!isPlainObject(raw)) {
    throw new Error(`screens[${screenIndex}].elements[${elementIndex}] must be an object`);
  }
  if (typeof raw.elementId !== 'string' || raw.elementId.length === 0) {
    throw new Error(`screens[${screenIndex}].elements[${elementIndex}].elementId must be a string`);
  }
  if (typeof raw.type !== 'string' || raw.type.length === 0) {
    throw new Error(`screens[${screenIndex}].elements[${elementIndex}].type must be a string`);
  }
  const element: GenerationInventoryElement = {
    elementId: raw.elementId,
    type: raw.type,
  };
  if (raw.label === null || typeof raw.label === 'string') {
    element.label = raw.label as string | null;
  }
  if (typeof raw.required === 'boolean') {
    element.required = raw.required;
  }
  if (typeof raw.screenId === 'string') {
    element.screenId = raw.screenId;
  }
  if (typeof raw.category === 'string') {
    element.category = raw.category;
  }
  return element;
}

function parseScreen(raw: unknown, index: number): GenerationInventoryScreen {
  if (!isPlainObject(raw)) {
    throw new Error(`screens[${index}] must be an object`);
  }
  if (typeof raw.screenId !== 'string' || raw.screenId.length === 0) {
    throw new Error(`screens[${index}].screenId must be a string`);
  }
  if (typeof raw.url !== 'string') {
    throw new Error(`screens[${index}].url must be a string`);
  }
  if (!Array.isArray(raw.elements)) {
    throw new Error(`screens[${index}].elements must be an array`);
  }
  const screen: GenerationInventoryScreen = {
    screenId: raw.screenId,
    url: raw.url,
    elements: raw.elements.map((el, elementIndex) => parseElement(el, index, elementIndex)),
  };
  if (typeof raw.title === 'string') {
    screen.title = raw.title;
  }
  return screen;
}

/**
 * Validate and normalize unknown JSON into GenerationInventory.
 * Rejects non-objects. Empty screens array is valid.
 * Never inserts placeholder create-user routes or demo payloads.
 */
export function parseGenerationInventory(raw: unknown): GenerationInventory {
  if (!isPlainObject(raw)) {
    throw new Error('GenerationInventory must be a non-null object');
  }
  if (raw.version !== '1') {
    throw new Error("GenerationInventory.version must be '1'");
  }
  if (!Array.isArray(raw.screens)) {
    throw new Error('GenerationInventory.screens must be an array');
  }
  return {
    version: '1',
    screens: raw.screens.map((screen, index) => parseScreen(screen, index)),
  };
}

function discoveryCategoryFromContract(
  category: string | undefined,
  type: string
): DiscoveryCategory {
  if (category && DISCOVERY_CATEGORY_SET.has(category)) {
    return category as DiscoveryCategory;
  }
  const derived = elementCategoryFromKind(type);
  if (DISCOVERY_CATEGORY_SET.has(derived)) {
    return derived as DiscoveryCategory;
  }
  if (derived === 'date-picker') return 'input';
  return 'interactive';
}

function routeFromContractUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname || '/'}${parsed.search || ''}${parsed.hash || ''}`;
  } catch {
    return url.trim() || '/';
  }
}

function scopeHostFromUrl(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

function inputTypeHint(kind: string): string | null {
  switch (kind) {
    case 'email-input':
      return 'email';
    case 'password-input':
      return 'password';
    case 'number-input':
      return 'number';
    case 'date-input':
      return 'date';
    case 'time-input':
      return 'time';
    case 'datetime-input':
      return 'datetime-local';
    case 'search-field':
      return 'search';
    case 'file-upload':
      return 'file';
    case 'checkbox':
      return 'checkbox';
    case 'radio':
      return 'radio';
    default:
      return null;
  }
}

/**
 * Adapt the generation contract into the pageMap + ui inputs generateUiChecks already takes.
 * Does not fetch URLs, crawl, or invent min/max/options/required.
 */
export function generationInventoryToPageMapAndUi(inventory: GenerationInventory): {
  pageMap: PageMap;
  ui: UiInventory;
} {
  const generatedAt = new Date().toISOString();
  const seedUrl = inventory.screens[0]?.url ?? '';

  const discoveredScreens: DiscoveredScreen[] = inventory.screens.map((screen) => ({
    id: screen.screenId,
    url: screen.url,
    state: 'default',
    source: 'direct-url',
    ...(screen.title ? { title: screen.title } : {}),
  }));

  const pages: PageMapEntry[] = inventory.screens.map((screen) => ({
    url: screen.url,
    route: routeFromContractUrl(screen.url),
    title: screen.title ?? screen.screenId,
    status: 200,
    ok: true,
    depth: 0,
    h1s: [],
    applicableTestTypes: applicableTestTypes('pages'),
  }));

  const elements: UiElementRecord[] = [];
  for (const screen of inventory.screens) {
    for (const el of screen.elements) {
      const elementType = discoveryCategoryFromContract(el.category, el.type);
      const kind = el.type as ElementKind;
      const name = el.label ?? null;
      const record = {
        page: screen.url,
        elementId: el.elementId,
        elementType,
        elementKind: kind,
        type: kind,
        locator: null,
        locatorCandidates: [],
        accessibleName: name,
        label: name,
        visible: true,
        enabled: true,
        interactive: true,
        potentialAction: potentialAction(elementType),
        applicableTestTypes: applicableTestTypes(elementType),
        discoveryStatus: 'DISCOVERED' as const,
        evidence: 'generation-inventory',
        screenId: el.screenId ?? screen.screenId,
        ...(el.type === 'submit-button' ? { isSubmit: true } : {}),
        ...(inputTypeHint(el.type) ? { inputType: inputTypeHint(el.type) } : {}),
      } as unknown as UiElementRecord;

      if (typeof el.required === 'boolean') {
        record.required = el.required;
      } else {
        delete (record as { required?: boolean }).required;
      }

      elements.push(record);
    }
  }

  const pageMap: PageMap = {
    generatedAt,
    seedUrl,
    scopeHost: scopeHostFromUrl(seedUrl),
    truncated: false,
    pages,
    routes: pages.map((page) => ({
      path: page.route,
      url: page.url,
      title: page.title,
      source: 'crawl',
    })),
    navigation: [],
    skippedByScope: [],
    categoryStatus: [],
    screens: discoveredScreens,
  };

  const ui: UiInventory = {
    generatedAt,
    seedUrl,
    pagesScanned: pages.length,
    elements,
    categoryStatus: [],
    screenElements: inventory.screens.map((screen) => ({
      screenId: screen.screenId,
      url: screen.url,
      state: 'default',
      elements: elements.filter((el) => el.screenId === screen.screenId),
    })),
  };

  return { pageMap, ui };
}
