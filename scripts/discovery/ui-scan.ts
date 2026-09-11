import type { Page } from '@playwright/test';
import { applicableTestTypes, potentialAction } from './test-types';
import { rollupCategory, type CategoryStatus, type DiscoveryCategory } from './categories';
import { COLLECT_UI_DOM } from './collect-ui-dom';

export interface UiElementRecord {
  page: string;
  elementId: string;
  elementType: DiscoveryCategory;
  locator: string | null;
  locatorCandidates: string[];
  accessibleName: string | null;
  visible: boolean;
  enabled: boolean;
  required: boolean;
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
}

export interface UiInventory {
  generatedAt: string;
  seedUrl: string;
  pagesScanned: number;
  elements: UiElementRecord[];
  categoryStatus: CategoryStatus[];
}

interface RawUiElement {
  category: DiscoveryCategory;
  tag: string;
  inputType: string | null;
  role: string | null;
  text: string;
  ariaLabel: string | null;
  placeholder: string | null;
  name: string | null;
  id: string | null;
  testId: string | null;
  visible: boolean;
  enabled: boolean;
  required: boolean;
  href: string | null;
  isSubmit: boolean;
  readOnly: boolean;
  min: string | null;
  max: string | null;
  minLength: string | null;
  maxLength: string | null;
  formMethod: string | null;
  evidence: string;
  candidate: boolean;
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
    const attr = cssAttr('data-testid', raw.testId);
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
    'interactive',
  ].includes(category);
}

function toRecord(raw: RawUiElement, pageUrl: string, index: number): UiElementRecord {
  const locators = buildLocatorCandidates(raw);
  const flags = { required: raw.required, isSubmit: raw.isSubmit, interactive: isInteractive(raw.category) };
  return {
    page: pageUrl,
    elementId: `UI-${String(index + 1).padStart(4, '0')}`,
    elementType: raw.category,
    locator: locators[0] ?? null,
    locatorCandidates: locators,
    accessibleName: raw.ariaLabel || raw.text || raw.placeholder || raw.name || null,
    visible: raw.visible,
    enabled: raw.enabled,
    required: raw.required,
    interactive: flags.interactive,
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
  };
}

export async function scanPageUi(page: Page, pageUrl: string): Promise<UiElementRecord[]> {
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

  const raw = (await page.evaluate(COLLECT_UI_DOM)) as RawUiElement[];

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
  pagination: 'No pagination landmark or rel=next|prev observed',
  search: 'No search input or role=search observed',
  filter: 'No control whose accessible name matched filter/refine',
  sort: 'No control whose accessible name matched sort/order by',
  tab: 'No role=tab or tablist observed',
  accordion: 'No details or aria-expanded disclosure observed',
  modal: 'No dialog / role=dialog observed',
  popup: 'No menu, listbox, or popover observed',
  tooltip: 'No role=tooltip (title attributes are candidates only)',
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
  const numbered = elements.map((el, index) => ({
    ...el,
    elementId: `UI-${String(index + 1).padStart(4, '0')}`,
  }));
  const interactive = numbered.filter((el) => el.interactive);
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
