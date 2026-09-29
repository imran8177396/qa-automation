/**
 * Fine-grained element kinds from scan evidence (tag / type / role / aria / accessible name).
 * Never invents DOM nodes. Never classifies from app-specific CSS classes.
 */

export const ELEMENT_KINDS = [
  // Navigation
  'link',
  'menu-item',
  'breadcrumb',
  'tab',
  'pagination',
  'nav-button',
  'logo-link',
  'back-button',
  'forward-button',
  // Forms
  'text-input',
  'password-input',
  'email-input',
  'number-input',
  'date-input',
  'time-input',
  'datetime-input',
  'textarea',
  'select',
  'multi-select',
  'checkbox',
  'radio',
  'toggle',
  'file-upload',
  'search-field',
  'autocomplete',
  'masked-input',
  'otp-field',
  // Actions
  'button',
  'submit-button',
  'reset-button',
  'delete-button',
  'edit-button',
  'save-button',
  'cancel-button',
  'download-button',
  'upload-button',
  'copy-button',
  'share-button',
  'refresh-button',
  'load-more-button',
  // Interactive
  'dropdown',
  'accordion',
  'modal',
  'dialog',
  'drawer',
  'tooltip',
  'popover',
  'carousel',
  'slider',
  'date-picker',
  'menu',
  'context-menu',
  // Data display (observable, not click targets)
  'table',
  'card',
  'list',
  'chart',
  'badge',
  'status-indicator',
  'alert',
  'notification',
  'empty-state',
  'error-state',
  // Non-functional
  'decorative',
  // Coarse leftovers / landmarks
  'form',
  'unknown',
] as const;

export type ElementKind = (typeof ELEMENT_KINDS)[number];

/** Action kinds that stay inventoried but must not get PLANNED executable click/submit plans. */
export const BLOCKED_ACTION_KINDS = new Set<ElementKind>([
  'submit-button',
  'delete-button',
  'save-button',
  'reset-button',
  'upload-button',
]);

/** Data-display kinds: one positive observe row; no click plan. */
export const DATA_DISPLAY_KINDS = new Set<ElementKind>([
  'table',
  'card',
  'list',
  'chart',
  'badge',
  'status-indicator',
  'alert',
  'notification',
  'empty-state',
  'error-state',
]);

export const DECORATIVE_PLAN_REASON =
  'NOT_APPLICABLE: decorative element is not a functional control';

/** Signals available from the UI scan record / raw DOM snapshot — never CSS class names. */
export interface ElementKindSignals {
  tag?: string | null;
  inputType?: string | null;
  role?: string | null;
  elementType?: string | null;
  accessibleName?: string | null;
  href?: string | null;
  isSubmit?: boolean;
  evidence?: string | null;
  attributes?: Record<string, string> | null;
  /** True when scanner recorded role=img (or img) inside a <figure> with an accessible name. */
  chartCandidate?: boolean;
  /** True when scanner recorded the node inside dialog / role=dialog / aria-modal. */
  insideOverlay?: boolean;
}

const INTERACTIVE_TAGS = new Set([
  'a',
  'button',
  'input',
  'select',
  'textarea',
  'summary',
  'details',
  'option',
  'label',
]);

function attr(signals: ElementKindSignals, name: string): string {
  return (signals.attributes?.[name] ?? '').trim();
}

function roleOf(signals: ElementKindSignals): string {
  return (signals.role || attr(signals, 'role') || '').toLowerCase();
}

function tagOf(signals: ElementKindSignals): string {
  return (signals.tag || '').toLowerCase();
}

function inputTypeOf(signals: ElementKindSignals): string {
  const fromField = (signals.inputType || '').toLowerCase();
  if (fromField) return fromField;
  return attr(signals, 'type').toLowerCase();
}

function nameBlob(signals: ElementKindSignals): string {
  return (signals.accessibleName || '').trim();
}

/**
 * Decorative exclusion — not a functional control.
 * aria-hidden=true; role=presentation|none; or inert media/span/div with no role, href, name, or interactive tag.
 */
