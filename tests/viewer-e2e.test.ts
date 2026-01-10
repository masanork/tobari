import { test, expect } from '@playwright/test';
import path from 'path';

test('viewer should render juminhyo correctly', async ({ page }) => {
    const filePath = path.resolve('examples/juminhyo/juminhyo.html');
    await page.goto(`file://${filePath}`);

    // Handle "Secure Access Required" screen for file:// protocol
    const stayHereButton = page.getByRole('button', { name: 'Stay here' });
    if (await stayHereButton.isVisible()) {
        await stayHereButton.click();
    }

    // Handle "Encrypted Document" screen
    const unlockBtn = page.locator('#unlock-btn');
    if (await unlockBtn.isVisible()) {
        await unlockBtn.click();
    }

    // The auto-renderer uses <h1> for the title
    const title = page.locator('h1');
    await expect(title).toContainText('住民票の写し');

    // Check for a specific member name (auto-renderer doesn't use name-cell now)
    // It uses standard card rendering. Let's look for part of the sample data.
    await expect(page.locator('body')).toContainText('䶒藤󠄃');

    // Check if the font is applied to the document container
    const docContainer = page.locator('.official-doc');
    await expect(docContainer).toHaveCSS('font-family', /TobariSubset/);
});
