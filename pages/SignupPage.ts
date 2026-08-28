import { Page, Locator } from '@playwright/test';

export class SignupPage {
  readonly page: Page;
  readonly firstNameInput: Locator;
  readonly lastNameInput: Locator;
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly submitButton: Locator;
  readonly cancelButton: Locator;
  readonly errorMessage: Locator;

  constructor(page: Page) {
    this.page = page;
    this.firstNameInput = page.getByPlaceholder('First Name');
    this.lastNameInput = page.getByPlaceholder('Last Name');
    this.emailInput = page.getByPlaceholder('Email');
    this.passwordInput = page.getByPlaceholder('Password');
    this.submitButton = page.locator('#submit');
    this.cancelButton = page.locator('#cancel');
    this.errorMessage = page.locator('#error');
  }

  async goto() {
    await this.page.goto('/addUser');
  }

  async signup(
    firstName: string,
    lastName: string,
    email: string,
    password: string,
    options: { expectSuccess?: boolean } = {}
  ) {
    const { expectSuccess = true } = options;

    await this.firstNameInput.fill(firstName);
    await this.lastNameInput.fill(lastName);
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);

    if (expectSuccess) {
      await Promise.all([
        this.page.waitForURL(/contactList/),
        this.submitButton.click(),
      ]);
    } else {
      await this.submitButton.click();
    }
  }
}
