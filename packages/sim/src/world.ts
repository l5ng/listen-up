import {
  aabbFromMinSize,
  characterAabb,
  clamp,
  distanceXZ,
  moveToward,
  overlaps,
} from './geometry';
import type {
  Aabb,
  ActionResult,
  BCommand,
  BlockSpec,
  CharacterSnapshot,
  HazardCycle,
  HazardPhase,
  LevelDef,
  LevelProp,
  PropSnapshot,
  Vec3,
  WaitCondition,
  WorldRenderState,
  WorldEvent,
  WorldSnapshot,
} from './types';
import { ActionError } from './types';
import { COMPANION_NAME, PLAYER_NAME } from './names';
import { NavGrid } from './nav';

const GRAVITY = 18;
const JUMP_SPEED = 7.2;
const RADIUS = 0.34;
const HEIGHT = 1.6;
const PLAYER_SPEED = 4.8;
const B_SPEED = 4.1;
/** The glowing ring around an exit; the character's body may overlap its rim. */
export const EXIT_ZONE_RADIUS = 1.15;
const EXIT_TRIGGER_RADIUS = EXIT_ZONE_RADIUS + RADIUS;
const EXIT_ZONE_LEVEL_TOLERANCE = 1.2;
const MAX_STEP_TIME = 60;
const EPS = 1e-5;

interface Character {
  id: 'a' | 'b';
  pos: Vec3;
  vel: Vec3;
  grounded: boolean;
  facing: number;
  jumpBuffer: number;
  coyote: number;
  lastSafe: Vec3;
  respawnCooldown: number;
  lastSafeTimer: number;
  speed: number;
}

interface CrateState {
  id: string;
  label: string;
  size: Vec3;
  pos: Vec3;
  initial: Vec3;
  vy: number;
  grounded: boolean;
  tween?: {
    fromX: number;
    fromZ: number;
    toX: number;
    toZ: number;
    elapsed: number;
    duration: number;
  };
}

interface GateState {
  id: string;
  label: string;
  aabb: Aabb;
  initialOpen: boolean;
  open: boolean;
}

interface BridgeState {
  id: string;
  label: string;
  aabb: Aabb;
  initialOpen: boolean;
  open: boolean;
}

interface PlateState {
  id: string;
  label: string;
  aabb: Aabb;
  link: string;
  pressed: boolean;
}

interface LeverState {
  id: string;
  label: string;
  aabb: Aabb;
  link: string;
  on: boolean;
}

interface HazardState {
  id: string;
  label: string;
  aabb: Aabb;
  cycle: HazardCycle;
  phase: HazardPhase;
  secondsUntilPhase: number;
  lastPhase?: HazardPhase;
}

interface ExitState {
  id: string;
  label: string;
  aabb: Aabb;
}

interface AnchorInternal {
  id: string;
  label: string;
  aliases: string[];
  pos: Vec3;
  kind: string;
}

interface Collider {
  aabb: Aabb;
  kind: 'block' | 'gate' | 'bridge' | 'crate';
  id?: string;
}

interface PendingAction {
  command: BCommand;
  resolve: (result: ActionResult) => void;
  reject: (error: Error) => void;
  path: Vec3[];
  pathIndex: number;
  startedAt: number;
  deadline: number;
  lastPos: Vec3;
  lastMoveAt: number;
  waitRemaining?: number;
  waitCondition?: WaitCondition;
  waitTimeout?: number;
  push?: {
    boxId: string;
    toId: string;
    dir: Vec3;
    distance: number;
    phase: 'approach' | 'push';
    startedAt: number;
  };
  phase: 'path' | 'act' | 'settle';
}

interface PlayerInput {
  x: number;
  z: number;
  jump: boolean;
}

function cloneVec(v: Vec3): Vec3 {
  return { x: v.x, y: v.y, z: v.z };
}

function centerXZ(a: Aabb): Vec3 {
  return { x: (a.min.x + a.max.x) / 2, y: a.min.y, z: (a.min.z + a.max.z) / 2 };
}

function propSize(prop: LevelProp): Vec3 {
  if (prop.size) return prop.size;
  switch (prop.kind) {
    case 'crate':
      return { x: 1, y: 1, z: 1 };
    case 'plate':
      return { x: 1, y: 0.1, z: 1 };
    case 'lever':
      return { x: 0.6, y: 1.2, z: 0.6 };
    case 'gate':
      return { x: 0.4, y: 2.6, z: 1 };
    case 'bridge':
      return { x: 1, y: 0.15, z: 1 };
    case 'hazard':
      return { x: 1, y: 0.1, z: 1 };
    case 'exit':
      return { x: 1.2, y: 1.2, z: 1.2 };
  }
}

function propAabb(prop: LevelProp): Aabb {
  return aabbFromMinSize(prop.at, propSize(prop));
}

export class World {
  readonly level: LevelDef;
  time = 0;
  status: 'playing' | 'won' = 'playing';
  a: Character;
  b: Character;
  private inputA: PlayerInput = { x: 0, z: 0, jump: false };
  private prevJump = false;
  private actionInput: PlayerInput = { x: 0, z: 0, jump: false };
  private crates = new Map<string, CrateState>();
  private gates = new Map<string, GateState>();
  private bridges = new Map<string, BridgeState>();
  private plates = new Map<string, PlateState>();
  private levers = new Map<string, LeverState>();
  private hazards = new Map<string, HazardState>();
  private exits = new Map<string, ExitState>();
  private propsById = new Map<string, LevelProp>();
  private anchors = new Map<string, AnchorInternal>();
  private events: WorldEvent[] = [];
  private pending: PendingAction | undefined;
  private nav: NavGrid | undefined;
  private navDirty = true;
  private colliderCache: Collider[] = [];
  private hazardCooldowns = new Map<string, number>();
  private staticBlocks: BlockSpec[];
  private staticBlockAabbs: Aabb[];

