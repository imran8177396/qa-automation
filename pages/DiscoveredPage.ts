import { type Locator, type Page, expect } from '@playwright/test';
import { BasePage } from './BasePage';

const NAV_TIMEOUT_MS = 30000;

/**
 * Generic page object for discovery-generated UI checks.
 * Specs go through these methods — no raw goto/fill in the generated spec.
 */
export class DiscoveredPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  async open(url: string, options?: { requireOk?: boolean }): Promise<void> {
    const response = await this.page.goto(url, { waitUntil: 'load', timeout: NAV_TIMEOUT_MS });
    if (options?.requireOk === false) return;
    expect(response, `expected a response for ${url}`).not.toBeNull();
    expect(response!.ok(), `${url} should return a successful status`).toBeTruthy();
  }

  async openAllowingError(url: string): Promise<number> {
    const response = await this.page.goto(url, { waitUntil: 'load', timeout: NAV_TIMEOUT_MS }).catch(() => null);
    return response?.status() ?? 0;
  }

  locate(selector: string): Locator {
    return this.page.locator(selector).first();
  }

  async expectVisible(selector: string): Promise<Locator> {
    const locator = this.locate(selector);
    await expect(locator).toBeVisible();
    return locator;
  }

  async expectEnabledState(selector: string, enabled: boolean): Promise<void> {
    const locator = await this.expectVisible(selector);
    if (enabled) await expect(locator).toBeEnabled();
    else await expect(locator).toBeDisabled();
  }

  async expectAccessibleName(selector: string, name: string): Promise<void> {
    const locator = await this.expectVisible(selector);
    const observed = await locator.evaluate((el) => {
      const input = el as HTMLInputElement;
      return [el.getAttribute('aria-label'), (el.textContent ?? '').trim(), input.placeholder, input.name, el.id]
        .filter(Boolean)
        .join(' ');
    });
    expect(observed.toLowerCase()).toContain(name.trim().toLowerCase().slice(0, 80));
  }

  async expectRequired(selector: string, required: boolean): Promise<void> {
    const locator = await this.expectVisible(selector);
    const actual = await locator.evaluate((el) => Boolean((el as HTMLInputElement).required));
    expect(actual, `${selector} required`).toBe(required);
  }

  async expectEditable(selector: string, readOnly?: boolean): Promise<void> {
    const locator = await this.expectVisible(selector);
    if (readOnly) {
      await expect(locator).toHaveAttribute('readonly', /.*/);
      return;
    }
    await expect(locator).toBeEditable();
  }

  async fillWithoutSubmit(selector: string, value: string): Promise<void> {
    const locator = await this.expectVisible(selector);
    await locator.fill(value);
    await locator.blur();
  }

  async expectConstraintValidity(selector: string, valid: boolean): Promise<void> {
    const locator = this.locate(selector);
    const actual = await locator.evaluate((el) => {
      const input = el as HTMLInputElement;
      return typeof input.checkValidity === 'function' ? input.checkValidity() : true;
    });
    expect(actual, `expected constraint validity=${valid} for ${selector}`).toBe(valid);
  }

  async recoverFromInvalid(selector: string, invalid: string, valid: string): Promise<void> {
    await this.fillWithoutSubmit(selector, invalid);
    await this.expectConstraintValidity(selector, false);
    await this.fillWithoutSubmit(selector, valid);
    await this.expectConstraintValidity(selector, true);
  }

  async expectHref(selector: string, href: string): Promise<void> {
    const locator = await this.expectVisible(selector);
    await expect(locator).toHaveAttribute('href', href);
  }

  async clickLink(selector: string, expectedHref: string, pageUrl: string): Promise<void> {
    const locator = await this.expectVisible(selector);
    const resolved = new URL(expectedHref, pageUrl).href;
    await locator.click();
    await this.page.waitForLoadState('load');
    const landed = new URL(this.page.url());
    const expected = new URL(resolved);
    expect(`${landed.origin}${landed.pathname}${landed.search}`).toBe(
      `${expected.origin}${expected.pathname}${expected.search}`
    );
  }

  async clickButton(selector: string): Promise<void> {
    const locator = await this.expectVisible(selector);
    await expect(locator).toBeEnabled();
    await locator.click();
  }

  async selectFirstAlternative(selector: string): Promise<void> {
    const locator = await this.expectVisible(selector);
    const values = await locator.evaluate((el) =>
      Array.from((el as HTMLSelectElement).options).map((option) => option.value)
    );
    expect(values.length, `${selector} should expose options`).toBeGreaterThan(0);
    const current = await locator.inputValue();
    const next = values.find((value) => value !== current) ?? values[0];
    await locator.selectOption(next);
  }

  async toggleCheckbox(selector: string): Promise<void> {
    const locator = await this.expectVisible(selector);
    const checked = await locator.isChecked();
    if (checked) await locator.uncheck();
    else await locator.check();
    expect(await locator.isChecked()).toBe(!checked);
  }

  async selectRadio(selector: string): Promise<void> {
    const locator = await this.expectVisible(selector);
    await locator.check();
    await expect(locator).toBeChecked();
  }

  async destinationStatus(href: string, pageUrl: string): Promise<number> {
    const resolved = new URL(href, pageUrl).href;
    const response = await this.page.request.get(resolved);
    return response.status();
  }
}
