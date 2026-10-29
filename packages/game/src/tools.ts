import { ActionError, PLAYER_NAME, World } from '@listen-up/sim';
import type { BCommand, LevelDef, WaitCondition, WorldSnapshot } from '@listen-up/sim';
import type { ToolCall, ToolDefinition, ToolExecution } from '@listen-up/agent';
import type { RuleStore } from './rules';
import type { StandingRule } from './types';
import { formatObservation } from './observation';

interface ToolHost {
  world: World;
  rules: RuleStore;
  onRulesChanged: (rules: StandingRule[]) => void;
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

function parseArgs(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {};
  const value = JSON.parse(raw) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('参数必须是一个 JSON 对象。');
  return value as Record<string, unknown>;
}

function anchorList(level: LevelDef): string[] {
  return [...level.props.map((prop) => prop.id), ...level.zones.map((zone) => zone.id)];
}

function leverList(level: LevelDef): string[] {
  return level.props.filter((prop) => prop.kind === 'lever').map((prop) => prop.id);
}

function crateList(level: LevelDef): string[] {
  return level.props.filter((prop) => prop.kind === 'crate').map((prop) => prop.id);
}

function labelOf(level: LevelDef, id: string): string {
  if (id === 'player') return `${PLAYER_NAME} 附近`;
  const prop = level.props.find((entry) => entry.id === id);
  if (prop) return prop.label;
  const zone = level.zones.find((entry) => entry.id === id);
  return zone?.label ?? id;
}

function resolveId(level: LevelDef, value: string, allowed: string[]): string | undefined {
  if (allowed.includes(value)) return value;
  const prop = level.props.find(
    (entry) => entry.id === value || entry.label === value || (entry.aliases ?? []).includes(value),
  );
  if (prop && allowed.includes(prop.id)) return prop.id;
  const zone = level.zones.find(
    (entry) => entry.id === value || entry.label === value || (entry.aliases ?? []).includes(value),
  );
  if (zone && allowed.includes(zone.id)) return zone.id;
  return undefined;
}

function conditionFrom(
  args: Record<string, unknown>,
  level: LevelDef,
  anchors: string[],
): WaitCondition {
  const kind = args.kind;
  const targetValue = args.target;
  if (typeof kind !== 'string') throw new Error('条件缺少 kind。');
  if (typeof targetValue !== 'string') throw new Error('条件缺少 target。');
  const target = resolveId(level, targetValue, anchors);
  if (!target) throw new Error(`条件目标 ${targetValue} 不存在。可用目标：${anchors.join('、')}。`);
  if (kind === 'player_on') return { kind: 'player_on', target };
  if (kind === 'player_near') {
    const maxDistance = typeof args.maxDistance === 'number' ? args.maxDistance : undefined;
    return { kind: 'player_near', target, ...(maxDistance === undefined ? {} : { maxDistance }) };
  }
  if (kind === 'object_state') {
    const state = args.state;
    if (
      state !== 'open' &&
      state !== 'closed' &&
      state !== 'pressed' &&
      state !== 'unpressed' &&
      state !== 'on' &&
      state !== 'off'
    ) {
      throw new Error('object_state 的 state 必须是 open/closed/pressed/unpressed/on/off。');
    }
    return { kind: 'object_state', target, state };
  }
  if (kind === 'hazard_state') {
    const state = args.state;
    if (state !== 'safe' && state !== 'warning' && state !== 'active')
      throw new Error('hazard_state 的 state 必须是 safe/warning/active。');
    return { kind: 'hazard_state', target, state };
  }
  throw new Error('未知的等待条件 kind。');
}

function toolNames(level: LevelDef): { anchors: string[]; levers: string[]; crates: string[] } {
  return { anchors: anchorList(level), levers: leverList(level), crates: crateList(level) };
}

export function buildToolDefinitions(level: LevelDef): ToolDefinition[] {
  const { anchors, levers, crates } = toolNames(level);
  const moveTargets = [...anchors, 'player'];
  const definitions: ToolDefinition[] = [
    {
      name: 'observe',
      description: '重新查看当前场景。通常不需要调用；每个动作的结果里已经带有最新观察。',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
      name: 'move_to',
      description:
        '走到一个锚点附近。引擎会自动寻路、绕过静态障碍；门或桥需要先打开。target 使用观察里的 id 或中文标签。',
      parameters: {
        type: 'object',
        properties: {
          target: {
            type: 'string',
            enum: moveTargets,
            description: `目标锚点 id；player 表示 ${PLAYER_NAME} 附近。`,
          },
        },
        required: ['target'],
        additionalProperties: false,
      },
    },
    {
      name: 'use',
      description: '走到拉杆旁边并操作它。压力板不需要 use，站上去即可。',
      parameters: {
        type: 'object',
        properties: { target: { type: 'string', enum: levers, description: '拉杆 id。' } },
        required: ['target'],
        additionalProperties: false,
      },
    },
    {
      name: 'push_box',
      description: `把木箱朝目标方向推。可以推下边缘；to 用锚点，player 表示推向 ${PLAYER_NAME} 附近。`,
      parameters: {
        type: 'object',
        properties: {
          box: { type: 'string', enum: crates, description: '木箱 id。' },
          to: { type: 'string', enum: moveTargets, description: '推动方向的目标锚点或 player。' },
        },
        required: ['box', 'to'],
        additionalProperties: false,
      },
    },
    {
      name: 'wait',
      description: '等待固定秒数，0.2 到 30 秒。用来卡节拍，不要用来轮询。',
      parameters: {
        type: 'object',
        properties: { seconds: { type: 'number', description: '等待秒数。' } },
        required: ['seconds'],
        additionalProperties: false,
      },
    },
    {
      name: 'wait_until',
      description: `等到一个机器可判定的条件成立。适合“等 ${PLAYER_NAME} 站上机关”“等门打开”“等红地板预警”。`,
      parameters: {
        type: 'object',
        properties: {
          condition: {
            type: 'object',
            properties: {
              kind: {
                type: 'string',
                enum: ['player_on', 'player_near', 'object_state', 'hazard_state'],
                description: '条件类型。',
              },
              target: { type: 'string', enum: anchors, description: '条件目标锚点。' },
              state: {
                type: 'string',
                enum: [
                  'open',
                  'closed',
                  'pressed',
                  'unpressed',
                  'on',
                  'off',
                  'safe',
                  'warning',
                  'active',
                ],
                description: 'object_state 或 hazard_state 的目标状态。',
              },
              maxDistance: { type: 'number', description: 'player_near 的距离，默认 2.5 米。' },
            },
            required: ['kind', 'target'],
            additionalProperties: false,
          },
          timeout_seconds: { type: 'number', description: '超时秒数，默认 90，最大 120。' },
        },
        required: ['condition'],
        additionalProperties: false,
      },
    },
    {
      name: 'remember_rule',
      description: '记住一条长期规则，例如“不要踩红地板”“待在机关上别动”。以后每次行动都会看到它。',
      parameters: {
        type: 'object',
        properties: { text: { type: 'string', description: '规则原文，最多 240 字。' } },
        required: ['text'],
        additionalProperties: false,
      },
    },
    {
      name: 'forget_rule',
      description: '删除一条已经记住的长期规则。',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: '规则 id，例如 rule_1。' } },
        required: ['id'],
        additionalProperties: false,
      },
    },
  ];
  return definitions.filter((definition) => {
    if (definition.name === 'use') return levers.length > 0;
    if (definition.name === 'push_box') return crates.length > 0;
    return true;
  });
}

