import { expect, test } from '@playwright/test';

function sse(events: unknown[]): string {
  return events
    .map((event) => {
      const type = (event as { type?: string }).type ?? 'message';
      return `event: ${type}\ndata: ${JSON.stringify(event)}\n\n`;
    })
    .join('');
}

const completed = (
  output: unknown[],
  usage = { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
) => ({
  type: 'response.completed',
  response: { status: 'completed', output, usage },
});

test('Echo uses the Responses API for a tool loop', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  const bodies: Record<string, unknown>[] = [];
  await page.route('**/v1/responses', async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    bodies.push(body);
    const first = bodies.length === 1;
    const output = first
      ? [
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: '好，我把木箱推下去。' }],
          },
          {
            type: 'function_call',
            call_id: 'call_push',
            name: 'push_box',
            arguments: '{"box":"crate_1","direction":"北"}',
            status: 'completed',
          },
        ]
      : [
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: '推下去了。你踩上去试试。' }],
          },
        ];
    const events = first
      ? [
          { type: 'response.created', response: { status: 'in_progress', output: [] } },
          {
            type: 'response.output_text.delta',
            output_index: 0,
            delta: '好，我把木箱推下去。',
          },
          { type: 'response.output_item.done', output_index: 0, item: output[0] },
          { type: 'response.output_item.done', output_index: 1, item: output[1] },
          completed(output),
        ]
      : [
          {
            type: 'response.output_text.delta',
            output_index: 0,
            delta: '推下去了。你踩上去试试。',
          },
          completed(output),
        ];
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/event-stream; charset=utf-8' },
      body: sse(events),
    });
  });

  await page.addInitScript(() => {
    localStorage.setItem(
      'listen-up.settings.v1',
      JSON.stringify({
        provider: {
          baseUrl: 'http://127.0.0.1:5173/v1',
          apiKey: '',
          model: 'mock-responses',
          temperature: 0.4,
          protocol: 'responses',
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
    return session?.world.getRenderState().crates[0];
  });
  expect(state?.pos.y).toBe(0);
  expect(state?.pos.z).toBeGreaterThan(0);
  expect(state?.pos.z).toBeLessThan(7.5);
  expect(bodies).toHaveLength(2);
  expect(bodies[0]?.instructions).toContain('你是 Echo');
  expect(bodies[0]?.store).toBe(false);
  const secondInput = bodies[1]?.input as { type?: string; call_id?: string }[] | undefined;
  expect(
    secondInput?.some(
      (item) => item.type === 'function_call_output' && item.call_id === 'call_push',
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
