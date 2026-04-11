import { by, device, element, expect, waitFor } from 'detox';

describe('Fuel type switching', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
  });

  it('can switch between fuel types', async () => {
    await waitFor(element(by.text('95')))
      .toBeVisible()
      .withTimeout(15_000);

    // Dismiss fuel picker if shown
    try {
      await element(by.text('95')).atIndex(0).tap();
    } catch {
      // Picker not shown — continue
    }

    // Tap ON pill
    await element(by.text('ON')).tap();
    await expect(element(by.text('ON'))).toBeVisible();

    // Tap LPG pill
    await element(by.text('LPG')).tap();
    await expect(element(by.text('LPG'))).toBeVisible();
  });
});
