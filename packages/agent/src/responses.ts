import type { OpenAiCompatibleConfig } from './client';
import { endpoint, headers, listModelIds, parseFailure, readError, readSseData } from './http';
import type { ChatMessage, LlmClient, LlmDelta, LlmRequest, ProviderItem, Usage } from './types';
import { LlmError } from './types';

interface ResponsesTool {
  type: 'function';
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  strict: boolean;
}

interface ResponsesBody {
  model: string;
  input: ProviderItem[];
  instructions?: string;
  tools?: ResponsesTool[];
  tool_choice?: 'auto';
  stream: true;
  store: false;
  include: ['reasoning.encrypted_content'];
  temperature?: number;
  max_output_tokens?: number;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function isReasoningModel(model: string): boolean {
  return /^(o[1-9]|gpt-5|gpt-6)/i.test(model.trim());
}

function messageText(item: Record<string, unknown>): string {
  if (typeof item.content === 'string') return item.content;
  const content = Array.isArray(item.content) ? item.content : [];
  const parts: string[] = [];
  for (const raw of content) {
    const part = record(raw);
    if (part.type === 'output_text' && typeof part.text === 'string' && part.text) {
      parts.push(part.text);
    } else if (part.type === 'refusal' && typeof part.refusal === 'string' && part.refusal) {
      parts.push(part.refusal);
    }
  }
  return parts.join('\n');
}

function sanitizeItem(raw: unknown, allowCalls: boolean): ProviderItem | undefined {
  const item = record(raw);
  if (item.type === 'reasoning') {
    if (typeof item.id !== 'string' || !item.id) return undefined;
    const summary = Array.isArray(item.summary)
      ? item.summary.flatMap((part) => {
          const entry = record(part);
          return entry.type === 'summary_text' && typeof entry.text === 'string'
            ? [{ type: 'summary_text', text: entry.text }]
            : [];
        })
      : [];
    return {
      type: 'reasoning',
      id: item.id,
      summary,
      ...(typeof item.encrypted_content === 'string'
        ? { encrypted_content: item.encrypted_content }
        : {}),
    };
  }
  if (item.type === 'message') {
    const body = messageText(item);
    return body ? { role: 'assistant', content: body } : undefined;
  }
  if (item.type === 'function_call' && allowCalls) {
    if (item.status === 'incomplete' || item.status === 'in_progress') return undefined;
    if (typeof item.call_id !== 'string' || !item.call_id) return undefined;
    if (typeof item.name !== 'string' || !item.name) return undefined;
    return {
      type: 'function_call',
      call_id: item.call_id,
      name: item.name,
      arguments:
        typeof item.arguments === 'string'
          ? item.arguments
          : item.arguments && typeof item.arguments === 'object'
            ? JSON.stringify(item.arguments)
            : '',
    };
  }
  return undefined;
}

function sanitizeItems(output: unknown, allowCalls: boolean): ProviderItem[] {
  if (!Array.isArray(output)) return [];
  return output.flatMap((raw) => {
    const item = sanitizeItem(raw, allowCalls);
    return item ? [item] : [];
  });
}

function providerItemsMatch(items: ProviderItem[], calls: ChatMessage['tool_calls']): boolean {
  const expected = calls ?? [];
  const actual = items.filter((item) => item.type === 'function_call');
  if (expected.length !== actual.length) return false;
  const ids = new Set(actual.map((item) => item.call_id));
  if (ids.size !== actual.length) return false;
  return expected.every((call) => ids.has(call.id));
}

function buildInput(messages: ChatMessage[]): {
  input: ProviderItem[];
  instructions?: string;
} {
  const instructions = messages
    .filter(
      (message) =>
        message.role === 'system' &&
        typeof message.content === 'string' &&
        message.content.trim().length > 0,
    )
    .map((message) => message.content?.trim() ?? '')
    .join('\n\n');

  const lastUser = messages.findLastIndex((message) => message.role === 'user');
  const turnStart = lastUser >= 0 ? lastUser : 0;
  const input: ProviderItem[] = [];

  const pushText = (role: 'user' | 'assistant', value: string | null) => {
    const body = (value ?? '').trim();
    if (!body) return;
    const last = input.at(-1);
    if (last && last.role === role && typeof last.content === 'string') {
      last.content = last.content + '\n' + body;
      return;
    }
    input.push({ role, content: body });
  };

  const pushAssistant = (message: ChatMessage) => {
    const items = message.providerItems;
    const calls = message.tool_calls ?? [];
    if (items && items.length > 0 && providerItemsMatch(items, calls)) {
      input.push(...items);
      return;
    }
    pushText('assistant', message.content);
    for (const call of calls) {
      input.push({
        type: 'function_call',
        call_id: call.id,
        name: call.function.name,
        arguments: call.function.arguments || '{}',
      });
    }
  };

  messages.forEach((message, index) => {
    if (message.role === 'system') return;
    if (index < turnStart) {
      if (message.role === 'user') pushText('user', message.content);
      else if (message.role === 'assistant') pushText('assistant', message.content);
      return;
    }
    if (message.role === 'user') {
      pushText('user', message.content);
      return;
    }
    if (message.role === 'assistant') {
      pushAssistant(message);
      return;
    }
    if (message.role === 'tool' && message.tool_call_id) {
      input.push({
        type: 'function_call_output',
        call_id: message.tool_call_id,
        output: message.content ?? '',
      });
    }
  });

  return { input, instructions: instructions || undefined };
}

function usageFrom(response: Record<string, unknown>): Usage | undefined {
  const raw = record(response.usage);
  const usage: Usage = {
    promptTokens: number(raw.input_tokens),
    completionTokens: number(raw.output_tokens),
    totalTokens: number(raw.total_tokens),
  };
  if (
    usage.promptTokens === undefined &&
    usage.completionTokens === undefined &&
    usage.totalTokens === undefined
  ) {
    return undefined;
  }
  return usage;
}

function providerCode(code: string): string {
  if (code === 'invalid_api_key' || code === 'authentication_error') return 'auth';
  if (code === 'rate_limit_exceeded' || code === 'insufficient_quota') return 'rate-limit';
  if (code === 'server_error') return 'server';
  if (code === 'context_length_exceeded') return 'context';
  return 'api';
}

function providerError(response: Record<string, unknown>): LlmError {
  const error = record(response.error);
  const message = typeof error.message === 'string' ? error.message : '模型接口返回了失败状态。';
  const code = typeof error.code === 'string' ? providerCode(error.code) : 'api';
  return new LlmError(code, message);
}

function incompleteReason(response: Record<string, unknown>): string {
  const reason = record(response.incomplete_details).reason;
  if (reason === 'max_output_tokens') return 'length';
  if (reason === 'content_filter') return 'content_filter';
  return 'incomplete';
}

function parseResponsePayload(payload: unknown): LlmDelta[] {
  const response = record(payload);
  if (response.status === 'failed') throw providerError(response);
  if (response.error && (!Array.isArray(response.output) || response.output.length === 0)) {
    throw providerError(response);
  }

  const completed = response.status !== 'incomplete';
  const output = Array.isArray(response.output) ? response.output : [];
  const deltas: LlmDelta[] = [];

  let sawText = false;
  for (const raw of output) {
    const item = record(raw);
    if (item.type !== 'message') continue;
    const body = messageText(item);
    if (body) {
      deltas.push({ type: 'content', text: body });
      sawText = true;
    }
  }
  if (!sawText && typeof response.output_text === 'string' && response.output_text) {
    deltas.push({ type: 'content', text: response.output_text });
  }

  let items = sanitizeItems(output, completed);
  if (!completed) items = items.filter((item) => item.type !== 'function_call');

  let callIndex = 0;
  for (const item of items) {
    if (item.type !== 'function_call') continue;
    deltas.push({
      type: 'tool_call',
      index: callIndex,
      id: typeof item.call_id === 'string' ? item.call_id : undefined,
      name: typeof item.name === 'string' ? item.name : undefined,
      argumentsDelta: typeof item.arguments === 'string' ? item.arguments : '',
    });
    callIndex += 1;
  }

  if (items.some((item) => item.type === 'function_call')) {
    deltas.push({ type: 'provider_items', items });
  }

  const usage = usageFrom(response);
  if (usage) deltas.push({ type: 'usage', usage });
  deltas.push({ type: 'finish', reason: completed ? 'stop' : incompleteReason(response) });
  return deltas;
}

export class OpenAiResponsesClient implements LlmClient {
  readonly config: Required<Pick<OpenAiCompatibleConfig, 'baseUrl' | 'apiKey' | 'model'>> & {
    temperature: number;
    maxTokens?: number;
    timeoutMs: number;
  };
  private temperatureUnsupported = false;

