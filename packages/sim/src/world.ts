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
  Direction,
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
import { ActionError, directionVector } from './types';
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
/** Horizontal slack for treating a character as standing on a plate-sized AABB. */
const PLATE_MARGIN = 0.12;
/** Steering walks stop before drops larger than this (meters). */
const EDGE_DROP = 0.6;
/** Seconds of no positional progress before a steering walk reports BLOCKED. */
const STUCK_SECONDS = 0.55;
/** Speed at which a walking character or Echo's tool drives a crate. */
const PUSH_SPEED = 2.4;

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
  pushBlocked?: boolean;
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
  /** Steering walk: fixed heading for `walk`, or tracked anchor for `walk_to`. */
  steering?: {
    mode: 'direction' | 'target';
    dir?: Vec3;
    targetId?: string;
    targetPos?: Vec3;
    radius: number;
    walkRemaining?: number;
  };
  /** Jump action state: resolves once b lands again. */
  jumping?: {
    airborneAt?: number;
  };
  push?: {
    boxId: string;
    direction: Direction;
    dir: Vec3;
    phase: 'approach' | 'push';
    startedAt: number;
    /** Crate height when this push started; dropping below it means it fell. */
    startY: number;
    /** Set once the crate leaves support; the push then waits for the fall. */
    droppedAt?: number;
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

/** Where Echo must stand to push the crate along dir. */
function pushStandPosition(crate: CrateState, dir: Vec3): Vec3 {
  return {
    x: crate.pos.x - dir.x * (crate.size.x / 2 + RADIUS + 0.25),
    y: crate.pos.y,
    z: crate.pos.z - dir.z * (crate.size.z / 2 + RADIUS + 0.25),
  };
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
        pos: { x: prop.at.x + size.x / 2, y: prop.at.y, z: prop.at.z + size.z / 2 },
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

  /**
   * A crate's cached collider goes stale within a step as the crate is
   * shoved; resolve crate colliders to their live AABB so characters never
   * collide with where a crate used to be.
   */
  private effectiveAabb(collider: Collider): Aabb {
    if (collider.kind !== 'crate') return collider.aabb;
    const crate = this.crates.get(collider.id ?? '');
    return crate ? this.crateAabb(crate) : collider.aabb;
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

    this.depenetrateCharacter(char);
    this.moveCharacterX(char, dt);
    this.moveCharacterZ(char, dt);
    this.moveCharacterY(char, dt);

    char.speed = Math.hypot(char.vel.x, char.vel.z);
    if (char.speed > 0.2) char.facing = Math.atan2(char.vel.x, char.vel.z);
    if (char.pos.y < -8) {
      this.respawnCharacter(char, '掉出了浮岛。');
    }
  }

  /**
   * Pushes a character out of any collider it is embedded in along the axis
   * of least penetration, instead of letting the next movement step eject it
   * along its travel direction (which let characters pass through closed gates).
   */
  private depenetrateCharacter(char: Character): void {
    for (let round = 0; round < 3; round += 1) {
      const body = characterAabb(char.pos, RADIUS, HEIGHT);
      let best: { axis: 'x' | 'y' | 'z'; depth: number; sign: number } | undefined;
      for (const collider of this.colliderCache) {
        const aabb = this.effectiveAabb(collider);
        if (!overlaps(body, aabb)) continue;
        const pushPosX = aabb.max.x - body.min.x;
        const pushNegX = body.max.x - aabb.min.x;
        const pushPosY = aabb.max.y - body.min.y;
        const pushNegY = body.max.y - aabb.min.y;
        const pushPosZ = aabb.max.z - body.min.z;
        const pushNegZ = body.max.z - aabb.min.z;
        const candidates: { axis: 'x' | 'y' | 'z'; depth: number; sign: number }[] = [
          { axis: 'x', depth: pushPosX, sign: 1 },
          { axis: 'x', depth: pushNegX, sign: -1 },
          { axis: 'y', depth: pushPosY, sign: 1 },
          { axis: 'y', depth: pushNegY, sign: -1 },
          { axis: 'z', depth: pushPosZ, sign: 1 },
          { axis: 'z', depth: pushNegZ, sign: -1 },
        ];
        for (const candidate of candidates) {
          if (!best || candidate.depth < best.depth) best = candidate;
        }
      }
      if (!best || best.depth <= 0) return;
      if (best.axis === 'x') {
        char.pos.x += best.sign * (best.depth + EPS);
        char.vel.x = 0;
      } else if (best.axis === 'y') {
        char.pos.y += best.sign * (best.depth + EPS);
        if (best.sign < 0) {
          char.vel.y = 0;
          char.grounded = true;
        } else {
          char.vel.y = 0;
        }
      } else {
        char.pos.z += best.sign * (best.depth + EPS);
        char.vel.z = 0;
      }
    }
  }

  private moveCharacterX(char: Character, dt: number): void {
    const dx = char.vel.x * dt;
    if (Math.abs(dx) < EPS) return;
    char.pos.x += dx;
    const body = characterAabb(char.pos, RADIUS, HEIGHT);
    for (const collider of this.colliderCache) {
      const aabb = this.effectiveAabb(collider);
      if (!overlaps(body, aabb)) continue;
      if (this.tryShoveCrate(char, collider, dx, 0, dt)) {
        Object.assign(body, characterAabb(char.pos, RADIUS, HEIGHT));
        continue;
      }
      if (dx > 0) char.pos.x = Math.min(char.pos.x, aabb.min.x - RADIUS - EPS);
      else char.pos.x = Math.max(char.pos.x, aabb.max.x + RADIUS + EPS);
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
      const aabb = this.effectiveAabb(collider);
      if (!overlaps(body, aabb)) continue;
      if (this.tryShoveCrate(char, collider, 0, dz, dt)) {
        Object.assign(body, characterAabb(char.pos, RADIUS, HEIGHT));
        continue;
      }
      if (dz > 0) char.pos.z = Math.min(char.pos.z, aabb.min.z - RADIUS - EPS);
      else char.pos.z = Math.max(char.pos.z, aabb.max.z + RADIUS + EPS);
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
      const aabb = this.effectiveAabb(collider);
      if (!overlaps(body, aabb)) continue;
      if (dy < 0) {
        char.pos.y = Math.max(char.pos.y, aabb.max.y);
        char.vel.y = 0;
        char.grounded = true;
      } else if (dy > 0) {
        char.pos.y = Math.min(char.pos.y, aabb.min.y - HEIGHT - EPS);
        char.vel.y = 0;
      }
      const updated = characterAabb(char.pos, RADIUS, HEIGHT);
      Object.assign(body, updated);
    }
  }

  /**
   * The player shoves a grounded crate by walking into it, instead of being
   * stopped by it. Echo never shoves while walking — it has the push tool.
   * The crate slides at PUSH_SPEED until it is blocked or leaves support
   * (pushed off an edge — gravity then takes over). Returns true when the
   * collider was handled here as a crate, whether or not it moved.
   */
  private tryShoveCrate(
    char: Character,
    collider: Collider,
    dx: number,
    dz: number,
    dt: number,
  ): boolean {
    if (char.id !== 'a') return false;
    if (collider.kind !== 'crate') return false;
    const crate = this.crates.get(collider.id ?? '');
    if (!crate) return false;
    // Diagonal movement or airborne: treat the crate as a wall.
    if (Math.abs(dx) > EPS && Math.abs(dz) > EPS) return false;
    if (!char.grounded) return false;
    // Square contact only: brushing a corner must not shove the crate sideways.
    const body = this.crateAabb(crate);
    if (Math.abs(dx) > EPS && (char.pos.z < body.min.z || char.pos.z > body.max.z)) return false;
    if (Math.abs(dz) > EPS && (char.pos.x < body.min.x || char.pos.x > body.max.x)) return false;
    // An airborne or already-falling crate cannot be steered by walking.
    if (!this.crateSupported(crate)) return false;
    const stepX = Math.sign(dx) * PUSH_SPEED * dt;
    const stepZ = Math.sign(dz) * PUSH_SPEED * dt;
    this.moveCrateXZ(crate, stepX, stepZ, char);
    this.navDirty = true;
    // Glue the character to the crate's current face either way: the shove
    // keeps contact while the crate slides, and stops the character against
    // the crate's up-to-date position when it is blocked.
    const face = this.crateAabb(crate);
    if (stepX > 0) char.pos.x = face.min.x - RADIUS - EPS;
    else if (stepX < 0) char.pos.x = face.max.x + RADIUS + EPS;
    else if (stepZ > 0) char.pos.z = face.min.z - RADIUS - EPS;
    else char.pos.z = face.max.z + RADIUS + EPS;
    return true;
  }

  private crateAabb(crate: CrateState): Aabb {
    return aabbFromMinSize(
      { x: crate.pos.x - crate.size.x / 2, y: crate.pos.y, z: crate.pos.z - crate.size.z / 2 },
      crate.size,
    );
  }

  /**
   * Moves a crate horizontally with the same axis sweep the characters use.
   * Returns false when the crate was blocked by geometry or a character.
   */
  private moveCrateXZ(crate: CrateState, dx: number, dz: number, ignore?: Character): boolean {
    let movedX = true;
    if (Math.abs(dx) >= EPS) {
      crate.pos.x += dx;
      let body = this.crateAabb(crate);
      for (const collider of this.colliderCache) {
        if (collider.kind === 'crate' && collider.id === crate.id) continue;
        if (!overlaps(body, collider.aabb)) continue;
        if (dx > 0)
          crate.pos.x = Math.min(crate.pos.x, collider.aabb.min.x - crate.size.x / 2 - EPS);
        else crate.pos.x = Math.max(crate.pos.x, collider.aabb.max.x + crate.size.x / 2 + EPS);
        movedX = false;
        body = this.crateAabb(crate);
      }
    }
    let movedZ = true;
    if (Math.abs(dz) >= EPS) {
      crate.pos.z += dz;
      let body = this.crateAabb(crate);
      for (const collider of this.colliderCache) {
        if (collider.kind === 'crate' && collider.id === crate.id) continue;
        if (!overlaps(body, collider.aabb)) continue;
        if (dz > 0)
          crate.pos.z = Math.min(crate.pos.z, collider.aabb.min.z - crate.size.z / 2 - EPS);
        else crate.pos.z = Math.max(crate.pos.z, collider.aabb.max.z + crate.size.z / 2 + EPS);
        movedZ = false;
        body = this.crateAabb(crate);
      }
    }
    // Characters stop a moving crate instead of being swept away. The pushing
    // character itself is excluded so it can stay in contact while shoving.
    for (const char of [this.a, this.b]) {
      if (char === ignore) continue;
      if (overlaps(this.crateAabb(crate), characterAabb(char.pos, RADIUS, HEIGHT))) return false;
    }
    return movedX && movedZ;
  }

  private updateCrates(dt: number): void {
    for (const crate of this.crates.values()) {
      if (crate.tween) {
        crate.tween.elapsed += dt;
        const t = Math.min(1, crate.tween.elapsed / crate.tween.duration);
        const targetX = crate.tween.fromX + (crate.tween.toX - crate.tween.fromX) * t;
        const targetZ = crate.tween.fromZ + (crate.tween.toZ - crate.tween.fromZ) * t;
        const moved = this.moveCrateXZ(crate, targetX - crate.pos.x, targetZ - crate.pos.z);
        if (t >= 1 || !moved) {
          crate.tween = undefined;
          crate.vy = 0;
          crate.grounded = false;
          if (!moved) crate.pushBlocked = true;
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
      this.navDirty = true;
    }
  }

  /** True when any character or crate body overlaps the given AABB. */
  private aabbOccupied(aabb: Aabb): boolean {
    if (overlaps(characterAabb(this.a.pos, RADIUS, HEIGHT), aabb)) return true;
    if (overlaps(characterAabb(this.b.pos, RADIUS, HEIGHT), aabb)) return true;
    for (const crate of this.crates.values()) {
      if (overlaps(this.crateAabb(crate), aabb)) return true;
    }
    return false;
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
      let next = openGates.get(gate.id) ?? gate.initialOpen;
      // A gate must not close onto a character or crate standing in its frame.
      if (!next && gate.open && this.aabbOccupied(gate.aabb)) next = true;
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
      let next = openBridges.get(bridge.id) ?? bridge.initialOpen;
      // A bridge must not materialize inside a character or crate.
      if (next && !bridge.open && this.aabbOccupied(bridge.aabb)) next = false;
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
      if (this.isCharacterOnAabb(char, plate.aabb, PLATE_MARGIN)) return true;
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
      case 'walk': {
        pending.steering = {
          mode: 'direction',
          dir: directionVector(command.direction),
          radius: 0,
          walkRemaining: clamp(command.seconds, 0.2, 5),
        };
        pending.phase = 'act';
        return;
      }
      case 'walk_to': {
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
        const anchorKind = this.anchors.get(command.target)?.kind;
        const radius = this.exits.has(command.target)
          ? 0.8
          : anchorKind === 'plate' || anchorKind === 'hazard'
            ? 0.45
            : 1.0;
        pending.steering = {
          mode: 'target',
          targetId: command.target,
          targetPos: target,
          radius,
        };
        pending.phase = 'act';
        return;
      }
      case 'jump': {
        const dir = command.direction ? directionVector(command.direction) : undefined;
        if (dir) {
          pending.steering = { mode: 'direction', dir, radius: 0 };
        }
        this.b.jumpBuffer = 0.12;
        pending.jumping = {};
        pending.phase = 'act';
        return;
      }
      case 'use': {
        const lever = this.levers.get(command.target);
        if (!lever) throw new ActionError('BAD_TARGET', `${command.target} 不是可以操作的拉杆。`);
        const target = centerXZ(lever.aabb);
        pending.steering = {
          mode: 'target',
          targetId: command.target,
          targetPos: target,
          radius: 1.6,
        };
        pending.phase = 'act';
        return;
      }
      case 'push': {
        const box = this.crates.get(command.box);
        if (!box) throw new ActionError('BAD_TARGET', `${command.box} 不是可以推动的箱子。`);
        const dir = directionVector(command.direction);
        const pushPos = pushStandPosition(box, dir);
        // Reaching behind the crate may require stepping around it; use the
        // nav grid only for this short approach (targets stay steering walks).
        const navResult = this.getNav().findPath(this.b.pos, pushPos, 0.9);
        if (!navResult) throw new ActionError('NO_PATH', `没有位置可以推动${box.label}。`);
        pending.path = navResult.path.map((node) => ({
          x: node.x + 0.5,
          y: node.y,
          z: node.z + 0.5,
        }));
        pending.phase = pending.path.length === 0 ? 'act' : 'path';
        pending.push = {
          boxId: box.id,
          direction: command.direction,
          dir,
          phase: 'approach',
          startedAt: this.time,
          startY: box.pos.y,
        };
        return;
      }
    }
  }

  /**
   * Edge guard: samples the ground height ahead of b along its heading.
   * Returns a human reason when walking on would drop more than EDGE_DROP,
   * or undefined when the ground ahead is walkable.
   */
  private edgeGuardAhead(): string | undefined {
    const ahead = 0.55 + RADIUS;
    const dx = this.b.pos.x + this.steerHeading().x * ahead;
    const dz = this.b.pos.z + this.steerHeading().z * ahead;
    const support = this.supportHeightAt(dx, this.b.pos.y, dz);
    if (support === undefined) {
      // Nothing solid ahead within tolerance: open gap or a real cliff.
      return this.hasSupportUnder(this.b.pos)
        ? '前面是边缘，没有落脚的地方，再走就要掉下去了。'
        : undefined;
    }
    const drop = this.b.pos.y - support;
    if (drop > EDGE_DROP) return '前面是边缘，再走就要掉下去了。';
    if (support - this.b.pos.y > 0.65) return undefined; // wall handling covers this
    return undefined;
  }

  private steerHeading(): Vec3 {
    const pending = this.pending;
    const steering = pending?.steering;
    if (!steering) return { x: 0, y: 0, z: 0 };
    if (steering.mode === 'direction' && steering.dir) return steering.dir;
    if (steering.mode === 'target' && steering.targetPos) {
      const target =
        steering.targetId === 'player'
          ? this.a.pos
          : steering.targetId
            ? (this.anchorPosition(steering.targetId) ?? steering.targetPos)
            : steering.targetPos;
      const dx = target.x - this.b.pos.x;
      const dz = target.z - this.b.pos.z;
      const length = Math.hypot(dx, dz);
      if (length < 1e-4) return { x: 0, y: 0, z: 0 };
      return { x: dx / length, y: 0, z: dz / length };
    }
    return { x: 0, y: 0, z: 0 };
  }

  /** Highest walkable surface top within y tolerance at (x, z), or undefined. */
  private supportHeightAt(x: number, y: number, z: number): number | undefined {
    let best: number | undefined;
    for (const collider of this.colliderCache) {
      if (collider.kind === 'gate' && !this.gates.get(collider.id ?? '')?.open) continue;
      if (collider.kind === 'gate') continue;
      const top = collider.aabb.max.y;
      if (Math.abs(top - y) > 1.3) continue;
      if (
        x >= collider.aabb.min.x - 0.1 &&
        x <= collider.aabb.max.x + 0.1 &&
        z >= collider.aabb.min.z - 0.1 &&
        z <= collider.aabb.max.z + 0.1
      ) {
        if (best === undefined || top > best) best = top;
      }
    }
    return best;
  }

  private hasSupportUnder(pos: Vec3): boolean {
    return this.supportHeightAt(pos.x, pos.y, pos.z) !== undefined;
  }

  private conditionTargetExists(condition: WaitCondition): boolean {
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
      // Path following is used only for the short approach behind a crate
      // before pushing it; everything else is steering.
      const done = this.followPath(pending);
      if (done) {
        pending.phase = 'act';
      } else {
        return;
      }
    }

    if (command.kind === 'jump' && pending.jumping) {
      if (this.b.respawnCooldown > 0 && this.time - pending.startedAt > 0.5) {
        this.failAction('FELL', '跳跃后掉下去了，回到了安全位置。');
        return;
      }
      if (!this.b.grounded) {
        pending.jumping.airborneAt ??= this.time;
        if (pending.steering) {
          const heading = this.steerHeading();
          this.actionInput = { x: heading.x, z: heading.z, jump: false };
        }
        return;
      }
      if (pending.jumping.airborneAt === undefined) {
        // Jump buffered but not yet airborne; give physics a moment.
        if (this.time - pending.startedAt > 1.2) {
          this.failAction('BLOCKED', '跳不起来，可能头顶或脚下有东西挡着。');
        }
        return;
      }
      const dirName = (command as { direction?: Direction }).direction;
      this.finishAction(dirName ? `朝${dirName}跳了一步，落地了。` : '跳了一下，落地了。');
      return;
    }

    if (pending.steering) {
      const steering = pending.steering;
      if (steering.mode === 'target' && steering.targetPos) {
        const target = this.resolveSteerTarget(steering);
        steering.targetPos = cloneVec(target);
        const arrived = distanceXZ(this.b.pos, target) <= steering.radius;
        if (arrived) {
          if (command.kind === 'push') {
            pending.steering = undefined;
            pending.phase = 'act';
            return this.updateBAction(0);
          }
          const label = steering.targetId ? this.anchorLabel(steering.targetId) : '目标';
          this.finishAction(`走到了${label}附近。`);
          return;
        }
      }
      // Time budget for direction walks (and jump run-ups).
      if (steering.mode === 'direction' && steering.walkRemaining !== undefined) {
        steering.walkRemaining -= dt;
        if (steering.walkRemaining <= 0) {
          this.finishAction(
            `朝${(command as { direction?: Direction }).direction ?? '前'}走了一段，停下来了。`,
          );
          return;
        }
      }
      // Blocked: no progress for a while.
      const now = this.time;
      if (distanceXZ(this.b.pos, pending.lastPos) > 0.015) {
        pending.lastPos = cloneVec(this.b.pos);
        pending.lastMoveAt = now;
      } else if (now - pending.lastMoveAt > STUCK_SECONDS && this.b.grounded) {
        const where =
          steering.mode === 'target' && steering.targetId
            ? this.anchorLabel(steering.targetId)
            : '前方';
        this.failAction('BLOCKED', `朝${where}走被挡住了，走不过去。`);
        return;
      }
      // Edge guard: stop before walking off a cliff (not during jumps).
      if (this.b.grounded && command.kind !== 'jump') {
        const edgeReason = this.edgeGuardAhead();
        if (edgeReason) {
          this.finishAction(`${edgeReason}先停下来了。`);
          return;
        }
      }
      const heading = this.steerHeading();
      this.actionInput = { x: heading.x, z: heading.z, jump: false };
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
        const pushPos = pushStandPosition(box, push.dir);
        if (distanceXZ(this.b.pos, pushPos) > 1.1) {
          this.failAction('BLOCKED', `没有走到能推动${box.label}的位置。`);
          return;
        }
        push.phase = 'push';
        this.b.facing = Math.atan2(push.dir.x, push.dir.z);
        return;
      }
      // Pushing: drive the crate along dir until it is blocked or has left
      // support (pushed off an edge). Once it has dropped, stop driving it and
      // only wait for gravity to settle the fall.
      // Once the crate has left support it is never driven again this push:
      // stop and wait for gravity to settle it below. (Without this, a crate
      // that lands and regains support would be shoved across the ground.)
      const unsupported = !this.crateSupported(box);
      if (push.droppedAt === undefined && unsupported) push.droppedAt = this.time;
      if (push.droppedAt !== undefined) {
        const settled = this.crateSupported(box) && box.pos.y < push.startY - 0.4;
        if (settled || this.time - push.droppedAt > 3) {
          const dropped = box.pos.y < push.startY - 0.4;
          this.finishAction(
            dropped
              ? `把${box.label}朝${push.direction}推了出去。`
              : `${box.label}没有站稳，没能推出去。`,
          );
        }
        return;
      }
      const dx = push.dir.x * PUSH_SPEED * dt;
      const dz = push.dir.z * PUSH_SPEED * dt;
      const moved = this.moveCrateXZ(box, dx, dz);
      this.b.facing = Math.atan2(push.dir.x, push.dir.z);
      this.navDirty = true;
      if (!moved) {
        this.finishAction(`${box.label}被挡住了，推不动了。`);
        return;
      }
      // Cap the continuous push at ~4 seconds of pushing.
      if (this.time - (push.startedAt ?? this.time) > 4) {
        this.finishAction(`把${box.label}朝${push.direction}推了一段。`);
        return;
      }
      return;
    }
  }

  private resolveSteerTarget(steering: NonNullable<PendingAction['steering']>): Vec3 {
    if (steering.mode !== 'target') return cloneVec(this.b.pos);
    if (steering.targetId === 'player') return cloneVec(this.a.pos);
    if (steering.targetId) return this.anchorPosition(steering.targetId) ?? cloneVec(this.b.pos);
    return cloneVec(steering.targetPos ?? this.b.pos);
  }

  /** Whether the crate currently rests on any collider below it. */
  private crateSupported(crate: CrateState): boolean {
    const body = this.crateAabb(crate);
    for (const collider of this.colliderCache) {
      if (collider.kind === 'crate' && collider.id === crate.id) continue;
      if (
        Math.abs(collider.aabb.max.y - body.min.y) < 0.08 &&
        body.min.x < collider.aabb.max.x &&
        body.max.x > collider.aabb.min.x &&
        body.min.z < collider.aabb.max.z &&
        body.max.z > collider.aabb.min.z
      ) {
        return true;
      }
    }
    return false;
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
      this.failAction('STUCK', `${COMPANION_NAME} 在绕到箱子背面的路上被挡住了。`);
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
          return this.isCharacterOnAabb(this.a, propAabb(prop), PLATE_MARGIN);
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