  constructor(level: LevelDef) {
    this.level = level;
    this.staticBlocks = level.blocks;
    this.staticBlockAabbs = level.blocks.map((block) => aabbFromMinSize(block.at, block.size));
    this.a = this.makeCharacter('a', level.spawns.a);
    this.b = this.makeCharacter('b', level.spawns.b);

    for (const prop of level.props) {
      this.propsById.set(prop.id, prop);
      const size = propSize(prop);
      const aabb = aabbFromMinSize(prop.at, size);
      switch (prop.kind) {
        case 'crate':
          this.crates.set(prop.id, {
            id: prop.id,
            label: prop.label,
            size,
            pos: { x: prop.at.x + size.x / 2, y: prop.at.y, z: prop.at.z + size.z / 2 },
            initial: { x: prop.at.x + size.x / 2, y: prop.at.y, z: prop.at.z + size.z / 2 },
            vy: 0,
            grounded: false,
          });
          break;
        case 'gate':
          this.gates.set(prop.id, {
            id: prop.id,
            label: prop.label,
            aabb,
            initialOpen: prop.initiallyOpen ?? false,
            open: prop.initiallyOpen ?? false,
          });
          break;
        case 'bridge':
          this.bridges.set(prop.id, {
            id: prop.id,
            label: prop.label,
            aabb,
            initialOpen: prop.initiallyOpen ?? false,
            open: prop.initiallyOpen ?? false,
          });
          break;
        case 'plate':
          this.plates.set(prop.id, {
            id: prop.id,
            label: prop.label,
            aabb,
            link: prop.link,
            pressed: false,
          });
          break;
        case 'lever':
          this.levers.set(prop.id, {
            id: prop.id,
            label: prop.label,
            aabb,
            link: prop.link,
            on: prop.initiallyOn ?? false,
          });
          break;
        case 'hazard':
          this.hazards.set(prop.id, {
            id: prop.id,
            label: prop.label,
            aabb,
            cycle: prop.cycle,
            phase: 'safe',
            secondsUntilPhase: 0,
          });
          break;
        case 'exit':
          this.exits.set(prop.id, { id: prop.id, label: prop.label, aabb });
          break;
      }
      this.anchors.set(prop.id, {
        id: prop.id,
        label: prop.label,
        aliases: prop.aliases ?? [],
        pos:
          prop.kind === 'crate'
            ? { x: prop.at.x + size.x / 2, y: prop.at.y, z: prop.at.z + size.z / 2 }
            : { x: prop.at.x + size.x / 2, y: prop.at.y, z: prop.at.z + size.z / 2 },
        kind: prop.kind,
      });
    }

    for (const zone of level.zones) {
      this.anchors.set(zone.id, {
        id: zone.id,
        label: zone.label,
        aliases: zone.aliases ?? [],
        pos: cloneVec(zone.at),
        kind: 'zone',
      });
    }

    this.updateHazards();
    this.updateLinks();
    this.ensureNav();
  }

  private makeCharacter(id: 'a' | 'b', spawn: Vec3): Character {
    return {
      id,
      pos: cloneVec(spawn),
      vel: { x: 0, y: 0, z: 0 },
      grounded: false,
      facing: 0,
      jumpBuffer: 0,
      coyote: 0,
      lastSafe: cloneVec(spawn),
      respawnCooldown: 0,
      lastSafeTimer: 0,
      speed: 0,
    };
  }

  setPlayerInput(input: PlayerInput): void {
    const magnitude = Math.hypot(input.x, input.z);
    this.inputA = {
      x: magnitude > 1 ? input.x / magnitude : input.x,
      z: magnitude > 1 ? input.z / magnitude : input.z,
      jump: input.jump,
    };
    if (input.jump && !this.prevJump) this.a.jumpBuffer = 0.12;
    this.prevJump = input.jump;
  }

  get levelId(): string {
    return this.level.id;
  }

  get snapshot(): WorldSnapshot {
    return this.getSnapshot();
  }

  step(dt: number): void {
    if (this.status !== 'playing') return;
    const fixed = clamp(dt, 0, 0.05);
    this.time += fixed;
    this.updateHazards();
    this.updateLinks();
    this.actionInput = { x: 0, z: 0, jump: false };
    this.updateBAction(fixed);
    this.colliderCache = this.buildColliders();
    this.updateCharacter(this.a, this.inputA, fixed);
    this.updateCharacter(this.b, this.actionInput, fixed);
    this.updateCrates(fixed);
    this.updateLinks();
    this.updateLastSafe(fixed);
    this.checkHazards();
    this.checkWin();
  }

  private buildColliders(): Collider[] {
    const list: Collider[] = [];
    for (let i = 0; i < this.staticBlocks.length; i += 1) {
      const aabb = this.staticBlockAabbs[i];
      if (aabb) list.push({ aabb, kind: 'block' });
    }
    for (const gate of this.gates.values()) {
      if (!gate.open) list.push({ aabb: gate.aabb, kind: 'gate', id: gate.id });
    }
    for (const bridge of this.bridges.values()) {
      if (bridge.open) list.push({ aabb: bridge.aabb, kind: 'bridge', id: bridge.id });
    }
    for (const crate of this.crates.values()) {
      list.push({
        aabb: aabbFromMinSize(
          { x: crate.pos.x - crate.size.x / 2, y: crate.pos.y, z: crate.pos.z - crate.size.z / 2 },
          crate.size,
        ),
        kind: 'crate',
        id: crate.id,
      });
    }
    return list;
  }

