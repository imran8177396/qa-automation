import { test as base } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';

type QaFixtures = {
  loginPage: LoginPage;
};

export const test = base.extend<QaFixtures>({
  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },
});

export { expect } from '@playwright/test';
