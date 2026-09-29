import type { Page } from '@playwright/test';
import { applicableTestTypes, potentialAction } from './test-types';
import { rollupCategory, type CategoryStatus, type DiscoveryCategory } from './categories';
import { COLLECT_UI_DOM, collectUiDomScript } from './collect-ui-dom';
import {
  classifyElementKind,
  type ElementKind,
  type LocatorStrategy,
} from './element-kind';

export interface UiElementRecord {
  page: string;
  elementId: string;
  elementType: DiscoveryCategory;
  /** Fine-grained kind from tag/type/role/aria/name — not CSS classes. */
  elementKind?: ElementKind;
  /** Published alias of elementKind (set when stable ids are assigned per screen). */
  type?: ElementKind;
  /** HTML tag from the scan snapshot. */
  tag?: string | null;
  locator: string | null;
  locatorCandidates: string[];
  /** How the published locator was chosen (stable-id pass). */
  locatorStrategy?: LocatorStrategy;
  /** False for tag-only fallback or when locator is null (ambiguous). */
  locatorStable?: boolean;
  /** Present when locator is null because fallback would be ambiguous. */
  locatorReason?: string;
  accessibleName: string | null;
  label?: string | null;
  visible: boolean;
  enabled: boolean;
  required: boolean;
  editable?: boolean;
  interactive: boolean;
  potentialAction: string;
  applicableTestTypes: ReturnType<typeof applicableTestTypes>;
  discoveryStatus: 'DISCOVERED' | 'CANDIDATE';
  evidence: string;
  href?: string | null;
  isSubmit?: boolean;
  readOnly?: boolean;
  min?: string | null;
  max?: string | null;
  minLength?: string | null;
  maxLength?: string | null;
  formMethod?: string | null;
  inputType?: string | null;
  attributes?: Record<string, string>;
  /**
   * Discovered option value list for select controls — never invented.
   * Empty / omitted means no options were observed in the scan.
   */
  optionValues?: string[];
  /** Observed request URL from element evidence when discovery recorded one. */
  requestUrl?: string | null;
  /** Observed HTTP method when discovery recorded one — never invent POST. */
  requestMethod?: string | null;
  /** Observed request body fixture string when discovery recorded one — never invent. */
  requestBody?: string | null;
  /** Documented expected HTTP status when present — never invent. */
  expectedStatus?: number | null;
  /** Observed actual HTTP status when a response was recorded — never invent. */
  actualStatus?: number | null;
  /** True when the node was inside dialog / role=dialog / aria-modal at scan time. */
  insideOverlay?: boolean;
  /** True when role=img (or img) inside a figure had an accessible name. */
  chartCandidate?: boolean;
  /** SCREEN-NNN when attached via attachElementsToScreens. */
  screenId?: string;
}

/** Per-screen element group — every real screen id appears, even with an empty list. */
export interface ScreenElementInventory {
  screenId: string;
  url: string;
  state: string;
  elements: UiElementRecord[];
}

export interface UiInventory {
  generatedAt: string;
  seedUrl: string;
  pagesScanned: number;
  elements: UiElementRecord[];
  categoryStatus: CategoryStatus[];
  /** Populated after buildScreenInventory; every screen id has a row. */
  screenElements?: ScreenElementInventory[];
}

interface RawUiElement {
  category: DiscoveryCategory;
  tag: string;
  inputType: string | null;
  role: string | null;
  text: string;
  controlValue: string | null;
  ariaLabel: string | null;
  label: string | null;
  placeholder: string | null;
  name: string | null;
  id: string | null;
  testId: string | null;
  testIdAttribute: string | null;
  visible: boolean;
  enabled: boolean;
  required: boolean;
  editable: boolean;
  href: string | null;
  isSubmit: boolean;
  readOnly: boolean;
  min: string | null;
  max: string | null;
  minLength: string | null;
  maxLength: string | null;
  formMethod: string | null;
  attributes: Record<string, string>;
  optionValues?: string[];
  evidence: string;
  candidate: boolean;
  insideOverlay?: boolean;
  chartCandidate?: boolean;
}

const MAX_ELEMENTS_PER_PAGE = 400;

function cssAttr(name: string, value: string): string | null {
  if (value.includes('"') && value.includes("'")) return null;
  const quote = value.includes('"') ? "'" : '"';
  return `[${name}=${quote}${value}${quote}]`;
}

