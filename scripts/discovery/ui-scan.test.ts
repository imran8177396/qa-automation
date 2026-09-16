import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { startFixtureServer } from '../testing/serve-fixture-site';
import { scanPageUi } from './ui-scan';
import { mergeCategoryStatus, rollupCategory } from './categories';

test('mergeCategoryStatus() prefers DISCOVERED over a later NOT_DISCOVERED rollup', () => {
  const merged = mergeCategoryStatus([
    rollupCategory('navigation', 4, 0, 'No links'),
    rollupCategory('navigation', 0, 0, 'No <nav> observed'),
    rollupCategory('link', 0, 0, 'No <a href> observed'),
  ]);
  const navigation = merged.find((row) => row.category === 'navigation');
  const link = merged.find((row) => row.category === 'link');
  assert.equal(navigation?.status, 'DISCOVERED');
  assert.equal(navigation?.count, 4);
  assert.equal(link?.status, 'NOT_DISCOVERED');
});

test(
  'scanPageUi() records fixture elements that actually exist and does not invent the rest',
  { timeout: 60000 },
  async () => {
    const server = await startFixtureServer();
    const browser = await chromium.launch();

    try {
      const page = await browser.newPage();
      await page.goto(`${server.url}/contact.html`, { waitUntil: 'load' });
      const elements = await scanPageUi(page, `${server.url}/contact.html`);

      const types = elements.map((el) => el.elementType);
      assert.ok(types.includes('navigation'), 'contact.html has a <nav>');
      assert.ok(types.includes('link'), 'contact.html has <a href="/index.html">');
      assert.ok(types.includes('form'), 'contact.html has a POST form');
      assert.ok(types.includes('input'), 'contact.html has name and email inputs');
      assert.ok(types.includes('textarea'), 'contact.html has a message textarea');
      assert.ok(types.includes('button'), 'contact.html has Send message');

      const name = elements.find((el) => el.locator === '#name');
      assert.ok(name, 'name input is present with id=name');
      assert.equal(name!.required, true);
      assert.equal(name!.visible, true);
      assert.equal(name!.label, 'Name');
      assert.equal(name!.editable, true);
      assert.ok(name!.applicableTestTypes.includes('form-boundary'));

      const send = elements.find((el) => el.accessibleName === 'Send message');
      assert.ok(send);
      assert.equal(send!.isSubmit, true);
      assert.match(send!.potentialAction, /not authorized/i);

      assert.equal(
        elements.some((el) => el.elementType === 'modal'),
        false,
        'contact.html has no modal — must not invent one'
      );
      assert.equal(
        elements.some((el) => el.elementType === 'video'),
        false,
        'contact.html has no video — must not invent one'
      );

      const home = await browser.newPage();
      await home.goto(`${server.url}/index.html`, { waitUntil: 'load' });
      const homeElements = await scanPageUi(home, `${server.url}/index.html`);
      const homeLinks = homeElements.filter((el) => el.elementType === 'link').map((el) => el.accessibleName);
      assert.ok(homeLinks.includes('Home'));
      assert.ok(homeLinks.includes('Contact'));
      assert.ok(homeLinks.includes('Account settings'));
      await home.close();
    } finally {
      await browser.close();
      await server.close();
    }
  }
);