export function isDecorativeElement(signals: ElementKindSignals): boolean {
  if (attr(signals, 'aria-hidden') === 'true') return true;
  const role = roleOf(signals);
  if (role === 'presentation' || role === 'none') return true;

  const tag = tagOf(signals);
  const inertTags = tag === 'img' || tag === 'svg' || tag === 'span' || tag === 'div';
  if (!inertTags) return false;
  if (role) return false;
  if (signals.href && signals.href.trim()) return false;
  if (nameBlob(signals)) return false;
  if (INTERACTIVE_TAGS.has(tag)) return false;
  // img/svg/span/div with nothing interactive → decorative
  return true;
}

function matchName(name: string, pattern: RegExp): boolean {
  return pattern.test(name.trim());
}

function classifyButtonKind(signals: ElementKindSignals): ElementKind {
  const name = nameBlob(signals);
  const type = inputTypeOf(signals);
  const tag = tagOf(signals);

  if (signals.isSubmit || type === 'submit') return 'submit-button';
  if (type === 'reset' || (tag === 'button' && type === 'reset')) return 'reset-button';

  if (matchName(name, /^delete\b/i)) return 'delete-button';
  if (matchName(name, /^save\b/i)) return 'save-button';
  if (matchName(name, /^edit\b/i)) return 'edit-button';
  if (matchName(name, /^cancel\b/i)) return 'cancel-button';
  if (matchName(name, /^download\b/i)) return 'download-button';
  if (matchName(name, /^upload\b/i)) return 'upload-button';
  if (matchName(name, /^copy\b/i)) return 'copy-button';
  if (matchName(name, /^share\b/i)) return 'share-button';
  if (matchName(name, /^refresh\b/i)) return 'refresh-button';
  if (matchName(name, /^load\s*more\b/i)) return 'load-more-button';
  if (matchName(name, /^back\b/i)) return 'back-button';
  if (matchName(name, /^forward\b/i)) return 'forward-button';
  if (matchName(name, /\bnav(igation)?\b/i) || matchName(name, /^menu\b/i)) return 'nav-button';

  return 'button';
}

function classifyLinkKind(signals: ElementKindSignals): ElementKind {
  const name = nameBlob(signals);
  if (matchName(name, /\blogo\b/i)) return 'logo-link';
  if (matchName(name, /^back\b/i)) return 'back-button';
  if (matchName(name, /^forward\b/i)) return 'forward-button';
  return 'link';
}

function classifyInputKind(signals: ElementKindSignals): ElementKind {
  const type = inputTypeOf(signals);
  const name = nameBlob(signals);
  const autocomplete = attr(signals, 'autocomplete').toLowerCase();
  const ariaAuto = attr(signals, 'aria-autocomplete').toLowerCase();
  const inputMode = attr(signals, 'inputmode').toLowerCase();
  const role = roleOf(signals);

  if (type === 'password' || matchName(name, /\bpassword\b/i)) return 'password-input';
  if (type === 'email') return 'email-input';
  if (type === 'number' || inputMode === 'numeric' || inputMode === 'decimal') return 'number-input';
  if (type === 'date') return 'date-input';
  if (type === 'time') return 'time-input';
  if (type === 'datetime-local' || type === 'datetime') return 'datetime-input';
  if (type === 'file') return 'file-upload';
  if (type === 'search' || signals.elementType === 'search') return 'search-field';
  if (type === 'checkbox' || role === 'checkbox') return 'checkbox';
  if (type === 'radio' || role === 'radio') return 'radio';
  if (type === 'range' || role === 'slider') return 'slider';
  if (type === 'hidden') return 'unknown';

  if (matchName(name, /\botp\b/i) || matchName(name, /\bone[-\s]?time\b/i) || matchName(name, /\bpasscode\b/i)) {
    return 'otp-field';
  }
  if (matchName(name, /\bsearch\b/i)) return 'search-field';
  if (
    matchName(name, /\bmask(ed)?\b/i) ||
    autocomplete === 'cc-number' ||
    matchName(name, /\bcard\s*number\b/i)
  ) {
    return 'masked-input';
  }
  if (
    role === 'combobox' ||
    ariaAuto === 'list' ||
    ariaAuto === 'both' ||
    ariaAuto === 'inline' ||
    matchName(name, /\bautocomplete\b/i)
  ) {
    return 'autocomplete';
  }
  if (role === 'spinbutton') return 'number-input';

  return 'text-input';
}

/**
 * Classify a scanned node into a stable elementKind.
 * Uses tag, input type, role, aria attributes, and accessible name only — not CSS classes.
 */
