import fs from 'fs';
import path from 'path';
import { type Locator, type Page, type TestInfo, expect } from '@playwright/test';
import { BasePage } from './BasePage';
import { collectLayout, type LayoutSnapshot } from '../scripts/responsive/collect-layout';
import { formatFinding, slugFinding, type ResponsiveFinding } from '../scripts/responsive/findings';
import {
  boxesOverlap,
  boxOverflowsViewport,
  clipAmount,
  documentHasHorizontalOverflow,
  isCollapsed,
} from '../scripts/responsive/geometry';
import { PATHS } from '../scripts/lib/paths';
import type { ViewportProfile } from '../scripts/responsive/viewports';

export class ResponsivePage extends BasePage {
  constructor(
    page: Page,
    private readonly profile: ViewportProfile,
    private readonly testInfo: TestInfo,
    private readonly pageName: string
  ) {
    super(page);
  }

  get header(): Locator {
    return this.page.locator('header, [data-qa="header"]');
  }

  get hero(): Locator {
    return this.page.locator('[data-qa="hero"]');
  }

  get cards(): Locator {
    return this.page.locator('[data-qa="cards"]');
  }

  get grid(): Locator {
    return this.page.locator('[data-qa="grid"]');
  }

  get form(): Locator {
    return this.page.locator('form');
  }

  get table(): Locator {
    return this.page.locator('table');
  }

  get footer(): Locator {
    return this.page.locator('footer, [data-qa="footer"]');
  }

  get menuToggle(): Locator {
    return this.page.getByRole('button', { name: 'Menu' });
  }

  get siteNav(): Locator {
    return this.page.locator('[data-qa="nav"], nav').first();
  }

  get modal(): Locator {
    return this.page.locator('[data-qa="modal"]');
  }

  get dropdown(): Locator {
    return this.page.locator('[data-qa="dropdown"]');
  }

  async open(targetPath: string): Promise<void> {
    await this.page.setViewportSize({ width: this.profile.width, height: this.profile.height });
    await this.goto(targetPath);
    await this.page.waitForLoadState('domcontentloaded');
    await this.page.evaluate(() => document.fonts.ready);
  }

  async snapshot(): Promise<LayoutSnapshot> {
    return collectLayout(this.page);
  }

  async expectNoHorizontalOverflow(): Promise<void> {
    const snap = await this.snapshot();
    const overflow = documentHasHorizontalOverflow(snap.scrollWidth, snap.clientWidth);
    await this.assert(!overflow, {
      element: 'document',
      expected: 'page scrollWidth stays within the layout viewport (no horizontal overflow)',
      actual: overflow
        ? `scrollWidth=${snap.scrollWidth} clientWidth=${snap.clientWidth} viewport=${snap.viewportWidth}`
        : 'no horizontal overflow',
    });
  }

  async expectLandmarksInViewport(): Promise<void> {
    const snap = await this.snapshot();
    for (const landmark of snap.landmarks) {
      if (!landmark.present || !landmark.visible || !landmark.box) continue;
      if (landmark.name === 'mobile-menu-toggle' && !this.profile.compactChrome) continue;
      const overflow = boxOverflowsViewport(landmark.box, snap.viewportWidth);
      await this.assert(!overflow, {
        element: landmark.name,
        expected: `${landmark.name} stays within the ${this.profile.width}px layout viewport`,
        actual: overflow
          ? `box x=${landmark.box.x.toFixed(1)} width=${landmark.box.width.toFixed(1)} viewport=${snap.viewportWidth}`
          : 'within viewport',
      });
    }
  }

  async expectNoBrokenContainers(): Promise<void> {
    const snap = await this.snapshot();
    for (const landmark of snap.landmarks) {
      if (!landmark.present || !landmark.visible || !landmark.box) continue;
      if (landmark.name === 'mobile-menu-toggle' && !this.profile.compactChrome) continue;
      await this.assert(!isCollapsed(landmark.box), {
        element: landmark.name,
        expected: `${landmark.name} renders with a non-zero box`,
        actual: `width=${landmark.box.width} height=${landmark.box.height}`,
      });
    }
  }

  async expectNoClippedLandmarks(): Promise<void> {
    const snap = await this.snapshot();
    for (const landmark of snap.landmarks) {
      if (!landmark.present || !landmark.visible) continue;
      if (landmark.overflowX === 'auto' || landmark.overflowX === 'scroll') continue;
      const clipped = clipAmount(landmark.scrollWidth, landmark.clientWidth);
      await this.assert(clipped === 0, {
        element: landmark.name,
        expected: `${landmark.name} does not clip its content on the x-axis`,
        actual: clipped > 0 ? `content is clipped by ${clipped}px` : 'not clipped',
      });
    }
  }

