import type { AgentEvent, LlmClient } from '@listen-up/agent';
import { LlmError } from '@listen-up/agent';
import type { LevelDef, WorldEvent, WorldSnapshot } from '@listen-up/sim';
import { COMPANION_NAME, PLAYER_NAME, World } from '@listen-up/sim';
import type { AgentErrorInfo, GameUiState, StandingRule, ToolTrace } from './types';
import { RuleStore } from './rules';
import { formatSituation } from './observation';
import { buildToolDefinitions, humanizeToolArgs, humanizeToolName, ToolExecutor } from './tools';
import { TeammateRuntime } from './runtime';

const FIXED_STEP = 1 / 60;
const MAX_STEPS_PER_FRAME = 5;

export interface GameSessionOptions {
  level: LevelDef;
  client: LlmClient;
  model: string;
  temperature?: number;
  maxSteps?: number;
  now?: () => number;
}

interface QueuedInput {
  source: 'player' | 'world';
  text: string;
}

type Listener = () => void;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class GameSession {
  readonly world: World;
  readonly level: LevelDef;
  readonly rules = new RuleStore();
  private readonly options: GameSessionOptions;
  private readonly runtime: TeammateRuntime;
  private readonly executor: ToolExecutor;
  private readonly listeners = new Set<Listener>();
  private ui: GameUiState;
  private queue: QueuedInput[] = [];
  private worldNotes: string[] = [];
  private running = false;
  private activeAbort: AbortController | undefined;
  private scheduleTimer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;
  private accumulator = 0;
  private assistantTraceId: string | undefined;
  private readonly toolTraceIds = new Map<string, string>();
  private traceCounter = 0;
  private lastInput: string | undefined;

  constructor(options: GameSessionOptions) {
    this.options = options;
    this.level = options.level;
    this.world = new World(options.level);
    const onRulesChanged = (rules: StandingRule[]) => {
      this.setUi({ rules });
    };
    this.executor = new ToolExecutor({ world: this.world, rules: this.rules, onRulesChanged });
    this.ui = {
      levelId: options.level.id,
      status: 'playing',
      speech: '',
      speechStreaming: false,
      bStatus: '等你开口',
      rules: [],
      trace: [],
      turnActive: false,
      paused: false,
      promptTokens: 0,
      completionTokens: 0,
    };
    this.runtime = new TeammateRuntime({
      client: options.client,
      model: options.model,
      level: options.level,
      tools: buildToolDefinitions(options.level),
      temperature: options.temperature,
      maxSteps: options.maxSteps,
      executeTool: (call, signal) => this.executor.execute(call, signal),
      onEvent: (event) => this.handleAgentEvent(event),
    });
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getUiSnapshot = (): GameUiState => this.ui;

  getWorldSnapshot = (): WorldSnapshot => this.world.getSnapshot();

  setPlayerInput(input: { x: number; z: number; jump: boolean }): void {
    this.world.setPlayerInput(input);
  }

  interact(): string {
    return this.world.interactA();
  }

  setPaused(paused: boolean): void {
    if (this.ui.paused === paused) return;
    this.accumulator = 0;
    this.setUi({ paused });
  }

  say(text: string): void {
    const clean = text.trim();
    if (!clean || this.disposed || this.ui.status === 'won') return;
    this.lastInput = clean;
    this.setUi({ agentError: undefined, lastInput: clean });
    this.queue.push({ source: 'player', text: clean });
    this.activeAbort?.abort();
    this.schedule(80);
  }

  retry(): void {
    if (this.disposed || this.ui.status === 'won') return;
    const text = this.lastInput;
    if (!text) return;
    this.setUi({ agentError: undefined });
    this.queue.push({ source: 'player', text });
    this.activeAbort?.abort();
    this.schedule(80);
  }

  removeRule(id: string): void {
    const list = this.rules.list();
    const rule = list.find((entry) => entry.id === id);
    if (!rule) return;
    this.rules.remove(id);
    this.setUi({ rules: this.rules.list() });
    this.worldNotes.push(`${PLAYER_NAME} 撤销了长期规则：${rule.text}`);
  }

  tick(deltaSeconds: number): void {
    if (this.disposed || this.ui.paused || this.ui.status === 'won') return;
    this.accumulator += Math.min(Math.max(deltaSeconds, 0), 0.1);
    let steps = 0;
    while (this.accumulator >= FIXED_STEP && steps < MAX_STEPS_PER_FRAME) {
      this.world.step(FIXED_STEP);
      this.accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (steps > 0) this.consumeWorldEvents();
  }

  dispose(): void {
    this.disposed = true;
    if (this.scheduleTimer) clearTimeout(this.scheduleTimer);
    this.scheduleTimer = undefined;
    this.activeAbort?.abort();
    this.queue = [];
    this.listeners.clear();
  }

  private isWon(): boolean {
    return this.ui.status === 'won';
  }

  private schedule(ms: number): void {
    if (this.disposed || this.running || this.scheduleTimer) return;
    this.scheduleTimer = setTimeout(() => {
      this.scheduleTimer = undefined;
      void this.processQueue().catch((error) => {
        this.handleError(this.toAgentError(error));
      });
    }, ms);
  }

  private async processQueue(): Promise<void> {
    if (this.running || this.disposed || this.ui.status === 'won') return;
    this.running = true;
    try {
      while (this.queue.length > 0 && !this.disposed && !this.isWon()) {
        await delay(90);
        if (this.queue.length === 0 || this.disposed) break;
        const batch = this.queue.splice(0);
        const controller = new AbortController();
        this.activeAbort = controller;
        this.assistantTraceId = undefined;
        this.setUi({
          turnActive: true,
          bStatus: '正在思考',
          speech: '',
          speechStreaming: false,
          agentError: undefined,
        });
        const playerText = batch
          .filter((entry) => entry.source === 'player')
          .map((entry) => entry.text)
          .join('\n');
        const events = [
          ...this.worldNotes.splice(0),
          ...batch.filter((entry) => entry.source === 'world').map((entry) => entry.text),
        ];
        let situation: string;
        try {
          situation = formatSituation(this.world.getSnapshot(), this.level, this.rules.format(), {
            playerText: playerText || undefined,
            worldEvent: events.length > 0 ? events.join('\n') : undefined,
            bStatus: '正在思考',
          });
        } catch (error) {
          if (!controller.signal.aborted) this.handleError(this.toAgentError(error));
          continue;
        }
        try {
          const result = await this.runtime.runTurn(situation, controller.signal);
          if (!controller.signal.aborted && result.stopped === 'max-steps') {
            this.handleError({
              message: `${COMPANION_NAME} 想得有点久，先停下来了。可以再给一条更具体的指令。`,
              code: 'max-steps',
            });
          }
        } catch (error) {
          if (!controller.signal.aborted) this.handleError(this.toAgentError(error));
        } finally {
          if (this.activeAbort === controller) this.activeAbort = undefined;
          if (this.isWon()) {
            this.setUi({ turnActive: false, speechStreaming: false });
          } else {
            this.setUi({
              turnActive: false,
              speechStreaming: false,
              bStatus: this.ui.agentError
                ? this.ui.agentError.code === 'max-steps'
                  ? '停下'
                  : '连接失败'
                : '等你',
              promptTokens: this.runtime.usage.promptTokens ?? 0,
              completionTokens: this.runtime.usage.completionTokens ?? 0,
            });
          }
        }
      }
    } finally {
      this.running = false;
      if (this.queue.length > 0 && !this.disposed) this.schedule(80);
    }
  }

  private handleAgentEvent(event: AgentEvent): void {
    if (this.disposed) return;
    switch (event.type) {
      case 'assistant_delta': {
        const current = this.ui.speech;
        this.setUi({ speech: current + event.text, speechStreaming: true, bStatus: '正在思考' });
        if (!this.assistantTraceId) {
          this.assistantTraceId = this.addTrace({
            kind: 'assistant',
            title: `${COMPANION_NAME} 说`,
            text: event.text,
            status: 'running',
            at: this.now(),
          });
        } else {
          this.updateTrace(this.assistantTraceId, (entry) => ({
            ...entry,
            text: entry.text + event.text,
          }));
        }
        break;
      }
      case 'assistant_done': {
        if (event.text.trim().length > 0)
          this.setUi({ speech: event.text, speechStreaming: false });
        else this.setUi({ speechStreaming: false });
        if (this.assistantTraceId) {
          this.updateTrace(this.assistantTraceId, (entry) => ({
            ...entry,
            text: event.text || entry.text,
            status: 'done',
          }));
          this.assistantTraceId = undefined;
        }
        break;
      }
      case 'tool_started': {
        this.setUi({
          bStatus: `正在${humanizeToolName(event.name)}：${humanizeToolArgs(this.level, event.name, event.args)}`,
        });
        const traceId = this.addTrace({
          kind: 'tool',
          title: humanizeToolName(event.name),
          text: humanizeToolArgs(this.level, event.name, event.args),
          args: event.args,
          status: 'running',
          at: this.now(),
        });
        this.toolTraceIds.set(event.id, traceId);
        break;
      }
      case 'tool_finished': {
        const traceId = this.toolTraceIds.get(event.id);
        if (traceId) {
          this.updateTrace(traceId, (entry) => ({
            ...entry,
            status: event.ok ? 'done' : 'error',
            text: event.summary,
            durationMs: event.durationMs,
          }));
          this.toolTraceIds.delete(event.id);
        }
        this.setUi({ bStatus: '正在思考' });
        break;
      }
      case 'usage': {
        this.setUi({
          promptTokens: this.runtime.usage.promptTokens ?? 0,
          completionTokens: this.runtime.usage.completionTokens ?? 0,
        });
        break;
      }
      case 'error': {
        this.addTrace({
          kind: 'error',
          title: '请求重试',
          text: event.message,
          status: 'error',
          at: this.now(),
        });
        break;
      }
    }
  }

  private consumeWorldEvents(): void {
    const events = this.world.consumeEvents();
    for (const event of events) {
      if (event.kind === 'level_won') {
        this.finishWin();
        return;
      }
      if (event.kind === 'hazard_warning') {
        this.addTrace({
          kind: 'event',
          title: '危险预警',
          text: event.text,
          status: 'done',
          at: this.now(),
        });
        if (this.bNearHazard(event)) {
          this.queueWorld(event.text);
        }
        continue;
      }
      if (event.kind === 'hazard_hit_b') {
        this.addTrace({
          kind: 'event',
          title: `${COMPANION_NAME} 被击中`,
          text: event.text,
          status: 'error',
          at: this.now(),
        });
        if (!this.ui.turnActive) this.queueWorld(event.text);
        continue;
      }
      if (event.kind === 'character_respawned' && event.id === 'a') {
        this.worldNotes.push(event.text);
        continue;
      }
      if (event.kind === 'hazard_hit_a') {
        this.worldNotes.push(event.text);
      }
    }
  }

  private finishWin(): void {
    if (this.ui.status === 'won') return;
    this.activeAbort?.abort();
    this.queue = [];
    this.setUi({
      status: 'won',
      turnActive: false,
      speechStreaming: false,
      bStatus: '完成',
      speech: '到了。',
    });
  }

  private queueWorld(text: string): void {
    if (this.disposed || this.ui.status === 'won') return;
    this.queue.push({ source: 'world', text });
    this.activeAbort?.abort();
    this.schedule(50);
  }

  private bNearHazard(event: WorldEvent): boolean {
    const hazard = this.world
      .getSnapshot()
      .props.find((prop) => prop.id === event.id && prop.kind === 'hazard');
    if (!hazard) return false;
    const b = this.world.getSnapshot().b.pos;
    return Math.hypot(hazard.pos.x - b.x, hazard.pos.z - b.z) <= 7;
  }

  private toAgentError(error: unknown): AgentErrorInfo {
    if (error instanceof LlmError) return { message: error.message, code: error.code };
    if (error instanceof Error) return { message: error.message, code: 'unknown' };
    return { message: String(error), code: 'unknown' };
  }

  private handleError(info: AgentErrorInfo): void {
    this.setUi({ agentError: info, bStatus: info.code === 'max-steps' ? '停下' : '连接失败' });
    this.addTrace({
      kind: 'error',
      title: '模型连接失败',
      text: `${info.message}（${info.code}）`,
      status: 'error',
      at: this.now(),
    });
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private addTrace(entry: Omit<ToolTrace, 'id'> & { id?: string }): string {
    this.traceCounter += 1;
    const id = entry.id ?? `trace_${this.traceCounter}`;
    const trace = [...this.ui.trace, { ...entry, id }].slice(-120);
    this.setUi({ trace });
    return id;
  }

  private updateTrace(id: string, update: (entry: ToolTrace) => ToolTrace): void {
    let found = false;
    const trace = this.ui.trace.map((entry) => {
      if (entry.id !== id) return entry;
      found = true;
      return update(entry);
    });
    if (found) this.setUi({ trace });
  }

  private setUi(patch: Partial<GameUiState>): void {
    if (this.disposed) return;
    this.ui = { ...this.ui, ...patch };
    for (const listener of this.listeners) listener();
  }
}
