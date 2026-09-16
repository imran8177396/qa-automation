import { type Locator, type Page, expect } from '@playwright/test';

export interface ContactFormValues {
  name: string;
  email: string;
  message: string;
}

/**
 * Contact form addressed by its visible labels. Shared by the functional example
 * spec and the visual filled-state screenshot so the locators are defined once.
 *
 * There is deliberately no submit() — `scripts/core/safety-policy.ts` refuses
 * `submit-form` for automated checks, so this component can observe and fill the
 * form but can never post it.
 */
export class ContactForm {
  constructor(private readonly page: Page) {}

  /** No accessible name on the fixture `<form>`, so there is no role-based alternative here. */
  get root(): Locator {
    return this.page.locator('form').first();
  }

  get name(): Locator {
    return this.page.getByLabel('Name');
  }

  get email(): Locator {
    return this.page.getByLabel('Email');
  }

  get message(): Locator {
    return this.page.getByLabel('Message');
  }

  get submitButton(): Locator {
    return this.page.getByRole('button', { name: 'Send message' });
  }

  async fillWithoutSubmit(values: ContactFormValues): Promise<void> {
    await this.name.fill(values.name);
    await this.email.fill(values.email);
    await this.message.fill(values.message);
  }

  async expectFilled(values: ContactFormValues): Promise<void> {
    await expect(this.name).toHaveValue(values.name);
    await expect(this.email).toHaveValue(values.email);
    await expect(this.message).toHaveValue(values.message);
  }
}
