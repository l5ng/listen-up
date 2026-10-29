import type { AnchorSnapshot, Vec3, WorldSnapshot } from '@listen-up/sim';

export interface StandingRule {
  id: string;
  text: string;
}

export interface ToolTrace {
  id: string;
  kind: 'assistant' | 'tool' | 'event' | 'error';
  title: string;
  text: string;
  status: 'running' | 'done' | 'error';
  args?: string;
  durationMs?: number;
  at: number;
}

export interface AgentErrorInfo {
  message: string;
  code: string;
}

export interface GameUiState {
  levelId: string;
  status: 'playing' | 'won';
  speech: string;
  speechStreaming: boolean;
  bStatus: string;
  rules: StandingRule[];
  trace: ToolTrace[];
  agentError?: AgentErrorInfo;
  turnActive: boolean;
  paused: boolean;
  promptTokens: number;
  completionTokens: number;
  lastInput?: string;
}

export interface ObservationOptions {
  bStatus?: string;
}

export type { AnchorSnapshot, Vec3, WorldSnapshot };
