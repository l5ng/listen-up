import { LlmError } from './types';

export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

export function apiBase(baseUrl: string): string {
  return normalizeBaseUrl(baseUrl).replace(/\/(?:chat\/completions|responses)$/, '');
}

export function endpoint(baseUrl: string, path: string): string {
  const base = apiBase(baseUrl);
  if (base.endsWith('/v1')) return `${base}${path}`;
  return `${base}/v1${path}`;
}

export function headers(apiKey: string): Record<string, string> {
  const value: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey.trim()) value.Authorization = `Bearer ${apiKey.trim()}`;
  return value;
}

export function httpErrorCode(status: number): string {
  return status === 401 || status === 403
    ? 'auth'
    : status === 429
      ? 'rate-limit'
      : status >= 500
        ? 'server'
        : 'http';
}

export function parseFailure(status: number, detail: string): { message: string; code: string } {
  let message = detail.slice(0, 800);
  try {
    const parsed = JSON.parse(message) as { error?: { message?: string } };
    if (parsed.error?.message) message = parsed.error.message;
  } catch {
    // keep raw detail
  }
  return {
    message: message || `模型接口返回 HTTP ${status}`,
    code: httpErrorCode(status),
  };
}

export async function readError(response: Response): Promise<{ message: string; code: string }> {
  let detail = '';
  try {
    detail = (await response.text()).slice(0, 800);
  } catch {
    detail = '';
  }
  return parseFailure(response.status, detail);
}

export async function listModelIds(
  config: { baseUrl: string; apiKey: string },
  signal?: AbortSignal,
): Promise<string[]> {
  const response = await fetch(endpoint(config.baseUrl, '/models'), {
    method: 'GET',
    headers: headers(config.apiKey),
    signal,
  });
  if (!response.ok) {
    const error = await readError(response);
    throw new LlmError(error.code, error.message, {
      status: response.status,
      retryable: response.status >= 500,
    });
  }
  let payload: { data?: { id?: string }[] };
  try {
    payload = (await response.json()) as { data?: { id?: string }[] };
  } catch {
    throw new LlmError('parse', '模型接口返回了无法解析的 JSON。');
  }
  return (payload.data ?? [])
    .map((item) => item.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
}

export async function* readSseData(response: Response): AsyncGenerator<Record<string, unknown>> {
  const reader = response.body?.getReader();
  if (!reader) throw new LlmError('parse', '模型接口没有返回可读取的响应体。');
  const decoder = new TextDecoder();
  let buffer = '';

  const parse = (rawLine: string): Record<string, unknown> | undefined => {
    const line = rawLine.trim();
    if (!line.startsWith('data:')) return undefined;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') return undefined;
    try {
      return JSON.parse(data) as Record<string, unknown>;
    } catch {
      // A data line that is neither empty, [DONE], nor valid JSON means the
      // stream is corrupt; silently dropping it would hide truncated output.
      throw new LlmError('parse', '模型接口返回了无法解析的 SSE 数据行。', { retryable: true });
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const rawLine of lines) {
        const payload = parse(rawLine);
        if (payload) yield payload;
      }
    }
    buffer += decoder.decode();
    const tail = parse(buffer);
    if (tail) yield tail;
  } finally {
    try {
      await reader.cancel();
    } catch {
      // ignore
    }
  }
}