  private updateCharacter(char: Character, input: PlayerInput, dt: number): void {
    if (char.respawnCooldown > 0) {
      char.respawnCooldown = Math.max(0, char.respawnCooldown - dt);
      input = { x: 0, z: 0, jump: false };
    }
    const speed = char.id === 'a' ? PLAYER_SPEED : B_SPEED;
    const targetX = input.x * speed;
    const targetZ = input.z * speed;
    const accel = char.grounded ? 38 : 16;
    char.vel.x = moveToward(char.vel.x, targetX, accel * dt);
    char.vel.z = moveToward(char.vel.z, targetZ, accel * dt);
    if (!input.jump && char.id === 'b') char.jumpBuffer = 0;

    if (char.grounded) char.coyote = 0.11;
    else char.coyote = Math.max(0, char.coyote - dt);
    if (char.jumpBuffer > 0 && char.coyote > 0 && char.respawnCooldown <= 0) {
      char.vel.y = JUMP_SPEED;
      char.grounded = false;
      char.coyote = 0;
      char.jumpBuffer = 0;
    }
    char.jumpBuffer = Math.max(0, char.jumpBuffer - dt);

    char.vel.y -= GRAVITY * dt;
    if (char.vel.y < -24) char.vel.y = -24;

    this.moveCharacterX(char, dt);
    this.moveCharacterZ(char, dt);
    this.moveCharacterY(char, dt);

    char.speed = Math.hypot(char.vel.x, char.vel.z);
    if (char.speed > 0.2) char.facing = Math.atan2(char.vel.x, char.vel.z);
    if (char.pos.y < -8) {
      this.respawnCharacter(char, '掉出了浮岛。');
    }
  }

  private moveCharacterX(char: Character, dt: number): void {
    const dx = char.vel.x * dt;
    if (Math.abs(dx) < EPS) return;
    char.pos.x += dx;
    const body = characterAabb(char.pos, RADIUS, HEIGHT);
    for (const collider of this.colliderCache) {
      if (!overlaps(body, collider.aabb)) continue;
      if (dx > 0) char.pos.x = Math.min(char.pos.x, collider.aabb.min.x - RADIUS - EPS);
      else char.pos.x = Math.max(char.pos.x, collider.aabb.max.x + RADIUS + EPS);
      char.vel.x = 0;
      const updated = characterAabb(char.pos, RADIUS, HEIGHT);
      Object.assign(body, updated);
    }
  }

  private moveCharacterZ(char: Character, dt: number): void {
    const dz = char.vel.z * dt;
    if (Math.abs(dz) < EPS) return;
    char.pos.z += dz;
    const body = characterAabb(char.pos, RADIUS, HEIGHT);
    for (const collider of this.colliderCache) {
      if (!overlaps(body, collider.aabb)) continue;
      if (dz > 0) char.pos.z = Math.min(char.pos.z, collider.aabb.min.z - RADIUS - EPS);
      else char.pos.z = Math.max(char.pos.z, collider.aabb.max.z + RADIUS + EPS);
      char.vel.z = 0;
      const updated = characterAabb(char.pos, RADIUS, HEIGHT);
      Object.assign(body, updated);
    }
  }

  private moveCharacterY(char: Character, dt: number): void {
    const dy = char.vel.y * dt;
    if (Math.abs(dy) < EPS) return;
    char.pos.y += dy;
    const body = characterAabb(char.pos, RADIUS, HEIGHT);
    char.grounded = false;
    for (const collider of this.colliderCache) {
      if (!overlaps(body, collider.aabb)) continue;
      if (dy < 0) {
        char.pos.y = Math.max(char.pos.y, collider.aabb.max.y);
        char.vel.y = 0;
        char.grounded = true;
      } else if (dy > 0) {
        char.pos.y = Math.min(char.pos.y, collider.aabb.min.y - HEIGHT - EPS);
        char.vel.y = 0;
      }
      const updated = characterAabb(char.pos, RADIUS, HEIGHT);
      Object.assign(body, updated);
    }
  }

  private updateCrates(dt: number): void {
    for (const crate of this.crates.values()) {
      if (crate.tween) {
        crate.tween.elapsed += dt;
        const t = Math.min(1, crate.tween.elapsed / crate.tween.duration);
        crate.pos.x = crate.tween.fromX + (crate.tween.toX - crate.tween.fromX) * t;
        crate.pos.z = crate.tween.fromZ + (crate.tween.toZ - crate.tween.fromZ) * t;
        if (t >= 1) {
          crate.tween = undefined;
          crate.vy = 0;
          crate.grounded = false;
        }
        this.navDirty = true;
        continue;
      }
      crate.vy -= GRAVITY * dt;
      if (crate.vy < -24) crate.vy = -24;
      const dy = crate.vy * dt;
      if (Math.abs(dy) < EPS) continue;
      crate.pos.y += dy;
      crate.grounded = false;
      const body = aabbFromMinSize(
        { x: crate.pos.x - crate.size.x / 2, y: crate.pos.y, z: crate.pos.z - crate.size.z / 2 },
        crate.size,
      );
      for (const collider of this.colliderCache) {
        if (collider.kind === 'crate') continue;
        if (!overlaps(body, collider.aabb)) continue;
        if (dy < 0) {
          crate.pos.y = Math.max(crate.pos.y, collider.aabb.max.y);
          crate.vy = 0;
          crate.grounded = true;
        } else if (dy > 0) {
          crate.pos.y = Math.min(crate.pos.y, collider.aabb.min.y - crate.size.y - EPS);
          crate.vy = 0;
        }
        const moved = aabbFromMinSize(
          { x: crate.pos.x - crate.size.x / 2, y: crate.pos.y, z: crate.pos.z - crate.size.z / 2 },
          crate.size,
        );
        Object.assign(body, moved);
      }
      if (crate.pos.y < -8) {
        crate.pos = cloneVec(crate.initial);
        crate.vy = 0;
        crate.grounded = false;
      }
      if (dy !== 0) this.navDirty = true;
    }
  }

