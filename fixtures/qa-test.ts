import { test as base } from '@playwright/test';
import { HomePage } from '../pages/HomePage';
import { LoginPage } from '../pages/LoginPage';
import { InventoryPage } from '../pages/InventoryPage';
import { DiscoveredPage } from '../pages/DiscoveredPage';
import { VisualPage } from '../pages/VisualPage';
import { ResponsivePage } from '../pages/ResponsivePage';
import { AccessibilityPage } from '../pages/AccessibilityPage';
import { ContactForm } from '../components/ContactForm';
import { LoginForm } from '../components/LoginForm';
import { viewportFromProjectName, type ViewportProfile } from '../scripts/responsive/viewports';
import type { ResponsivePageDef } from '../scripts/responsive/pages';
import type { AccessibilityPageDef } from '../scripts/accessibility/types';

type QaFixtures = {
  homePage: HomePage;
  loginPage: LoginPage;
  inventoryPage: InventoryPage;
  discoveredPage: DiscoveredPage;
  visualPage: VisualPage;
  contactForm: ContactForm;
  loginForm: LoginForm;
  viewportProfile: ViewportProfile;
  openResponsive: (def: ResponsivePageDef) => Promise<ResponsivePage>;
  openAccessibility: (def: AccessibilityPageDef) => Promise<AccessibilityPage>;
};

export const test = base.extend<QaFixtures>({
  homePage: async ({ page }, use) => {
    await use(new HomePage(page));
  },
  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },
  inventoryPage: async ({ page }, use) => {
    await use(new InventoryPage(page));
  },
  discoveredPage: async ({ page }, use) => {
    await use(new DiscoveredPage(page));
  },
  visualPage: async ({ page }, use) => {
    await use(new VisualPage(page));
  },
  contactForm: async ({ page }, use) => {
    await use(new ContactForm(page));
  },
  loginForm: async ({ page }, use) => {
    await use(new LoginForm(page));
  },
  viewportProfile: async ({}, use, testInfo) => {
    await use(viewportFromProjectName(testInfo.project.name));
  },
  openResponsive: async ({ page }, use, testInfo) => {
    const profile = viewportFromProjectName(testInfo.project.name);
    await use(async (def) => {
      const responsivePage = new ResponsivePage(page, profile, testInfo, def.name);
      await responsivePage.open(def.path);
      return responsivePage;
    });
  },
  openAccessibility: async ({ page }, use, testInfo) => {
    await use(async (def) => {
      const accessibilityPage = new AccessibilityPage(page, testInfo, def.name);
      await accessibilityPage.open(def.path);
      return accessibilityPage;
    });
  },
});

export { expect } from '@playwright/test';