  async expectSiblingGroupsDoNotOverlap(): Promise<void> {
    const snap = await this.snapshot();
    for (const [group, boxes] of Object.entries(snap.siblingGroups)) {
      for (let i = 0; i < boxes.length; i += 1) {
        for (let j = i + 1; j < boxes.length; j += 1) {
          const overlap = boxesOverlap(boxes[i], boxes[j]);
          await this.assert(!overlap, {
            element: `${group}[${i}]/${group}[${j}]`,
            expected: `${group} items do not overlap`,
            actual: overlap
              ? `boxes intersect: ${JSON.stringify(boxes[i])} vs ${JSON.stringify(boxes[j])}`
              : 'no overlap',
          });
        }
      }
    }
  }

  async expectRegionPairDoesNotOverlap(first: string, second: string): Promise<void> {
    const snap = await this.snapshot();
    const a = snap.landmarks.find((row) => row.name === first);
    const b = snap.landmarks.find((row) => row.name === second);
    if (!a?.present || !b?.present || !a.visible || !b.visible || !a.box || !b.box) {
      return;
    }
    const overlap = boxesOverlap(a.box, b.box);
    await this.assert(!overlap, {
      element: `${first} vs ${second}`,
      expected: `${first} and ${second} do not overlap`,
      actual: overlap ? 'bounding boxes intersect' : 'no overlap',
    });
  }

  async expectImagesLoadedAndContained(): Promise<void> {
    const snap = await this.snapshot();
    if (snap.images.length === 0) return;
    for (const image of snap.images) {
      await this.assert(image.naturalWidth > 0, {
        element: `img:${image.name}`,
        expected: 'image file loaded (naturalWidth > 0)',
        actual: `naturalWidth=${image.naturalWidth}`,
      });
      await this.assert(!boxOverflowsViewport(image.box, snap.viewportWidth), {
        element: `img:${image.name}`,
        expected: 'image stays within the layout viewport',
        actual: `x=${image.box.x.toFixed(1)} width=${image.box.width.toFixed(1)} viewport=${snap.viewportWidth}`,
      });
    }
  }

  async expectButtonsUsable(): Promise<void> {
    const snap = await this.snapshot();
    const visible = snap.buttons.filter((btn) => !isCollapsed(btn.box));
    if (visible.length === 0) return;
    for (const button of visible) {
      await this.assert(!boxOverflowsViewport(button.box, snap.viewportWidth), {
        element: `button:${button.name}`,
        expected: 'button remains within the layout viewport',
        actual: `x=${button.box.x.toFixed(1)} width=${button.box.width.toFixed(1)}`,
      });
    }
  }

  async expectReadableTypography(): Promise<void> {
    const snap = await this.snapshot();
    await this.assert(snap.bodyFontSize >= 14, {
      element: 'body typography',
      expected: 'body font-size is at least 14px so text stays readable when the viewport shrinks',
      actual: `font-size=${snap.bodyFontSize}px`,
    });
    await expect(this.heading, this.message('h1', 'primary heading is visible', 'heading missing')).toBeVisible();
  }

  async expectApplicableRegionVisible(name: string, locator: Locator): Promise<void> {
    if ((await locator.count()) === 0) {
      this.recordNotApplicable(name, `${name} is not present on ${this.pageName}`);
      return;
    }
    await expect(locator.first(), this.message(name, `${name} is visible`, 'not visible')).toBeVisible();
  }

  async expectNavigationChrome(): Promise<void> {
    if ((await this.siteNav.count()) === 0) {
      this.recordNotApplicable('navigation', `navigation is not present on ${this.pageName}`);
      return;
    }
    if (this.profile.compactChrome && (await this.menuToggle.count()) > 0) {
      await expect(
        this.menuToggle,
        this.message('navigation', 'compact viewport exposes a menu toggle', 'toggle not visible')
      ).toBeVisible();
      return;
    }
    await expect(this.siteNav, this.message('navigation', 'navigation is visible', 'not visible')).toBeVisible();
  }

  async ensureNavAvailable(): Promise<void> {
    if (await this.menuToggle.isVisible()) {
      const expanded = await this.menuToggle.getAttribute('aria-expanded');
      if (expanded !== 'true') {
        await this.menuToggle.click();
      }
      await expect(this.siteNav).toBeVisible();
    }
  }

