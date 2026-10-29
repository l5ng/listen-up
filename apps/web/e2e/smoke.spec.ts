import { expect, test } from '@playwright/test';

function sse(deltas: unknown[]): string {
  return deltas.map((delta) => `data: ${JSON.stringify(delta)}\n\n`).join('') + 'data: [DONE]\n\n';
}

test('Echo executes a mocked tool call and pushes the crate', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  let requests = 0;
  await page.route('**/v1/chat/completions', async (route) => {
    requests += 1;
    const body =
      requests === 1
        ? sse([
            {
              choices: [
                {
                  index: 0,
                  delta: { role: 'assistant', content: '好，我把木箱推下去。' },
                  finish_reason: null,
                },
              ],
            },
            {
              choices: [
                {
                  index: 0,
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: 'call_push',
                        type: 'function',
                        function: {
                          name: 'push_box',
                          arguments: '{"box":"crate_1","to":"yard_a"}',
                        },
                      },
                    ],
                  },
                  finish_reason: null,
                },
              ],
            },
            { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
          ])
        : sse([
            {
              choices: [
                {
                  index: 0,
                  delta: { role: 'assistant', content: '推下去了。你踩上去试试。' },
                  finish_reason: null,
                },
              ],
            },
            { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
          ]);
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/event-stream; charset=utf-8' },
      body,
    });
  });

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
  await page.getByRole('button', { name: '关卡' }).click();
  await page.getByRole('button', { name: '进入关卡' }).first().click();
  await expect(page.getByRole('button', { name: '开始', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '开始', exact: true }).click();
  await page.getByRole('button', { name: '帮助与键位' }).click();
  await expect(page.getByRole('heading', { name: '帮助与键位' })).toBeVisible();
  await expect(page.getByText('W A S D')).toBeVisible();
  await page.getByRole('button', { name: '知道了' }).click();
  const input = page.getByRole('textbox', { name: '告诉 Echo 要做什么' });
  await input.fill('把木箱推下来给我垫脚');
  await input.press('Enter');

  await expect
    .poll(async () => page.evaluate(() => window.listenupSession?.getUiSnapshot().speech ?? ''), {
      timeout: 20_000,
    })
    .toContain('推下去了');

  const state = await page.evaluate(() => {
    const session = window.listenupSession;
    return {
      crate: session?.world.getRenderState().crates[0],
      requests: 'ok',
    };
  });
  expect(state.crate?.pos.y).toBe(0);
  expect(state.crate?.pos.z).toBeCloseTo(6.6, 1);
  expect(requests).toBe(2);

  await page.keyboard.press('Tab');
  const drawer = page.locator('.trace-drawer');
  await expect(drawer).toHaveClass(/open/);
  await expect(drawer).toContainText('推箱');
  expect(errors).toEqual([]);
});