export function classifyElementKind(signals: ElementKindSignals): ElementKind {
  if (isDecorativeElement(signals)) return 'decorative';

  const tag = tagOf(signals);
  const role = roleOf(signals);
  const type = inputTypeOf(signals);
  const name = nameBlob(signals);
  const category = (signals.elementType || '').toLowerCase();
  const scannerKind = attr(signals, 'kind').toLowerCase();

  // Explicit scanner kind (DOM attribute kind=…) — allowlisted tokens only.
  if (scannerKind && (ELEMENT_KINDS as readonly string[]).includes(scannerKind)) {
    return scannerKind as ElementKind;
  }

  if (role === 'tab') return 'tab';
  if (role === 'tabpanel') return 'unknown';
  if (role === 'menuitem' || role === 'menuitemcheckbox' || role === 'menuitemradio') return 'menu-item';
  if (role === 'switch') return 'toggle';
  if (role === 'tooltip') return 'tooltip';
  if (role === 'slider' || type === 'range') return 'slider';
  if (role === 'listbox' || (category === 'popup' && role === 'listbox')) return 'dropdown';
  if (role === 'menu') return 'menu';
  if (role === 'alertdialog') return 'dialog';
  if (role === 'dialog') {
    if (/\bdrawer\b/i.test(name) || /\bdrawer\b/i.test(signals.evidence ?? '') || scannerKind === 'drawer') {
      return 'drawer';
    }
    return 'dialog';
  }
  if (role === 'alert') return 'alert';
  if (role === 'status') {
    if (matchName(name, /\bempty\b/i) || /\bempty[- ]?state\b/i.test(signals.evidence ?? '')) return 'empty-state';
    if (matchName(name, /\berror\b/i) || /\berror[- ]?state\b/i.test(signals.evidence ?? '')) return 'error-state';
    if (matchName(name, /\bbadge\b/i)) return 'badge';
    if (matchName(name, /\bnotif/i)) return 'notification';
    return 'status-indicator';
  }
  if (role === 'img' && (signals.chartCandidate || /\bfigure\b/i.test(signals.evidence ?? ''))) {
    if (nameBlob(signals)) return 'chart';
  }

  if (category === 'breadcrumbs' || role === 'navigation' && /\bbreadcrumb/i.test(name + (signals.evidence ?? ''))) {
    if (category === 'breadcrumbs' || /\bbreadcrumb/i.test(signals.evidence ?? '')) return 'breadcrumb';
  }
  if (category === 'pagination' || /\bpagination\b/i.test(signals.evidence ?? '')) return 'pagination';
  if (category === 'table' || role === 'table' || role === 'grid' || tag === 'table') return 'table';
  if (category === 'accordion' || tag === 'details' || (attr(signals, 'aria-expanded') !== '' && category === 'accordion')) {
    return 'accordion';
  }
  if (category === 'modal') {
    if (/\bdrawer\b/i.test(signals.evidence ?? '') || scannerKind === 'drawer') return 'drawer';
    if (/\bdialog\b/i.test(signals.evidence ?? '') || role === 'dialog') return 'dialog';
    return 'modal';
  }
  if (category === 'tooltip') return 'tooltip';
  if (category === 'popup') {
    if (role === 'menu') return 'menu';
    if (tag === 'div' && attr(signals, 'popover') !== '') return 'popover';
    if (signals.attributes && 'popover' in signals.attributes) return 'popover';
    return 'dropdown';
  }
  if (category === 'file-upload' || type === 'file') return 'file-upload';
  if (category === 'toggle') return 'toggle';
  if (category === 'checkbox' || type === 'checkbox') return 'checkbox';
  if (category === 'radio' || type === 'radio') return 'radio';
  if (category === 'select' || tag === 'select') {
    if (signals.attributes != null && Object.prototype.hasOwnProperty.call(signals.attributes, 'multiple')) {
      return 'multi-select';
    }
    return 'select';
  }
  if (category === 'textarea' || tag === 'textarea') return 'textarea';
  if (category === 'search') return 'search-field';
  if (category === 'form' || tag === 'form') return 'form';
  if (category === 'tab') return 'tab';
  if (category === 'link' || (tag === 'a' && signals.href)) return classifyLinkKind(signals);
  if (category === 'button' || tag === 'button' || role === 'button' || type === 'button' || type === 'submit' || type === 'reset') {
    return classifyButtonKind(signals);
  }
  if (
    category === 'input' ||
    tag === 'input' ||
    role === 'textbox' ||
    role === 'searchbox' ||
    role === 'combobox' ||
    role === 'spinbutton'
  ) {
    return classifyInputKind(signals);
  }

  if (category === 'list' || role === 'list' || tag === 'ul' || tag === 'ol') return 'list';
  if (category === 'card' || role === 'article' || tag === 'article') return 'card';
  if (category === 'carousel' || /\bcarousel\b/i.test(attr(signals, 'aria-roledescription'))) return 'carousel';
  if (category === 'slider') return 'slider';
  if (category === 'chart' || signals.chartCandidate) {
    if (nameBlob(signals)) return 'chart';
  }
  if (category === 'badge') return 'badge';
  if (category === 'alert') return 'alert';
  if (category === 'notification') return 'notification';
  if (category === 'empty-state') return 'empty-state';
  if (category === 'error-state') return 'error-state';
  if (category === 'menu') return 'menu';
  if (category === 'drawer') return 'drawer';
  if (category === 'date-picker' || (type === 'date' && role === 'group')) return 'date-picker';
  if (matchName(name, /\bdate\s*picker\b/i) || attr(signals, 'aria-haspopup') === 'dialog' && matchName(name, /\bdate\b/i)) {
    return 'date-picker';
  }

  // Context menu: button/div with aria-haspopup=menu
  if (attr(signals, 'aria-haspopup') === 'menu' && (role === 'button' || tag === 'button')) {
    return 'context-menu';
  }

  if (category === 'navigation' || category === 'header' || category === 'footer' || category === 'sidebar') {
    return 'unknown';
  }
  if (category === 'image' || tag === 'img' || tag === 'svg') {
    if (signals.chartCandidate && nameBlob(signals)) return 'chart';
    // Named images are content evidence (e.g. SEO alt), not functional controls — not decorative
    // unless isDecorativeElement already matched (aria-hidden / presentation / nameless).
    return 'unknown';
  }

  return 'unknown';
}