  private updateLinks(): void {
    const openGates = new Map<string, boolean>();
    const openBridges = new Map<string, boolean>();
    for (const gate of this.gates.values()) openGates.set(gate.id, gate.initialOpen);
    for (const bridge of this.bridges.values()) openBridges.set(bridge.id, bridge.initialOpen);

    for (const plate of this.plates.values()) {
      const pressed = this.isPlatePressed(plate);
      plate.pressed = pressed;
      if (pressed && this.gates.has(plate.link)) openGates.set(plate.link, true);
      if (pressed && this.bridges.has(plate.link)) openBridges.set(plate.link, true);
    }
    for (const lever of this.levers.values()) {
      if (lever.on && this.gates.has(lever.link)) openGates.set(lever.link, true);
      if (lever.on && this.bridges.has(lever.link)) openBridges.set(lever.link, true);
    }

    let changed = false;
    for (const gate of this.gates.values()) {
      const next = openGates.get(gate.id) ?? gate.initialOpen;
      if (next !== gate.open) {
        gate.open = next;
        changed = true;
        this.emit({
          kind: 'gate_changed',
          id: gate.id,
          label: gate.label,
          text: `${gate.label}${next ? '打开了' : '关闭了'}。`,
          at: this.time,
        });
      }
    }
    for (const bridge of this.bridges.values()) {
      const next = openBridges.get(bridge.id) ?? bridge.initialOpen;
      if (next !== bridge.open) {
        bridge.open = next;
        changed = true;
        this.emit({
          kind: 'bridge_changed',
          id: bridge.id,
          label: bridge.label,
          text: `${bridge.label}${next ? '展开了' : '收起了'}。`,
          at: this.time,
        });
      }
    }
    if (changed) this.navDirty = true;
  }

  private isPlatePressed(plate: PlateState): boolean {
    for (const char of [this.a, this.b]) {
      if (this.isCharacterOnAabb(char, plate.aabb, 0.12)) return true;
    }
    for (const crate of this.crates.values()) {
      const body = aabbFromMinSize(
        { x: crate.pos.x - crate.size.x / 2, y: crate.pos.y, z: crate.pos.z - crate.size.z / 2 },
        crate.size,
      );
      if (overlaps(body, plate.aabb)) return true;
    }
    return false;
  }

  private isCharacterOnAabb(char: Character, aabb: Aabb, margin = 0.05): boolean {
    return (
      char.pos.x >= aabb.min.x - margin &&
      char.pos.x <= aabb.max.x + margin &&
      char.pos.z >= aabb.min.z - margin &&
      char.pos.z <= aabb.max.z + margin &&
      char.pos.y >= aabb.min.y - 0.35 &&
      char.pos.y <= aabb.max.y + 0.5
    );
  }

  private updateHazards(): void {
    for (const hazard of this.hazards.values()) {
      const total = hazard.cycle.warning + hazard.cycle.active + hazard.cycle.safe;
      const phaseTime = (this.time + (hazard.cycle.offset ?? 0)) % total;
      let phase: HazardPhase;
      let secondsUntilPhase: number;
      if (phaseTime < hazard.cycle.warning) {
        phase = 'warning';
        secondsUntilPhase = hazard.cycle.warning - phaseTime;
      } else if (phaseTime < hazard.cycle.warning + hazard.cycle.active) {
        phase = 'active';
        secondsUntilPhase = hazard.cycle.warning + hazard.cycle.active - phaseTime;
      } else {
        phase = 'safe';
        secondsUntilPhase = total - phaseTime;
      }
      hazard.phase = phase;
      hazard.secondsUntilPhase = secondsUntilPhase;
      if (hazard.lastPhase !== phase) {
        if (phase === 'warning') {
          this.emit({
            kind: 'hazard_warning',
            id: hazard.id,
            label: hazard.label,
            text: `${hazard.label}开始发红，大约 ${Math.max(1, Math.round(secondsUntilPhase))} 秒后喷发。`,
            at: this.time,
          });
        } else if (phase === 'active') {
          this.emit({
            kind: 'hazard_active',
            id: hazard.id,
            label: hazard.label,
            text: `${hazard.label}喷发了。`,
            at: this.time,
          });
        }
        hazard.lastPhase = phase;
      }
    }
  }

  private checkHazards(): void {
    for (const hazard of this.hazards.values()) {
      if (hazard.phase !== 'active') continue;
      for (const char of [this.a, this.b]) {
        const cooldown = this.hazardCooldowns.get(`${hazard.id}:${char.id}`) ?? 0;
        if (this.time < cooldown) continue;
        const body = characterAabb(char.pos, RADIUS, HEIGHT);
        if (!overlaps(body, hazard.aabb)) continue;
        this.hazardCooldowns.set(`${hazard.id}:${char.id}`, this.time + 1.2);
        const wasB = char.id === 'b';
        this.respawnCharacter(
          char,
          `${hazard.label}喷发，${char.id === 'a' ? PLAYER_NAME : COMPANION_NAME}回到了安全位置。`,
        );
        this.emit({
          kind: wasB ? 'hazard_hit_b' : 'hazard_hit_a',
          id: hazard.id,
          label: hazard.label,
          text: `${char.id === 'a' ? PLAYER_NAME : COMPANION_NAME}被${hazard.label}击中，回到了安全位置。`,
          at: this.time,
        });
      }
    }
  }

  private updateLastSafe(dt: number): void {
    for (const char of [this.a, this.b]) {
      char.lastSafeTimer += dt;
      if (char.lastSafeTimer < 0.3) continue;
      char.lastSafeTimer = 0;
      if (!char.grounded || char.respawnCooldown > 0) continue;
      if (this.isInHazardArea(char)) continue;
      const support = this.supportKindAt(char.pos);
      if (support === 'block') char.lastSafe = cloneVec(char.pos);
    }
  }

