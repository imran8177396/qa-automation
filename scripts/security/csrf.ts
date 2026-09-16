import { pagePathOf } from './probe';
import type { ObservedCookie } from './cookies';
import { observedSameSite } from './cookies';
import type { SecurityFinding } from './types';

const FORM_TAG = /<form[\s>]/i;
const CSRF_TOKEN = /(?:name|id)=["'][^"']*(?:csrf|_token|authenticity_token)[^"']*["']/i;
const CSRF_META = /<meta[^>]+name=["']csrf-token["'][^>]*>/i;

export function htmlHasForm(html: string): boolean {
  return FORM_TAG.test(html);
}

export function htmlHasCsrfIndicator(html: string): boolean {
  return CSRF_TOKEN.test(html) || CSRF_META.test(html);
}

export function collectCsrfFindings(input: {
  url: string;
  html: string;
  cookies?: ObservedCookie[];
  formObserved?: boolean;
}): SecurityFinding {
  const pagePath = pagePathOf(input.url);
  const hasForm = htmlHasForm(input.html) || input.formObserved === true;
  if (!hasForm) {
    return {
      status: 'NOT_TESTED',
      rule: 'csrf-indicator',
      severity: 'info',
      detail: 'No form markup was observed — CSRF token indicators were not invented and forms were not submitted',
      page: input.url,
      pagePath,
      expected: 'CSRF token pattern or SameSite on a form-bearing page',
      actual: 'no form observed',
    };
  }

  const token = htmlHasCsrfIndicator(input.html);
  const sameSite = observedSameSite(input.cookies ?? []);
  if (token) {
    return {
      status: 'PASS',
      rule: 'csrf-indicator',
      severity: 'info',
      detail: 'CSRF token pattern observed in HTML (form was not submitted)',
      page: input.url,
      pagePath,
      expected: 'csrf/_token/authenticity_token field or csrf-token meta',
      actual: 'token pattern present',
    };
  }

  if (sameSite) {
    return {
      status: 'WARNING',
      rule: 'csrf-indicator',
      severity: 'low',
      detail: 'Form observed without a CSRF token pattern; SameSite on an observed cookie is a partial indicator only',
      page: input.url,
      pagePath,
      expected: 'CSRF token pattern (SameSite is an indicator, not a CSRF test)',
      actual: 'no token pattern; SameSite present',
    };
  }

  return {
    status: 'WARNING',
    rule: 'csrf-indicator',
    severity: 'low',
    detail: 'Form observed without CSRF token or SameSite indicators — not a CSRF exploit',
    page: input.url,
    pagePath,
    expected: 'CSRF token pattern or SameSite cookie',
    actual: 'no CSRF indicators observed',
  };
}