  constructor(config: OpenAiCompatibleConfig) {
    this.config = {
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      model: config.model,
      temperature: config.temperature ?? 0.4,
      maxTokens: config.maxTokens,
      timeoutMs: config.timeoutMs ?? 90_000,
    };
  }

  async listModels(signal?: AbortSignal): Promise<string[]> {
    return listModelIds(this.config, signal);
  }

  async *stream(request: LlmRequest, signal: AbortSignal): AsyncIterable<LlmDelta> {
    const timeout = new AbortController();
    const timer = setTimeout(
      () => timeout.abort(new DOMException('模型请求超时。', 'TimeoutError')),
      this.config.timeoutMs,
    );
    const combined = AbortSignal.any([signal, timeout.signal]);
    const includeTemperature =
      !this.temperatureUnsupported &&
      !isReasoningModel(request.model) &&
      request.temperature !== undefined;
    const body = this.body(request, includeTemperature);

    const post = async (payload: ResponsesBody): Promise<Response> => {
      try {
        return await fetch(endpoint(this.config.baseUrl, '/responses'), {
          method: 'POST',
          headers: headers(this.config.apiKey),
          body: JSON.stringify(payload),
          signal: combined,
        });
      } catch {
        if (signal.aborted) throw new DOMException('请求已取消。', 'AbortError');
        if (timeout.signal.aborted) {
          throw new LlmError('timeout', '模型请求超时。', { retryable: true });
        }
        throw new LlmError(
          'network',
          '无法连接模型接口。浏览器可能被 CORS 拦截，或 Base URL 不可达。',
          { retryable: true },
        );
      }
    };

    try {
      let response = await post(body);

      if (response.status === 400 && body.temperature !== undefined) {
        let detail = '';
        try {
          detail = await response.text();
        } catch {
          if (signal.aborted) throw new DOMException('请求已取消。', 'AbortError');
          if (timeout.signal.aborted) {
            throw new LlmError('timeout', '模型请求超时。', { retryable: true });
          }
        }
        if (/temperature/i.test(detail)) {
          this.temperatureUnsupported = true;
          const retryBody = { ...body };
          delete retryBody.temperature;
          response = await post(retryBody);
        } else {
          const error = parseFailure(400, detail);
          throw new LlmError(error.code, error.message, { status: 400 });
        }
      }

      if (!response.ok) {
        if (signal.aborted) throw new DOMException('请求已取消。', 'AbortError');
        if (timeout.signal.aborted) {
          throw new LlmError('timeout', '模型请求超时。', { retryable: true });
        }
        const error = await readError(response);
        throw new LlmError(error.code, error.message, {
          status: response.status,
          retryable: response.status === 429 || response.status >= 500,
        });
      }

      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.includes('text/event-stream')) {
        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          if (signal.aborted) throw new DOMException('请求已取消。', 'AbortError');
          if (timeout.signal.aborted) {
            throw new LlmError('timeout', '模型请求超时。', { retryable: true });
          }
          throw new LlmError('parse', '模型接口返回了无法解析的 JSON。');
        }
        for (const delta of parseResponsePayload(payload)) yield delta;
        return;
      }

