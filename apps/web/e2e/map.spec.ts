import { test, expect } from '@playwright/test';

// Wait for the Mapbox canvas to render and station markers to appear
async function waitForMap(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.waitForSelector('canvas', { timeout: 15_000 });
  // Station markers are rendered as DOM buttons by react-map-gl's <Marker>
  await page.waitForSelector('[data-testid="station-marker"]', { timeout: 15_000 });
}

test.describe('Map page', () => {
  test('map loads with station pins visible', async ({ page }) => {
    await waitForMap(page);
    const markers = page.locator('[data-testid="station-marker"]');
    await expect(markers.first()).toBeVisible();
    expect(await markers.count()).toBeGreaterThanOrEqual(1);
  });

  test('fuel type switching updates active pill', async ({ page }) => {
    await waitForMap(page);
    // Default fuel is PB_95 — first pill should be active (amber bg)
    const pb95 = page.locator('button', { hasText: /95/ }).first();
    await expect(pb95).toHaveClass(/bg-amber-500/);

    // Click ON pill
    const onPill = page.locator('button', { hasText: /^ON$/ }).first();
    await onPill.click();

    // ON should now be active, PB_95 inactive
    await expect(onPill).toHaveClass(/bg-amber-500/);
    await expect(pb95).not.toHaveClass(/bg-amber-500/);
  });

  test('clicking a station marker opens the detail panel', async ({ page }) => {
    await waitForMap(page);
    const marker = page.locator('[data-testid="station-marker"]').first();
    await marker.click();

    // Detail panel should appear with station name, prices, and navigate button
    const panel = page.locator('[data-testid="station-detail-panel"]');
    await expect(panel).toBeVisible({ timeout: 5_000 });
    await expect(panel.locator('text=zł/l').first()).toBeVisible();
    await expect(panel.locator('text=/Nawiguj|Navigate/')).toBeVisible();

    // Close the panel
    const closeBtn = panel.locator('button[aria-label]').first();
    await closeBtn.click();
    await expect(panel).not.toBeVisible();
  });
});

test.describe('Desktop sidebar', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('sidebar shows stations sorted by price', async ({ page }) => {
    await waitForMap(page);
    const sidebar = page.locator('aside');
    await expect(sidebar).toBeVisible();

    // Station list items should exist
    const items = sidebar.locator('button');
    expect(await items.count()).toBeGreaterThanOrEqual(1);

    // Prices should be in ascending order
    const priceTexts = await sidebar.locator('p.font-semibold.text-gray-900').allInnerTexts();
    const prices = priceTexts.map(t => parseFloat(t.replace('~', '').split('–')[0]));
    for (let i = 1; i < prices.length; i++) {
      expect(prices[i]).toBeGreaterThanOrEqual(prices[i - 1]);
    }
  });

  test('clicking sidebar station opens detail panel', async ({ page }) => {
    await waitForMap(page);
    const sidebar = page.locator('aside');
    const firstStation = sidebar.locator('button').first();
    await firstStation.click();

    const panel = page.locator('[data-testid="station-detail-panel"]');
    await expect(panel).toBeVisible({ timeout: 5_000 });
  });
});

test.describe('Mobile cheapest button', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('cheapest-in-view button selects a station', async ({ page }) => {
    await waitForMap(page);

    // The cheapest button should be visible on mobile
    const cheapestBtn = page.locator('button', { hasText: '🏆' });
    await expect(cheapestBtn).toBeVisible();
    await cheapestBtn.click();

    // Should open a station detail panel
    const panel = page.locator('[data-testid="station-detail-panel"]');
    await expect(panel).toBeVisible({ timeout: 5_000 });
  });
});
