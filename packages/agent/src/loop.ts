import type {
  AgentEvent,
  AgentTurnResult,
  ChatMessage,
  LlmClient,
  ToolCall,
  ToolDefinition,
  ToolExecution,
  Usage,
} from './types';
import { LlmError } from './types';

export interface RunAgentTurnOptions {
  client: LlmClient;
  model: string;
  messages: ChatMessage[];
  tools: ToolDefinition[];
  executeTool: (call: ToolCall, signal: AbortSignal) => Promise<ToolExecution>;
  temperature?: number;
  maxTokens?: number;
  maxSteps?: number;
  maxToolCallsPerStep?: number;
  signal: AbortSignal;
  onEvent?: (event: AgentEvent) => void;
}

interface AssembledStep {
  content: string;
  reasoning: string;
  calls: ToolCall[];
  finishReason: string;
  usage?: Usage;
}

interface PartialCall {
  id?: string;
  name: string;
  args: string;
}

function emit(onEvent: ((event: AgentEvent) => void) | undefined, event: AgentEvent): void {
  if (!onEvent) return;
  try {
    onEvent(event);
  } catch {
    // UI callbacks must not break the loop.
  }
}

function abortError(): DOMException {
  return new DOMException('请求已取消。', 'AbortError');
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function collectStep(
  options: RunAgentTurnOptions,
  stepIndex: number,
  usage: Usage,
): Promise<AssembledStep> {
  const partials = new Map<number, PartialCall>();
  let content = '';
  let reasoning = '';
  let finishReason = '';
  let received = false;

  const consume = async (): Promise<AssembledStep> => {
    const stream = options.client.stream(
      {
        model: options.model,
        messages: options.messages,
        tools: options.tools,
        temperature: options.temperature ?? 0.4,
        maxTokens: options.maxTokens,
      },
      options.signal,
    );
    for await (const delta of stream) {
      received = true;
      if (delta.type === 'content') {
        content += delta.text;
        emit(options.onEvent, { type: 'assistant_delta', text: delta.text });
      } else if (delta.type === 'reasoning') {
        reasoning += delta.text;
      } else if (delta.type === 'tool_call') {
        const partial = partials.get(delta.index) ?? { name: '', args: '' };
        if (delta.id) partial.id = delta.id;
        if (delta.name) partial.name = delta.name;
        if (delta.argumentsDelta) partial.args += delta.argumentsDelta;
        partials.set(delta.index, partial);
      } else if (delta.type === 'finish') {
        finishReason = delta.reason;
      } else if (delta.type === 'usage') {
        usage.promptTokens = delta.usage.promptTokens ?? usage.promptTokens;
        usage.completionTokens = delta.usage.completionTokens ?? usage.completionTokens;
        usage.totalTokens = delta.usage.totalTokens ?? usage.totalTokens;
      }
    }
    const calls: ToolCall[] = [...partials.entries()]
      .toSorted(([a], [b]) => a - b)
      .map(([index, partial]) => ({
        id: partial.id || `call_${stepIndex}_${index}`,
        type: 'function',
        function: { name: partial.name, arguments: partial.args || '{}' },
      }));
    return { content, reasoning, calls, finishReason };
  };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await consume();
    } catch (error) {
      if (options.signal.aborted) throw abortError();
      const retryable = error instanceof LlmError && error.retryable;
      if (!retryable || received || attempt === 2) throw error;
      emit(options.onEvent, {
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
        code: 'retry',
      });
      await sleep(600 * 2 ** attempt, options.signal);
    }
  }
  throw new LlmError('retry', '模型请求重试次数用完了。');
}

function interruptedContent(): string {
  return JSON.stringify({ ok: false, error: '动作被新的输入打断，未完成。' });
}

function capContent(value: string): string {
  return value.length > 8000 ? `${value.slice(0, 8000)}\n[结果已截断]` : value;
}

