/**
 * Login / authentication screen plans for the existing planner.
 * Consumed only by buildScenarioInventory → planLogin — not a second planner.
 * Emits rows only when discovery already shows a login screen. Never submit,
 * never invent /login, never brute-force, never emit exploit payloads, never PASS.
 *
 * Credential fills are driven by discovered field kinds only — never invent
 * username or password inputs. Qualifying as an auth screen does not imply a
 * username/password pair; missing kinds simply omit those fill rows.
 */

import { isGenericAuthRoute } from '../discovery/inventory';
import type { PageMapEntry } from '../discovery/page-map';
import {
  canonicalScreenUrl,
  type AuthenticatedCoverage,
  type DiscoveredScreen,
} from '../discovery/screens';
import type { UiElementRecord } from '../discovery/ui-scan';
import { FORM_SUBMIT_NOT_AUTHORIZED_REASON } from './button-cases';
import { isPhoneField } from './field-cases';
import type {
  CheckKind,
  CheckStatus,
  InventoryCategory,
  PlannedAction,
  PlannedCheck,
} from './types';

/** Inert fixtures only — never realistic secrets or wordlists. */
export const LOGIN_FIXTURES = {
  usernameValid: 'user-fixture',
  usernameWrong: 'unknown-user-fixture',
  passwordValid: 'password-fixture',
  passwordWrong: 'wrong-password-fixture',
  /** Single inert injection token — no "<", quotes, SQL keywords, or javascript:. */
  injectionUsername: 'script-like-fixture',
} as const;

const LOGOUT_NAME = /log\s*out|sign\s*out/i;

export type LoginSubcaseId =
  | 'login-valid-credentials'
  | 'login-valid-session'
  | 'login-success'
  | 'login-logout'
  | 'login-wrong-username'
  | 'login-wrong-password'
  | 'login-both-wrong'
  | 'login-empty-username'
  | 'login-empty-password'
  | 'login-unknown-account'
  | 'login-locked-account'
  | 'login-expired-credentials'
  | 'login-injection'
  | 'login-session-handling'
  | 'login-unauthorized'
  | 'login-protected-route'
  | 'login-logout-invalidation'
  | 'login-session-expiration'
  | 'login-rapid'
  | 'login-multiple-tabs'
  | 'login-refresh'
  | 'login-network'
  | 'login-server'
  | 'login-submit';

export interface LoginSubcasePlan {
  subcaseId: LoginSubcaseId;
  kind: CheckKind;
  title: string;
  status: CheckStatus;
  action: PlannedAction;
  category: InventoryCategory;
  reason?: string;
  expect?: PlannedCheck['expect'];
  targetElementId?: string;
}

/** Inventory coverage notes for unresolved access gates — never executable. */
export interface AccessGateCoverageNote {
  noteId: string;
  kind: CheckKind;
  title: string;
  status: 'REQUIRES_CONFIGURATION' | 'NOT_TESTED' | 'BLOCKED';
  action: 'none';
  category: InventoryCategory;
  reason: string;
}

export interface LoginCaseResult {
  plans: LoginSubcasePlan[];
}

export interface LoginPlanningOptions {
  /** True only when auth session evidence was passed into planning. Never inferred. */
  hasAuthSession?: boolean;
}

function pushUnique(seen: Set<string>, plans: LoginSubcasePlan[], plan: LoginSubcasePlan): void {
  if (seen.has(plan.subcaseId)) return;
  seen.add(plan.subcaseId);
  plans.push(plan);
}

