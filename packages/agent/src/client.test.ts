import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAiCompatibleClient } from './client';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OpenAiCompatibleClient', () => {
  it('serializes tools using the OpenAI function wrapper', async () => {
    let requestBody: Record<string, unknown> | undefined;
    vi.stubGlobal('fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      );
    });

    const client = new OpenAiCompatibleClient({
      baseUrl: 'https://example.test/v1',
      apiKey: 'test-key',
      model: 'test-model',
    });
    const tools = [
      {
        name: 'move_to',
        description: 'walk',
        parameters: { type: 'object', properties: { target: { type: 'string' } } },
      },
    ];
    for await (const delta of client.stream(
      {
        model: 'test-model',
        messages: [
          { role: 'user', content: 'hi', providerItems: [{ type: 'reasoning', id: 'rs_1' }] },
        ],
        tools,
        temperature: 0.4,
      },
      new AbortController().signal,
    )) {
      if (delta.type === 'finish') break;
    }

    expect(requestBody?.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'move_to',
          description: 'walk',
          parameters: { type: 'object', properties: { target: { type: 'string' } } },
        },
      },
    ]);
    expect(requestBody?.tool_choice).toBe('auto');
    expect(requestBody?.messages).toEqual([{ role: 'user', content: 'hi' }]);
    expect(requestBody?.stream_options).toEqual({ include_usage: true });
  });

  it('reports a parse error when a non-streaming fallback returns invalid JSON', async () => {
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response('<html>gateway error</html>', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );

    const client = new OpenAiCompatibleClient({
      baseUrl: 'https://example.test/v1',
      apiKey: 'test-key',
      model: 'test-model',
    });
    const collected: unknown[] = [];
    await expect(
      (async () => {
        for await (const delta of client.stream(
          {
            model: 'test-model',
            messages: [{ role: 'user', content: 'hi' }],
            tools: [],
            temperature: 0.4,
          },
          new AbortController().signal,
        )) {
          collected.push(delta);
        }
      })(),
    ).rejects.toMatchObject({ code: 'parse' });
    expect(collected).toEqual([]);
  });
});