/** Map fine kind → coarse planning purpose (avoids a second conflicting label). */
export function purposeFromElementKind(kind: ElementKind):
  | 'navigation-link'
  | 'button'
  | 'text-input'
  | 'password-input'
  | 'hidden-input'
  | 'select'
  | 'checkbox'
  | 'radio'
  | 'form'
  | 'unknown' {
  switch (kind) {
    case 'link':
    case 'menu-item':
    case 'breadcrumb':
    case 'tab':
    case 'pagination':
    case 'nav-button':
    case 'logo-link':
    case 'back-button':
    case 'forward-button':
      return 'navigation-link';
    case 'password-input':
      return 'password-input';
    case 'text-input':
    case 'email-input':
    case 'number-input':
    case 'date-input':
    case 'time-input':
    case 'datetime-input':
    case 'textarea':
    case 'search-field':
    case 'autocomplete':
    case 'masked-input':
    case 'otp-field':
      return 'text-input';
    case 'select':
    case 'multi-select':
    case 'dropdown':
      return 'select';
    case 'checkbox':
    case 'toggle':
      return 'checkbox';
    case 'radio':
      return 'radio';
    case 'form':
      return 'form';
    case 'button':
    case 'submit-button':
    case 'reset-button':
    case 'delete-button':
    case 'edit-button':
    case 'save-button':
    case 'cancel-button':
    case 'download-button':
    case 'upload-button':
    case 'copy-button':
    case 'share-button':
    case 'refresh-button':
    case 'load-more-button':
      return 'button';
    default:
      return 'unknown';
  }
}

export function isBlockedActionKind(kind: ElementKind | undefined | null): boolean {
  return Boolean(kind && BLOCKED_ACTION_KINDS.has(kind));
}

export function isDataDisplayKind(kind: ElementKind | undefined | null): boolean {
  return Boolean(kind && DATA_DISPLAY_KINDS.has(kind));
}