function buildLocatorCandidates(raw: RawUiElement): string[] {
  const candidates: string[] = [];
  if (raw.testId) {
    const attrName = raw.testIdAttribute || 'data-testid';
    const attr = cssAttr(attrName, raw.testId);
    if (attr) candidates.push(attr);
  }
  if (raw.id) {
    const idSelector = /^[A-Za-z_][A-Za-z0-9_-]*$/.test(raw.id) ? `#${raw.id}` : cssAttr('id', raw.id);
    if (idSelector) candidates.push(idSelector);
  }
  if (raw.ariaLabel) {
    const attr = cssAttr('aria-label', raw.ariaLabel);
    if (attr) candidates.push(attr);
  }
  if (raw.name) {
    const attr = cssAttr('name', raw.name);
    if (attr) candidates.push(attr);
  }
  if (raw.placeholder) {
    const attr = cssAttr('placeholder', raw.placeholder);
    if (attr) candidates.push(attr);
  }
  const skipTextLocator = new Set<DiscoveryCategory>([
    'form',
    'navigation',
    'header',
    'footer',
    'sidebar',
    'table',
    'modal',
    'list',
    'card',
  ]);
  if (raw.text && raw.text.length <= 80 && !raw.text.includes('\n') && !skipTextLocator.has(raw.category)) {
    candidates.push(`text=${raw.text}`);
  }
  return candidates;
}

function isInteractive(category: DiscoveryCategory): boolean {
  return [
    'link',
    'button',
    'input',
    'textarea',
    'select',
    'checkbox',
    'radio',
    'toggle',
    'file-upload',
    'search',
    'tab',
    'slider',
    'menu',
    'interactive',
  ].includes(category);
}

function toRecord(raw: RawUiElement, pageUrl: string, index: number): UiElementRecord {
  const locators = buildLocatorCandidates(raw);
  const flags = { required: raw.required, isSubmit: raw.isSubmit, interactive: isInteractive(raw.category) };
  const accessibleName =
    raw.ariaLabel || raw.label || raw.text || raw.controlValue || raw.placeholder || raw.name || null;
  const elementKind = classifyElementKind({
    tag: raw.tag,
    inputType: raw.inputType,
    role: raw.role,
    elementType: raw.category,
    accessibleName,
    href: raw.href,
    isSubmit: raw.isSubmit,
    evidence: raw.evidence,
    attributes: raw.attributes,
    chartCandidate: Boolean(raw.chartCandidate),
    insideOverlay: Boolean(raw.insideOverlay),
  });
  return {
    page: pageUrl,
    elementId: `UI-${String(index + 1).padStart(4, '0')}`,
    elementType: raw.category,
    elementKind,
    tag: raw.tag,
    locator: locators[0] ?? null,
    locatorCandidates: locators,
    accessibleName,
    label: raw.label,
    visible: raw.visible,
    enabled: raw.enabled,
    required: raw.required,
    editable: Boolean(raw.editable),
    interactive: flags.interactive && elementKind !== 'decorative',
    potentialAction: potentialAction(raw.category, { isSubmit: raw.isSubmit, href: raw.href }),
    applicableTestTypes: applicableTestTypes(raw.category, flags),
    discoveryStatus: raw.candidate ? 'CANDIDATE' : 'DISCOVERED',
    evidence: raw.inputType === 'password' ? `${raw.evidence} (type=password)` : raw.evidence,
    href: raw.href,
    isSubmit: raw.isSubmit,
    readOnly: raw.readOnly,
    min: raw.min,
    max: raw.max,
    minLength: raw.minLength,
    maxLength: raw.maxLength,
    formMethod: raw.formMethod,
    inputType: raw.inputType,
    attributes: raw.attributes,
    optionValues: Array.isArray(raw.optionValues)
      ? raw.optionValues.filter((v) => typeof v === 'string' && v.length > 0)
      : undefined,
    insideOverlay: Boolean(raw.insideOverlay),
    chartCandidate: Boolean(raw.chartCandidate),
  };
}

export async function scanPageUi(
  page: Page,
  pageUrl: string,
  options: { testIdAttributes?: string[] } = {}
): Promise<UiElementRecord[]> {
  await page
    .locator('body')
    .first()
    .waitFor({ state: 'attached', timeout: 5000 })
    .catch(() => undefined);

  await page
    .locator('h1, a[href], button, input, header, nav')
    .first()
    .waitFor({ state: 'attached', timeout: 5000 })
    .catch(() => undefined);

  const script = options.testIdAttributes?.length
    ? collectUiDomScript(options.testIdAttributes)
    : COLLECT_UI_DOM;
  const raw = (await page.evaluate(script)) as RawUiElement[];

  return raw.slice(0, MAX_ELEMENTS_PER_PAGE).map((item, index) =>
    toRecord(item as RawUiElement, pageUrl, index)
  );
}

