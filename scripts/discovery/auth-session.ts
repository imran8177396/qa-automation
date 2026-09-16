import type { Page } from '@playwright/test';
import type { DiscoveryCredentials } from './credentials';

export interface ObservedLoginForm {
  usernameLocator: string;
  passwordLocator: string;
  submitLocator: string;
}

export interface AuthAttempt {
  attempted: boolean;
  succeeded: boolean;
  reason: string;
  loginPageUrl?: string;
  afterUrl?: string;
}

const LOGIN_WALL =
  /you can only access|must be logged in|please log in|please sign in|authentication required|sign in to continue/i;

const DETECT_LOGIN_FORM = `(() => {
  const password = document.querySelector('input[type="password"]');
  if (!password) return null;

  const locatorFor = function (el) {
    const testId = el.getAttribute('data-test') || el.getAttribute('data-testid');
    if (testId && !(testId.includes('"') && testId.includes("'"))) {
      const attr = el.getAttribute('data-test') ? 'data-test' : 'data-testid';
      const quote = testId.includes('"') ? "'" : '"';
      return '[' + attr + '=' + quote + testId + quote + ']';
    }
    if (el.id && /^[A-Za-z_][A-Za-z0-9_-]*$/.test(el.id)) return '#' + el.id;
    const name = el.getAttribute('name');
    if (name && !(name.includes('"') && name.includes("'"))) {
      const quote = name.includes('"') ? "'" : '"';
      return '[name=' + quote + name + quote + ']';
    }
    return null;
  };

  const isUsernameLike = function (el) {
    if (el.tagName.toLowerCase() !== 'input') return false;
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    if (['password', 'hidden', 'submit', 'button', 'image', 'reset', 'checkbox', 'radio', 'file'].includes(type)) {
      return false;
    }
    const hay = [
      el.getAttribute('name') || '',
      el.id || '',
      el.getAttribute('autocomplete') || '',
      el.getAttribute('data-test') || '',
      el.getAttribute('data-testid') || '',
      el.getAttribute('placeholder') || '',
      el.getAttribute('aria-label') || '',
    ].join(' ').toLowerCase();
    if (/user|email|login|account/.test(hay)) return true;
    return type === 'text' || type === 'email' || type === 'tel' || !el.getAttribute('type');
  };

  const inputs = Array.from(document.querySelectorAll('input'));
  let username = inputs.find(function (el) { return el !== password && isUsernameLike(el); }) || null;
  if (!username) return null;

  let submit = document.querySelector('input[type="submit"], button[type="submit"]');
  if (!submit) {
    submit = Array.from(document.querySelectorAll('button, input[type="button"], [role="button"]')).find(function (el) {
      const label = ((el.getAttribute('aria-label') || '') + ' ' + (el.textContent || '') + ' ' + (el.value || '')).toLowerCase();
      return /log\\s*in|sign\\s*in|submit/.test(label);
    }) || null;
  }
  if (!submit) return null;

  const usernameLocator = locatorFor(username);
  const passwordLocator = locatorFor(password);
  const submitLocator = locatorFor(submit);
  if (!usernameLocator || !passwordLocator || !submitLocator) return null;

  return { usernameLocator: usernameLocator, passwordLocator: passwordLocator, submitLocator: submitLocator };
})()`;

export async function detectLoginForm(page: Page): Promise<ObservedLoginForm | null> {
  const observed = (await page.evaluate(DETECT_LOGIN_FORM).catch(() => null)) as ObservedLoginForm | null;
  if (!observed?.usernameLocator || !observed.passwordLocator || !observed.submitLocator) return null;
  return observed;
}

export async function observeLoginWall(page: Page): Promise<{ loginForm: boolean; gatedMessage: string | null }> {
  const form = await detectLoginForm(page);
  if (!form) return { loginForm: false, gatedMessage: null };

  const text = (await page.locator('body').innerText().catch(() => '')).slice(0, 2000);
  const match = text.match(LOGIN_WALL);
  return { loginForm: true, gatedMessage: match ? match[0] : null };
}

function pathLooksLikeLogin(url: string): boolean {
  try {
    const { pathname } = new URL(url);
    return pathname === '/' || /login|signin|sign-in|index(\.html)?$/i.test(pathname);
  } catch {
    return false;
  }
}

export function classifyPageAccess(input: {
  error?: string;
  loginForm: boolean;
  gatedMessage: string | null;
  pageUrl: string;
  authenticatedSession: boolean;
}): 'public' | 'authenticated' | 'gated' | 'error' {
  if (input.error) return 'error';
  if (input.loginForm && !pathLooksLikeLogin(input.pageUrl) && (input.gatedMessage || !input.authenticatedSession)) {
    return 'gated';
  }
  if (input.authenticatedSession && !input.loginForm) return 'authenticated';
  return 'public';
}

/**
 * Discovery-session bootstrap only. Not authorize() for generated checks.
 * Submits the observed login form when credentials are present. Never invents locators.
 */
export async function tryDiscoveryLogin(page: Page, credentials: DiscoveryCredentials): Promise<AuthAttempt> {
  const loginPageUrl = page.url();
  const form = await detectLoginForm(page);
  if (!form) {
    return {
      attempted: false,
      succeeded: false,
      reason: 'No username/password/submit controls were observed — login was not invented',
      loginPageUrl,
    };
  }

  try {
    await page.locator(form.usernameLocator).fill(credentials.username);
    await page.locator(form.passwordLocator).fill(credentials.password);
    await page.locator(form.submitLocator).click();
    await page.waitForLoadState('load', { timeout: 15000 }).catch(() => undefined);
    await page
      .locator('h1, a[href], [data-test="inventory-item"], [data-testid="inventory-item"]')
      .first()
      .waitFor({ state: 'attached', timeout: 8000 })
      .catch(() => undefined);
  } catch (error) {
    return {
      attempted: true,
      succeeded: false,
      reason: `Login attempt failed: ${error instanceof Error ? error.message : String(error)}`,
      loginPageUrl,
    };
  }

  const afterUrl = page.url();
  const wall = await observeLoginWall(page);
  const passwordStillVisible = await page
    .locator('input[type="password"]')
    .first()
    .isVisible()
    .catch(() => false);

  if (wall.gatedMessage || (wall.loginForm && passwordStillVisible && afterUrl === loginPageUrl)) {
    return {
      attempted: true,
      succeeded: false,
      reason: wall.gatedMessage
        ? `Login rejected by the application (${wall.gatedMessage})`
        : 'Login form still visible after submit — authenticated inventory is not accessible',
      loginPageUrl,
      afterUrl,
    };
  }

  return {
    attempted: true,
    succeeded: true,
    reason: 'Observed login form accepted the provided QA_USERNAME/QA_PASSWORD session',
    loginPageUrl,
    afterUrl,
  };
}

export function authWithoutCredentials(loginFormObserved: boolean): AuthAttempt {
  if (!loginFormObserved) {
    return {
      attempted: false,
      succeeded: false,
      reason: 'No login form was observed on the seed page',
    };
  }
  return {
    attempted: false,
    succeeded: false,
    reason:
      'Login form observed; QA_USERNAME/QA_PASSWORD are not set — only unauthenticated pages were crawled. Behind-auth catalog items were not invented',
  };
}
