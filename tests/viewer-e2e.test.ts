import { test, expect } from '@playwright/test';
import path from 'path';

test('viewer should render juminhyo correctly', async ({ page }) => {
    const filePath = path.resolve('juminhyo-verifiable.html');

    // Load the generated HTML file
    await page.goto(`file://${filePath}`);

    // Check for the title
    const title = page.locator('.title');
    await expect(title).toContainText('住民票の写し');

    // Check for a specific member name to verify CBOR decoding worked
    const memberName = page.locator('.name-val').first();
    await expect(memberName).not.toBeEmpty();

    // Check for the "Verified" badge
    const badge = page.locator('.status-badge');
    await expect(badge).toBeVisible();
    await expect(badge).toContainText('検証済みバイナリ');

    // Check if the font is applied (indirectly by checking if the element is visible and has content)
    const body = page.locator('body');
    await expect(body).toHaveCSS('font-family', /TobariSubset/);
});
