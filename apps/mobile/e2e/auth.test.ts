import { by, device, element, expect, waitFor } from 'detox';

describe('Authentication', () => {
  beforeEach(async () => {
    await device.launchApp({ newInstance: true, delete: true });
  });

  it('can navigate to login screen', async () => {
    await waitFor(element(by.text('Zaloguj się')))
      .toBeVisible()
      .withTimeout(15_000);

    await element(by.text('Zaloguj się')).tap();

    // Login form should be visible
    await expect(element(by.text('E-mail'))).toBeVisible();
    await expect(element(by.text('Hasło'))).toBeVisible();
  });

  it('shows error for wrong credentials', async () => {
    await waitFor(element(by.text('Zaloguj się')))
      .toBeVisible()
      .withTimeout(15_000);

    await element(by.text('Zaloguj się')).tap();

    // Fill in wrong credentials
    await element(by.text('E-mail')).typeText('wrong@example.com');
    await element(by.text('Hasło')).typeText('wrongpassword');

    // Submit
    await element(by.text('Zaloguj się')).atIndex(0).tap();

    // Should show error
    await waitFor(
      element(by.text('Nieprawidłowy adres e-mail lub hasło'))
        .or(element(by.text('Coś poszło nie tak. Spróbuj ponownie.')))
    )
      .toBeVisible()
      .withTimeout(10_000);
  });

  it('can navigate to register screen', async () => {
    await waitFor(element(by.text('Zaloguj się')))
      .toBeVisible()
      .withTimeout(15_000);

    await element(by.text('Zaloguj się')).tap();

    // Navigate to register
    await element(by.text('Nie masz konta? Utwórz je')).tap();

    // Register form should be visible
    await expect(element(by.text('Utwórz konto'))).toBeVisible();
    await expect(element(by.text('Nazwa wyświetlana'))).toBeVisible();
  });

  it('shows validation error when terms not accepted', async () => {
    await waitFor(element(by.text('Zaloguj się')))
      .toBeVisible()
      .withTimeout(15_000);

    await element(by.text('Zaloguj się')).tap();
    await element(by.text('Nie masz konta? Utwórz je')).tap();

    // Fill in fields
    await element(by.text('Nazwa wyświetlana')).typeText('Test User');
    await element(by.text('E-mail')).typeText('test@litro.app');
    await element(by.text('Hasło')).typeText('SecurePass456!');

    // Submit without accepting terms
    await element(by.text('Utwórz konto')).atIndex(0).tap();

    // Should show terms validation error
    await waitFor(element(by.text('Wymagane zgody nie zostały zaznaczone')))
      .toBeVisible()
      .withTimeout(5_000);
  });
});