  async expectInScopeNavigation(): Promise<void> {
    await this.ensureNavAvailable();
    const contact = this.page.getByRole('link', { name: 'Contact' });
    const home = this.page.getByRole('link', { name: 'Home' });
    if (await contact.count()) {
      await contact.first().click();
      await expect(this.page).toHaveURL(/contact\.html/);
      return;
    }
    if (await home.count()) {
      await home.first().click();
      await expect(this.page).toHaveURL(/index\.html|\/$/);
      return;
    }
    this.recordNotApplicable('navigation', 'no in-scope Home/Contact link on this page');
  }

  async expectFormFillableWithoutSubmit(): Promise<void> {
    const form = this.page.locator('form').first();
    if ((await form.count()) === 0) {
      this.recordNotApplicable('form', 'no form on this page');
      return;
    }
    await expect(form).toBeVisible();
    const textField = form.locator('input:not([type="hidden"]):not([type="submit"]), textarea').first();
    if ((await textField.count()) === 0) {
      this.recordNotApplicable('form fields', 'form has no fillable text control');
      return;
    }
    await expect(textField).toBeVisible();
    await textField.fill('Responsive tester');
    await expect(textField).toHaveValue('Responsive tester');
  }

  async expectMobileMenuBehavior(): Promise<void> {
    if ((await this.menuToggle.count()) === 0) {
      this.recordNotApplicable('mobile menu', 'no menu toggle on this page');
      return;
    }

    if (!this.profile.compactChrome) {
      await expect(this.menuToggle, this.message('mobile-menu-toggle', 'toggle hidden on wide viewports', 'toggle visible')).toBeHidden();
      await expect(this.siteNav).toBeVisible();
      return;
    }

    await expect(this.menuToggle).toBeVisible();
    await expect(this.siteNav).toBeHidden();
    await this.menuToggle.click();
    await expect(this.menuToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(this.siteNav).toBeVisible();
    await this.menuToggle.click();
    await expect(this.menuToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(this.siteNav).toBeHidden();
  }

  async expectModalOpenClose(): Promise<void> {
    const openBtn = this.page.locator('[data-qa="modal-open"]');
    if ((await openBtn.count()) === 0) {
      this.recordNotApplicable('modal', 'no modal on this page');
      return;
    }
    await openBtn.click();
    await expect(this.modal).toBeVisible();
    await this.page.locator('[data-qa="modal-close"]').click();
    await expect(this.modal).toBeHidden();
  }

  async expectDropdownChange(): Promise<void> {
    if ((await this.dropdown.count()) === 0) {
      this.recordNotApplicable('dropdown', 'no dropdown on this page');
      return;
    }
    await expect(this.dropdown).toBeVisible();
    await this.dropdown.selectOption('billing');
    await expect(this.dropdown).toHaveValue('billing');
  }

  private message(element: string, expected: string, actual: string): string {
    return formatFinding(this.baseFinding(element, expected, actual));
  }

  private async assert(
    ok: boolean,
    detail: { element: string; expected: string; actual: string }
  ): Promise<void> {
    if (ok) return;
    const finding = this.baseFinding(detail.element, detail.expected, detail.actual);
    finding.screenshot = await this.captureEvidence(finding);
    this.appendFinding(finding);
    await this.testInfo.attach('responsive-finding', {
      body: Buffer.from(formatFinding(finding)),
      contentType: 'text/plain',
    });
    expect(ok, formatFinding(finding)).toBeTruthy();
  }

  private recordNotApplicable(element: string, reason: string): void {
    const finding: ResponsiveFinding = {
      ...this.baseFinding(element, 'applicable control is present', reason),
      status: 'NOT_APPLICABLE',
    };
    this.appendFinding(finding);
  }

  private baseFinding(element: string, expected: string, actual: string): ResponsiveFinding {
    return {
      status: 'FAIL',
      page: this.pageName,
      pagePath: new URL(this.page.url()).pathname,
      viewport: this.profile.name,
      viewportSize: `${this.profile.width}x${this.profile.height}`,
      affectedElement: element,
      expected,
      actual,
      engineNote: this.profile.emulationNote,
    };
  }

  private async captureEvidence(finding: ResponsiveFinding): Promise<string> {
    const dir = path.join(PATHS.root, 'test-results', 'responsive', 'evidence');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${slugFinding(finding)}.png`);
    await this.page.screenshot({ path: file, fullPage: true });
    await this.testInfo.attach('screenshot', { path: file, contentType: 'image/png' });
    return file;
  }

  private appendFinding(finding: ResponsiveFinding): void {
    const dir = path.join(PATHS.root, 'test-results', 'responsive', 'findings');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${slugFinding(finding)}-${Date.now()}-${process.pid}.json`);
    fs.writeFileSync(file, `${JSON.stringify(finding)}\n`);
  }
}
