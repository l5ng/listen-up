import { describe, expect, it } from 'vitest';
import type { AgentTurnResult, LlmClient, LlmDelta, LlmRequest } from '@listen-up/agent';
import { getLevel } from '@listen-up/sim';
import { TeammateRuntime } from './runtime';

class FailingClient implements LlmClient {
  async *stream(_request: LlmRequest, _signal: AbortSignal): AsyncIterable<LlmDelta> {
    yield* [];
    throw new Error('connection refused');
  }
}

class FlakyClient implements LlmClient {
  failedOnce = false;

  async *stream(_request: LlmRequest, _signal: AbortSignal): AsyncIterable<LlmDelta> {
    if (!this.failedOnce) {
      this.failedOnce = true;
      throw new Error('connection refused');
    }
    yield { type: 'content', text: '好的。' };
    yield { type: 'finish', reason: 'stop' };
  }
}

function makeRuntime(client: LlmClient): TeammateRuntime {
  return new TeammateRuntime({
    client,
    model: 'fake',
    level: getLevel('sky-01'),
    tools: [],
    executeTool: async () => ({ ok: true, summary: 'ok', content: '{"ok":true}' }),
    onEvent: () => undefined,
  });
}

describe('TeammateRuntime', () => {
  it('rolls back history when the turn fails so retry starts clean', async () => {
    const runtime = makeRuntime(new FailingClient());
    await expect(
      runtime.runTurn('情况：你被要求移动。', new AbortController().signal),
    ).rejects.toThrow('connection refused');
    expect(runtime.history.length).toBe(1); // only the system prompt remains
  });

  it('does not duplicate the user situation when a failed turn is retried', async () => {
    const client = new FlakyClient();
    const runtime = makeRuntime(client);
    const situation = '情况：同一句话。';
    await expect(runtime.runTurn(situation, new AbortController().signal)).rejects.toThrow(
      'connection refused',
    );
    expect(runtime.history.length).toBe(1);

    const result = await runtime.runTurn(situation, new AbortController().signal);
    expect(result.stopped).toBe('complete');
    const userMessages = runtime.history.filter(
      (message) => message.role === 'user' && message.content === situation,
    );
    expect(userMessages).toHaveLength(1);
    expect(runtime.history.length).toBe(3); // system + user + assistant
  });

  it('exposes a typed AgentTurnResult contract', () => {
    const sample: AgentTurnResult = { aborted: false, stopped: 'complete', usage: {} };
    expect(sample.stopped).toBe('complete');
  });
});
