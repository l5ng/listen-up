import type { ChatMessage, LlmClient, LlmDelta, LlmRequest, ToolCall, Usage } from './types';
import { LlmError } from './types';

export interface OpenAiCompatibleConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

function endpoint(baseUrl: string, path: string): string {
  const base = normalizeBaseUrl(baseUrl);
  if (base.endsWith('/chat/completions')) return base;
  if (base.endsWith('/v1')) return `${base}${path}`;
  return `${base}/v1${path}`;
}

function headers(apiKey: string): Record<string, string> {
  const value: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey.trim()) value.Authorization = `Bearer ${apiKey.trim()}`;
  return value;
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function parseUsage(raw: unknown): Usage | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const record = raw as Record<string, unknown>;
  const usage: Usage = {
    promptTokens: number(record.prompt_tokens),
    completionTokens: number(record.completion_tokens),
    totalTokens: number(record.total_tokens),
  };
  if (
    usage.promptTokens === undefined &&
    usage.completionTokens === undefined &&
    usage.totalTokens === undefined
  )
    return undefined;
  return usage;
}

async function readError(response: Response): Promise<{ message: string; code: string }> {
  let detail = '';
  try {
    const text = await response.text();
    detail = text.slice(0, 800);
  } catch {
    detail = '';
  }
  let message = detail;
  try {
    const parsed = JSON.parse(detail) as { error?: { message?: string } };
    if (parsed.error?.message) message = parsed.error.message;
  } catch {
    // keep raw detail
  }
  const code =
    response.status === 401 || response.status === 403
      ? 'auth'
      : response.status === 429
        ? 'rate-limit'
        : response.status >= 500
          ? 'server'
          : 'http';
  return {
    message: message || `模型接口返回 HTTP ${response.status}`,
    code,
  };
}

function toolCallFromDelta(raw: unknown, index: number): Extract<LlmDelta, { type: 'tool_call' }> {
  const record = (raw ?? {}) as Record<string, unknown>;
  const fn = (record.function ?? {}) as Record<string, unknown>;
  const args = fn.arguments;
  return {
    type: 'tool_call',
    index: typeof record.index === 'number' ? record.index : index,
    id: typeof record.id === 'string' ? record.id : undefined,
    name: typeof fn.name === 'string' ? fn.name : undefined,
    argumentsDelta:
      typeof args === 'string'
        ? args
        : args && typeof args === 'object'
          ? JSON.stringify(args)
          : undefined,
  };
}

function parseNonStreaming(payload: unknown): LlmDelta[] {
  const deltas: LlmDelta[] = [];
  const root = (payload ?? {}) as Record<string, unknown>;
  const choices = Array.isArray(root.choices) ? root.choices : [];
  const choice = (choices[0] ?? {}) as Record<string, unknown>;
  const message = (choice.message ?? {}) as Record<string, unknown>;
  const content = typeof message.content === 'string' ? message.content : '';
  if (content) deltas.push({ type: 'content', text: content });
  const reasoning =
    typeof message.reasoning_content === 'string'
      ? message.reasoning_content
      : typeof message.reasoning === 'string'
        ? message.reasoning
        : '';
  if (reasoning) deltas.push({ type: 'reasoning', text: reasoning });
  const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  calls.forEach((call, index) => {
    const record = (call ?? {}) as Record<string, unknown>;
    const fn = (record.function ?? {}) as Record<string, unknown>;
    deltas.push({
      type: 'tool_call',
      index,
      id: typeof record.id === 'string' ? record.id : undefined,
      name: typeof fn.name === 'string' ? fn.name : undefined,
      argumentsDelta:
        typeof fn.arguments === 'string' ? fn.arguments : JSON.stringify(fn.arguments ?? {}),
    });
  });
  const finish = typeof choice.finish_reason === 'string' ? choice.finish_reason : 'stop';
  deltas.push({ type: 'finish', reason: finish });
  const usage = parseUsage(root.usage);
  if (usage) deltas.push({ type: 'usage', usage });
  return deltas;
}

