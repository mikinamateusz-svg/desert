import { by, device, element, expect, waitFor } from 'detox';

describe('App launch', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
  });

  it('shows the loading screen then map with fuel pills', async () => {
    // Wordmark should appear
    await expect(element(by.text('litro'))).toBeVisible();

    // Wait for splash to finish and fuel pills to appear
    await waitFor(element(by.text('95')))
      .toBeVisible()
      .withTimeout(15_000);
  });
});
