import type { AnchorSnapshot, LevelDef, Vec3, WorldSnapshot } from '@listen-up/sim';
import { COMPANION_NAME, PLAYER_NAME } from '@listen-up/sim';
import type { ObservationOptions } from './types';

function fmt(value: number): string {
  return value.toFixed(1);
}

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** 8-wind compass bearing from Echo to the point (x=东, z=南). */
function bearing(from: Vec3, to: Vec3): string {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  if (Math.hypot(dx, dz) < 0.3) return '脚边';
  const angle = Math.atan2(dz, dx); // -π..π, 0 = 东
  const index = Math.round(angle / (Math.PI / 4)); // -4..4
  const names = ['东', '东南', '南', '西南', '西', '西北', '北', '东北'];
  return names[((index % 8) + 8) % 8] ?? '东';
}

function nearestAnchor(pos: Vec3, anchors: AnchorSnapshot[]): AnchorSnapshot | undefined {
  let best: AnchorSnapshot | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const anchor of anchors) {
    const d = distance(pos, anchor.pos);
    if (d < bestDistance && d <= 4.5) {
      bestDistance = d;
      best = anchor;
    }
  }
  return best;
}

function describePlace(pos: Vec3, anchors: AnchorSnapshot[]): string {
  const anchor = nearestAnchor(pos, anchors);
  if (!anchor) return '场地中';
  return anchor.label;
}

/** "你西北 3.5 米" style relative description of a point. */
function relativeFrom(b: Vec3, pos: Vec3): string {
  return `你${bearing(b, pos)} ${fmt(distance(b, pos))} 米`;
}

export function formatObservation(
  snapshot: WorldSnapshot,
  level: LevelDef,
  options: ObservationOptions = {},
): string {
  const lines: string[] = [];
  const b = snapshot.b.pos;
  const bPlace = describePlace(b, snapshot.anchors);
  lines.push(
    `你（${COMPANION_NAME}）：在${bPlace}，${snapshot.b.grounded ? '站立' : '空中'}${options.bStatus ? `，${options.bStatus}` : ''}。`,
  );
  lines.push(
    `${PLAYER_NAME}（玩家）：${relativeFrom(b, snapshot.a.pos)}，在${describePlace(snapshot.a.pos, snapshot.anchors)}。`,
  );
  lines.push(`目标：${level.goal}`);

  const mechanisms: string[] = [];
  for (const prop of snapshot.props) {
    if (prop.kind === 'gate')
      mechanisms.push(
        `${prop.label}（${prop.id}）${prop.open ? '打开' : '关闭'}，${relativeFrom(b, prop.pos)}`,
      );
    if (prop.kind === 'bridge')
      mechanisms.push(
        `${prop.label}（${prop.id}）${prop.open ? '展开' : '收起'}，${relativeFrom(b, prop.pos)}`,
      );
    if (prop.kind === 'plate')
      mechanisms.push(
        `${prop.label}（${prop.id}）${prop.pressed ? '被踩住' : '未被踩住'}，${relativeFrom(b, prop.pos)}`,
      );
    if (prop.kind === 'lever')
      mechanisms.push(
        `${prop.label}（${prop.id}）${prop.on ? '已拉下' : '未拉下'}，${relativeFrom(b, prop.pos)}`,
      );
  }
  if (mechanisms.length > 0) lines.push(`机关：${mechanisms.join('；')}。`);

  const objects: string[] = [];
  for (const prop of snapshot.props) {
    if (prop.kind !== 'crate' && prop.kind !== 'exit') continue;
    const nearby = distance(b, prop.pos) <= 2.5;
    const place = nearby
      ? ''
      : `，在${describePlace(
          prop.pos,
          snapshot.anchors.filter((anchor) => anchor.id !== prop.id),
        )}`;
    objects.push(`${prop.label}（${prop.id}）${relativeFrom(b, prop.pos)}${place}`);
  }
  if (objects.length > 0) lines.push(`物体：${objects.join('；')}。`);

  const hazards: string[] = [];
  for (const prop of snapshot.props) {
    if (prop.kind !== 'hazard') continue;
    const phase =
      prop.phase === 'warning' ? '正在发红预警' : prop.phase === 'active' ? '正在喷发' : '安全';
    hazards.push(`${prop.label}（${prop.id}）${phase}，${relativeFrom(b, prop.pos)}`);
  }
  if (hazards.length > 0) lines.push(`危险：${hazards.join('；')}。`);

  return lines.join('\n');
}

export function formatSituation(
  snapshot: WorldSnapshot,
  level: LevelDef,
  rulesText: string,
  options: { playerText?: string; worldEvent?: string; bStatus?: string } = {},
): string {
  const parts: string[] = [];
  if (options.worldEvent) parts.push(`[世界事件]\n${options.worldEvent}`);
  parts.push(`[当前场景]\n${formatObservation(snapshot, level, { bStatus: options.bStatus })}`);
  parts.push(`[长期规则]\n${rulesText}`);
  if (options.playerText) parts.push(`[${PLAYER_NAME} 说]\n${options.playerText}`);
  return parts.join('\n\n');
}