/**
 * Coarse planner category for a published TestableElement.
 * Derived from detailed ElementKind — never a second source of truth for kind.
 *
 * Mapping:
 * - text/password/email/number/time/datetime/masked/otp/autocomplete inputs → "input"
 * - textarea → "textarea"
 * - select, multi-select → "select"
 * - checkbox, toggle → "checkbox"
 * - radio → "radio"
 * - button and all *-button kinds → "button"
 * - link, logo-link, breadcrumb, nav-button that is an anchor → "link"
 * - tab → "tab"
 * - menu, menu-item, context-menu, dropdown → "menu"
 * - modal, dialog, drawer → "modal"
 * - table → "table"
 * - file-upload → "file-upload"
 * - date-picker, date-input → "date-picker"
 * - search-field → "search"
 * - decorative, chart, badge, list, card, alert, and anything else → "other"
 */
export type ElementCategory =
  | 'input'
  | 'textarea'
  | 'select'
  | 'checkbox'
  | 'radio'
  | 'button'
  | 'link'
  | 'tab'
  | 'menu'
  | 'modal'
  | 'table'
  | 'file-upload'
  | 'date-picker'
  | 'search'
  | 'other';

const INPUT_CATEGORY_KINDS = new Set<ElementKind>([
  'text-input',
  'password-input',
  'email-input',
  'number-input',
  'time-input',
  'datetime-input',
  'masked-input',
  'otp-field',
  'autocomplete',
]);

/** Fill-without-submit kinds the planner may record as action "fill". */
export const FILLABLE_ELEMENT_KINDS = new Set<ElementKind>([
  'text-input',
  'password-input',
  'email-input',
  'number-input',
  'date-input',
  'time-input',
  'datetime-input',
  'textarea',
  'select',
  'multi-select',
  'checkbox',
  'radio',
  'toggle',
  'search-field',
  'autocomplete',
  'masked-input',
  'otp-field',
]);

export function elementCategoryFromKind(
  kind: ElementKind | string,
  signals?: { tag?: string | null; href?: string | null }
): ElementCategory {
  const k = kind as ElementKind;
  if (INPUT_CATEGORY_KINDS.has(k)) return 'input';
  if (k === 'textarea') return 'textarea';
  if (k === 'select' || k === 'multi-select') return 'select';
  if (k === 'checkbox' || k === 'toggle') return 'checkbox';
  if (k === 'radio') return 'radio';
  if (k === 'file-upload') return 'file-upload';
  if (k === 'date-picker' || k === 'date-input') return 'date-picker';
  if (k === 'search-field') return 'search';
  if (k === 'tab') return 'tab';
  if (k === 'table') return 'table';
  if (k === 'modal' || k === 'dialog' || k === 'drawer') return 'modal';
  if (k === 'menu' || k === 'menu-item' || k === 'context-menu' || k === 'dropdown') return 'menu';
  if (k === 'link' || k === 'logo-link' || k === 'breadcrumb') return 'link';
  if (k === 'nav-button') {
    const tag = (signals?.tag ?? '').toLowerCase();
    const href = (signals?.href ?? '').trim();
    if (tag === 'a' || href) return 'link';
    return 'button';
  }
  if (k === 'button' || k.endsWith('-button')) return 'button';
  return 'other';
}

/**
 * Planner-allowed action strings from kind evidence only.
 * Observe for visibility; fill for fillable fields; blocked for submit/delete/save/reset/upload.
 * Never records "submit" or "click" as an executable action for state-changing controls.
 * Decorative → ["none"].
 */
export function plannerActionsForKind(kind: ElementKind | string): string[] {
  if (kind === 'decorative') return ['none'];
  const actions: string[] = ['observe'];
  if (FILLABLE_ELEMENT_KINDS.has(kind as ElementKind)) {
    actions.push('fill');
  }
  if (isBlockedActionKind(kind as ElementKind)) {
    actions.push('blocked');
  }
  return actions;
}

// ---------------------------------------------------------------------------
// Stable locators + per-screen ELEMENT-NNN ids
// ---------------------------------------------------------------------------

/**
 * Locator strategy priority (lower rank = preferred):
 * 1 data-testid → 2 id → 3 name → 4 aria-label → 5 role+name →
 * 6 accessible-name (unique among peers lacking 1–5) → 7 semantic (unique) →
 * 8 fallback tag-only (unique on screen, stable=false).
 *
 * ELEMENT-NNN sort (per screen / url+state): elementKind, preferred strategy rank,
 * candidate locator string, accessible name. Never DOM array index.
 * Ids restart per screen — SCREEN-A and SCREEN-B may both have ELEMENT-001.
 */