  private supportKindAt(pos: Vec3): Collider['kind'] | undefined {
    for (const collider of this.colliderCache) {
      if (Math.abs(collider.aabb.max.y - pos.y) > 0.08) continue;
      if (
        pos.x >= collider.aabb.min.x - RADIUS &&
        pos.x <= collider.aabb.max.x + RADIUS &&
        pos.z >= collider.aabb.min.z - RADIUS &&
        pos.z <= collider.aabb.max.z + RADIUS
      ) {
        return collider.kind;
      }
    }
    return undefined;
  }

  private isInHazardArea(char: Character): boolean {
    const body = characterAabb(char.pos, RADIUS, HEIGHT);
    for (const hazard of this.hazards.values()) {
      if (overlaps(body, hazard.aabb)) return true;
    }
    return false;
  }

  private respawnCharacter(char: Character, reason: string): void {
    char.pos = cloneVec(char.lastSafe);
    char.vel = { x: 0, y: 0, z: 0 };
    char.grounded = false;
    char.respawnCooldown = 0.7;
    char.jumpBuffer = 0;
    if (char.id === 'b') this.failAction('CANCELLED', reason);
    this.emit({
      kind: 'character_respawned',
      id: char.id,
      text: `${char.id === 'a' ? PLAYER_NAME : COMPANION_NAME}回到了安全位置。`,
      at: this.time,
    });
  }

  interactA(): string {
    for (const lever of this.levers.values()) {
      const distance = distanceXZ(this.a.pos, centerXZ(lever.aabb));
      if (distance <= 1.7 && Math.abs(this.a.pos.y - lever.aabb.min.y) < 1.4) {
        lever.on = !lever.on;
        this.navDirty = true;
        this.updateLinks();
        return `你${lever.on ? '拉下' : '拉起'}了${lever.label}。`;
      }
    }
    return '附近没有可以操作的东西。';
  }

  private ensureNav(): void {
    if (!this.nav || this.navDirty) {
      const solid = this.buildColliders().filter((collider) => collider.kind !== 'bridge');
      this.nav = NavGrid.bake({
        blocks: this.level.blocks,
        bridges: [...this.bridges.values()].map((bridge) => ({
          aabb: bridge.aabb,
          open: bridge.open,
        })),
        solidColliders: solid.map((collider) => collider.aabb),
        radius: RADIUS,
        height: HEIGHT,
      });
      this.navDirty = false;
    }
  }

  private getNav(): NavGrid {
    this.ensureNav();
    return this.nav as NavGrid;
  }

  private anchorPosition(id: string): Vec3 | undefined {
    if (id === 'player') return cloneVec(this.a.pos);
    const crate = this.crates.get(id);
    if (crate) return cloneVec(crate.pos);
    return this.anchors.get(id)?.pos;
  }

  private anchorLabel(id: string): string {
    if (id === 'player') return PLAYER_NAME;
    return this.anchors.get(id)?.label ?? id;
  }

  private noPathMessage(targetId: string): string {
    const label = this.anchorLabel(targetId);
    const closedBridge = this.bridges.get(targetId);
    if (closedBridge && !closedBridge.open) return `${label}现在是收起的。需要先让机关保持被踩住。`;
    const closedGate = this.gates.get(targetId);
    if (closedGate && !closedGate.open) return `${label}现在是关闭的。需要先让机关保持被踩住。`;
    for (const gateEntry of this.gates.values()) {
      if (!gateEntry.open)
        return `没有可行路线到${label}。${gateEntry.label}关着，可能要先打开它。`;
    }
    for (const bridgeEntry of this.bridges.values()) {
      if (!bridgeEntry.open)
        return `没有可行路线到${label}。${bridgeEntry.label}收起了，可能需要先踩住机关。`;
    }
    return `没有可行路线到${label}。可能有缺口、高差或障碍挡住了。`;
  }

