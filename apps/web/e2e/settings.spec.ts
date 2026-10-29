import { expect, test } from '@playwright/test';

test('settings save bar stays visible without scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 700 });
  await page.addInitScript(() => {
    localStorage.setItem(
      'listen-up.settings.v1',
      JSON.stringify({
        provider: {
          baseUrl: 'http://127.0.0.1:5173/v1',
          apiKey: '',
          model: 'mock-model',
          temperature: 0.4,
        },
        inputPausesWorld: false,
        reduceMotion: false,
      }),
    );
  });
  await page.goto('/');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByRole('button', { name: '保存', exact: true })).toBeInViewport();
  await expect(page.getByRole('button', { name: '恢复默认', exact: true })).toBeInViewport();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('.modal')).toHaveCount(0);
});