export class ToolExecutor {
  private readonly host: ToolHost;
  private readonly level: LevelDef;
  private readonly anchors: string[];
  private readonly levers: string[];
  private readonly crates: string[];

  constructor(host: ToolHost) {
    this.host = host;
    this.level = host.world.level;
    const names = toolNames(this.level);
    this.anchors = names.anchors;
    this.levers = names.levers;
    this.crates = names.crates;
  }

  async execute(call: ToolCall, signal: AbortSignal): Promise<ToolExecution> {
    let args: Record<string, unknown>;
    try {
      args = parseArgs(call.function.arguments);
    } catch (error) {
      return this.failure(error instanceof Error ? error.message : '参数不是合法 JSON。');
    }

    try {
      switch (call.function.name) {
        case 'observe':
          return this.success('已重新观察场景。');
        case 'move_to': {
          const target = this.requireString(args, 'target');
          const resolved = resolveId(this.level, target, [...this.anchors, 'player']);
          if (!resolved)
            throw new Error(
              `目标 ${target} 不存在。可用目标：${[...this.anchors, 'player'].join('、')}。`,
            );
          return await this.action({ kind: 'move', target: resolved }, signal);
        }
        case 'use': {
          const target = this.requireString(args, 'target');
          const resolved = resolveId(this.level, target, this.levers);
          if (!resolved)
            throw new Error(`${target} 不是拉杆。可用拉杆：${this.levers.join('、')}。`);
          return await this.action({ kind: 'use', target: resolved }, signal);
        }
        case 'push_box': {
          const boxValue = this.requireString(args, 'box');
          const box = resolveId(this.level, boxValue, this.crates);
          if (!box) throw new Error(`${boxValue} 不是木箱。可用木箱：${this.crates.join('、')}。`);
          const toValue = this.requireString(args, 'to');
          const to = resolveId(this.level, toValue, [...this.anchors, 'player']);
          if (!to) throw new Error(`推动目标 ${toValue} 不存在。`);
          return await this.action({ kind: 'push', box, to }, signal);
        }
        case 'wait': {
          const seconds = this.requireNumber(args, 'seconds');
          if (seconds < 0.2 || seconds > 30) throw new Error('等待秒数必须在 0.2 到 30 之间。');
          return await this.action({ kind: 'wait', seconds }, signal);
        }
        case 'wait_until': {
          const rawCondition = args.condition;
          if (!rawCondition || typeof rawCondition !== 'object' || Array.isArray(rawCondition))
            throw new Error('wait_until 缺少 condition 对象。');
          const condition = conditionFrom(
            rawCondition as Record<string, unknown>,
            this.level,
            this.anchors,
          );
          const timeout =
            typeof args.timeout_seconds === 'number'
              ? Math.max(1, Math.min(120, args.timeout_seconds))
              : 90;
          return await this.action(
            { kind: 'wait_until', condition, timeoutSeconds: timeout },
            signal,
          );
        }
        case 'remember_rule': {
          const text = this.requireString(args, 'text');
          const rule = this.host.rules.add(text);
          this.host.onRulesChanged(this.host.rules.list());
          return this.success(`记住了规则 ${rule.id}：${rule.text}`);
        }
        case 'forget_rule': {
          const id = this.requireString(args, 'id');
          if (!this.host.rules.remove(id)) throw new Error(`没有找到规则 ${id}。`);
          this.host.onRulesChanged(this.host.rules.list());
          return this.success(`删除了规则 ${id}。`);
        }
        default:
          return this.failure(`未知工具 ${call.function.name}。`);
      }
    } catch (error) {
      if (error instanceof ActionError) return this.failure(error.message);
      return this.failure(error instanceof Error ? error.message : String(error));
    }
  }