  startAction(command: BCommand, signal?: AbortSignal): Promise<ActionResult> {
    if (this.status === 'won') return Promise.reject(new ActionError('WON', '关卡已经结束。'));
    if (this.pending)
      return Promise.reject(new ActionError('BUSY', `${COMPANION_NAME} 正在执行另一个动作。`));
    if (signal?.aborted) return Promise.reject(new ActionError('CANCELLED', '动作被取消了。'));

    return new Promise<ActionResult>((resolve, reject) => {
      const pending: PendingAction = {
        command,
        resolve,
        reject,
        path: [],
        pathIndex: 0,
        startedAt: this.time,
        deadline: this.time + MAX_STEP_TIME,
        lastPos: cloneVec(this.b.pos),
        lastMoveAt: this.time,
        phase: 'path',
      };
      this.pending = pending;
      try {
        this.planAction(pending);
      } catch (error) {
        this.pending = undefined;
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      if (signal) {
        signal.addEventListener(
          'abort',
          () => {
            if (this.pending === pending) this.failAction('CANCELLED', '动作被新的指令打断。');
          },
          { once: true },
        );
      }
    });
  }

  cancelAction(reason = '动作被取消了。'): void {
    this.failAction('CANCELLED', reason);
  }

  private planAction(pending: PendingAction): void {
    const command = pending.command;
    switch (command.kind) {
      case 'wait': {
        const seconds = clamp(command.seconds, 0.2, 30);
        pending.waitRemaining = seconds;
        pending.deadline = this.time + seconds + 2;
        return;
      }
      case 'wait_until': {
        const timeout = clamp(command.timeoutSeconds ?? 90, 1, 120);
        if (!this.conditionTargetExists(command.condition))
          throw new ActionError('BAD_TARGET', '等待条件里的目标不存在。');
        pending.waitCondition = command.condition;
        pending.waitTimeout = timeout;
        pending.deadline = this.time + timeout + 1;
        return;
      }
      case 'move': {
        const target = this.anchorPosition(command.target);
        if (!target) throw new ActionError('BAD_TARGET', `目标 ${command.target} 不存在。`);
        const closedBridge = this.bridges.get(command.target);
        if (closedBridge && !closedBridge.open) {
          throw new ActionError('NO_PATH', `桥 ${closedBridge.label} 现在是收起的，过不去。`);
        }
        const closedGate = this.gates.get(command.target);
        if (closedGate && !closedGate.open) {
          throw new ActionError('NO_PATH', `闸门 ${closedGate.label} 现在是关闭的，过不去。`);
        }
        const goalRadius = this.exits.has(command.target) ? 0.8 : 1.25;
        const result = this.getNav().findPath(this.b.pos, target, goalRadius);
        if (!result) throw new ActionError('NO_PATH', this.noPathMessage(command.target));
        pending.path = result.path.map((node) => ({ x: node.x + 0.5, y: node.y, z: node.z + 0.5 }));
        if (pending.path.length === 0) {
          pending.phase = 'act';
        }
        return;
      }
      case 'use': {
        const lever = this.levers.get(command.target);
        if (!lever) throw new ActionError('BAD_TARGET', `${command.target} 不是可以操作的拉杆。`);
        const target = centerXZ(lever.aabb);
        const result = this.getNav().findPath(this.b.pos, target, 1.6);
        if (!result) throw new ActionError('NO_PATH', this.noPathMessage(command.target));
        pending.path = result.path.map((node) => ({ x: node.x + 0.5, y: node.y, z: node.z + 0.5 }));
        pending.phase = 'path';
        return;
      }
      case 'push': {
        const box = this.crates.get(command.box);
        if (!box) throw new ActionError('BAD_TARGET', `${command.box} 不是可以推动的箱子。`);
        const to = this.anchorPosition(command.to);
        if (!to) throw new ActionError('BAD_TARGET', `目标 ${command.to} 不存在。`);
        const rawX = to.x - box.pos.x;
        const rawZ = to.z - box.pos.z;
        let dir: Vec3;
        if (Math.abs(rawZ) >= Math.abs(rawX)) dir = { x: 0, y: 0, z: rawZ >= 0 ? 1 : -1 };
        else dir = { x: rawX >= 0 ? 1 : -1, y: 0, z: 0 };
        const distance =
          to.y < box.pos.y - 0.4
            ? 1.8
            : clamp(Math.max(Math.abs(rawX), Math.abs(rawZ)) - 0.6, 0.6, 3.2);
        const pushPos = {
          x: box.pos.x - dir.x * (box.size.x / 2 + RADIUS + 0.25),
          y: box.pos.y,
          z: box.pos.z - dir.z * (box.size.z / 2 + RADIUS + 0.25),
        };
        const result = this.getNav().findPath(this.b.pos, pushPos, 0.9);
        if (!result) throw new ActionError('NO_PATH', `没有位置可以推动${box.label}。`);
        pending.path = result.path.map((node) => ({ x: node.x + 0.5, y: node.y, z: node.z + 0.5 }));
        pending.push = {
          boxId: box.id,
          toId: command.to,
          dir,
          distance,
          phase: 'approach',
          startedAt: this.time,
        };
        pending.phase = 'path';
        return;
      }
    }
  }

  private conditionTargetExists(condition: WaitCondition): boolean {
    if (condition.kind === 'player_near')
      return this.anchorPosition(condition.target) !== undefined;
    return this.anchorPosition(condition.target) !== undefined;
  }

  private updateBAction(dt: number): void {
    const pending = this.pending;
    if (!pending) return;
    if (this.time > pending.deadline) {
      this.failAction('TIMEOUT', '动作等待超时了。');
      return;
    }

    const command = pending.command;
    if (command.kind === 'wait') {
      pending.waitRemaining = (pending.waitRemaining ?? 0) - dt;
      if ((pending.waitRemaining ?? 0) <= 0) this.finishAction('等待结束。');
      return;
    }
    if (command.kind === 'wait_until') {
      if (pending.waitCondition && this.evaluateCondition(pending.waitCondition)) {
        this.finishAction('等待的条件已满足。');
        return;
      }
      if (this.time > pending.startedAt + (pending.waitTimeout ?? 90))
        this.failAction('TIMEOUT', '等待条件超时了。');
      return;
    }

    if (pending.phase === 'path') {
      const done = this.followPath(pending);
      if (done) {
        pending.phase = 'act';
      } else {
        return;
      }
    }

    if (command.kind === 'move') {
      this.finishAction(`已到达${this.anchorLabel(command.target)}附近。`);
      return;
    }
    if (command.kind === 'use') {
      const lever = this.levers.get(command.target);
      if (!lever) {
        this.failAction('BAD_TARGET', '拉杆不存在了。');
        return;
      }
      if (distanceXZ(this.b.pos, centerXZ(lever.aabb)) > 2.0) {
        this.failAction('NO_REACH', `还没有走到${lever.label}旁边。`);
        return;
      }
      lever.on = !lever.on;
      this.navDirty = true;
      this.updateLinks();
      this.finishAction(`你${lever.on ? '拉下' : '拉起'}了${lever.label}。`);
      return;
    }
    if (command.kind === 'push' && pending.push) {
      const push = pending.push;
      const box = this.crates.get(push.boxId);
      if (!box) {
        this.failAction('BAD_TARGET', '箱子不存在了。');
        return;
      }
      if (push.phase === 'approach') {
        box.tween = {
          fromX: box.pos.x,
          fromZ: box.pos.z,
          toX: box.pos.x + push.dir.x * push.distance,
          toZ: box.pos.z + push.dir.z * push.distance,
          elapsed: 0,
          duration: 0.9,
        };
        push.phase = 'push';
        this.b.facing = Math.atan2(push.dir.x, push.dir.z);
        this.navDirty = true;
        return;
      }
      if (box.tween) return;
      if (!box.grounded && this.time - push.startedAt < 3) return;
      this.finishAction(`把${box.label}推向了${this.anchorLabel(command.to)}。`);
    }
  }

  private followPath(pending: PendingAction): boolean {
    if (pending.pathIndex >= pending.path.length) return true;
    const target = pending.path[pending.pathIndex];
    if (!target) return true;
    const dx = target.x - this.b.pos.x;
    const dz = target.z - this.b.pos.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 0.24) {
      pending.pathIndex += 1;
      if (pending.pathIndex >= pending.path.length) return true;
      return false;
    }
    if (Math.abs(target.y - this.b.pos.y) > 0.65) {
      this.failAction('NO_PATH', `前方高差太大，${COMPANION_NAME} 走不过去。`);
      return false;
    }
    const now = this.time;
    if (distanceXZ(this.b.pos, pending.lastPos) > 0.015) {
      pending.lastPos = cloneVec(this.b.pos);
      pending.lastMoveAt = now;
    } else if (now - pending.lastMoveAt > 1.3) {
      this.failAction(
        'STUCK',
        `${COMPANION_NAME} 在前往${this.anchorLabel(pending.command.kind === 'move' ? pending.command.target : '')}的路上被挡住了。`,
      );
      return false;
    }
    this.actionInput = { x: dx / distance, z: dz / distance, jump: false };
    return false;
  }

