import { test, expect } from '@playwright/test';

// Thin end-to-end smoke: log in as the seeded admin and confirm the item
// register renders. The bulk of behaviour is covered by the Vitest suite.
test('admin can log in and see the item register', async ({ page }) => {
  await page.goto('/login');

  await page.getByLabel(/email/i).fill('alice@larder.test');
  await page.getByLabel(/password/i).fill('password123');
  await page.getByRole('button', { name: /sign in|log in/i }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText('Compound Microscope')).toBeVisible();
});
