import { by, device, element, expect, waitFor } from 'detox';

describe('First launch fuel picker', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true, delete: true });
  });

  it('shows fuel picker on first launch and dismisses on selection', async () => {
    // Fuel picker modal should appear
    await waitFor(element(by.text('Jaki paliwo tankujesz?')))
      .toBeVisible()
      .withTimeout(15_000);

    // Select ON (diesel)
    await element(by.text('ON')).tap();

    // Picker should dismiss
    await expect(element(by.text('Jaki paliwo tankujesz?'))).not.toBeVisible();

    // Map fuel pills should be visible
    await expect(element(by.text('95'))).toBeVisible();
  });
});
