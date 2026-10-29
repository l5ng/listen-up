import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAiResponsesClient } from './responses';
import type { ChatMessage, LlmDelta, LlmRequest, ToolCall } from './types';

afterEach(() => {
  vi.unstubAllGlobals();
});

function sse(events: unknown[]): Response {
  const body = events
    .map((event) => {
      const type = (event as { type?: string }).type ?? 'message';
      return `event: ${type}\ndata: ${JSON.stringify(event)}\n\n`;
    })
    .join('');
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

function completed(
  output: unknown[],
  usage = { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
): Record<string, unknown> {
  return { type: 'response.completed', response: { status: 'completed', output, usage } };
}

function makeClient(model = 'gpt-4o-mini'): OpenAiResponsesClient {
  return new OpenAiResponsesClient({
    baseUrl: 'https://example.test/v1',
    apiKey: 'test-key',
    model,
  });
}

async function collect(client: OpenAiResponsesClient, request: LlmRequest): Promise<LlmDelta[]> {
  const deltas: LlmDelta[] = [];
  for await (const delta of client.stream(request, new AbortController().signal)) {
    deltas.push(delta);
  }
  return deltas;
}

function makeRequest(messages: ChatMessage[], model = 'gpt-4o-mini'): LlmRequest {
  return {
    model,
    messages,
    tools: [
      {
        name: 'move_to',
        description: 'walk',
        parameters: { type: 'object', properties: { target: { type: 'string' } } },
      },
    ],
    temperature: 0.4,
  };
}

function stubFetch(
  handler: (url: string, body: Record<string, unknown>, call: number) => Response,
): { url: string; body: Record<string, unknown> }[] {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal(
    'fetch',
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      calls.push({ url: String(input), body });
      return handler(String(input), body, calls.length - 1);
    },
  );
  return calls;
}

describe('OpenAiResponsesClient', () => {
  it('serializes instructions, input, flat tools, and privacy flags', async () => {
    const calls = stubFetch(() => sse([completed([])]));
    const client = makeClient();
    await collect(
      client,
      makeRequest([
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hi' },
      ]),
    );

    expect(calls[0]?.url).toBe('https://example.test/v1/responses');
    expect(calls[0]?.body).toMatchObject({
      model: 'gpt-4o-mini',
      instructions: 'sys',
      input: [{ role: 'user', content: 'hi' }],
      tools: [
        {
          type: 'function',
          name: 'move_to',
          description: 'walk',
          parameters: { type: 'object', properties: { target: { type: 'string' } } },
          strict: false,
        },
      ],
      tool_choice: 'auto',
      stream: true,
      store: false,
      include: ['reasoning.encrypted_content'],
      temperature: 0.4,
    });
  });

  it('replays current-turn response items and trims older tool calls', async () => {
    const calls = stubFetch(() => sse([completed([])]));
    const oldCall: ToolCall = {
      id: 'call_old',
      type: 'function',
      function: { name: 'move_to', arguments: '{"target":"old"}' },
    };
    const newCall: ToolCall = {
      id: 'call_new',
      type: 'function',
      function: { name: 'move_to', arguments: '{"target":"new"}' },
    };
    const messages: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'turn 1' },
      {
        role: 'assistant',
        content: 'old words',
        tool_calls: [oldCall],
        providerItems: [
          { type: 'reasoning', id: 'rs_old', summary: [], encrypted_content: 'enc_old' },
          { role: 'assistant', content: 'old words' },
          {
            type: 'function_call',
            call_id: 'call_old',
            name: 'move_to',
            arguments: '{"target":"old"}',
          },
        ],
      },
      { role: 'tool', tool_call_id: 'call_old', content: 'old result' },
      { role: 'assistant', content: 'old summary' },
      { role: 'user', content: 'turn 2' },
      {
        role: 'assistant',
        content: 'new words',
        tool_calls: [newCall],
        providerItems: [
          { type: 'reasoning', id: 'rs_new', summary: [], encrypted_content: 'enc_new' },
          { role: 'assistant', content: 'new words' },
          {
            type: 'function_call',
            call_id: 'call_new',
            name: 'move_to',
            arguments: '{"target":"new"}',
          },
        ],
      },
      { role: 'tool', tool_call_id: 'call_new', content: 'new result' },
    ];

    await collect(makeClient(), makeRequest(messages));
    expect(calls[0]?.body.input).toEqual([
      { role: 'user', content: 'turn 1' },
      { role: 'assistant', content: 'old words\nold summary' },
      { role: 'user', content: 'turn 2' },
      { type: 'reasoning', id: 'rs_new', summary: [], encrypted_content: 'enc_new' },
      { role: 'assistant', content: 'new words' },
      {
        type: 'function_call',
        call_id: 'call_new',
        name: 'move_to',
        arguments: '{"target":"new"}',
      },
      { type: 'function_call_output', call_id: 'call_new', output: 'new result' },
    ]);
  });

  it('rebuilds function calls when provider items do not match the tool calls', async () => {
    const calls = stubFetch(() => sse([completed([])]));
    const call: ToolCall = {
      id: 'call_real',
      type: 'function',
      function: { name: 'move_to', arguments: '{"target":"exit"}' },
    };
    const messages: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'go' },
      {
        role: 'assistant',
        content: 'on it',
        tool_calls: [call],
        providerItems: [
          { type: 'reasoning', id: 'rs_stale', summary: [] },
          { type: 'function_call', call_id: 'call_stale', name: 'move_to', arguments: '{}' },
        ],
      },
      { role: 'tool', tool_call_id: 'call_real', content: 'ok' },
    ];

    await collect(makeClient(), makeRequest(messages));
    expect(calls[0]?.body.input).toEqual([
      { role: 'user', content: 'go' },
      { role: 'assistant', content: 'on it' },
      {
        type: 'function_call',
        call_id: 'call_real',
        name: 'move_to',
        arguments: '{"target":"exit"}',
      },
      { type: 'function_call_output', call_id: 'call_real', output: 'ok' },
    ]);
  });

  it('streams text and emits one completed tool call with provider items', async () => {
    const output: Record<string, unknown>[] = [
      {
        type: 'reasoning',
        id: 'rs_1',
        summary: [{ type: 'summary_text', text: 'think' }],
        encrypted_content: 'enc',
      },
      {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: '好的' }],
      },
      {
        type: 'function_call',
        id: 'fc_1',
        call_id: 'call_1',
        name: 'move_to',
        arguments: '{"target":"exit"}',
        status: 'completed',
      },
    ];
    stubFetch(() =>
      sse([
        { type: 'response.output_text.delta', output_index: 1, delta: '好' },
        { type: 'response.output_text.delta', output_index: 1, delta: '的' },
        { type: 'response.output_item.done', output_index: 1, item: output[1] },
        {
          type: 'response.output_item.added',
          output_index: 2,
          item: { ...output[2], arguments: '' },
        },
        {
          type: 'response.function_call_arguments.delta',
          output_index: 2,
          delta: '{"target":"exit"}',
        },
        {
          type: 'response.function_call_arguments.done',
          output_index: 2,
          arguments: '{"target":"exit"}',
        },
        { type: 'response.output_item.done', output_index: 2, item: output[2] },
        {
          type: 'response.completed',
          response: {
            status: 'completed',
            output,
            usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
          },
        },
      ]),
    );

    const deltas = await collect(makeClient(), makeRequest([{ role: 'user', content: 'go' }]));
    const content = deltas
      .filter((delta): delta is Extract<LlmDelta, { type: 'content' }> => delta.type === 'content')
      .map((delta) => delta.text);
    expect(content).toEqual(['好', '的']);

    const toolCalls = deltas.filter(
      (delta): delta is Extract<LlmDelta, { type: 'tool_call' }> => delta.type === 'tool_call',
    );
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]).toMatchObject({
      id: 'call_1',
      name: 'move_to',
      argumentsDelta: '{"target":"exit"}',
    });

    const provider = deltas.find(
      (delta): delta is Extract<LlmDelta, { type: 'provider_items' }> =>
        delta.type === 'provider_items',
    );
    expect(provider?.items).toEqual([
      {
        type: 'reasoning',
        id: 'rs_1',
        summary: [{ type: 'summary_text', text: 'think' }],
        encrypted_content: 'enc',
      },
      { role: 'assistant', content: '好的' },
      { type: 'function_call', call_id: 'call_1', name: 'move_to', arguments: '{"target":"exit"}' },
    ]);

    const usage = deltas.find(
      (delta): delta is Extract<LlmDelta, { type: 'usage' }> => delta.type === 'usage',
    );
    expect(usage?.usage).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 });
  });

  it('parses a non-streaming Responses payload', async () => {
    stubFetch(
      () =>
        new Response(
          JSON.stringify({
            status: 'completed',
            output: [
              {
                type: 'message',
                role: 'assistant',
                content: [{ type: 'output_text', text: '好' }],
              },
              { type: 'function_call', call_id: 'call_1', name: 'move_to', arguments: '{}' },
            ],
            usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );

    const deltas = await collect(makeClient(), makeRequest([{ role: 'user', content: 'go' }]));
    expect(deltas.some((delta) => delta.type === 'content' && delta.text === '好')).toBe(true);
    expect(
      deltas.some(
        (delta) => delta.type === 'tool_call' && delta.id === 'call_1' && delta.name === 'move_to',
      ),
    ).toBe(true);
    expect(
      deltas.some((delta) => delta.type === 'provider_items' && delta.items.length === 2),
    ).toBe(true);
    expect(deltas.some((delta) => delta.type === 'usage' && delta.usage.totalTokens === 3)).toBe(
      true,
    );
  });

  it('maps HTTP errors to LlmError', async () => {
    stubFetch(
      () =>
        new Response(JSON.stringify({ error: { message: 'bad key' } }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
    );
    await expect(
      collect(makeClient(), makeRequest([{ role: 'user', content: 'go' }])),
    ).rejects.toMatchObject({ code: 'auth', message: 'bad key', status: 401 });

    vi.unstubAllGlobals();
    stubFetch(
      () =>
        new Response(JSON.stringify({ error: { message: 'down' } }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        }),
    );
    await expect(
      collect(makeClient(), makeRequest([{ role: 'user', content: 'go' }])),
    ).rejects.toMatchObject({ code: 'server', retryable: true });
  });

  it('maps response.failed and error events', async () => {
    stubFetch(() =>
      sse([
        {
          type: 'response.failed',
          response: { status: 'failed', error: { code: 'server_error', message: 'boom' } },
        },
      ]),
    );
    await expect(
      collect(makeClient(), makeRequest([{ role: 'user', content: 'go' }])),
    ).rejects.toMatchObject({ code: 'server', message: 'boom' });

    vi.unstubAllGlobals();
    stubFetch(() => sse([{ type: 'error', code: 'rate_limit_exceeded', message: 'slow down' }]));
    await expect(
      collect(makeClient(), makeRequest([{ role: 'user', content: 'go' }])),
    ).rejects.toMatchObject({ code: 'rate-limit', message: 'slow down' });
  });

  it('fails when the stream closes before a terminal event', async () => {
    stubFetch(() =>
      sse([{ type: 'response.output_text.delta', output_index: 0, delta: 'partial' }]),
    );
    await expect(
      collect(makeClient(), makeRequest([{ role: 'user', content: 'go' }])),
    ).rejects.toMatchObject({ code: 'stream', retryable: true });
  });

  it('drops tool calls from an incomplete response', async () => {
    stubFetch(() =>
      sse([
        {
          type: 'response.completed',
          response: {
            status: 'incomplete',
            incomplete_details: { reason: 'max_output_tokens' },
            output: [
              { type: 'function_call', call_id: 'call_1', name: 'move_to', arguments: '{}' },
            ],
          },
        },
      ]),
    );
    const deltas = await collect(makeClient(), makeRequest([{ role: 'user', content: 'go' }]));
    expect(deltas.some((delta) => delta.type === 'tool_call')).toBe(false);
    expect(deltas.some((delta) => delta.type === 'provider_items')).toBe(false);
    expect(deltas.some((delta) => delta.type === 'finish' && delta.reason === 'length')).toBe(true);
  });

  it('retries once without temperature when the model rejects it', async () => {
    const bodies: Record<string, unknown>[] = [];
    let call = 0;
    vi.stubGlobal(
      'fetch',
      async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        bodies.push(body);
        call += 1;
        if (call === 1) {
          return new Response(
            JSON.stringify({
              error: { message: "Unsupported parameter: 'temperature' is not supported." },
            }),
            { status: 400, headers: { 'content-type': 'application/json' } },
          );
        }
        return sse([completed([])]);
      },
    );

    const client = makeClient('gpt-4.1');
    await collect(client, makeRequest([{ role: 'user', content: 'go' }], 'gpt-4.1'));
    expect(bodies).toHaveLength(2);
    expect(bodies[0]?.temperature).toBe(0.4);
    expect(bodies[1]).not.toHaveProperty('temperature');

    await collect(client, makeRequest([{ role: 'user', content: 'again' }], 'gpt-4.1'));
    expect(bodies[2]).not.toHaveProperty('temperature');
  });

  it('does not retry a 400 that is not about temperature', async () => {
    let call = 0;
    vi.stubGlobal('fetch', async (): Promise<Response> => {
      call += 1;
      return new Response(JSON.stringify({ error: { message: 'bad input' } }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    });
    await expect(
      collect(makeClient('gpt-4.1'), makeRequest([{ role: 'user', content: 'go' }], 'gpt-4.1')),
    ).rejects.toMatchObject({ code: 'http', message: 'bad input', status: 400 });
    expect(call).toBe(1);
  });
});
