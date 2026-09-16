import { test, expect } from '../../fixtures/qa-test';
import { startFixtureServer, type FixtureServer } from '../../scripts/testing/serve-fixture-site';

/**
 * Framework self-verification — NOT product coverage.
 *
 * These tests run against the local loopback fixture in `fixtures/site/`, not
 * against the configured Sauce Demo origin. Product coverage lives in home.spec
 * and static-pages.spec. Every test title says so, so the suite report cannot
 * be read as evidence about the example application.
 *
 * Non-destructive by construction: only GET navigations and field fills. The
 * contact form is filled and inspected but never submitted, which the last test
 * proves by asserting the fixture server observed no state-changing request.
 */

const CONTACT_VALUES = {
  name: 'QA Automation',
  email: 'qa.automation@example.com',
  message: 'Non-destructive example check. This form is intentionally not submitted.',
} as const;

let server: FixtureServer;

test.beforeAll(async () => {
  server = await startFixtureServer();
});

test.afterAll(async () => {
  await server.close();
});

test.describe('framework self-check (local fixture site, not product coverage)', () => {
  test('home page loads and exposes a heading and title', async ({ homePage }) => {
    await homePage.open(`${server.url}/index.html`);
    await homePage.expectLoaded();
    await expect(homePage.heading).toHaveText('Fixture Site');
  });

  test('navigation links resolve by accessible name', async ({ homePage }) => {
    await homePage.open(`${server.url}/index.html`);
    await expect(homePage.navigation).toBeVisible();
    await expect(homePage.link('Contact')).toHaveAttribute('href', '/contact.html');
  });

  test('unknown route answers a real 404 rather than a soft error page', async ({ discoveredPage }) => {
    const status = await discoveredPage.openAllowingError(`${server.url}/missing-page.html`);
    expect(status, 'an unknown path must report 404, not 200 with error content').toBe(404);
  });

  test('contact form fills by label and is never submitted', async ({ discoveredPage, contactForm }) => {
    await discoveredPage.open(`${server.url}/contact.html`);

    await contactForm.fillWithoutSubmit(CONTACT_VALUES);
    await contactForm.expectFilled(CONTACT_VALUES);

    // The submit control is observed, not activated — safety-policy.authorize()
    // refuses 'submit-form' and submit buttons for automated checks.
    await expect(contactForm.submitButton).toBeVisible();
    await expect(contactForm.submitButton).toBeEnabled();

    const stateChanging = server.requestLog.filter((entry) => entry.method !== 'GET');
    expect(stateChanging, 'no state-changing request may reach the target').toEqual([]);
  });
});