function routeOf(url: string, page?: PageMapEntry): string {
  if (page?.route) return page.route;
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}` || '/';
  } catch {
    return url;
  }
}

function resolveKind(el: UiElementRecord): string {
  return (el.elementKind ?? el.type ?? el.elementType ?? '').toLowerCase();
}

function inputTypeOf(el: UiElementRecord): string {
  return (el.inputType ?? el.attributes?.type ?? '').toLowerCase();
}

export function isPasswordField(el: UiElementRecord): boolean {
  if (resolveKind(el) === 'password-input') return true;
  return inputTypeOf(el) === 'password';
}

function isOtpField(el: UiElementRecord): boolean {
  if (resolveKind(el) === 'otp-field') return true;
  const blob = `${el.accessibleName ?? ''} ${el.attributes?.name ?? ''} ${el.label ?? ''}`;
  return /\botp\b/i.test(blob) || /\bone[-\s]?time\b/i.test(blob) || /\bpasscode\b/i.test(blob);
}

/**
 * Identity / username candidate: text or email input (not password, phone, or OTP).
 * Phone and OTP are planned by field-cases from their own kinds — not as username.
 */
export function isUsernameField(el: UiElementRecord): boolean {
  if (isPasswordField(el)) return false;
  if (isOtpField(el)) return false;
  if (isPhoneField(el)) return false;
  const kind = resolveKind(el);
  if (kind === 'email-input' || kind === 'text-input') return true;
  const type = inputTypeOf(el);
  if (type === 'email' || type === 'text' || type === 'username') return true;
  if (el.elementType === 'input' && (type === '' || type === 'text' || type === 'email')) return true;
  return false;
}

/**
 * Any non-password fillable text-like control — used only for the single inert injection row.
 * Does not invent fields; returns false when none were discovered.
 */
export function isFillableTextField(el: UiElementRecord): boolean {
  if (isPasswordField(el)) return false;
  const kind = resolveKind(el);
  if (
    kind === 'button' ||
    kind === 'submit-button' ||
    kind === 'decorative' ||
    kind === 'link' ||
    kind === 'checkbox' ||
    kind === 'radio' ||
    kind === 'file-upload' ||
    kind === 'hidden-input'
  ) {
    return false;
  }
  const type = inputTypeOf(el);
  if (
    type === 'hidden' ||
    type === 'checkbox' ||
    type === 'radio' ||
    type === 'file' ||
    type === 'submit' ||
    type === 'button' ||
    type === 'image' ||
    type === 'reset'
  ) {
    return false;
  }
  if (
    kind === 'text-input' ||
    kind === 'email-input' ||
    kind === 'otp-field' ||
    kind === 'number-input' ||
    kind === 'search-field' ||
    kind === 'masked-input' ||
    kind === 'autocomplete' ||
    kind === 'textarea'
  ) {
    return true;
  }
  if (
    type === 'text' ||
    type === 'email' ||
    type === 'tel' ||
    type === 'number' ||
    type === 'search' ||
    type === 'url' ||
    type === ''
  ) {
    return el.elementType === 'input' || el.elementType === 'textarea' || el.elementType === 'search';
  }
  return (
    el.elementType === 'textarea' ||
    el.elementType === 'search' ||
    (el.elementType === 'input' && type !== 'password')
  );
}

function isSubmitControl(el: UiElementRecord): boolean {
  const kind = resolveKind(el);
  if (kind === 'submit-button' || el.isSubmit) return true;
  return inputTypeOf(el) === 'submit';
}

function findPasswordField(elements: UiElementRecord[]): UiElementRecord | undefined {
  return elements.find((el) => isPasswordField(el));
}

function findUsernameField(elements: UiElementRecord[]): UiElementRecord | undefined {
  return elements.find((el) => isUsernameField(el));
}

function findFillableTextField(elements: UiElementRecord[]): UiElementRecord | undefined {
  return elements.find((el) => isUsernameField(el)) ?? elements.find((el) => isFillableTextField(el));
}

function findSubmitControl(elements: UiElementRecord[]): UiElementRecord | undefined {
  return elements.find((el) => isSubmitControl(el));
}

function siblingHasState(
  screen: DiscoveredScreen,
  screens: DiscoveredScreen[],
  states: string[]
): boolean {
  const key = canonicalScreenUrl(screen.url);
  return screens.some(
    (s) => canonicalScreenUrl(s.url) === key && states.includes(String(s.state))
  );
}

function pageForScreen(screen: DiscoveredScreen, pages: PageMapEntry[]): PageMapEntry | undefined {
  const key = canonicalScreenUrl(screen.url);
  return pages.find(
    (p) =>
      canonicalScreenUrl(p.url) === key ||
      (p.finalUrl != null && canonicalScreenUrl(p.finalUrl) === key)
  );
}

/**
 * A screen qualifies as login from discovery evidence only:
 * - page access gated, or state unauthenticated, or generic auth route segment; OR
 * - discovered password-input together with a text/email identity field (heuristic when no auth route).
 * Qualifying does not invent fields; fill rows follow whichever kinds were discovered.
 */
export function isLoginScreen(input: {
  screen: DiscoveredScreen;
  elements: UiElementRecord[];
  page?: PageMapEntry;
}): boolean {
  const { screen, elements, page } = input;
  if (page?.access === 'gated') return true;
  if (screen.state === 'unauthenticated') return true;
  const route = routeOf(screen.url, page);
  if (isGenericAuthRoute(route)) return true;
  const hasPassword = elements.some((el) => isPasswordField(el));
  const hasUsername = elements.some((el) => isUsernameField(el));
  return hasPassword && hasUsername;
}

function linkedScreenUrls(
  screen: DiscoveredScreen,
  navigation: { from: string; to: string }[]
): Set<string> {
  const key = canonicalScreenUrl(screen.url);
  const linked = new Set<string>([key]);
  for (const edge of navigation) {
    const from = canonicalScreenUrl(edge.from);
    const to = canonicalScreenUrl(edge.to);
    if (from === key) linked.add(to);
    if (to === key) linked.add(from);
  }
  return linked;
}

function findLogoutControl(
  screen: DiscoveredScreen,
  elements: UiElementRecord[],
  allElements: UiElementRecord[],
  navigation: { from: string; to: string }[]
): UiElementRecord | undefined {
  const onScreen = elements.find((el) => LOGOUT_NAME.test(el.accessibleName ?? ''));
  if (onScreen) return onScreen;
  const linked = linkedScreenUrls(screen, navigation);
  return allElements.find(
    (el) => linked.has(canonicalScreenUrl(el.page)) && LOGOUT_NAME.test(el.accessibleName ?? '')
  );
}

function findProtectedRoute(
  screen: DiscoveredScreen,
  pages: PageMapEntry[]
): PageMapEntry | undefined {
  const key = canonicalScreenUrl(screen.url);
  return pages.find((p) => {
    if (canonicalScreenUrl(p.url) === key) return false;
    if (p.access === 'gated') return true;
    return p.status === 401 || p.status === 403;
  });
}

/** Build a fill note from only the fields that exist on the screen. */
function fillNote(parts: { username?: string; password?: string }): string {
  const bits: string[] = [];
  if (parts.username !== undefined) bits.push(`username→${parts.username}`);
  if (parts.password !== undefined) bits.push(`password→${parts.password}`);
  bits.push('submit not included');
  return bits.join('; ');
}

/**
 * Build login-* inventory rows for one screen when it qualifies as a login screen.
 * Returns [] when the screen is not a login screen. Exactly one row per subcase.
 * Zero planned rows submit. Rapid is a single NOT_TESTED row (no N attempts).
 * Fill rows emit only for discovered username and/or password fields — never both required.
 */
export function buildLoginPlansForScreen(input: {
  screen: DiscoveredScreen;
  elements: UiElementRecord[];
  screens: DiscoveredScreen[];
  pages: PageMapEntry[];
  allElements?: UiElementRecord[];
  navigation?: { from: string; to: string }[];
  options?: LoginPlanningOptions;
}): LoginCaseResult[] {
  const {
    screen,
    elements,
    screens,
    pages,
    allElements = elements,
    navigation = [],
    options,
  } = input;
  const page = pageForScreen(screen, pages);
  if (!isLoginScreen({ screen, elements, page })) return [];

  const plans: LoginSubcasePlan[] = [];
  const seen = new Set<string>();
  const label = `${screen.id} login`;
  const username = findUsernameField(elements);
  const password = findPasswordField(elements);
  const fillableText = findFillableTextField(elements);
  const submit = findSubmitControl(elements);
  const hasUsername = Boolean(username);
  const hasPassword = Boolean(password);
  const hasAuthSession = options?.hasAuthSession === true;
  const pageAuthenticated = page?.access === 'authenticated';
  const siblingAuthenticated =
    siblingHasState(screen, screens, ['authenticated']) || screen.state === 'authenticated';
  const canObserveAuth = hasAuthSession || pageAuthenticated || siblingAuthenticated;

  // --- Positive fills: only for discovered credential fields ---
  if (hasUsername || hasPassword) {
    const fillTarget = username ?? password!;
    const userFixture = hasUsername ? LOGIN_FIXTURES.usernameValid : undefined;
    const passFixture = hasPassword ? LOGIN_FIXTURES.passwordValid : undefined;
    pushUnique(seen, plans, {
      subcaseId: 'login-valid-credentials',
      kind: 'valid-input',
      title: `${label} — login-valid-credentials`,
      status: 'PLANNED',
      action: 'fill-no-submit',
      category: 'positive',
      reason: hasUsername && hasPassword
        ? 'fill user-fixture + password-fixture; form is not submitted'
        : hasUsername
          ? 'fill user-fixture into discovered identity field; form is not submitted'
          : 'fill password-fixture into discovered password field; form is not submitted',
      expect: {
        fillValue: userFixture ?? passFixture!,
        note: fillNote({
          ...(userFixture !== undefined ? { username: userFixture } : {}),
          ...(passFixture !== undefined ? { password: passFixture } : {}),
        }),
        control: 'text',
        locator: fillTarget.locator ?? undefined,
      },
      targetElementId: fillTarget.elementId,
    });
  }

  if (hasAuthSession || pageAuthenticated) {
    pushUnique(seen, plans, {
      subcaseId: 'login-valid-session',
      kind: 'visibility',
      title: `${label} — login-valid-session`,
      status: 'PLANNED',
      action: 'observe',
      category: 'positive',
      reason: 'PLANNED: observe authenticated session evidence already present — no submit',
    });
  } else {
    pushUnique(seen, plans, {
      subcaseId: 'login-valid-session',
      kind: 'visibility',
      title: `${label} — login-valid-session`,
      status: 'REQUIRES_CONFIGURATION',
      action: 'none',
      category: 'positive',
      reason: 'REQUIRES_CONFIGURATION: no session was established',
    });
  }

  if (canObserveAuth) {
    pushUnique(seen, plans, {
      subcaseId: 'login-success',
      kind: 'visibility',
      title: `${label} — login-success`,
      status: 'PLANNED',
      action: 'observe',
      category: 'positive',
      reason: 'PLANNED: observe authenticated state already in discovery — form is not submitted',
    });
  } else {
    pushUnique(seen, plans, {
      subcaseId: 'login-success',
      kind: 'visibility',
      title: `${label} — login-success`,
      status: 'NOT_TESTED',
      action: 'none',
      category: 'positive',
      reason: 'NOT_TESTED: login success was not observed because the form is not submitted',
    });
  }

  const logout = findLogoutControl(screen, elements, allElements, navigation);
  if (logout) {
    pushUnique(seen, plans, {
      subcaseId: 'login-logout',
      kind: 'visibility',
      title: `${label} — login-logout`,
      status: 'PLANNED',
      action: 'observe',
      category: 'positive',
      reason: 'PLANNED: logout control discovered — observe only; do not click',
      expect: {
        locator: logout.locator ?? undefined,
        accessibleName: logout.accessibleName,
        control: 'button',
      },
      targetElementId: logout.elementId,
    });
  } else {
    pushUnique(seen, plans, {
      subcaseId: 'login-logout',
      kind: 'visibility',
      title: `${label} — login-logout`,
      status: 'NOT_TESTED',
      action: 'none',
      category: 'positive',
      reason: 'NOT_TESTED: logout control was not discovered',
    });
  }

  // --- Negative (fill-only, no submit) — emit only when the relevant field exists ---
  if (hasUsername) {
    pushUnique(seen, plans, {
      subcaseId: 'login-wrong-username',
      kind: 'invalid-input',
      title: `${label} — login-wrong-username`,
      status: 'PLANNED',
      action: 'fill-no-submit',
      category: 'negative',
      reason: 'fill wrong username fixture; form is not submitted',
      expect: {
        fillValue: LOGIN_FIXTURES.usernameWrong,
        note: fillNote({
          username: LOGIN_FIXTURES.usernameWrong,
          ...(hasPassword ? { password: LOGIN_FIXTURES.passwordValid } : {}),
        }),
        control: 'text',
        locator: username!.locator ?? undefined,
        constraintInvalid: true,
      },
      targetElementId: username!.elementId,
    });
  }

  if (hasPassword) {
    pushUnique(seen, plans, {
      subcaseId: 'login-wrong-password',
      kind: 'invalid-input',
      title: `${label} — login-wrong-password`,
      status: 'PLANNED',
      action: 'fill-no-submit',
      category: 'negative',
      reason: 'fill wrong password fixture; form is not submitted',
      expect: {
        fillValue: hasUsername ? LOGIN_FIXTURES.usernameValid : LOGIN_FIXTURES.passwordWrong,
        note: fillNote({
          ...(hasUsername ? { username: LOGIN_FIXTURES.usernameValid } : {}),
          password: LOGIN_FIXTURES.passwordWrong,
        }),
        control: 'text',
        locator: (username ?? password)!.locator ?? undefined,
        constraintInvalid: true,
      },
      targetElementId: (username ?? password)!.elementId,
    });
  }

  if (hasUsername && hasPassword) {
    pushUnique(seen, plans, {
      subcaseId: 'login-both-wrong',
      kind: 'invalid-input',
      title: `${label} — login-both-wrong`,
      status: 'PLANNED',
      action: 'fill-no-submit',
      category: 'negative',
      reason: 'fill both wrong fixtures; form is not submitted',
      expect: {
        fillValue: LOGIN_FIXTURES.usernameWrong,
        note: fillNote({
          username: LOGIN_FIXTURES.usernameWrong,
          password: LOGIN_FIXTURES.passwordWrong,
        }),
        control: 'text',
        locator: username!.locator ?? undefined,
        constraintInvalid: true,
      },
      targetElementId: username!.elementId,
    });
  }

  if (hasUsername) {
    pushUnique(seen, plans, {
      subcaseId: 'login-empty-username',
      kind: 'empty-input',
      title: `${label} — login-empty-username`,
      status: 'PLANNED',
      action: 'fill-no-submit',
      category: 'negative',
      reason: 'empty username fill; form is not submitted',
      expect: {
        fillValue: '',
        note: fillNote({
          username: '',
          ...(hasPassword ? { password: LOGIN_FIXTURES.passwordValid } : {}),
        }),
        control: 'text',
        locator: username!.locator ?? undefined,
        constraintInvalid: true,
      },
      targetElementId: username!.elementId,
    });
  }

  if (hasPassword) {
    pushUnique(seen, plans, {
      subcaseId: 'login-empty-password',
      kind: 'empty-input',
      title: `${label} — login-empty-password`,
      status: 'PLANNED',
      action: 'fill-no-submit',
      category: 'negative',
      reason: 'empty password fill; form is not submitted',
      expect: {
        fillValue: hasUsername ? LOGIN_FIXTURES.usernameValid : '',
        note: fillNote({
          ...(hasUsername ? { username: LOGIN_FIXTURES.usernameValid } : {}),
          password: '',
        }),
        control: 'text',
        locator: (username ?? password)!.locator ?? undefined,
        constraintInvalid: true,
      },
      targetElementId: (username ?? password)!.elementId,
    });
  }

  if (hasUsername) {
    pushUnique(seen, plans, {
      subcaseId: 'login-unknown-account',
      kind: 'invalid-input',
      title: `${label} — login-unknown-account`,
      status: 'PLANNED',
      action: 'fill-no-submit',
      category: 'negative',
      reason: 'unknown-account fixture; account existence was not verified; form is not submitted',
      expect: {
        fillValue: LOGIN_FIXTURES.usernameWrong,
        note: fillNote({
          username: LOGIN_FIXTURES.usernameWrong,
          ...(hasPassword ? { password: LOGIN_FIXTURES.passwordValid } : {}),
        }),
        control: 'text',
        locator: username!.locator ?? undefined,
        constraintInvalid: true,
      },
      targetElementId: username!.elementId,
    });
  }

  pushUnique(seen, plans, {
    subcaseId: 'login-locked-account',
    kind: 'invalid-input',
    title: `${label} — login-locked-account`,
    status: 'NOT_TESTED',
    action: 'none',
    category: 'negative',
    reason: 'NOT_TESTED: locked account was not in discovery evidence',
  });

  pushUnique(seen, plans, {
    subcaseId: 'login-expired-credentials',
    kind: 'invalid-input',
    title: `${label} — login-expired-credentials`,
    status: 'NOT_TESTED',
    action: 'none',
    category: 'negative',
    reason: 'NOT_TESTED: expired credentials were not in discovery evidence',
  });

  // --- Security: one inert injection only when a fillable text field exists ---
  if (fillableText) {
    pushUnique(seen, plans, {
      subcaseId: 'login-injection',
      kind: 'security-observation',
      title: `${label} — login-injection`,
      status: 'PLANNED',
      action: 'fill-no-submit',
      category: 'security',
      reason:
        'inert credential fixture; not an exploit; form is not submitted; not a brute-force attempt',
      expect: {
        fillValue: LOGIN_FIXTURES.injectionUsername,
        note: fillNote({
          username: LOGIN_FIXTURES.injectionUsername,
          ...(hasPassword ? { password: LOGIN_FIXTURES.passwordValid } : {}),
        }),
        control: 'text',
        locator: fillableText.locator ?? undefined,
      },
      targetElementId: fillableText.elementId,
    });
  }

  if (hasAuthSession) {
    pushUnique(seen, plans, {
      subcaseId: 'login-session-handling',
      kind: 'security-observation',
      title: `${label} — login-session-handling`,
      status: 'NOT_TESTED',
      action: 'none',
      category: 'security',
      reason: 'NOT_TESTED: session cookie was not read or stored by the planner',
    });
  } else {
    pushUnique(seen, plans, {
      subcaseId: 'login-session-handling',
      kind: 'security-observation',
      title: `${label} — login-session-handling`,
      status: 'NOT_TESTED',
      action: 'none',
      category: 'security',
      reason: 'NOT_TESTED: session handling was not observed',
    });
  }

  pushUnique(seen, plans, {
    subcaseId: 'login-unauthorized',
    kind: 'security-observation',
    title: `${label} — login-unauthorized`,
    status: 'NOT_TESTED',
    action: 'none',
    category: 'security',
    reason:
      'NOT_TESTED: unauthorized access is not executed; no authorization matrix was discovered',
  });

  const protectedRoute = findProtectedRoute(screen, pages);
  if (protectedRoute) {
    pushUnique(seen, plans, {
      subcaseId: 'login-protected-route',
      kind: 'security-observation',
      title: `${label} — login-protected-route`,
      status: 'PLANNED',
      action: 'observe',
      category: 'security',
      reason: `PLANNED: protected route was recorded during discovery (${protectedRoute.url}) — observe only; no fetch`,
      expect: {
        href: protectedRoute.url,
        note: `access=${protectedRoute.access ?? 'unknown'}; status=${protectedRoute.status ?? 'null'}`,
      },
    });
  } else {
    pushUnique(seen, plans, {
      subcaseId: 'login-protected-route',
      kind: 'security-observation',
      title: `${label} — login-protected-route`,
      status: 'NOT_TESTED',
      action: 'none',
      category: 'security',
      reason: 'NOT_TESTED: no protected route was crawled',
    });
  }

  pushUnique(seen, plans, {
    subcaseId: 'login-logout-invalidation',
    kind: 'security-observation',
    title: `${label} — login-logout-invalidation`,
    status: 'NOT_TESTED',
    action: 'none',
    category: 'security',
    reason: 'NOT_TESTED: logout was not performed, so invalidation was not observed',
  });

  if (hasAuthSession) {
    pushUnique(seen, plans, {
      subcaseId: 'login-session-expiration',
      kind: 'security-observation',
      title: `${label} — login-session-expiration`,
      status: 'NOT_TESTED',
      action: 'none',
      category: 'security',
      reason: 'NOT_TESTED: session expiration is not simulated',
    });
  } else {
    pushUnique(seen, plans, {
      subcaseId: 'login-session-expiration',
      kind: 'security-observation',
      title: `${label} — login-session-expiration`,
      status: 'REQUIRES_CONFIGURATION',
      action: 'none',
      category: 'security',
      reason: 'REQUIRES_CONFIGURATION: no session was established',
    });
  }

  // --- Edge (all NOT_TESTED, never a loop) ---
  pushUnique(seen, plans, {
    subcaseId: 'login-rapid',
    kind: 'click-behavior',
    title: `${label} — login-rapid`,
    status: 'NOT_TESTED',
    action: 'none',
    category: 'boundary',
    reason:
      'NOT_TESTED: rapid login attempts are not executed (bounded: no repeated authentication)',
  });

  pushUnique(seen, plans, {
    subcaseId: 'login-multiple-tabs',
    kind: 'visibility',
    title: `${label} — login-multiple-tabs`,
    status: 'NOT_TESTED',
    action: 'none',
    category: 'boundary',
    reason: 'NOT_TESTED: multiple tabs were not observed',
  });

  pushUnique(seen, plans, {
    subcaseId: 'login-refresh',
    kind: 'visibility',
    title: `${label} — login-refresh`,
    status: 'NOT_TESTED',
    action: 'none',
    category: 'boundary',
    reason: 'NOT_TESTED: refresh during login was not observed',
  });

  pushUnique(seen, plans, {
    subcaseId: 'login-network',
    kind: 'visibility',
    title: `${label} — login-network`,
    status: 'NOT_TESTED',
    action: 'none',
    category: 'boundary',
    reason: 'NOT_TESTED: network failure is not simulated',
  });

  pushUnique(seen, plans, {
    subcaseId: 'login-server',
    kind: 'visibility',
    title: `${label} — login-server`,
    status: 'NOT_TESTED',
    action: 'none',
    category: 'boundary',
    reason: 'NOT_TESTED: server failure is not simulated',
  });

  // Submit / login button — BLOCKED only; never PLANNED click.
  if (submit) {
    pushUnique(seen, plans, {
      subcaseId: 'login-submit',
      kind: 'form-submit',
      title: `${label} — login-submit`,
      status: 'BLOCKED',
      action: 'none',
      category: 'positive',
      reason: FORM_SUBMIT_NOT_AUTHORIZED_REASON,
      expect: { locator: submit.locator ?? undefined, control: 'button' },
      targetElementId: submit.elementId,
    });
  }

  // Safety net: never emit PLANNED submit / click of submit.
  for (const plan of plans) {
    if (
      plan.status === 'PLANNED' &&
      (plan.kind === 'form-submit' || plan.action === 'click-button')
    ) {
      plan.status = 'BLOCKED';
      plan.action = 'none';
      plan.reason = FORM_SUBMIT_NOT_AUTHORIZED_REASON;
    }
  }

  return [{ plans }];
}

/**
 * Coverage-note rows for unresolved authenticated-discovery gates.
 * Never PLANNED navigation into gated URLs; never click login; never PASS / TESTED.
 */
export function buildAccessGateCoverageNotes(
  coverage: AuthenticatedCoverage | null | undefined
): AccessGateCoverageNote[] {
  if (!coverage?.layers?.length) return [];
  const plans: AccessGateCoverageNote[] = [];
  const seen = new Set<string>();

  for (const layer of coverage.layers) {
    if (layer.gate === 'public' || layer.gate === 'login') continue;
    if (
      layer.status !== 'REQUIRES_CONFIGURATION' &&
      layer.status !== 'NOT_TESTED' &&
      layer.status !== 'BLOCKED'
    ) {
      continue;
    }

    const noteId = layer.key ? `auth-gate-${layer.gate}-${layer.key}` : `auth-gate-${layer.gate}`;
    if (seen.has(noteId)) continue;
    seen.add(noteId);
    const noteStatus: CheckStatus =
      layer.status === 'BLOCKED'
        ? 'BLOCKED'
        : layer.status === 'REQUIRES_CONFIGURATION'
          ? 'REQUIRES_CONFIGURATION'
          : 'NOT_TESTED';
    plans.push({
      noteId,
      kind: 'security-observation',
      title: layer.key
        ? `authenticated coverage — ${layer.gate} (${layer.key})`
        : `authenticated coverage — ${layer.gate} gate`,
      status: noteStatus,
      action: 'none',
      category: 'security',
      reason: `${layer.status}: ${layer.reason}`,
    });
  }

  return plans;
}
