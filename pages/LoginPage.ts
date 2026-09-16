import { expect, type Locator, type Page } from '@playwright/test';
import { LoginForm } from '../components/LoginForm';
import { BasePage } from './BasePage';

/**
 * Sauce Demo login screen (public example target). Specs orchestrate;
 * credentials come from env via getCredentials() — never hardcoded here.
 * Locators live on LoginForm so generated checks do not redefine them.
 */
export class LoginPage extends BasePage {
  readonly form: LoginForm;

  constructor(page: Page) {
    super(page);
    this.form = new LoginForm(page);
  }

  async open(target = '/'): Promise<void> {
    await this.goto(target);
  }

  /**
   * Navigate a login-gated path. Sauce Demo renders the login form and may
   * return a non-2xx status — do not use BasePage.goto, which requires ok().
   */
  async openGated(target: string): Promise<number> {
    const response = await this.page.goto(target);
    expect(response, `expected a response for ${target}`).not.toBeNull();
    return response!.status();
  }

  get username(): Locator {
    return this.form.username;
  }

  get password(): Locator {
    return this.form.password;
  }

  get loginButton(): Locator {
    return this.form.submitButton;
  }

  get error(): Locator {
    return this.form.error;
  }

  async expectLoaded(): Promise<void> {
    await expect(this.page).toHaveTitle(/Swag Labs/);
    await expect(this.username).toBeVisible();
    await expect(this.password).toBeVisible();
    await expect(this.loginButton).toBeVisible();
    await expect(this.loginButton).toBeEnabled();
  }

  async expectStillOnLogin(): Promise<void> {
    await this.expectLoaded();
    await expect(this.page.getByTestId('inventory-item')).toHaveCount(0);
  }

  async fillWithoutSubmit(username: string, password: string): Promise<void> {
    await this.form.fillWithoutSubmit({ username, password });
  }

  async login(username: string, password: string): Promise<void> {
    await this.fillWithoutSubmit(username, password);
    await this.loginButton.click();
  }

  async submitEmpty(): Promise<void> {
    await this.username.fill('');
    await this.password.fill('');
    await this.loginButton.click();
  }

  async expectUsernameRequiredError(): Promise<void> {
    await expect(this.error).toBeVisible();
    await expect(this.error).toContainText(/Username is required/i);
  }

  async expectSessionRequiredError(path: string): Promise<void> {
    await expect(this.error).toBeVisible();
    await expect(this.error).toContainText(new RegExp(`You can only access '${path}' when you are logged in`, 'i'));
  }
}
