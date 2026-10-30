import { expect, test } from '@playwright/test';

test('first run shows the demo before asking for a key', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Listen Up' })).toBeVisible();
  await expect(page.getByText('你说一句，Echo 去做。')).toBeVisible();

  await page.getByRole('button', { name: /试一句/ }).click();
  await expect(page.getByRole('heading', { name: /把木箱推下来/ })).toBeVisible();

  await page.getByRole('button', { name: '把木箱推下来', exact: true }).click();
  await expect(page.getByText('刚才的 Echo 是排练好的。')).toBeVisible({ timeout: 20_000 });

  await page.getByRole('button', { name: '连接模型，继续' }).click();
  await expect(page.getByRole('heading', { name: '连接 Echo 的大脑' })).toBeVisible();
  await expect(page.locator('#model-name')).toHaveValue('deepseek-flash');

  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText('云端服务需要 API key；本地 Ollama 可以留空。')).toBeVisible();
});
