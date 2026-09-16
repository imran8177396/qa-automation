import { type Locator, type Page, expect } from '@playwright/test';
import { BasePage } from './BasePage';
import { ContactForm } from '../components/ContactForm';
import { LoginForm } from '../components/LoginForm';
import { stabilizeForVisual } from '../scripts/visual/stabilize';
import { sampleValues } from '../scripts/planning/sample-values';
import {
  boxesOverlap,
  boxOverflowsViewport,
  clipAmount,
  isCollapsed,
} from '../scripts/responsive/geometry';

const SCREENSHOT = {
  animations: 'disabled' as const,
  caret: 'hide' as const,
};

const DEFAULT_VIEWPORT = { width: 1280, height: 720 };
const MOVEMENT_SLACK_PX = 2;
const ALIGNMENT_SLACK_PX = 24;

/**
 * Visual assertions only. Functional "does it work?" checks belong in tests/e2e/, not here.
 */
export class VisualPage extends BasePage {
  readonly loginForm: LoginForm;

  constructor(page: Page) {
    super(page);
    this.loginForm = new LoginForm(page);
  }

  async open(path: string, viewport = DEFAULT_VIEWPORT): Promise<void> {
    await this.page.setViewportSize(viewport);
    await this.goto(path);
    await stabilizeForVisual(this.page);
  }

  get nav(): Locator {
    return this.navigation;
  }

  get firstForm(): Locator {
    return this.page.locator('form').first();
  }

  get logo(): Locator {
    return this.page.getByRole('img', { name: 'Fixture logo' });
  }

  get dangerZone(): Locator {
    return this.page.locator('section').filter({ hasText: 'Danger zone' });
  }

  /** First heading of any level — Sauce Demo login has h4s, not an h1. */
  get observedHeading(): Locator {
    return this.page.getByRole('heading').first();
  }

  /** Visible brand text on the Sauce Demo login screen. */
  get brand(): Locator {
    return this.page.getByText('Swag Labs', { exact: true });
  }

  async expectPageScreenshot(name: string): Promise<void> {
    await expect(this.page).toHaveScreenshot(name, { ...SCREENSHOT, fullPage: true });
  }

  async expectElementScreenshot(locator: Locator, name: string): Promise<void> {
    await expect(locator).toBeVisible();
    await expect(locator).toHaveScreenshot(name, SCREENSHOT);
  }

  async fillContactPreview(): Promise<void> {
    await new ContactForm(this.page).fillWithoutSubmit({
      name: 'Visual Tester',
      email: 'visual@example.com',
      message: 'Filled-state screenshot. This form is not submitted.',
    });
  }

  /** Sample values only — never real credentials, never submit. */
  async fillLoginPreview(): Promise<void> {
    await this.loginForm.fillWithoutSubmit({
      username: sampleValues('text').valid,
      password: sampleValues('password').valid,
    });
  }

  async expectRegionsDoNotOverlap(first: Locator, second: Locator, label: string): Promise<void> {
    const boxA = await first.boundingBox();
    const boxB = await second.boundingBox();
    expect(boxA, `${label}: first region has no box`).not.toBeNull();
    expect(boxB, `${label}: second region has no box`).not.toBeNull();
    expect(boxesOverlap(boxA!, boxB!), `${label} should not overlap`).toBeFalsy();
  }

  async expectRegionIntact(locator: Locator, label: string): Promise<void> {
    await expect(locator).toBeVisible();
    const box = await locator.boundingBox();
    const viewport = this.page.viewportSize();
    expect(box, `${label} should have a rendered box`).not.toBeNull();
    expect(viewport, `${label}: viewport is missing`).not.toBeNull();
    expect(isCollapsed(box!), `${label} should not be a collapsed container`).toBeFalsy();
    expect(
      boxOverflowsViewport(box!, viewport!.width),
      `${label} should stay within the viewport (no clipped overflow)`
    ).toBeFalsy();
  }

  async expectRegionNotClipped(locator: Locator, label: string): Promise<void> {
    const metrics = await locator.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    expect(clipAmount(metrics.scrollWidth, metrics.clientWidth), `${label} should not clip its content`).toBe(0);
  }

  async expectNoUnexpectedMovement(locator: Locator, label: string): Promise<void> {
    const first = await locator.boundingBox();
    await this.page.evaluate(() => document.fonts.ready);
    await this.page.waitForLoadState('domcontentloaded');
    await stabilizeForVisual(this.page);
    const second = await locator.boundingBox();
    expect(first, `${label}: first measurement missing`).not.toBeNull();
    expect(second, `${label}: second measurement missing`).not.toBeNull();
    expect(Math.abs(first!.x - second!.x), `${label} unexpected horizontal movement`).toBeLessThanOrEqual(
      MOVEMENT_SLACK_PX
    );
    expect(Math.abs(first!.y - second!.y), `${label} unexpected vertical movement`).toBeLessThanOrEqual(
      MOVEMENT_SLACK_PX
    );
  }

  async expectLoginFieldsStacked(): Promise<void> {
    const user = await this.loginForm.username.boundingBox();
    const pass = await this.loginForm.password.boundingBox();
    const button = await this.loginForm.submitButton.boundingBox();
    expect(user, 'username box').not.toBeNull();
    expect(pass, 'password box').not.toBeNull();
    expect(button, 'login button box').not.toBeNull();
    expect(pass!.y, 'password should sit below username').toBeGreaterThan(user!.y);
    expect(button!.y, 'login button should sit below password').toBeGreaterThan(pass!.y);
    expect(Math.abs(user!.x - pass!.x), 'username/password horizontal alignment').toBeLessThanOrEqual(
      ALIGNMENT_SLACK_PX
    );
  }

  async expectHeadingHasTypography(): Promise<void> {
    await expect(this.observedHeading).toBeVisible();
    const fontSize = await this.observedHeading.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(fontSize, 'observed heading should have a non-zero font-size').toBeGreaterThan(0);
  }

  async countVisibleImages(): Promise<number> {
    return this.page.locator('img').count();
  }

  async expectVisibleImagesLoaded(): Promise<void> {
    const images = this.page.locator('img');
    const count = await images.count();
    for (let i = 0; i < count; i++) {
      const img = images.nth(i);
      if (!(await img.isVisible())) continue;
      const natural = await img.evaluate((el) => {
        const image = el as HTMLImageElement;
        return { w: image.naturalWidth, complete: image.complete };
      });
      expect(natural.complete && natural.w > 0, `visible image ${i} should load`).toBeTruthy();
    }
  }
}
