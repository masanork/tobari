import { test, expect } from '@playwright/test';
import path from 'path';

test('viewer should render juminhyo correctly', async ({ page }) => {
    // Path to the generated juminhyo-verifiable.html
    const filePath = path.resolve('examples/juminhyo/juminhyo-verifiable.html');
    await page.goto(`file://${filePath}`);

    // Check for the title
    const title = page.locator('.title');
    await expect(title).toContainText('住民票の写し');

    // Check for a specific member name to verify CBOR decoding worked
    const memberName = page.locator('.name-val').first();
    await expect(memberName).not.toBeEmpty();

    // The badge has been removed for a more subtle design.
    // Let's check for the meta-info in the footer instead.
    const metaInfo = page.locator('.meta-info');
    await expect(metaInfo).toBeVisible();
    await expect(metaInfo).toContainText('Sig: ES384');

    // Check if the font is applied
    const body = page.locator('body');
    await expect(body).toHaveCSS('font-family', /TobariSubset/);
});