  private evaluateCondition(condition: WaitCondition): boolean {
    const target = this.anchorPosition(condition.target);
    if (!target) return false;
    switch (condition.kind) {
      case 'player_on': {
        const prop = this.propsById.get(condition.target);
        if (prop && (prop.kind === 'plate' || prop.kind === 'gate' || prop.kind === 'bridge')) {
          return this.isCharacterOnAabb(this.a, propAabb(prop), 0.15);
        }
        return distanceXZ(this.a.pos, target) <= 0.9 && Math.abs(this.a.pos.y - target.y) <= 1.0;
      }
      case 'player_near':
        return distanceXZ(this.a.pos, target) <= (condition.maxDistance ?? 2.5);
      case 'object_state': {
        const plate = this.plates.get(condition.target);
        if (plate)
          return condition.state === 'pressed'
            ? plate.pressed
            : condition.state === 'unpressed'
              ? !plate.pressed
              : false;
        const gate = this.gates.get(condition.target);
        if (gate)
          return condition.state === 'open'
            ? gate.open
            : condition.state === 'closed'
              ? !gate.open
              : false;
        const bridge = this.bridges.get(condition.target);
        if (bridge)
          return condition.state === 'open'
            ? bridge.open
            : condition.state === 'closed'
              ? !bridge.open
              : false;
        const lever = this.levers.get(condition.target);
        if (lever)
          return condition.state === 'on'
            ? lever.on
            : condition.state === 'off'
              ? !lever.on
              : false;
        return false;
      }
      case 'hazard_state': {
        const hazard = this.hazards.get(condition.target);
        return hazard ? hazard.phase === condition.state : false;
      }
    }
  }

