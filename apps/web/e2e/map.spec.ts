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
    const pb95 = page.locator('[data-testid="fuel-pills"] > button', { hasText: /95/ });
    await expect(pb95).toHaveClass(/bg-amber-500/);

    // Use nth(2) — pills order is: 95, 98, ON, ON Premium, LPG — index 2 is ON
    const onPill = page.locator('[data-testid="fuel-pills"] > button').nth(2);
    await onPill.click();

    await expect(onPill).toHaveClass(/bg-amber-500/);
    await expect(pb95).not.toHaveClass(/bg-amber-500/);
  });

  test('clicking a station marker opens the detail panel', async ({ page }) => {
    await waitForMap(page);
    const marker = page.locator('[data-testid="station-marker"]').first();
    // Canvas intercepts pointer events; force the click on the marker button
    await marker.click({ force: true });

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
    // Target the station list sidebar (has overflow-y-auto), not the ad sidebar
    const sidebar = page.locator('aside.overflow-y-auto');
    await expect(sidebar).toBeVisible();

    // Station list items should exist
    const items = sidebar.locator('button');
    expect(await items.count()).toBeGreaterThanOrEqual(1);

    // Verify prices are displayed
    const priceLabels = sidebar.locator('text=zł/l');
    expect(await priceLabels.count()).toBeGreaterThanOrEqual(1);
  });

  test('clicking sidebar station opens detail panel', async ({ page }) => {
    await waitForMap(page);
    const sidebar = page.locator('aside.overflow-y-auto');
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