export async function runAgentTurn(options: RunAgentTurnOptions): Promise<AgentTurnResult> {
  const maxSteps = options.maxSteps ?? 8;
  const maxCalls = options.maxToolCallsPerStep ?? 6;
  const usage: Usage = {};

  for (let step = 0; step < maxSteps; step += 1) {
    if (options.signal.aborted) return { aborted: true, stopped: 'aborted', usage };

    let assembled: AssembledStep;
    try {
      assembled = await collectStep(options, step, usage);
    } catch (error) {
      if (options.signal.aborted) return { aborted: true, stopped: 'aborted', usage };
      throw error;
    }

    if (options.signal.aborted) return { aborted: true, stopped: 'aborted', usage };
    const text = assembled.content.trim();
    const calls = assembled.calls.filter((call) => call.function.name.length > 0);
    const assistant: ChatMessage = {
      role: 'assistant',
      content: assembled.content.length > 0 ? assembled.content : null,
      ...(calls.length > 0 ? { tool_calls: calls } : {}),
    };
    options.messages.push(assistant);
    emit(options.onEvent, { type: 'assistant_done', text });
    if (usage.totalTokens !== undefined || usage.promptTokens !== undefined) {
      emit(options.onEvent, { type: 'usage', usage });
    }

    if (calls.length === 0) {
      return { aborted: false, stopped: 'complete', usage };
    }

    const executable = calls.slice(0, maxCalls);
    const excess = calls.slice(maxCalls);
    for (const call of excess) {
      options.messages.push({
        role: 'tool',
        tool_call_id: call.id,
        name: call.function.name,
        content: capContent(JSON.stringify({ ok: false, error: '一次最多执行 6 个工具调用。' })),
      });
    }

    for (let index = 0; index < executable.length; index += 1) {
      const call = executable[index];
      if (!call) continue;
      if (options.signal.aborted) {
        for (let rest = index; rest < executable.length; rest += 1) {
          const remaining = executable[rest];
          if (!remaining) continue;
          options.messages.push({
            role: 'tool',
            tool_call_id: remaining.id,
            name: remaining.function.name,
            content: interruptedContent(),
          });
        }
        return { aborted: true, stopped: 'aborted', usage };
      }
      emit(options.onEvent, {
        type: 'tool_started',
        id: call.id,
        name: call.function.name,
        args: call.function.arguments,
      });
      const started = performance.now();
      let result: ToolExecution;
      try {
        result = await options.executeTool(call, options.signal);
      } catch (error) {
        if (options.signal.aborted) {
          result = { content: interruptedContent(), ok: false, summary: '动作被打断' };
        } else {
          const message = error instanceof Error ? error.message : String(error);
          result = {
            content: JSON.stringify({ ok: false, error: message }),
            ok: false,
            summary: message,
          };
        }
      }
      const durationMs = Math.round(performance.now() - started);
      emit(options.onEvent, {
        type: 'tool_finished',
        id: call.id,
        name: call.function.name,
        ok: result.ok,
        summary: result.summary,
        durationMs,
      });
      options.messages.push({
        role: 'tool',
        tool_call_id: call.id,
        name: call.function.name,
        content: capContent(result.content),
      });
      if (options.signal.aborted) {
        for (let rest = index + 1; rest < executable.length; rest += 1) {
          const remaining = executable[rest];
          if (!remaining) continue;
          options.messages.push({
            role: 'tool',
            tool_call_id: remaining.id,
            name: remaining.function.name,
            content: interruptedContent(),
          });
        }
        return { aborted: true, stopped: 'aborted', usage };
      }
      if (!result.ok) {
        for (let rest = index + 1; rest < executable.length; rest += 1) {
          const remaining = executable[rest];
          if (!remaining) continue;
          options.messages.push({
            role: 'tool',
            tool_call_id: remaining.id,
            name: remaining.function.name,
            content: JSON.stringify({ ok: false, error: '上一步动作失败，这一项没有执行。' }),
          });
        }
        break;
      }
    }
  }

  return { aborted: false, stopped: 'max-steps', usage };
}
