import type { UiElementRecord, UiInventory } from '../discovery/ui-scan';
import { pagePathOf } from './probe';
import type { SecurityFinding } from './types';

const INPUT_TAG = /<input\b([^>]*)>/gi;

export interface ObservedField {
  page: string;
  name: string;
  inputType: string | null;
  required: boolean;
}

function attr(source: string, name: string): string | null {
  const match = source.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i'));
  return match?.[1] ?? null;
}

export function fieldsFromHtml(url: string, html: string): ObservedField[] {
  const fields: ObservedField[] = [];
  INPUT_TAG.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = INPUT_TAG.exec(html))) {
    const attrs = match[1] ?? '';
    const type = (attr(attrs, 'type') ?? 'text').toLowerCase();
    if (type === 'hidden' || type === 'submit' || type === 'button' || type === 'image') continue;
    const name = attr(attrs, 'name') ?? attr(attrs, 'id') ?? attr(attrs, 'data-test') ?? 'input';
    fields.push({
      page: url,
      name,
      inputType: type,
      required: /\brequired\b/i.test(attrs) || attr(attrs, 'aria-required') === 'true',
    });
  }
  return fields;
}

function samePage(left: string, right: string): boolean {
  try {
    const a = new URL(left);
    const b = new URL(right);
    const pathA = a.pathname.replace(/\/+$/, '') || '/';
    const pathB = b.pathname.replace(/\/+$/, '') || '/';
    return a.origin === b.origin && pathA === pathB;
  } catch {
    return left === right;
  }
}

export function fieldsFromInventory(inventory: UiInventory | null, pageUrl?: string): ObservedField[] {
  if (!inventory) return [];
  return inventory.elements
    .filter((el: UiElementRecord) => el.elementType === 'input' || el.elementType === 'textarea' || el.elementType === 'select')
    .filter((el) => (pageUrl ? samePage(el.page, pageUrl) : true))
    .map((el) => ({
      page: el.page,
      name: el.accessibleName ?? el.label ?? el.locator ?? el.elementId,
      inputType: el.inputType ?? null,
      required: el.required,
    }));
}

function looksLikePassword(field: ObservedField): boolean {
  return field.inputType === 'password' || /pass/i.test(field.name);
}

function looksLikeEmail(field: ObservedField): boolean {
  return field.inputType === 'email' || /e-?mail/i.test(field.name);
}

export function collectInputValidationFindings(input: {
  url: string;
  html?: string;
  inventory?: UiInventory | null;
}): SecurityFinding[] {
  const fromInventory = fieldsFromInventory(input.inventory ?? null, input.url);
  const fields = fromInventory.length > 0 ? fromInventory : fieldsFromHtml(input.url, input.html ?? '');
  const pagePath = pagePathOf(input.url);

  if (fields.length === 0) {
    return [
      {
        status: input.inventory ? 'NOT_TESTED' : input.html ? 'NOT_TESTED' : 'BLOCKED',
        rule: 'input-validation',
        severity: 'info',
        detail: input.inventory
          ? 'No inventoried input fields on this page — HTML5 validation was not invented. Forms were not submitted.'
          : input.html
            ? 'No input fields were observed in HTML. Forms were not submitted.'
            : 'UI inventory and HTML were both unavailable — input validation was not tested.',
        page: input.url,
        pagePath,
        expected: 'observed HTML5 type/required on inventoried fields',
        actual: 'no fields observed',
      },
    ];
  }

  const findings: SecurityFinding[] = [];
  for (const field of fields) {
    if (looksLikePassword(field) && field.inputType !== 'password') {
      findings.push({
        status: 'FAIL',
        rule: 'input-validation',
        severity: 'medium',
        detail: `Password-named field "${field.name}" is not type=password (observed only; not submitted)`,
        page: input.url,
        pagePath,
        expected: 'type=password',
        actual: field.inputType ?? 'absent',
      });
      continue;
    }
    if (looksLikeEmail(field) && field.inputType !== 'email') {
      findings.push({
        status: 'WARNING',
        rule: 'input-validation',
        severity: 'low',
        detail: `Email-named field "${field.name}" is not type=email (indicator only)`,
        page: input.url,
        pagePath,
        expected: 'type=email',
        actual: field.inputType ?? 'absent',
      });
      continue;
    }

    const extras = [
      `type=${field.inputType ?? 'absent'}`,
      `required=${field.required}`,
    ].join(' ');
    findings.push({
      status: 'PASS',
      rule: 'input-validation',
      severity: 'info',
      detail: `Field "${field.name}" HTML5 attributes observed (${extras}). Form was not submitted.`,
      page: input.url,
      pagePath,
      expected: 'record type/required when present; do not submit',
      actual: extras,
    });
  }
  return findings;
}
