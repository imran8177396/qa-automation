import { test, expect } from '@playwright/test';
import { LoginPage } from '../../pages/LoginPage';
import { DashboardPage } from '../../pages/DashboardPage';
import { CheckoutPage } from '../../pages/CheckoutPage';
import { getCredentials } from '../../utils/env';
import users from '../../test-data/users.json';

test('User should complete checkout on Swag Labs', async ({ page }) => {
  const loginPage = new LoginPage(page);
  const dashboard = new DashboardPage(page);
  const checkout = new CheckoutPage(page);
  const { username, password } = getCredentials();

  await loginPage.goto();
  await loginPage.login(username || users.validUser.username, password || users.validUser.password);
  await dashboard.expectLoaded();
  await dashboard.addFirstItemToCart();

  await checkout.openCart();
  await checkout.startCheckout();
  await checkout.fillShippingInfo(
    users.shipping.firstName,
    users.shipping.lastName,
    users.shipping.postalCode
  );
  await checkout.finishOrder();
  await checkout.expectOrderComplete();

  await expect(page).toHaveURL(/checkout-complete\.html/);
  await expect(page.locator('[data-test="complete-header"]')).toHaveText(
    'Thank you for your order!'
  );
});
