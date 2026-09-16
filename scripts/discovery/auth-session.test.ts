import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { startFixtureServer } from '../testing/serve-fixture-site';
import {
  classifyPageAccess,
  detectLoginForm,
  tryDiscoveryLogin,
} from './auth-session';

test('classifyPageAccess() marks a non-login URL with a login wall as gated', () => {
  assert.equal(
    classifyPageAccess({
      loginForm: true,
      gatedMessage: 'You can only access',
      pageUrl: 'https://www.saucedemo.com/inventory.html',
      authenticatedSession: false,
    }),
    'gated'
  );
});

test('classifyPageAccess() keeps the seed login page public', () => {
  assert.equal(
    classifyPageAccess({
      loginForm: true,
      gatedMessage: null,
      pageUrl: 'https://www.saucedemo.com/',
      authenticatedSession: false,
    }),
    'public'
  );
});

test(
  'detectLoginForm() observes fixture login controls and does not invent them on contact.html',
  { timeout: 60000 },
  async () => {
    const server = await startFixtureServer();
    const browser = await chromium.launch();
    try {
      const loginPage = await browser.newPage();
      await loginPage.goto(`${server.url}/login.html`, { waitUntil: 'load' });
      const form = await detectLoginForm(loginPage);
      assert.ok(form, 'login.html has username, password, and submit');
      assert.match(form!.usernameLocator, /username|#user/);
      assert.match(form!.passwordLocator, /password|#pass/);
      assert.match(form!.submitLocator, /login-button|#login-form|button/i);

      const contact = await browser.newPage();
      await contact.goto(`${server.url}/contact.html`, { waitUntil: 'load' });
      assert.equal(await detectLoginForm(contact), null, 'contact.html has no password field');
      await contact.close();
      await loginPage.close();
    } finally {
      await browser.close();
      await server.close();
    }
  }
);

test(
  'tryDiscoveryLogin() succeeds only with the observed fixture credentials',
  { timeout: 60000 },
  async () => {
    const server = await startFixtureServer();
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.goto(`${server.url}/login.html`, { waitUntil: 'load' });
      const failed = await tryDiscoveryLogin(page, { username: 'wrong', password: 'nope' });
      assert.equal(failed.succeeded, false);
      assert.equal(failed.attempted, true);

      const retry = await browser.newPage();
      await retry.goto(`${server.url}/login.html`, { waitUntil: 'load' });
      const ok = await tryDiscoveryLogin(retry, { username: 'fixture-user', password: 'fixture-pass' });
      assert.equal(ok.succeeded, true);
      assert.match(retry.url(), /authed\.html/);
      await retry.close();
      await page.close();
    } finally {
      await browser.close();
      await server.close();
    }
  }
);
