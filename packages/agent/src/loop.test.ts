import { describe, expect, it } from 'vitest';
import { runAgentTurn } from './loop';
import type { ChatMessage, LlmClient, LlmDelta, LlmRequest, ToolExecution } from './types';

class FakeClient implements LlmClient {
  readonly requests: LlmRequest[] = [];
  private readonly scripts: LlmDelta[][];

  constructor(scripts: LlmDelta[][]) {
    this.scripts = scripts;
  }

  async *stream(request: LlmRequest, signal: AbortSignal): AsyncIterable<LlmDelta> {
    this.requests.push(request);
    const script = this.scripts.shift() ?? [];
    for (const delta of script) {
      if (signal.aborted) throw new DOMException('aborted', 'AbortError');
      yield delta;
    }
  }
}

function toolCall(name: string, args: string, id = 'call_1', index = 0): LlmDelta {
  return { type: 'tool_call', index, id, name, argumentsDelta: args };
}

describe('runAgentTurn', () => {
  it('executes a tool call and continues for a final answer', async () => {
    const client = new FakeClient([
      [
        { type: 'content', text: '我去推箱子。' },
        toolCall('push_box', '{"box":"crate_1","to":"yard_a"}'),
        { type: 'finish', reason: 'tool_calls' },
      ],
      [
        { type: 'content', text: '推下去了。' },
        { type: 'finish', reason: 'stop' },
      ],
    ]);
    const messages: ChatMessage[] = [{ role: 'system', content: 'system' }];
    const calls: string[] = [];
    const result = await runAgentTurn({
      client,
      model: 'fake',
      messages,
      tools: [{ name: 'push_box', description: 'push', parameters: { type: 'object' } }],
      signal: new AbortController().signal,
      executeTool: async (call): Promise<ToolExecution> => {
        calls.push(call.function.name);
        return { ok: true, summary: 'pushed', content: '{"ok":true}' };
      },
    });
    expect(result.stopped).toBe('complete');
    expect(calls).toEqual(['push_box']);
    expect(messages.some((message) => message.role === 'tool')).toBe(true);
    expect(messages.at(-1)?.content).toBe('推下去了。');
  });

  it('records interrupted tool calls when the turn is aborted', async () => {
    const client = new FakeClient([
      [
        toolCall('move_to', '{"target":"exit"}', 'call_a', 0),
        toolCall('wait', '{"seconds":10}', 'call_b', 1),
        { type: 'finish', reason: 'tool_calls' },
      ],
    ]);
    const messages: ChatMessage[] = [{ role: 'system', content: 'system' }];
    const controller = new AbortController();
    const result = await runAgentTurn({
      client,
      model: 'fake',
      messages,
      tools: [],
      signal: controller.signal,
      executeTool: async (call): Promise<ToolExecution> => {
        if (call.id === 'call_a') {
          controller.abort();
          throw new DOMException('aborted', 'AbortError');
        }
        return { ok: true, summary: 'done', content: '{"ok":true}' };
      },
    });
    expect(result.aborted).toBe(true);
    const toolResults = messages.filter((message) => message.role === 'tool');
    expect(toolResults).toHaveLength(2);
    expect(toolResults[1]?.content).toContain('打断');
  });

  it('attaches provider items to the assistant message', async () => {
    const providerItems = [
      { type: 'reasoning', id: 'rs_1', summary: [] },
      { role: 'assistant', content: '我去推箱子。' },
    ];
    const client = new FakeClient([
      [
        { type: 'provider_items', items: providerItems },
        { type: 'content', text: '我去推箱子。' },
        { type: 'finish', reason: 'stop' },
      ],
    ]);
    const messages: ChatMessage[] = [{ role: 'system', content: 'system' }];
    await runAgentTurn({
      client,
      model: 'fake',
      messages,
      tools: [],
      signal: new AbortController().signal,
      executeTool: async () => ({ ok: true, summary: 'ok', content: '{"ok":true}' }),
    });
    expect(messages.at(-1)?.role).toBe('assistant');
    expect(messages.at(-1)?.providerItems).toEqual(providerItems);
  });

  it('stops at the configured step limit', async () => {
    const scripts = Array.from({ length: 4 }, () => [
      toolCall('observe', '{}'),
      { type: 'finish' as const, reason: 'tool_calls' },
    ]);
    const client = new FakeClient(scripts);
    const result = await runAgentTurn({
      client,
      model: 'fake',
      messages: [{ role: 'system', content: 'system' }],
      tools: [],
      maxSteps: 2,
      signal: new AbortController().signal,
      executeTool: async () => ({ ok: true, summary: 'ok', content: '{"ok":true}' }),
    });
    expect(result.stopped).toBe('max-steps');
    expect(result.aborted).toBe(false);
  });
});
