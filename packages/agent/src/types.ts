export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export type ProviderItem = Record<string, unknown>;

export interface ChatMessage {
  role: ChatRole;
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
  /** Protocol-specific context that must ride along to the next request. */
  providerItems?: ProviderItem[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface Usage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface LlmRequest {
  model: string;
  messages: ChatMessage[];
  tools: ToolDefinition[];
  temperature: number;
  maxTokens?: number;
}

export type LlmDelta =
  | { type: 'content'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool_call'; index: number; id?: string; name?: string; argumentsDelta?: string }
  | { type: 'provider_items'; items: ProviderItem[] }
  | { type: 'finish'; reason: string }
  | { type: 'usage'; usage: Usage };

export interface LlmClient {
  stream(request: LlmRequest, signal: AbortSignal): AsyncIterable<LlmDelta>;
}

export type AgentEvent =
  | { type: 'assistant_delta'; text: string }
  | { type: 'assistant_done'; text: string }
  | { type: 'tool_started'; id: string; name: string; args: string }
  | {
      type: 'tool_finished';
      id: string;
      name: string;
      ok: boolean;
      summary: string;
      durationMs: number;
    }
  | { type: 'usage'; usage: Usage }
  | { type: 'error'; message: string; code: string };

export interface ToolExecution {
  content: string;
  ok: boolean;
  summary: string;
}

export interface AgentTurnResult {
  aborted: boolean;
  stopped: 'complete' | 'max-steps' | 'aborted';
  usage: Usage;
}

export class LlmError extends Error {
  readonly code: string;
  readonly status?: number;
  readonly retryable: boolean;
  constructor(
    code: string,
    message: string,
    options: { status?: number; retryable?: boolean } = {},
  ) {
    super(message);
    this.name = 'LlmError';
    this.code = code;
    this.status = options.status;
    this.retryable = options.retryable ?? false;
  }
}
