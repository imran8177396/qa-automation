import fs from 'fs';
import path from 'path';
import { type Locator, type Page, type TestInfo, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { BasePage } from './BasePage';
import { LoginForm } from '../components/LoginForm';
import { ContactForm } from '../components/ContactForm';
import { sampleValues } from '../scripts/planning/sample-values';
import { plannedNotApplicableReason } from '../scripts/accessibility/applicability';
import {
  accessibilityAxeDir,
  accessibilityEvidenceDir,
  accessibilityFindingsDir,
  formatAxeViolations,
  formatFinding,
  slugFinding,
} from '../scripts/accessibility/findings';
import type {
  AccessibilityAxePage,
  AccessibilityFinding,
  AccessibilityImpact,
  AxeViolationRecord,
} from '../scripts/accessibility/types';

const MIN_TOUCH_TARGET_PX = 24;
const ZOOM_FACTOR = '2';

interface AxeNodeLike {
  target?: string[];
  html?: string;
}

interface AxeRuleLike {
  id: string;
  impact?: string | null;
  help?: string;
  helpUrl?: string;
  tags?: string[];
  nodes?: AxeNodeLike[];
}

interface TabbableInfo {
  tag: string;
  id: string;
  name: string;
  testId: string;
}

interface FieldLabelInfo {
  id: string;
  type: string;
  name: string;
  testId: string;
  ariaLabel: string | null;
  labelledBy: string | null;
  title: string | null;
  placeholder: string | null;
  hasForLabel: boolean;
  hasWrapLabel: boolean;
}

/**
 * Accessibility Page Object. Specs orchestrate; locators and checks live here.
 * Generated a11y never submits Login — labels and keyboard are checked without submit.
 */
export class AccessibilityPage extends BasePage {
  readonly loginForm: LoginForm;
  readonly contactForm: ContactForm;

  constructor(
    page: Page,
    private readonly testInfo: TestInfo,
    private readonly pageName: string
  ) {
    super(page);
    this.loginForm = new LoginForm(page);
    this.contactForm = new ContactForm(page);
  }

  async open(targetPath: string): Promise<void> {
    await this.goto(targetPath);
    await this.page.waitForLoadState('domcontentloaded');
  }

  async expectLoaded(): Promise<void> {
    await expect(this.page.locator('body')).toBeVisible();
    await this.testInfo.attach(`a11y-${this.pageName}`, {
      body: `Loaded ${this.pageName} for accessibility checks.`,
      contentType: 'text/plain',
    });
  }

  /** First heading of any level — Sauce Demo login has h4s, not an h1. */
  get observedHeading(): Locator {
    return this.page.getByRole('heading').first();
  }

  get brand(): Locator {
    return this.page.getByText('Swag Labs', { exact: true });
  }

  get images(): Locator {
    return this.page.locator('img');
  }

  get table(): Locator {
    return this.page.getByRole('table').or(this.page.locator('table'));
  }

  async expectNoAxeViolations(): Promise<void> {
    const raw = await new AxeBuilder({ page: this.page }).analyze();
    const payload: AccessibilityAxePage = {
      url: raw.url,
      path: this.pagePath(),
      violations: (raw.violations as AxeRuleLike[]).map((row) => this.toAxeRecord(row)),
      incomplete: (raw.incomplete as AxeRuleLike[]).map((row) => this.toAxeRecord(row)),
    };
    this.writeAxePage(payload);
    expect(payload.violations, formatAxeViolations(payload.path, payload.violations)).toEqual([]);
  }

  async expectFirstTabMovesFocus(): Promise<void> {
    await this.page.keyboard.press('Tab');
    await expect(this.page.locator(':focus')).toBeVisible();
  }

  async expectTabOrderAndFocusVisibility(): Promise<void> {
    const expected = await this.collectTabbables();
    if (expected.length === 0) {
      this.recordNotApplicable('keyboard-tab-order', 'No tabbable controls were observed on this page.');
      return;
    }

    await this.blurActive();
    const seen: TabbableInfo[] = [];
    for (let i = 0; i < expected.length; i += 1) {
      await this.page.keyboard.press('Tab');
      const focused = await this.focusedTabbable();
      if (!focused) {
        await this.assert(false, {
          rule: 'keyboard-tab-order',
          impact: 'serious',
          expected: 'each Tab press lands on a visible tabbable control',
          actual: `Tab ${i + 1} of ${expected.length} did not move focus to a visible control`,
        });
        return;
      }
      seen.push(focused);
      await this.expectFocusedIndicator(focused);
    }

    if (await this.hasLoginForm()) {
      const ids = seen.map((row) => row.testId || row.id);
      const userAt = ids.findIndex((id) => id === 'username' || id === 'user-name');
      const passAt = ids.findIndex((id) => id === 'password');
      const buttonAt = ids.findIndex((id) => id === 'login-button' || /login/i.test(id));
      await this.assert(userAt !== -1 && passAt !== -1 && buttonAt !== -1 && userAt < passAt && passAt < buttonAt, {
        rule: 'keyboard-tab-order',
        impact: 'serious',
        expected: 'tab order is username → password → Login',
        actual: `observed order: ${ids.join(' → ') || 'none'}`,
      });
    }
  }

  async expectKeyboardInteractionWithoutSubmit(): Promise<void> {
    if (await this.hasLoginForm()) {
      const user = sampleValues('text').valid;
      const pass = sampleValues('password').valid;
      await this.loginForm.username.click();
      await this.page.keyboard.type(user);
      await this.page.keyboard.press('Tab');
      await expect(this.loginForm.password).toBeFocused();
      await this.page.keyboard.type(pass);
      await this.page.keyboard.press('Tab');
      await expect(this.loginForm.submitButton).toBeFocused();
      await expect(this.page, 'generated a11y must not submit Login').not.toHaveURL(/inventory/i);
      return;
    }

    if ((await this.contactForm.root.count()) > 0 && (await this.contactForm.name.count()) > 0) {
      await this.contactForm.name.click();
      await this.page.keyboard.type(sampleValues('text').valid);
      await this.page.keyboard.press('Tab');
      await expect(this.contactForm.email).toBeFocused();
      return;
    }

    this.recordNotApplicable(
      'keyboard-interaction',
      'No login or contact form was observed — keyboard typing without submit does not apply.'
    );
  }

  async expectProgrammaticLabels(): Promise<void> {
    const fields = await this.collectLabeledFields();
    if (fields.length === 0) {
      this.recordNotApplicable(
        'form-label',
        plannedNotApplicableReason('form-label') ?? 'No text inputs were observed on this page.'
      );
      return;
    }

    for (const field of fields) {
      const labelledByOk = await this.labelledByResolves(field.labelledBy);
      const ok =
        field.hasForLabel ||
        field.hasWrapLabel ||
        Boolean(field.ariaLabel?.trim()) ||
        labelledByOk ||
        Boolean(field.title?.trim());
      await this.assert(ok, {
        rule: 'form-label',
        impact: 'serious',
        expected:
          'programmatic name via label[for], wrapping label, aria-label, aria-labelledby, or title — placeholder is not sufficient',
        actual: ok
          ? 'programmatic label present'
          : `${field.testId || field.id || field.name || field.type} is unlabeled (placeholder=${field.placeholder ?? ''})`,
        selector: field.testId ? `[data-test="${field.testId}"]` : field.id ? `#${field.id}` : field.name,
      });
    }

    if (await this.hasLoginForm()) {
      await expect(this.loginForm.submitButton).toHaveAccessibleName(/login/i);
    }
  }

  async expectHeadingStructure(): Promise<void> {
    const levels = await this.page.evaluate(() =>
      [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((node) => Number(node.tagName.slice(1)))
    );
    if (levels.length === 0) {
      await this.assert(false, {
        rule: 'heading-structure',
        impact: 'moderate',
        expected: 'content page exposes a heading hierarchy',
        actual: 'no heading elements were observed',
      });
      return;
    }

    await expect(this.observedHeading).toBeVisible();
    await this.assert(levels.includes(1), {
      rule: 'heading-structure',
      impact: 'moderate',
      expected: 'page has an h1 (heading hierarchy should start at level 1)',
      actual: `observed heading levels: ${levels.join(', ')}`,
    });
  }

  async expectLandmarksAndAria(): Promise<void> {
    const mainCount = await this.page.getByRole('main').count();
    if (mainCount === 0) {
      await this.assert(false, {
        rule: 'landmark-main',
        impact: 'moderate',
        expected: 'page has a main landmark',
        actual: 'no role=main / <main> observed',
      });
    }

    if (await this.hasLoginForm()) {
      await expect(this.loginForm.root).toBeVisible();
      await expect(this.loginForm.root).toHaveAccessibleName(/login/i);
    }
  }

  async expectFormErrorsWithoutSubmit(): Promise<void> {
    const errorVisible = (await this.loginForm.error.count()) > 0 && (await this.loginForm.error.isVisible());
    if (!errorVisible) {
      this.recordNotApplicable(
        'form-error',
        plannedNotApplicableReason('form-error') ??
          'Form error text is not on the initial page. Generated a11y does not click Login.'
      );
      return;
    }
    await expect(this.loginForm.error).toBeVisible();
  }

  async expectZoomReadable(): Promise<void> {
    await this.page.evaluate((zoom) => {
      document.documentElement.style.zoom = zoom;
    }, ZOOM_FACTOR);
    try {
      if (await this.hasLoginForm()) {
        await expect(this.loginForm.username).toBeVisible();
        await expect(this.loginForm.password).toBeVisible();
        await expect(this.loginForm.submitButton).toBeVisible();
      } else {
        await expect(this.page.locator('body')).toBeVisible();
      }
    } finally {
      await this.page.evaluate(() => {
        document.documentElement.style.zoom = '';
      });
    }
  }

  async expectTouchTargets(): Promise<void> {
    const targets = await this.page.evaluate((min) => {
      const nodes = [...document.querySelectorAll('a[href], button, [role="button"], input[type="submit"], input[type="button"]')] as HTMLElement[];
      return nodes
        .filter((el) => {
          const style = getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden') return false;
          const box = el.getBoundingClientRect();
          return box.width > 0 && box.height > 0;
        })
        .map((el) => {
          const box = el.getBoundingClientRect();
          return {
            name:
              el.getAttribute('data-test') ||
              el.getAttribute('aria-label') ||
              el.textContent?.trim() ||
              el.tagName.toLowerCase(),
            width: box.width,
            height: box.height,
            ok: box.width >= min && box.height >= min,
          };
        });
    }, MIN_TOUCH_TARGET_PX);

    if (targets.length === 0) {
      this.recordNotApplicable('touch-target', 'No pointer targets (links/buttons) were observed.');
      return;
    }

    for (const target of targets) {
      await this.assert(target.ok, {
        rule: 'touch-target',
        impact: 'moderate',
        expected: `pointer target is at least ${MIN_TOUCH_TARGET_PX}×${MIN_TOUCH_TARGET_PX} CSS pixels (WCAG 2.5.8, Chromium box — not a real device)`,
        actual: `${target.name} is ${target.width.toFixed(1)}×${target.height.toFixed(1)}`,
        selector: target.name,
      });
    }
  }

  async recordAbsentChrome(): Promise<void> {
    if ((await this.navigation.count()) === 0) {
      this.recordNotApplicable(
        'navigation',
        plannedNotApplicableReason('navigation') ?? 'No <nav> or role=navigation observed'
      );
    }
    if ((await this.table.count()) === 0) {
      this.recordNotApplicable(
        'table',
        plannedNotApplicableReason('table') ?? 'No table / role=table observed'
      );
    }
    if ((await this.images.count()) === 0) {
      this.recordNotApplicable(
        'image',
        plannedNotApplicableReason('image') ??
          'No <img> observed (Sauce Demo bot is a CSS background, not an image element).'
      );
    }
  }

  async expectImageAltsWhenPresent(): Promise<void> {
    const count = await this.images.count();
    if (count === 0) {
      this.recordNotApplicable(
        'image-alt',
        plannedNotApplicableReason('image') ??
          'No <img> observed (Sauce Demo bot is a CSS background, not an image element).'
      );
      return;
    }
    for (let i = 0; i < count; i += 1) {
      const img = this.images.nth(i);
      const alt = await img.getAttribute('alt');
      await this.assert(alt !== null, {
        rule: 'image-alt',
        impact: 'critical',
        expected: 'each <img> has an alt attribute (empty allowed for decorative)',
        actual: alt === null ? 'img is missing the alt attribute' : `alt="${alt}"`,
      });
    }
  }

  private async hasLoginForm(): Promise<boolean> {
    return (await this.loginForm.username.count()) > 0 && (await this.loginForm.password.count()) > 0;
  }

  private async blurActive(): Promise<void> {
    await this.page.evaluate(() => {
      const active = document.activeElement;
      if (active instanceof HTMLElement) active.blur();
    });
  }

  private async collectTabbables(): Promise<TabbableInfo[]> {
    return this.page.evaluate(() => {
      const nodes = [
        ...document.querySelectorAll('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'),
      ] as HTMLElement[];
      return nodes
        .filter((el) => {
          if ((el as HTMLButtonElement | HTMLInputElement).disabled) return false;
          const style = getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden') return false;
          const box = el.getBoundingClientRect();
          return box.width > 0 && box.height > 0;
        })
        .map((el) => ({
          tag: el.tagName.toLowerCase(),
          id: el.id,
          name:
            el.getAttribute('aria-label') ||
            (el as HTMLInputElement).placeholder ||
            el.textContent?.trim() ||
            el.getAttribute('name') ||
            '',
          testId: el.getAttribute('data-test') || el.getAttribute('data-testid') || '',
        }));
    });
  }

  private async focusedTabbable(): Promise<TabbableInfo | null> {
    return this.page.evaluate(() => {
      const el = document.activeElement;
      if (!(el instanceof HTMLElement) || el === document.body || el === document.documentElement) return null;
      const style = getComputedStyle(el);
      const box = el.getBoundingClientRect();
      if (style.visibility === 'hidden' || box.width === 0 || box.height === 0) return null;
      return {
        tag: el.tagName.toLowerCase(),
        id: el.id,
        name:
          el.getAttribute('aria-label') ||
          (el as HTMLInputElement).placeholder ||
          el.textContent?.trim() ||
          el.getAttribute('name') ||
          '',
        testId: el.getAttribute('data-test') || el.getAttribute('data-testid') || '',
      };
    });
  }

  private async expectFocusedIndicator(focused: TabbableInfo): Promise<void> {
    const visible = await this.page.evaluate(() => {
      const el = document.activeElement;
      if (!(el instanceof HTMLElement)) return false;
      const style = getComputedStyle(el);
      const outlineOn = style.outlineStyle !== 'none' && style.outlineStyle !== '';
      const widthOn = Number.parseFloat(style.outlineWidth) > 0;
      const shadowOn = style.boxShadow !== 'none' && style.boxShadow !== '';
      return outlineOn || widthOn || shadowOn;
    });
    await this.assert(visible, {
      rule: 'focus-visible',
      impact: 'serious',
      expected: 'keyboard focus shows an outline or box-shadow',
      actual: `${focused.testId || focused.id || focused.name || focused.tag} has no measurable focus indicator`,
    });
  }

  private async collectLabeledFields(): Promise<FieldLabelInfo[]> {
    return this.page.evaluate(() => {
      const allowed = new Set(['text', 'password', 'email', 'search', 'tel', 'url', 'number', 'textarea', 'select-one']);
      const nodes = [...document.querySelectorAll('input, select, textarea')] as Array<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >;
      return nodes
        .filter((el) => {
          const type = el.type;
          if (type === 'hidden' || type === 'submit' || type === 'button' || type === 'image') return false;
          if (!allowed.has(type) && el.tagName.toLowerCase() !== 'textarea' && el.tagName.toLowerCase() !== 'select') {
            return false;
          }
          const style = getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden') return false;
          const box = el.getBoundingClientRect();
          return box.width > 0 && box.height > 0;
        })
        .map((el) => {
          const id = el.id;
          const label = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
          const wrapped = el.closest('label');
          return {
            id,
            type: el.type,
            name: el.getAttribute('name') ?? '',
            testId: el.getAttribute('data-test') || el.getAttribute('data-testid') || '',
            ariaLabel: el.getAttribute('aria-label'),
            labelledBy: el.getAttribute('aria-labelledby'),
            title: el.getAttribute('title'),
            placeholder: el.getAttribute('placeholder'),
            hasForLabel: Boolean(label?.textContent?.trim()),
            hasWrapLabel: Boolean(wrapped?.textContent?.trim()),
          };
        });
    });
  }

  private async labelledByResolves(labelledBy: string | null): Promise<boolean> {
    if (!labelledBy?.trim()) return false;
    return this.page.evaluate((ids) => ids.split(/\s+/).every((id) => Boolean(document.getElementById(id))), labelledBy);
  }

  private pagePath(): string {
    try {
      return new URL(this.page.url()).pathname || '/';
    } catch {
      return '/';
    }
  }

  private toAxeRecord(row: AxeRuleLike): AxeViolationRecord {
    return {
      id: row.id,
      impact: row.impact ?? undefined,
      help: row.help,
      helpUrl: row.helpUrl,
      tags: row.tags ?? [],
      nodes: (row.nodes ?? []).map((node) => ({
        target: node.target ?? [],
        html: node.html ?? '',
      })),
    };
  }

  private writeAxePage(payload: AccessibilityAxePage): void {
    const dir = accessibilityAxeDir();
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${slugFinding({ page: this.pageName, rule: 'axe' })}-${process.pid}.json`);
    fs.writeFileSync(file, `${JSON.stringify(payload)}\n`);
  }

  private async assert(
    ok: boolean,
    detail: {
      rule: string;
      expected: string;
      actual: string;
      impact?: AccessibilityImpact;
      selector?: string;
    }
  ): Promise<void> {
    if (ok) return;
    const finding: AccessibilityFinding = {
      status: 'FAIL',
      rule: detail.rule,
      impact: detail.impact ?? 'serious',
      page: this.pageName,
      pagePath: this.pagePath(),
      expected: detail.expected,
      actual: detail.actual,
      selector: detail.selector,
    };
    await this.captureEvidence(finding);
    this.appendFinding(finding);
    await this.testInfo.attach('accessibility-finding', {
      body: Buffer.from(formatFinding(finding)),
      contentType: 'text/plain',
    });
    expect(ok, formatFinding(finding)).toBeTruthy();
  }

  private recordNotApplicable(rule: string, reason: string): void {
    this.appendFinding({
      status: 'NOT_APPLICABLE',
      rule,
      impact: 'info',
      page: this.pageName,
      pagePath: this.pagePath(),
      expected: 'applicable control is present',
      actual: reason,
    });
  }

  private async captureEvidence(finding: AccessibilityFinding): Promise<void> {
    const dir = accessibilityEvidenceDir();
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${slugFinding(finding)}.png`);
    await this.page.screenshot({ path: file, fullPage: true });
    await this.testInfo.attach('screenshot', { path: file, contentType: 'image/png' });
  }

  private appendFinding(finding: AccessibilityFinding): void {
    const dir = accessibilityFindingsDir();
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${slugFinding(finding)}-${Date.now()}-${process.pid}.json`);
    fs.writeFileSync(file, `${JSON.stringify(finding)}\n`);
  }
}
