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

test('settings modal suspends the game and Escape closes it without unpausing', async ({
  page,
}) => {
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
  await page.getByRole('button', { name: '关卡', exact: true }).click();
  await page.getByRole('button', { name: '进入关卡' }).first().click();
  await page.getByRole('button', { name: '开始', exact: true }).click();

  // World is running before the modal opens.
  await expect
    .poll(async () => page.evaluate(() => window.listenupSession?.getUiSnapshot().paused ?? null))
    .toBe(false);

  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.locator('.modal')).toHaveCount(1);

  // While the modal is open the world must be suspended...
  await expect
    .poll(async () => page.evaluate(() => window.listenupSession?.getUiSnapshot().paused ?? null))
    .toBe(true);

  // ...and the P hotkey must not un-pause behind it.
  await page.keyboard.press('p');
  await expect(await page.evaluate(() => window.listenupSession?.getUiSnapshot().paused)).toBe(
    true,
  );

  // Escape closes the modal (instead of toggling the game pause).
  await page.keyboard.press('Escape');
  await expect(page.locator('.modal')).toHaveCount(0);
  await expect(await page.evaluate(() => window.listenupSession?.getUiSnapshot().paused)).toBe(
    false,
  );
});

test('OpenAI preset uses Responses and the choice persists', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '连接模型', exact: true }).click();
  await expect(page.getByRole('heading', { name: '连接 Echo 的大脑' })).toBeVisible();

  await page.getByRole('button', { name: /OpenAI/ }).click();
  await page.getByText('自定义接口与高级设置', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Responses', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('#model-name')).toHaveValue('gpt-4o-mini');

  await page.locator('#api-key').fill('sk-test-e2e');
  await page.getByRole('button', { name: '保存', exact: true }).click();

  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('listen-up.settings.v1') ?? '{}'),
  );
  expect(stored.provider.protocol).toBe('responses');
  expect(stored.provider.baseUrl).toBe('https://api.openai.com/v1');

  await page.reload();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible();
  await page.getByText('自定义接口与高级设置', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Responses', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('#model-name')).toHaveValue('gpt-4o-mini');
  await expect(page.locator('#base-url')).toHaveValue('https://api.openai.com/v1');
});
