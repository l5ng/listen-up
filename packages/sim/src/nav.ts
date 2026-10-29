import { aabbFromMinSize, characterAabb, overlaps } from './geometry';
import type { Aabb, BlockSpec, Vec3 } from './types';

export interface NavBlock {
  aabb: Aabb;
  top: number;
}

export interface NavBuildInput {
  blocks: BlockSpec[];
  bridges: { aabb: Aabb; open: boolean }[];
  solidColliders: Aabb[];
  radius: number;
  height: number;
}

export interface NavNode {
  x: number;
  z: number;
  y: number;
  key: string;
}

export class NavGrid {
  readonly nodes = new Map<string, NavNode>();
  private readonly neighbors = new Map<string, string[]>();

  static bake(input: NavBuildInput): NavGrid {
    const grid = new NavGrid();
    const tops = new Map<string, NavNode>();
    const addTop = (x: number, z: number, top: number) => {
      const key = `${x},${z}`;
      const current = tops.get(key);
      if (!current || top > current.y) tops.set(key, { x, z, y: top, key });
    };

    for (const block of input.blocks) {
      const minX = Math.floor(block.at.x + 1e-5);
      const maxX = Math.ceil(block.at.x + block.size.x - 1e-5);
      const minZ = Math.floor(block.at.z + 1e-5);
      const maxZ = Math.ceil(block.at.z + block.size.z - 1e-5);
      const top = block.at.y + block.size.y;
      for (let x = minX; x < maxX; x += 1) {
        for (let z = minZ; z < maxZ; z += 1) addTop(x, z, top);
      }
    }
    for (const bridge of input.bridges) {
      if (!bridge.open) continue;
      const minX = Math.floor(bridge.aabb.min.x + 1e-5);
      const maxX = Math.ceil(bridge.aabb.max.x - 1e-5);
      const minZ = Math.floor(bridge.aabb.min.z + 1e-5);
      const maxZ = Math.ceil(bridge.aabb.max.z - 1e-5);
      const top = bridge.aabb.max.y;
      for (let x = minX; x < maxX; x += 1) {
        for (let z = minZ; z < maxZ; z += 1) addTop(x, z, top);
      }
    }

    for (const node of tops.values()) {
      const center: Vec3 = { x: node.x + 0.5, y: node.y, z: node.z + 0.5 };
      const body = characterAabb(center, input.radius, input.height);
      let blocked = false;
      for (const solid of input.solidColliders) {
        if (overlaps(body, solid, 0.02)) {
          blocked = true;
          break;
        }
      }
      if (!blocked) grid.nodes.set(node.key, node);
    }

    for (const node of grid.nodes.values()) {
      const value = node.key;
      const list: string[] = [];
      const candidate = (x: number, z: number) => {
        const next = grid.nodes.get(`${x},${z}`);
        if (next && Math.abs(next.y - node.y) < 0.08) list.push(next.key);
      };
      candidate(node.x + 1, node.z);
      candidate(node.x - 1, node.z);
      candidate(node.x, node.z + 1);
      candidate(node.x, node.z - 1);
      grid.neighbors.set(value, list);
    }

    return grid;
  }

  nodeAt(x: number, z: number): NavNode | undefined {
    return this.nodes.get(`${x},${z}`);
  }

  nearest(pos: Vec3, maxDistance = 1.5): NavNode | undefined {
    let best: NavNode | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const node of this.nodes.values()) {
      for (const y of [pos.y, pos.y - 0.05, pos.y + 0.05]) {
        if (Math.abs(node.y - y) > 0.55) continue;
        const distance = Math.hypot(node.x + 0.5 - pos.x, node.z + 0.5 - pos.z);
        if (distance < bestDistance && distance <= maxDistance) {
          bestDistance = distance;
          best = node;
        }
      }
    }
    return best;
  }

  goalsFor(pos: Vec3, radius = 1.3): NavNode[] {
    const goals: NavNode[] = [];
    for (const node of this.nodes.values()) {
      if (Math.abs(node.y - pos.y) > 1.1) continue;
      if (Math.hypot(node.x + 0.5 - pos.x, node.z + 0.5 - pos.z) <= radius) goals.push(node);
    }
    return goals;
  }

  pathBetween(start: NavNode, goal: NavNode): NavNode[] | undefined {
    const open = new Set<string>([start.key]);
    const cameFrom = new Map<string, string>();
    const gScore = new Map<string, number>([[start.key, 0]]);
    const fScore = new Map<string, number>([
      [start.key, Math.hypot(start.x - goal.x, start.z - goal.z)],
    ]);
    const frontier = new Set<string>([start.key]);

    while (frontier.size > 0) {
      let currentKey: string | undefined;
      let currentScore = Number.POSITIVE_INFINITY;
      for (const key of frontier) {
        const score = fScore.get(key) ?? Number.POSITIVE_INFINITY;
        if (score < currentScore) {
          currentScore = score;
          currentKey = key;
        }
      }
      if (!currentKey) break;
      if (currentKey === goal.key) {
        const path: NavNode[] = [];
        let cursor: string | undefined = currentKey;
        while (cursor && cursor !== start.key) {
          const node = this.nodes.get(cursor);
          if (node) path.unshift(node);
          cursor = cameFrom.get(cursor);
        }
        return path;
      }
      frontier.delete(currentKey);
      open.add(currentKey);
      const current = this.nodes.get(currentKey);
      if (!current) continue;
      for (const nextKey of this.neighbors.get(currentKey) ?? []) {
        if (open.has(nextKey)) continue;
        const next = this.nodes.get(nextKey);
        if (!next) continue;
        const tentative = (gScore.get(currentKey) ?? Number.POSITIVE_INFINITY) + 1;
        if (tentative < (gScore.get(nextKey) ?? Number.POSITIVE_INFINITY)) {
          cameFrom.set(nextKey, currentKey);
          gScore.set(nextKey, tentative);
          fScore.set(nextKey, tentative + Math.hypot(next.x - goal.x, next.z - goal.z));
          frontier.add(nextKey);
        }
      }
    }
    return undefined;
  }

  findPath(
    from: Vec3,
    to: Vec3,
    goalRadius = 1.3,
  ): { path: NavNode[]; start: NavNode; goal: NavNode } | undefined {
    const start = this.nearest(from, 1.6);
    if (!start) return undefined;
    const goals = this.goalsFor(to, goalRadius);
    let best: { path: NavNode[]; start: NavNode; goal: NavNode } | undefined;
    for (const goal of goals) {
      if (goal.key === start.key) return { path: [], start, goal };
      const path = this.pathBetween(start, goal);
      if (path && (!best || path.length < best.path.length)) best = { path, start, goal };
    }
    return best;
  }

  reachableKeys(start: NavNode): Set<string> {
    const seen = new Set<string>([start.key]);
    const queue = [start.key];
    while (queue.length > 0) {
      const key = queue.shift();
      if (!key) continue;
      for (const next of this.neighbors.get(key) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
    return seen;
  }

  reachableFrom(start: NavNode, targets: NavNode[]): boolean {
    const seen = this.reachableKeys(start);
    return targets.some((target) => seen.has(target.key));
  }
}

export function colliderFromBlock(block: BlockSpec): Aabb {
  return aabbFromMinSize(block.at, block.size);
}