export const LOCATOR_STRATEGIES = [
  'data-testid',
  'id',
  'name',
  'aria-label',
  'role-name',
  'accessible-name',
  'semantic',
  'fallback',
] as const;

export type LocatorStrategy = (typeof LOCATOR_STRATEGIES)[number];

export interface StableLocatorResult {
  locator: string | null;
  strategy: LocatorStrategy;
  stable: boolean;
}

/** Signals for locator building — attribute evidence only; never CSS class names. */
export interface LocatorSignals {
  tag?: string | null;
  inputType?: string | null;
  role?: string | null;
  accessibleName?: string | null;
  attributes?: Record<string, string> | null;
  testId?: string | null;
  testIdAttribute?: string | null;
  id?: string | null;
  name?: string | null;
  ariaLabel?: string | null;
  elementKind?: ElementKind | null;
}

export const AMBIGUOUS_LOCATOR_REASON =
  'NOT_TESTED: no stable locator; fallback would be ambiguous';

const CSS_IDENT = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const NAME_TAGS = new Set(['input', 'select', 'textarea', 'button']);

function quoteAttrValue(value: string): string | null {
  if (value.includes('"') && value.includes("'")) return null;
  const quote = value.includes('"') ? "'" : '"';
  return `${quote}${value}${quote}`;
}

function cssAttrSelector(attrName: string, value: string): string | null {
  const quoted = quoteAttrValue(value);
  if (!quoted) return null;
  return `[${attrName}=${quoted}]`;
}

function readTestId(signals: LocatorSignals): { attr: string; value: string } | null {
  if (signals.testId && signals.testId.trim()) {
    return { attr: signals.testIdAttribute || 'data-testid', value: signals.testId.trim() };
  }
  const attrs = signals.attributes ?? {};
  for (const key of ['data-testid', 'data-test', 'data-qa']) {
    const value = (attrs[key] ?? '').trim();
    if (value) return { attr: key, value };
  }
  return null;
}

function readId(signals: LocatorSignals): string {
  return (signals.id || attr(signals as ElementKindSignals, 'id') || '').trim();
}

function readName(signals: LocatorSignals): string {
  return (signals.name || attr(signals as ElementKindSignals, 'name') || '').trim();
}

function readAriaLabel(signals: LocatorSignals): string {
  return (signals.ariaLabel || attr(signals as ElementKindSignals, 'aria-label') || '').trim();
}

function readRole(signals: LocatorSignals): string {
  return (signals.role || attr(signals as ElementKindSignals, 'role') || '').toLowerCase().trim();
}

function readTag(signals: LocatorSignals): string {
  return (signals.tag || '').toLowerCase().trim();
}

function readInputType(signals: LocatorSignals): string {
  const fromField = (signals.inputType || '').toLowerCase().trim();
  if (fromField) return fromField;
  return attr(signals as ElementKindSignals, 'type').toLowerCase();
}

function readAccessibleName(signals: LocatorSignals): string {
  return (signals.accessibleName || '').trim();
}

/** Rank of the best locator *signal* available (before uniqueness checks). */
export function preferredLocatorSourceRank(signals: LocatorSignals): number {
  if (readTestId(signals)) return 1;
  if (readId(signals)) return 2;
  if (readName(signals) && NAME_TAGS.has(readTag(signals) || 'input')) return 3;
  if (readName(signals)) return 3;
  if (readAriaLabel(signals)) return 4;
  if (readRole(signals) && readAccessibleName(signals)) return 5;
  if (readAccessibleName(signals)) return 6;
  if (readTag(signals) && (readInputType(signals) || readRole(signals))) return 7;
  if (readTag(signals)) return 8;
  return 9;
}

function hasStrongStrategy(signals: LocatorSignals): boolean {
  return preferredLocatorSourceRank(signals) <= 5;
}

function candidateLocatorPreview(signals: LocatorSignals): string {
  const built = buildStableLocator(signals);
  return built.locator ?? '';
}

/**
 * Build a published locator from attribute / a11y signals.
 * Never emits nth-child, class selectors, or indexed xpath.
 * Uniqueness-sensitive strategies (accessible-name, semantic, fallback) need `peers`.
 */