      try {
        yield* this.streamEvents(response);
      } catch (error) {
        if (signal.aborted) throw new DOMException('请求已取消。', 'AbortError');
        if (timeout.signal.aborted) {
          throw new LlmError('timeout', '模型请求超时。', { retryable: true });
        }
        if (error instanceof LlmError) throw error;
        throw new LlmError('stream', '模型流式响应中断了。', { retryable: true });
      }
    } finally {
      clearTimeout(timer);
    }
  }

  private body(request: LlmRequest, includeTemperature: boolean): ResponsesBody {
    const { input, instructions } = buildInput(request.messages);
    const tools: ResponsesTool[] = request.tools.map((tool) => ({
      type: 'function',
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      strict: false,
    }));
    const maxTokens = request.maxTokens ?? this.config.maxTokens;
    return {
      model: request.model,
      input,
      ...(instructions ? { instructions } : {}),
      ...(tools.length > 0 ? { tools, tool_choice: 'auto' as const } : {}),
      stream: true,
      store: false,
      include: ['reasoning.encrypted_content'],
      ...(includeTemperature && request.temperature !== undefined
        ? { temperature: request.temperature }
        : {}),
      ...(maxTokens !== undefined ? { max_output_tokens: maxTokens } : {}),
    };
  }

  private async *streamEvents(response: Response): AsyncIterable<LlmDelta> {
    const seenText = new Set<number>();
    const doneItems = new Map<number, ProviderItem>();

    for await (const event of readSseData(response)) {
      const type = typeof event.type === 'string' ? event.type : '';
      const outputIndex = typeof event.output_index === 'number' ? event.output_index : 0;

      if (type === 'response.output_text.delta' || type === 'response.refusal.delta') {
        const delta = typeof event.delta === 'string' ? event.delta : '';
        if (delta) {
          seenText.add(outputIndex);
          yield { type: 'content', text: delta };
        }
        continue;
      }

      if (type === 'response.output_item.done') {
        const item = record(event.item);
        if (item.type === 'message' && !seenText.has(outputIndex)) {
          const body = messageText(item);
          if (body) {
            seenText.add(outputIndex);
            yield { type: 'content', text: body };
          }
        }
        const sanitized = sanitizeItem(item, true);
        if (sanitized) doneItems.set(outputIndex, sanitized);
        continue;
      }

      if (type === 'response.failed') {
        throw providerError(record(event.response));
      }

      if (type === 'error') {
        const code = typeof event.code === 'string' ? providerCode(event.code) : 'api';
        const message = typeof event.message === 'string' ? event.message : '模型接口返回错误。';
        throw new LlmError(code, message);
      }

      if (type !== 'response.completed' && type !== 'response.incomplete') continue;

      const payload = record(event.response);
      if (payload.status === 'failed') throw providerError(payload);
      const completed = payload.status !== 'incomplete';
      const output = Array.isArray(payload.output) ? payload.output : [];

      for (let index = 0; index < output.length; index += 1) {
        const item = record(output[index]);
        if (item.type !== 'message' || seenText.has(index)) continue;
        const body = messageText(item);
        if (body) {
          seenText.add(index);
          yield { type: 'content', text: body };
        }
      }

      let maxIndex = output.length - 1;
      for (const index of doneItems.keys()) maxIndex = Math.max(maxIndex, index);
      let items: ProviderItem[] = [];
      for (let index = 0; index <= maxIndex; index += 1) {
        let item = index < output.length ? sanitizeItem(output[index], completed) : undefined;
        if (item?.type === 'reasoning') {
          const done = doneItems.get(index);
          if (done?.type === 'reasoning' && typeof done.encrypted_content === 'string') {
            item = done;
          }
        }
        if (!item) item = doneItems.get(index);
        if (item) items.push(item);
      }
      if (!completed) {
        items = items.filter((item) => item.type !== 'function_call');
      }

      let callIndex = 0;
      for (const item of items) {
        if (item.type !== 'function_call') continue;
        yield {
          type: 'tool_call',
          index: callIndex,
          id: typeof item.call_id === 'string' ? item.call_id : undefined,
          name: typeof item.name === 'string' ? item.name : undefined,
          argumentsDelta: typeof item.arguments === 'string' ? item.arguments : '',
        };
        callIndex += 1;
      }

      if (items.some((item) => item.type === 'function_call')) {
        yield { type: 'provider_items', items };
      }

      const usage = usageFrom(payload);
      if (usage) yield { type: 'usage', usage };
      yield {
        type: 'finish',
        reason: completed ? 'stop' : incompleteReason(payload),
      };
      return;
    }

    throw new LlmError('stream', '模型流式响应提前结束了。', { retryable: true });
  }
}
