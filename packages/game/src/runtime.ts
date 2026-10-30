import type {
  AgentEvent,
  AgentTurnResult,
  ChatMessage,
  LlmClient,
  ToolCall,
  ToolDefinition,
  ToolExecution,
  Usage,
} from '@listen-up/agent';
import { runAgentTurn } from '@listen-up/agent';
import type { LevelDef } from '@listen-up/sim';
import { buildSystemPrompt } from './prompt';

export interface TeammateRuntimeOptions {
  client: LlmClient;
  model: string;
  level: LevelDef;
  tools: ToolDefinition[];
  temperature?: number;
  maxSteps?: number;
  executeTool: (call: ToolCall, signal: AbortSignal) => Promise<ToolExecution>;
  onEvent: (event: AgentEvent) => void;
}

export class TeammateRuntime {
  private readonly options: TeammateRuntimeOptions;
  private messages: ChatMessage[];
  usage: Usage = {};

  constructor(options: TeammateRuntimeOptions) {
    this.options = options;
    this.messages = [{ role: 'system', content: buildSystemPrompt(options.level) }];
  }

  async runTurn(situation: string, signal: AbortSignal): Promise<AgentTurnResult> {
    const historyLength = this.messages.length;
    this.messages.push({ role: 'user', content: situation });
    let result: AgentTurnResult;
    try {
      result = await runAgentTurn({
        client: this.options.client,
        model: this.options.model,
        messages: this.messages,
        tools: this.options.tools,
        executeTool: this.options.executeTool,
        temperature: this.options.temperature ?? 0.4,
        maxSteps: this.options.maxSteps ?? 8,
        signal,
        onEvent: this.options.onEvent,
      });
    } catch (error) {
      // A failed turn leaves unusable history (a user message that never got a
      // reply, or dangling tool calls). Roll back so retry() starts clean.
      this.messages.length = historyLength;
      throw error;
    }
    this.usage = {
      promptTokens: (this.usage.promptTokens ?? 0) + (result.usage.promptTokens ?? 0) || undefined,
      completionTokens:
        (this.usage.completionTokens ?? 0) + (result.usage.completionTokens ?? 0) || undefined,
      totalTokens: (this.usage.totalTokens ?? 0) + (result.usage.totalTokens ?? 0) || undefined,
    };
    this.trim();
    return result;
  }

  reset(): void {
    this.messages = [{ role: 'system', content: buildSystemPrompt(this.options.level) }];
    this.usage = {};
  }

  get history(): readonly ChatMessage[] {
    return this.messages;
  }

  private trim(): void {
    if (this.messages.length <= 60) return;
    const keep = this.messages.slice(-44);
    let start = 0;
    while (start < keep.length) {
      const message = keep[start];
      if (message?.role === 'system') break;
      if (message?.role === 'user') break;
      start += 1;
    }
    this.messages = [this.messages[0] as ChatMessage, ...keep.slice(start)];
  }
}
