import { by, device, element, expect, waitFor } from 'detox';

describe('Station detail sheet', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
  });

  it('opens station detail when cheapest-in-view is tapped', async () => {
    await waitFor(element(by.text('95')))
      .toBeVisible()
      .withTimeout(15_000);

    // Dismiss fuel picker if shown
    try {
      const picker = element(by.text('Jaki paliwo tankujesz?'));
      await picker.tap();
      await element(by.text('95')).atIndex(0).tap();
    } catch {
      // Not shown
    }

    // Wait for cheapest-in-view button
    await waitFor(element(by.text('Najtańsza w widoku')))
      .toBeVisible()
      .withTimeout(15_000);

    await element(by.text('Najtańsza w widoku')).tap();

    // Station detail sheet should appear with navigate button
    await waitFor(element(by.text('Nawiguj')))
      .toBeVisible()
      .withTimeout(5_000);
  });
});
