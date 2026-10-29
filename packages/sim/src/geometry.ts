import type { Aabb, Vec3 } from './types';

export const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const lengthXZ = (a: Vec3): number => Math.hypot(a.x, a.z);
export const distanceXZ = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.z - b.z);

export function aabbFromMinSize(min: Vec3, size: Vec3): Aabb {
  return { min, max: { x: min.x + size.x, y: min.y + size.y, z: min.z + size.z } };
}

export function aabbFromCenter(center: Vec3, size: Vec3): Aabb {
  return {
    min: { x: center.x - size.x / 2, y: center.y - size.y / 2, z: center.z - size.z / 2 },
    max: { x: center.x + size.x / 2, y: center.y + size.y / 2, z: center.z + size.z / 2 },
  };
}

export function characterAabb(pos: Vec3, radius: number, height: number): Aabb {
  return {
    min: { x: pos.x - radius, y: pos.y, z: pos.z - radius },
    max: { x: pos.x + radius, y: pos.y + height, z: pos.z + radius },
  };
}

export function overlaps(a: Aabb, b: Aabb, epsilon = 0.0001): boolean {
  return (
    a.min.x < b.max.x - epsilon &&
    a.max.x > b.min.x + epsilon &&
    a.min.y < b.max.y - epsilon &&
    a.max.y > b.min.y + epsilon &&
    a.min.z < b.max.z - epsilon &&
    a.max.z > b.min.z + epsilon
  );
}

export function containsPoint(a: Aabb, p: Vec3): boolean {
  return (
    p.x >= a.min.x &&
    p.x <= a.max.x &&
    p.y >= a.min.y &&
    p.y <= a.max.y &&
    p.z >= a.min.z &&
    p.z <= a.max.z
  );
}

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function moveToward(current: number, target: number, maxDelta: number): number {
  if (current < target) return Math.min(current + maxDelta, target);
  return Math.max(current - maxDelta, target);
}

export function centerOf(a: Aabb): Vec3 {
  return {
    x: (a.min.x + a.max.x) / 2,
    y: (a.min.y + a.max.y) / 2,
    z: (a.min.z + a.max.z) / 2,
  };
}

export function topCenter(a: Aabb): Vec3 {
  return { x: (a.min.x + a.max.x) / 2, y: a.max.y, z: (a.min.z + a.max.z) / 2 };
}

export function sizeOf(a: Aabb): Vec3 {
  return { x: a.max.x - a.min.x, y: a.max.y - a.min.y, z: a.max.z - a.min.z };
}