export class OpenAiCompatibleClient implements LlmClient {
  readonly config: Required<Pick<OpenAiCompatibleConfig, 'baseUrl' | 'apiKey' | 'model'>> & {
    temperature: number;
    maxTokens?: number;
    timeoutMs: number;
  };

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
    const response = await fetch(endpoint(this.config.baseUrl, '/models'), {
      method: 'GET',
      headers: headers(this.config.apiKey),
      signal,
    });
    if (!response.ok) {
      const error = await readError(response);
      throw new LlmError(error.code, error.message, {
        status: response.status,
        retryable: response.status >= 500,
      });
    }
    const payload = (await response.json()) as { data?: { id?: string }[] };
    return (payload.data ?? [])
      .map((item) => item.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
  }

  async *stream(request: LlmRequest, signal: AbortSignal): AsyncIterable<LlmDelta> {
    const timeout = new AbortController();
    const timer = setTimeout(
      () => timeout.abort(new DOMException('模型请求超时。', 'TimeoutError')),
      this.config.timeoutMs,
    );
    const combined = AbortSignal.any([signal, timeout.signal]);
    const wireTools = request.tools.map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
    const body = {
      model: request.model,
      messages: request.messages,
      tools: wireTools.length > 0 ? wireTools : undefined,
      tool_choice: wireTools.length > 0 ? 'auto' : undefined,
      stream: true,
      temperature: request.temperature,
      max_tokens: request.maxTokens ?? this.config.maxTokens,
    };

    let response: Response;
    try {
      response = await fetch(endpoint(this.config.baseUrl, '/chat/completions'), {
        method: 'POST',
        headers: headers(this.config.apiKey),
        body: JSON.stringify(body),
        signal: combined,
      });
    } catch {
      clearTimeout(timer);
      if (signal.aborted) throw new DOMException('请求已取消。', 'AbortError');
      if (timeout.signal.aborted)
        throw new LlmError('timeout', '模型请求超时。', { retryable: true });
      throw new LlmError(
        'network',
        '无法连接模型接口。浏览器可能被 CORS 拦截，或 Base URL 不可达。',
        { retryable: true },
      );
    }

    if (!response.ok) {
      clearTimeout(timer);
      const error = await readError(response);
      throw new LlmError(error.code, error.message, {
        status: response.status,
        retryable: response.status === 429 || response.status >= 500,
      });
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('text/event-stream')) {
      try {
        const payload = await response.json();
        for (const delta of parseNonStreaming(payload)) yield delta;
      } finally {
        clearTimeout(timer);
      }
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      clearTimeout(timer);
      throw new LlmError('parse', '模型接口没有返回可读取的响应体。');
    }
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (!data || data === '[DONE]') continue;
          let payload: Record<string, unknown>;
          try {
            payload = JSON.parse(data) as Record<string, unknown>;
          } catch {
            continue;
          }
          const choices = Array.isArray(payload.choices) ? payload.choices : [];
          const choice = (choices[0] ?? {}) as Record<string, unknown>;
          const delta = (choice.delta ?? {}) as Record<string, unknown>;
          const content = typeof delta.content === 'string' ? delta.content : '';
          if (content) yield { type: 'content', text: content };
          const reasoning =
            typeof delta.reasoning_content === 'string'
              ? delta.reasoning_content
              : typeof delta.reasoning === 'string'
                ? delta.reasoning
                : '';
          if (reasoning) yield { type: 'reasoning', text: reasoning };
          const calls = Array.isArray(delta.tool_calls) ? delta.tool_calls : [];
          for (let index = 0; index < calls.length; index += 1) {
            yield toolCallFromDelta(calls[index], index);
          }
          if (typeof choice.finish_reason === 'string' && choice.finish_reason) {
            yield { type: 'finish', reason: choice.finish_reason };
          }
          const usage = parseUsage(payload.usage);
          if (usage) yield { type: 'usage', usage };
        }
      }
    } catch (error) {
      if (signal.aborted) throw new DOMException('请求已取消。', 'AbortError');
      if (timeout.signal.aborted)
        throw new LlmError('timeout', '模型请求超时。', { retryable: true });
      if (error instanceof LlmError) throw error;
      throw new LlmError('stream', '模型流式响应中断了。', { retryable: true });
    } finally {
      clearTimeout(timer);
      try {
        await reader.cancel();
      } catch {
        // ignore
      }
    }
  }
}

export function toOpenAiMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((message) => {
    if (message.role === 'assistant' && message.tool_calls && message.tool_calls.length > 0) {
      return { ...message, content: message.content ?? null };
    }
    return message;
  });
}

export function toolCallSignature(call: ToolCall): string {
  return `${call.function.name}:${call.function.arguments}`;
}
