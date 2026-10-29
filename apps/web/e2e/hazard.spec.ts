import { expect, test } from '@playwright/test';

function sse(deltas: unknown[]): string {
  return deltas.map((delta) => `data: ${JSON.stringify(delta)}\n\n`).join('') + 'data: [DONE]\n\n';
}

function call(name: string, args: string, id: string): unknown {
  return {
    choices: [
      {
        index: 0,
        delta: {
          tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: args } }],
        },
        finish_reason: null,
      },
    ],
  };
}

test('hazard warning interrupts B and sends it to the safe pad', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  let requests = 0;
  await page.route('**/v1/chat/completions', async (route) => {
    requests += 1;
    let body = '';
    if (requests === 1) {
      body = sse([
        {
          choices: [
            {
              index: 0,
              delta: { role: 'assistant', content: '好，我站到红色机关上。' },
              finish_reason: null,
            },
          ],
        },
        call('move_to', '{"target":"plate_red"}', 'call_move'),
        { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
      ]);
    } else if (requests === 2) {
      body = sse([
        call(
          'wait_until',
          '{"condition":{"kind":"player_on","target":"gate_side"},"timeout_seconds":120}',
          'call_wait',
        ),
        { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
      ]);
    } else if (requests === 3) {
      body = sse([
        {
          choices: [
            {
              index: 0,
              delta: { role: 'assistant', content: '红地板要喷发了，我先跳到安全垫。' },
              finish_reason: null,
            },
          ],
        },
        call('move_to', '{"target":"safe_pad"}', 'call_safe'),
        { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
      ]);
    } else {
      body = sse([
        {
          choices: [
            { index: 0, delta: { role: 'assistant', content: '我安全了。' }, finish_reason: null },
          ],
        },
        { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
      ]);
    }
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
  await page.getByRole('button', { name: '进入关卡' }).nth(2).click();
  await page.getByRole('button', { name: '开始', exact: true }).click();
  const input = page.getByRole('textbox', { name: '告诉 B 要做什么' });
  await input.fill('站到红色机关上，等我穿过闸门。');
  await input.press('Enter');

  await expect
    .poll(async () => page.evaluate(() => window.listenupSession?.getUiSnapshot().speech ?? ''), {
      timeout: 22_000,
    })
    .toContain('我安全了');

  const state = await page.evaluate(() => {
    const session = window.listenupSession;
    if (!session) return undefined;
    const view = session.world.getRenderState();
    return {
      b: view.b.pos,
      gate: view.gates.find((gate) => gate.id === 'gate_1')?.open,
      trace: session.getUiSnapshot().trace.map((entry) => `${entry.title}:${entry.text}`),
      requests: 0,
    };
  });
  expect(state?.b.x).toBeGreaterThan(13.5);
  expect(state?.b.z).toBeGreaterThan(6);
  expect(state?.gate).toBe(false);
  expect(state?.trace.some((entry) => entry.includes('危险预警'))).toBe(true);
  expect(requests).toBeGreaterThanOrEqual(3);
  expect(errors).toEqual([]);
});
