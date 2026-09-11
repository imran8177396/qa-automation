import type { Page } from '@playwright/test';
import type { ElementRecord, ElementType } from './types';

interface RawElement {
  tag: string;
  type: string | null;
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
  formMethod: string | null;
  isSubmit: boolean;
}

const SELECTOR =
  'button, a[href], input, textarea, select, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="tab"]';

export async function inventoryPage(page: Page, url: string): Promise<ElementRecord[]> {
  // Same rationale as crawler.ts: give a client-rendered page a chance to hydrate before reading
  // its DOM, rather than reading it immediately after navigation and finding nothing.
  await page
    .locator(SELECTOR)
    .first()
    .waitFor({ state: 'attached', timeout: 5000 })
    .catch(() => undefined);

  const rawElements = await page
    .locator(SELECTOR)
    .evaluateAll((elements) =>
      (elements as HTMLElement[]).map((el) => {
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        const visible = style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        const inputEl = el as HTMLInputElement;
        const formEl = el.closest('form');

        return {
          tag: el.tagName.toLowerCase(),
          type: inputEl.type ?? null,
          role: el.getAttribute('role'),
          text: (el.textContent ?? '').trim().slice(0, 120),
          ariaLabel: el.getAttribute('aria-label'),
          placeholder: inputEl.placeholder ?? null,
          name: inputEl.name || el.getAttribute('name'),
          id: el.id || null,
          testId: el.getAttribute('data-testid'),
          visible,
          enabled: !inputEl.disabled,
          required: Boolean(inputEl.required),
          href: el.getAttribute('href'),
          formMethod: formEl?.getAttribute('method') ?? null,
          isSubmit: inputEl.type === 'submit' || el.getAttribute('type') === 'submit',
        };
      })
    )
    .catch(() => [] as RawElement[]);

  return rawElements.map((raw, index) => toElementRecord(raw, url, index));
}

function resolveType(raw: RawElement): ElementType {
  if (raw.tag === 'a') return 'link';
  if (raw.tag === 'button' || raw.role === 'button') return 'button';
  if (raw.tag === 'textarea') return 'textarea';
  if (raw.tag === 'select') return 'select';
  if (raw.tag === 'input') {
    switch (raw.type) {
      case 'email':
        return 'email-input';
      case 'password':
        return 'password-input';
      case 'number':
        return 'number-input';
      case 'tel':
        return 'tel-input';
      case 'date':
      case 'datetime-local':
      case 'time':
        return 'date-input';
      case 'search':
        return 'search-input';
      case 'checkbox':
        return 'checkbox';
      case 'radio':
        return 'radio';
      case 'file':
        return 'file-upload';
      case 'submit':
      case 'button':
        return 'button';
      default:
        return 'text-input';
    }
  }
  return 'other';
}

function cssAttr(name: string, value: string): string | null {
  if (value.includes('"') && value.includes("'")) return null;
  const quote = value.includes('"') ? "'" : '"';
  return `[${name}=${quote}${value}${quote}]`;
}

function buildLocatorCandidates(raw: RawElement): string[] {
  const candidates: string[] = [];
  if (raw.testId) {
    const attr = cssAttr('data-testid', raw.testId);
    if (attr) candidates.push(attr);
  }
  if (raw.id) {
    // This runs in Node (not the browser), so no CSS.escape() global is available. IDs containing
    // characters that aren't valid in an unescaped CSS identifier fall back to an attribute selector.
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
  if (raw.text && raw.text.length <= 80 && !raw.text.includes('\n')) {
    candidates.push(`text=${raw.text}`);
  }
  return candidates;
}

function toElementRecord(raw: RawElement, url: string, index: number): ElementRecord {
  return {
    page: url,
    elementId: `EL-${String(index + 1).padStart(4, '0')}`,
    type: resolveType(raw),
    role: raw.role,
    label: raw.ariaLabel || raw.text || raw.placeholder || raw.name || null,
    href: raw.href,
    formMethod: raw.formMethod,
    isSubmit: raw.isSubmit,
    locatorCandidates: buildLocatorCandidates(raw),
    visible: raw.visible,
    enabled: raw.enabled,
    required: raw.required,
    risk: 'unknown',
  };
}
