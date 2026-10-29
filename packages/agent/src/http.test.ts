import { describe, expect, it } from 'vitest';
import { endpoint, readSseData } from './http';

describe('endpoint', () => {
  it('normalizes base URLs and full endpoints', () => {
    expect(endpoint('https://api.openai.com/v1', '/responses')).toBe(
      'https://api.openai.com/v1/responses',
    );
    expect(endpoint('https://api.openai.com/v1/', '/responses')).toBe(
      'https://api.openai.com/v1/responses',
    );
    expect(endpoint('https://api.openai.com', '/responses')).toBe(
      'https://api.openai.com/v1/responses',
    );
    expect(endpoint('https://api.openai.com/v1/responses', '/responses')).toBe(
      'https://api.openai.com/v1/responses',
    );
    expect(endpoint('https://api.openai.com/v1/responses', '/models')).toBe(
      'https://api.openai.com/v1/models',
    );
    expect(endpoint('https://api.deepseek.com/v1/chat/completions', '/chat/completions')).toBe(
      'https://api.deepseek.com/v1/chat/completions',
    );
    expect(endpoint('https://api.deepseek.com/v1/chat/completions', '/models')).toBe(
      'https://api.deepseek.com/v1/models',
    );
  });
});

describe('readSseData', () => {
  it('buffers chunks, ignores keepalives and [DONE], and reads a final line', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(': keepalive\n\ndata: {"a":1}\n\n'));
        controller.enqueue(encoder.encode('data: {"b":'));
        controller.enqueue(encoder.encode('2}\n\ndata: [DONE]\n\n'));
        controller.enqueue(encoder.encode('data: {"c":3}'));
        controller.close();
      },
    });
    const response = new Response(stream, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
    const events: Record<string, unknown>[] = [];
    for await (const event of readSseData(response)) events.push(event);
    expect(events).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
  });
});