export function buildStableLocator(
  signals: LocatorSignals,
  peers: LocatorSignals[] = []
): StableLocatorResult {
  const tag = readTag(signals);
  const testId = readTestId(signals);
  if (testId) {
    const sel = cssAttrSelector(testId.attr, testId.value);
    if (sel) return { locator: sel, strategy: 'data-testid', stable: true };
  }

  const id = readId(signals);
  if (id) {
    if (CSS_IDENT.test(id)) {
      return { locator: `#${id}`, strategy: 'id', stable: true };
    }
    const sel = cssAttrSelector('id', id);
    if (sel) return { locator: sel, strategy: 'id', stable: true };
  }

  const name = readName(signals);
  if (name) {
    const nameTag = NAME_TAGS.has(tag) ? tag : tag || 'input';
    const sel = cssAttrSelector('name', name);
    if (sel) return { locator: `${nameTag}${sel}`, strategy: 'name', stable: true };
  }

  const ariaLabel = readAriaLabel(signals);
  if (ariaLabel) {
    const sel = cssAttrSelector('aria-label', ariaLabel);
    if (sel) {
      const prefix = tag || '*';
      return { locator: `${prefix === '*' ? '' : prefix}${sel}`, strategy: 'aria-label', stable: true };
    }
  }

  const role = readRole(signals);
  const accessibleName = readAccessibleName(signals);
  if (role && accessibleName) {
    const quoted = quoteAttrValue(accessibleName);
    if (quoted) {
      return {
        locator: `role=${role}[name=${quoted}]`,
        strategy: 'role-name',
        stable: true,
      };
    }
  }

  // Accessible name alone — only if unique among peers that also lack strategies 1–5.
  if (accessibleName) {
    const weakPeers = peers.length > 0 ? peers : [signals];
    const sameName = weakPeers.filter(
      (peer) => !hasStrongStrategy(peer) && readAccessibleName(peer) === accessibleName
    );
    if (sameName.length === 1) {
      const quoted = quoteAttrValue(accessibleName);
      if (quoted) {
        return { locator: `text=${accessibleName}`, strategy: 'accessible-name', stable: true };
      }
    }
  }

  // Semantic: tag[type=…] or tag[role=…] when unique on the screen.
  const inputType = readInputType(signals);
  if (tag && inputType) {
    const typeSel = cssAttrSelector('type', inputType);
    if (typeSel) {
      const locator = `${tag}${typeSel}`;
      const matches = (peers.length > 0 ? peers : [signals]).filter((peer) => {
        const peerTag = readTag(peer);
        const peerType = readInputType(peer);
        return peerTag === tag && peerType === inputType;
      });
      if (matches.length === 1) {
        return { locator, strategy: 'semantic', stable: true };
      }
    }
  }
  if (tag && role && !accessibleName) {
    const roleSel = cssAttrSelector('role', role);
    if (roleSel) {
      const locator = `${tag}${roleSel}`;
      const matches = (peers.length > 0 ? peers : [signals]).filter(
        (peer) => readTag(peer) === tag && readRole(peer) === role && !readAccessibleName(peer)
      );
      if (matches.length === 1) {
        return { locator, strategy: 'semantic', stable: true };
      }
    }
  }

  // Fallback: bare tag only when it is the only element of that tag on the screen.
  if (tag && (tag === 'input' || tag === 'button' || tag === 'select' || tag === 'textarea' || tag === 'a')) {
    const matches = (peers.length > 0 ? peers : [signals]).filter((peer) => readTag(peer) === tag);
    if (matches.length === 1) {
      return { locator: tag, strategy: 'fallback', stable: false };
    }
  }

  return { locator: null, strategy: 'fallback', stable: false };
}

export function formatElementId(index: number): string {
  return `ELEMENT-${String(index).padStart(3, '0')}`;
}