const UI_CATEGORY_REASONS: Partial<Record<DiscoveryCategory, string>> = {
  header: 'No <header> or role=banner observed',
  footer: 'No <footer> or role=contentinfo observed',
  sidebar: 'No <aside> or role=complementary observed',
  breadcrumbs: 'No breadcrumb landmark or .breadcrumb markup observed',
  navigation: 'No <nav> or role=navigation observed',
  link: 'No <a href> observed',
  button: 'No button / role=button observed',
  input: 'No text-like input observed',
  textarea: 'No <textarea> observed',
  select: 'No <select> observed',
  checkbox: 'No checkbox observed',
  radio: 'No radio observed',
  toggle: 'No role=switch observed',
  'file-upload': 'No input type=file observed',
  form: 'No <form> observed',
  table: 'No table / role=table observed',
  list: 'No ul/ol / role=list observed',
  card: 'No article / role=article observed',
  pagination: 'No pagination landmark or rel=next|prev observed',
  search: 'No search input or role=search observed',
  filter: 'No control whose accessible name matched filter/refine',
  sort: 'No control whose accessible name matched sort/order by',
  tab: 'No role=tab or tablist observed',
  accordion: 'No details or aria-expanded disclosure observed',
  modal: 'No dialog / role=dialog observed',
  drawer: 'No drawer dialog evidence observed',
  popup: 'No menu, listbox, or popover observed',
  tooltip: 'No role=tooltip (title attributes are candidates only)',
  carousel: 'No aria-roledescription=carousel observed',
  slider: 'No input type=range / role=slider observed',
  chart: 'No named role=img inside figure observed',
  badge: 'No badge status evidence observed',
  alert: 'No role=alert observed',
  notification: 'No notification status evidence observed',
  'empty-state': 'No empty-state status evidence observed',
  'error-state': 'No error-state evidence observed',
  menu: 'No role=menu / menuitem observed',
  image: 'No <img> observed',
  video: 'No <video> or known video embed observed',
};

export function buildUiCategoryStatus(elements: UiElementRecord[]): CategoryStatus[] {
  const uiCategories = Object.keys(UI_CATEGORY_REASONS) as DiscoveryCategory[];
  return uiCategories.map((category) => {
    const matches = elements.filter((el) => el.elementType === category);
    const discovered = matches.filter((el) => el.discoveryStatus === 'DISCOVERED').length;
    const candidates = matches.filter((el) => el.discoveryStatus === 'CANDIDATE').length;
    return rollupCategory(category, discovered, candidates, UI_CATEGORY_REASONS[category] ?? 'Not observed');
  });
}

export function buildUiInventory(seedUrl: string, pagesScanned: number, elements: UiElementRecord[]): UiInventory {
  const numbered = elements.map((el, index) => {
    const withId = {
      ...el,
      elementId: `UI-${String(index + 1).padStart(4, '0')}`,
    };
    if (!withId.elementKind) {
      withId.elementKind = classifyElementKind({
        tag: withId.tag,
        inputType: withId.inputType,
        role: withId.attributes?.role ?? null,
        elementType: withId.elementType,
        accessibleName: withId.accessibleName,
        href: withId.href,
        isSubmit: withId.isSubmit,
        evidence: withId.evidence,
        attributes: withId.attributes,
        chartCandidate: withId.chartCandidate,
        insideOverlay: withId.insideOverlay,
      });
    }
    return withId;
  });
  const interactive = numbered.filter((el) => el.interactive && el.elementKind !== 'decorative');
  const categoryStatus = [
    ...buildUiCategoryStatus(numbered),
    rollupCategory(
      'interactive',
      interactive.filter((el) => el.discoveryStatus === 'DISCOVERED').length,
      interactive.filter((el) => el.discoveryStatus === 'CANDIDATE').length,
      'No interactive controls observed'
    ),
  ];

  return {
    generatedAt: new Date().toISOString(),
    seedUrl,
    pagesScanned,
    elements: numbered,
    categoryStatus,
  };
}
