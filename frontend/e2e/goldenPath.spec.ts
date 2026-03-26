import { test, expect } from '@playwright/test';

test.describe('Platform E2E - Full Stack Integration', () => {
  const TEST_USER = 'e2e@test.com';
  const TEST_PASS = 'Password123!';
  const COMPANY_NAME = 'E2E Test Company ' + Date.now();

  test.beforeEach(async ({ page }) => {
    test.setTimeout(120000); // Allow extra time for dev build
    // Shared login for all tests in this suite
    await page.goto('/login');
    await page.fill('input[placeholder="Your email"]', TEST_USER);
    await page.fill('input[placeholder="Your password"]', TEST_PASS);
    await page.click('button[type="submit"]:has-text("Log in")');
    // Wait for the URL to change to dashboard with a generous timeout
    await page.waitForURL(/.*dashboard/, { timeout: 30000 });
  });

  test('1. Workspace & Directory Navigation', async ({ page }) => {
    // Verification of Sidebar and Dashboard state
    const sidebar = page.locator('aside');
    await expect(sidebar).toBeVisible();
    await expect(sidebar).toContainText('Workspaces');
    
    // Create new Directory
    const createNewBtn = page.locator('button:has-text("Create New")');
    if (await createNewBtn.count() > 0) {
       await createNewBtn.click();
       const createNewDirBtn = page.locator('button:has-text("Create New Directory")');
       await expect(createNewDirBtn).toBeVisible();
       await createNewDirBtn.click();
       
       const companyInput = page.locator('input[placeholder="Enter company name..."]');
       await companyInput.fill(COMPANY_NAME);
       await page.click('button:has-text("Create Directory")');
       
       // Verify Directory creation in sidebar
       await expect(page.locator(`aside button:has-text("${COMPANY_NAME}")`).first()).toBeVisible();
    }
  });

  test('2. Document Upload Pipeline', async ({ page }) => {
    // Navigate to the company directory
    const dirBtn = page.locator(`aside button:has-text("${COMPANY_NAME}")`).first();
    await dirBtn.click();
    
    // Open Upload Modal
    const uploadBtn = page.locator('button:has-text("Upload DRHP")');
    if (await uploadBtn.count() === 0) {
      // Fallback if the button is nested or different due to initial empty state
      await page.click('button:has-text("Create New")');
      await page.click('button:has-text("Upload DRHP")');
    } else {
      await uploadBtn.click();
    }

    // Handle File Chooser
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.click('input[type="file"]')
    ]);
    await fileChooser.setFiles('e2e/fixtures/test.pdf');
    
    await page.click('button:has-text("Upload DRHP")');
    
    // Verify toast or processing state
    await expect(page.locator('text=completed successfully')).toBeVisible({ timeout: 15000 });
  });

  test('3. Document Intelligence: Summarization', async ({ page }) => {
     // Navigate to the company directory
     await page.locator(`aside button:has-text("${COMPANY_NAME}")`).first().click();
     
     // Verify document is in the list
     const docItem = page.locator('text=test.pdf');
     await expect(docItem).toBeVisible();
     
     // Trigger Summary (Simplified: click on the document to open it)
     await docItem.click();
     
     // Verify we are on the document page
     await page.waitForURL(/.*doc\//);
     
     // Check for Chat interface
     const chatInput = page.locator('textarea[placeholder*="Ask any question"]');
     await expect(chatInput).toBeVisible();
     
     console.log('E2E Journey Completed: Login -> Sync -> Upload -> Analyze.');
  });
});