  private async action(command: BCommand, signal: AbortSignal): Promise<ToolExecution> {
    try {
      const result = await this.host.world.startAction(command, signal);
      return this.success(result.message);
    } catch (error) {
      if (error instanceof ActionError) return this.failure(error.message);
      throw error;
    }
  }

  private requireString(args: Record<string, unknown>, key: string): string {
    const value = args[key];
    if (typeof value !== 'string' || value.trim().length === 0)
      throw new Error(`参数 ${key} 必须是非空字符串。`);
    return value.trim();
  }

  private requireNumber(args: Record<string, unknown>, key: string): number {
    const value = args[key];
    if (typeof value !== 'number' || !Number.isFinite(value))
      throw new Error(`参数 ${key} 必须是数字。`);
    return value;
  }

  private snapshot(): WorldSnapshot {
    return this.host.world.getSnapshot();
  }

  private observation(): string {
    return formatObservation(this.snapshot(), this.level);
  }

  private success(message: string): ToolExecution {
    return {
      ok: true,
      summary: message,
      content: json({ ok: true, message, observation: this.observation() }),
    };
  }

  private failure(message: string): ToolExecution {
    return {
      ok: false,
      summary: message,
      content: json({ ok: false, error: message, observation: this.observation() }),
    };
  }
}

export function humanizeToolName(name: string): string {
  switch (name) {
    case 'observe':
      return '观察';
    case 'move_to':
      return '移动';
    case 'use':
      return '操作';
    case 'push_box':
      return '推箱';
    case 'wait':
      return '等待';
    case 'wait_until':
      return '等待条件';
    case 'remember_rule':
      return '记住规则';
    case 'forget_rule':
      return '删除规则';
    default:
      return name;
  }
}

export function humanizeToolArgs(level: LevelDef, name: string, raw: string): string {
  try {
    const args = parseArgs(raw) as Record<string, unknown>;
    const target = typeof args.target === 'string' ? args.target : undefined;
    const box = typeof args.box === 'string' ? args.box : undefined;
    const to = typeof args.to === 'string' ? args.to : undefined;
    if (name === 'move_to' && target) return labelOf(level, target);
    if (name === 'use' && target) return labelOf(level, target);
    if (name === 'push_box' && box)
      return `${labelOf(level, box)} → ${to ? labelOf(level, to) : '?'}`;
    if (name === 'wait' && typeof args.seconds === 'number') return `${args.seconds} 秒`;
    if (name === 'wait_until' && args.condition && typeof args.condition === 'object') {
      const condition = args.condition as Record<string, unknown>;
      const targetLabel =
        typeof condition.target === 'string' ? labelOf(level, condition.target) : '?';
      const state = typeof condition.state === 'string' ? condition.state : '';
      return `${targetLabel} ${state}`;
    }
    if (name === 'remember_rule' && typeof args.text === 'string') return args.text;
    if (name === 'forget_rule' && typeof args.id === 'string') return args.id;
  } catch {
    return raw;
  }
  return raw;
}