  private finishAction(message: string): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = undefined;
    this.actionInput = { x: 0, z: 0, jump: false };
    pending.resolve({ message, snapshot: this.getSnapshot() });
  }

  private failAction(code: string, message: string): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = undefined;
    this.actionInput = { x: 0, z: 0, jump: false };
    pending.reject(new ActionError(code, message));
  }

  private checkWin(): void {
    if (this.status === 'won') return;
    for (const exit of this.exits.values()) {
      const center = centerXZ(exit.aabb);
      const inZone = (char: Character): boolean =>
        distanceXZ(char.pos, center) <= EXIT_TRIGGER_RADIUS &&
        Math.abs(char.pos.y - exit.aabb.min.y) <= EXIT_ZONE_LEVEL_TOLERANCE;
      if (inZone(this.a) && inZone(this.b)) {
        this.status = 'won';
        this.failAction('WON', '关卡完成。');
        this.emit({
          kind: 'level_won',
          id: exit.id,
          label: exit.label,
          text: '两个人都到达了旗门。',
          at: this.time,
        });
      }
    }
  }

  private emit(event: WorldEvent): void {
    this.events.push(event);
    if (this.events.length > 100) this.events.splice(0, this.events.length - 100);
  }

  consumeEvents(): WorldEvent[] {
    const events = this.events;
    this.events = [];
    return events;
  }

  getAnchorIds(): string[] {
    return [...this.anchors.keys()];
  }

  getAnchorLabel(id: string): string {
    return this.anchorLabel(id);
  }

  getRenderState(): WorldRenderState {
    return {
      time: this.time,
      status: this.status,
      a: this.characterSnapshot(this.a),
      b: this.characterSnapshot(this.b),
      crates: [...this.crates.values()].map((crate) => ({
        id: crate.id,
        label: crate.label,
        pos: cloneVec(crate.pos),
        size: cloneVec(crate.size),
      })),
      gates: [...this.gates.values()].map((gate) => ({
        id: gate.id,
        label: gate.label,
        pos: centerXZ(gate.aabb),
        size: {
          x: gate.aabb.max.x - gate.aabb.min.x,
          y: gate.aabb.max.y - gate.aabb.min.y,
          z: gate.aabb.max.z - gate.aabb.min.z,
        },
        open: gate.open,
      })),
      bridges: [...this.bridges.values()].map((bridge) => ({
        id: bridge.id,
        label: bridge.label,
        pos: centerXZ(bridge.aabb),
        size: {
          x: bridge.aabb.max.x - bridge.aabb.min.x,
          y: bridge.aabb.max.y - bridge.aabb.min.y,
          z: bridge.aabb.max.z - bridge.aabb.min.z,
        },
        open: bridge.open,
      })),
      plates: [...this.plates.values()].map((plate) => ({
        id: plate.id,
        label: plate.label,
        pos: centerXZ(plate.aabb),
        size: {
          x: plate.aabb.max.x - plate.aabb.min.x,
          y: plate.aabb.max.y - plate.aabb.min.y,
          z: plate.aabb.max.z - plate.aabb.min.z,
        },
        pressed: plate.pressed,
      })),
      levers: [...this.levers.values()].map((lever) => ({
        id: lever.id,
        label: lever.label,
        pos: centerXZ(lever.aabb),
        size: {
          x: lever.aabb.max.x - lever.aabb.min.x,
          y: lever.aabb.max.y - lever.aabb.min.y,
          z: lever.aabb.max.z - lever.aabb.min.z,
        },
        on: lever.on,
      })),
      hazards: [...this.hazards.values()].map((hazard) => ({
        id: hazard.id,
        label: hazard.label,
        pos: centerXZ(hazard.aabb),
        size: {
          x: hazard.aabb.max.x - hazard.aabb.min.x,
          y: hazard.aabb.max.y - hazard.aabb.min.y,
          z: hazard.aabb.max.z - hazard.aabb.min.z,
        },
        phase: hazard.phase,
        secondsUntilPhase: hazard.secondsUntilPhase,
      })),
      exits: [...this.exits.values()].map((exit) => ({
        id: exit.id,
        label: exit.label,
        pos: centerXZ(exit.aabb),
        size: {
          x: exit.aabb.max.x - exit.aabb.min.x,
          y: exit.aabb.max.y - exit.aabb.min.y,
          z: exit.aabb.max.z - exit.aabb.min.z,
        },
      })),
    };
  }

  getSnapshot(): WorldSnapshot {
    this.ensureNav();
    const nav = this.nav as NavGrid;
    const start = nav.nearest(this.b.pos, 1.8);
    const reachable = start ? nav.reachableKeys(start) : new Set<string>();
    const anchorSnapshots = [...this.anchors.values()].map((anchor) => {
      const crate = this.crates.get(anchor.id);
      const position = crate ? cloneVec(crate.pos) : anchor.pos;
      const goals = nav.goalsFor(position, 1.25);
      const bridge = this.bridges.get(anchor.id);
      const gate = this.gates.get(anchor.id);
      const passable = (!bridge || bridge.open) && (!gate || gate.open);
      return {
        id: anchor.id,
        label: anchor.label,
        aliases: anchor.aliases,
        pos: cloneVec(position),
        kind: anchor.kind,
        reachable: passable && goals.some((goal) => reachable.has(goal.key)),
      };
    });

    const props: PropSnapshot[] = [];
    for (const crate of this.crates.values()) {
      props.push({
        id: crate.id,
        kind: 'crate',
        label: crate.label,
        pos: cloneVec(crate.pos),
        size: cloneVec(crate.size),
      });
    }
    for (const gate of this.gates.values()) {
      props.push({
        id: gate.id,
        kind: 'gate',
        label: gate.label,
        pos: centerXZ(gate.aabb),
        size: {
          x: gate.aabb.max.x - gate.aabb.min.x,
          y: gate.aabb.max.y - gate.aabb.min.y,
          z: gate.aabb.max.z - gate.aabb.min.z,
        },
        open: gate.open,
      });
    }
    for (const bridge of this.bridges.values()) {
      props.push({
        id: bridge.id,
        kind: 'bridge',
        label: bridge.label,
        pos: centerXZ(bridge.aabb),
        size: {
          x: bridge.aabb.max.x - bridge.aabb.min.x,
          y: bridge.aabb.max.y - bridge.aabb.min.y,
          z: bridge.aabb.max.z - bridge.aabb.min.z,
        },
        open: bridge.open,
      });
    }
    for (const plate of this.plates.values()) {
      props.push({
        id: plate.id,
        kind: 'plate',
        label: plate.label,
        pos: centerXZ(plate.aabb),
        size: {
          x: plate.aabb.max.x - plate.aabb.min.x,
          y: plate.aabb.max.y - plate.aabb.min.y,
          z: plate.aabb.max.z - plate.aabb.min.z,
        },
        pressed: plate.pressed,
      });
    }
    for (const lever of this.levers.values()) {
      props.push({
        id: lever.id,
        kind: 'lever',
        label: lever.label,
        pos: centerXZ(lever.aabb),
        size: {
          x: lever.aabb.max.x - lever.aabb.min.x,
          y: lever.aabb.max.y - lever.aabb.min.y,
          z: lever.aabb.max.z - lever.aabb.min.z,
        },
        on: lever.on,
      });
    }
    for (const hazard of this.hazards.values()) {
      props.push({
        id: hazard.id,
        kind: 'hazard',
        label: hazard.label,
        pos: centerXZ(hazard.aabb),
        size: {
          x: hazard.aabb.max.x - hazard.aabb.min.x,
          y: hazard.aabb.max.y - hazard.aabb.min.y,
          z: hazard.aabb.max.z - hazard.aabb.min.z,
        },
        phase: hazard.phase,
        secondsUntilPhase: hazard.secondsUntilPhase,
      });
    }
    for (const exit of this.exits.values()) {
      props.push({
        id: exit.id,
        kind: 'exit',
        label: exit.label,
        pos: centerXZ(exit.aabb),
        size: {
          x: exit.aabb.max.x - exit.aabb.min.x,
          y: exit.aabb.max.y - exit.aabb.min.y,
          z: exit.aabb.max.z - exit.aabb.min.z,
        },
      });
    }

    return {
      levelId: this.level.id,
      time: this.time,
      status: this.status,
      a: this.characterSnapshot(this.a),
      b: this.characterSnapshot(this.b),
      props,
      anchors: anchorSnapshots,
      bridgeStates: Object.fromEntries(
        [...this.bridges.values()].map((bridge) => [bridge.id, bridge.open]),
      ),
    };
  }

  private characterSnapshot(char: Character): CharacterSnapshot {
    return {
      id: char.id,
      pos: cloneVec(char.pos),
      grounded: char.grounded,
      facing: char.facing,
      speed: char.speed,
      respawning: char.respawnCooldown > 0,
    };
  }
}
