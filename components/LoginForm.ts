import { type Locator, type Page, expect } from '@playwright/test';

/**
 * Sauce Demo login form. Locators live here once — LoginPage and generated
 * discovery checks both go through this component.
 *
 * There is deliberately no submit() — `scripts/core/safety-policy.ts` refuses
 * `submit-form` for generated checks. Hand-written specs that must click Login
 * do so explicitly on LoginPage.
 */
export class LoginForm {
  constructor(private readonly page: Page) {}

  get root(): Locator {
    return this.page.getByRole('form', { name: 'Login' }).or(this.page.locator('[aria-label="Login"]'));
  }

  get username(): Locator {
    return this.page.getByTestId('username');
  }

  get password(): Locator {
    return this.page.getByTestId('password');
  }

  get submitButton(): Locator {
    return this.page.getByRole('button', { name: 'Login' });
  }

  get error(): Locator {
    return this.page.getByTestId('error');
  }

  /**
   * Map a discovery locator onto this component. Returns null when the selector
   * is not a known login control — callers fall back to the generic locator.
   */
  locatorForDiscoverySelector(selector: string): Locator | null {
    const normalized = selector.replace(/\\"/g, '"').replace(/\\'/g, "'");
    if (
      normalized.includes('data-test="username"') ||
      normalized.includes("data-test='username'") ||
      normalized === '#user-name' ||
      normalized.includes('name="user-name"')
    ) {
      return this.username;
    }
    if (
      normalized.includes('data-test="password"') ||
      normalized.includes("data-test='password'") ||
      normalized === '#password' ||
      normalized.includes('name="password"')
    ) {
      return this.password;
    }
    if (
      normalized.includes('data-test="login-button"') ||
      normalized.includes("data-test='login-button'") ||
      normalized === '#login-button' ||
      normalized.includes('name="login-button"')
    ) {
      return this.submitButton;
    }
    if (normalized.includes('aria-label="Login"') || normalized.includes("aria-label='Login'")) {
      return this.root;
    }
    return null;
  }

  async fillWithoutSubmit(values: { username?: string; password?: string }): Promise<void> {
    if (values.username !== undefined) {
      await this.username.fill(values.username);
      await this.username.blur();
    }
    if (values.password !== undefined) {
      await this.password.fill(values.password);
      await this.password.blur();
    }
  }

  async expectFieldsPresent(): Promise<void> {
    await expect(this.root).toBeVisible();
    await expect(this.username).toBeVisible();
    await expect(this.password).toBeVisible();
    await expect(this.submitButton).toBeVisible();
    await expect(this.submitButton).toBeEnabled();
  }
}