export function locatorSignalsFromElement(el: {
  tag?: string | null;
  inputType?: string | null;
  accessibleName?: string | null;
  attributes?: Record<string, string> | null;
  elementKind?: ElementKind | null;
  role?: string | null;
}): LocatorSignals {
  const attrs = el.attributes ?? null;
  return {
    tag: el.tag,
    inputType: el.inputType,
    role: el.role ?? attrs?.role ?? null,
    accessibleName: el.accessibleName,
    attributes: attrs,
    testId: attrs?.['data-testid'] || attrs?.['data-test'] || attrs?.['data-qa'] || null,
    testIdAttribute: attrs?.['data-testid']
      ? 'data-testid'
      : attrs?.['data-test']
        ? 'data-test'
        : attrs?.['data-qa']
          ? 'data-qa'
          : null,
    id: attrs?.id ?? null,
    name: attrs?.name ?? null,
    ariaLabel: attrs?.['aria-label'] ?? null,
    elementKind: el.elementKind,
  };
}

/**
 * Stable sort for per-screen ELEMENT-NNN assignment.
 * Key: elementKind → preferred locator source rank → locator preview → accessible name.
 */
export function compareElementsForStableId(
  a: LocatorSignals & { elementKind?: ElementKind | null },
  b: LocatorSignals & { elementKind?: ElementKind | null }
): number {
  const kindA = a.elementKind ?? 'unknown';
  const kindB = b.elementKind ?? 'unknown';
  const kindCmp = kindA.localeCompare(kindB);
  if (kindCmp !== 0) return kindCmp;
  const rankCmp = preferredLocatorSourceRank(a) - preferredLocatorSourceRank(b);
  if (rankCmp !== 0) return rankCmp;
  const locCmp = candidateLocatorPreview(a).localeCompare(candidateLocatorPreview(b));
  if (locCmp !== 0) return locCmp;
  return readAccessibleName(a).localeCompare(readAccessibleName(b));
}

export interface StableElementPublishFields {
  elementId: string;
  screenId: string;
  /** Alias of elementKind for published inventory rows. */
  type: ElementKind;
  label: string | null;
  locator: string | null;
  locatorStrategy: LocatorStrategy;
  locatorStable: boolean;
  /** Set when locator is null because fallback would be ambiguous. */
  locatorReason?: string;
}

/**
 * Assign ELEMENT-NNN + published stable locator fields for one screen's elements.
 * Mutates a sorted copy; returns new array (same object refs with updated fields).
 * Keeps prior locator strings in locatorCandidates when present on the record.
 */
export function assignStableElementIdentities<
  T extends {
    elementId: string;
    elementKind?: ElementKind;
    tag?: string | null;
    inputType?: string | null;
    accessibleName?: string | null;
    attributes?: Record<string, string>;
    locator: string | null;
    locatorCandidates?: string[];
    screenId?: string;
    type?: ElementKind;
    label?: string | null;
    locatorStrategy?: LocatorStrategy;
    locatorStable?: boolean;
    locatorReason?: string;
  },
>(elements: T[], screenId: string): T[] {
  const withKind = elements.map((el) => {
    if (el.elementKind) return el;
    const kind = classifyElementKind({
      tag: el.tag,
      inputType: el.inputType,
      role: el.attributes?.role ?? null,
      accessibleName: el.accessibleName,
      attributes: el.attributes ?? null,
    });
    return Object.assign(el, { elementKind: kind });
  });

  const sorted = [...withKind].sort((a, b) =>
    compareElementsForStableId(
      locatorSignalsFromElement(a),
      locatorSignalsFromElement(b)
    )
  );

  const peers = sorted.map((el) => locatorSignalsFromElement(el));

  return sorted.map((el, index) => {
    const signals = peers[index]!;
    const built = buildStableLocator(signals, peers);
    const priorLocator = el.locator;
    const candidates = [...(el.locatorCandidates ?? [])];
    if (priorLocator && !candidates.includes(priorLocator)) {
      candidates.push(priorLocator);
    }
    if (built.locator && !candidates.includes(built.locator)) {
      candidates.unshift(built.locator);
    }

    const kind = el.elementKind ?? 'unknown';
    const published: StableElementPublishFields = {
      elementId: formatElementId(index + 1),
      screenId,
      type: kind,
      label: el.accessibleName ?? null,
      locator: built.locator,
      locatorStrategy: built.strategy,
      locatorStable: built.stable,
    };
    if (!built.locator) {
      published.locatorReason = AMBIGUOUS_LOCATOR_REASON;
    }

    return Object.assign(el, {
      ...published,
      locatorCandidates: candidates,
      // Decorative stays inventoried with an id; planning still marks NOT_APPLICABLE.
    });
  });
}
