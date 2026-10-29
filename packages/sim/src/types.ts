export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Aabb {
  min: Vec3;
  max: Vec3;
}

export type BlockKind = 'grass' | 'grassLow' | 'stone' | 'wood';

export interface BlockSpec {
  at: Vec3;
  size: Vec3;
  kind?: BlockKind;
}

export interface DecorSpec {
  id: string;
  model: string;
  at: Vec3;
  scale?: number;
  rotation?: number;
}

export interface ZoneSpec {
  id: string;
  label: string;
  aliases?: string[];
  at: Vec3;
}

interface PropBase {
  id: string;
  label: string;
  aliases?: string[];
  at: Vec3;
  size?: Vec3;
}

export type LevelProp =
  | (PropBase & { kind: 'crate' })
  | (PropBase & { kind: 'plate'; link: string })
  | (PropBase & { kind: 'lever'; link: string; initiallyOn?: boolean })
  | (PropBase & { kind: 'gate'; initiallyOpen?: boolean })
  | (PropBase & { kind: 'bridge'; initiallyOpen?: boolean })
  | (PropBase & { kind: 'hazard'; cycle: HazardCycle })
  | (PropBase & { kind: 'exit' });

export interface HazardCycle {
  warning: number;
  active: number;
  safe: number;
  offset?: number;
}

export interface LevelDef {
  id: string;
  name: string;
  summary: string;
  goal: string;
  spawns: { a: Vec3; b: Vec3 };
  blocks: BlockSpec[];
  props: LevelProp[];
  zones: ZoneSpec[];
  decor: DecorSpec[];
  cameraYaw?: number;
  briefing: string;
  hints: string[];
}

export type HazardPhase = 'safe' | 'warning' | 'active';

export interface CharacterSnapshot {
  id: 'a' | 'b';
  pos: Vec3;
  grounded: boolean;
  facing: number;
  speed: number;
  respawning: boolean;
}

export interface PropSnapshot {
  id: string;
  kind: LevelProp['kind'];
  label: string;
  pos: Vec3;
  size: Vec3;
  open?: boolean;
  pressed?: boolean;
  on?: boolean;
  phase?: HazardPhase;
  secondsUntilPhase?: number;
}

export interface AnchorSnapshot {
  id: string;
  label: string;
  aliases: string[];
  pos: Vec3;
  kind: string;
  reachable: boolean;
}

export interface RenderPropState {
  id: string;
  label: string;
  pos: Vec3;
  size: Vec3;
  open?: boolean;
  pressed?: boolean;
  on?: boolean;
  phase?: HazardPhase;
  secondsUntilPhase?: number;
}

export interface WorldRenderState {
  time: number;
  status: 'playing' | 'won';
  a: CharacterSnapshot;
  b: CharacterSnapshot;
  crates: RenderPropState[];
  gates: RenderPropState[];
  bridges: RenderPropState[];
  plates: RenderPropState[];
  levers: RenderPropState[];
  hazards: RenderPropState[];
  exits: RenderPropState[];
}

export interface WorldSnapshot {
  levelId: string;
  time: number;
  status: 'playing' | 'won';
  a: CharacterSnapshot;
  b: CharacterSnapshot;
  props: PropSnapshot[];
  anchors: AnchorSnapshot[];
  bridgeStates: Record<string, boolean>;
}

export type HazardStateCondition = 'safe' | 'warning' | 'active';

export type WaitCondition =
  | { kind: 'player_on'; target: string }
  | { kind: 'player_near'; target: string; maxDistance?: number }
  | {
      kind: 'object_state';
      target: string;
      state: 'open' | 'closed' | 'pressed' | 'unpressed' | 'on' | 'off';
    }
  | { kind: 'hazard_state'; target: string; state: HazardStateCondition };

export type BCommand =
  | { kind: 'move'; target: string }
  | { kind: 'use'; target: string }
  | { kind: 'push'; box: string; to: string }
  | { kind: 'wait'; seconds: number }
  | { kind: 'wait_until'; condition: WaitCondition; timeoutSeconds?: number };

export interface ActionResult {
  message: string;
  snapshot: WorldSnapshot;
}

export type WorldEventKind =
  | 'hazard_warning'
  | 'hazard_active'
  | 'hazard_hit_a'
  | 'hazard_hit_b'
  | 'character_respawned'
  | 'gate_changed'
  | 'bridge_changed'
  | 'level_won';

export interface WorldEvent {
  kind: WorldEventKind;
  id?: string;
  label?: string;
  text: string;
  at: number;
}

export class ActionError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ActionError';
    this.code = code;
  }
}
