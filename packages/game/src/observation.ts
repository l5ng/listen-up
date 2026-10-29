import type { AnchorSnapshot, LevelDef, Vec3, WorldSnapshot } from '@listen-up/sim';
import type { ObservationOptions } from './types';

function fmt(value: number): string {
  return value.toFixed(1);
}

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
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

export function formatObservation(
  snapshot: WorldSnapshot,
  level: LevelDef,
  options: ObservationOptions = {},
): string {
  const lines: string[] = [];
  const bPlace = describePlace(snapshot.b.pos, snapshot.anchors);
  const aPlace = describePlace(snapshot.a.pos, snapshot.anchors);
  lines.push(
    `你（B）：在${bPlace}，${snapshot.b.grounded ? '站立' : '空中'}${options.bStatus ? `，${options.bStatus}` : ''}。`,
  );
  lines.push(`A（玩家）：在${aPlace}，距你 ${fmt(distance(snapshot.a.pos, snapshot.b.pos))} 米。`);
  lines.push(`目标：${level.goal}`);

  const mechanisms: string[] = [];
  for (const prop of snapshot.props) {
    if (prop.kind === 'gate')
      mechanisms.push(`${prop.label}（${prop.id}）${prop.open ? '打开' : '关闭'}`);
    if (prop.kind === 'bridge')
      mechanisms.push(`${prop.label}（${prop.id}）${prop.open ? '展开' : '收起'}`);
    if (prop.kind === 'plate')
      mechanisms.push(`${prop.label}（${prop.id}）${prop.pressed ? '被踩住' : '未被踩住'}`);
    if (prop.kind === 'lever')
      mechanisms.push(`${prop.label}（${prop.id}）${prop.on ? '已拉下' : '未拉下'}`);
  }
  if (mechanisms.length > 0) lines.push(`机关：${mechanisms.join('；')}。`);

  const objects: string[] = [];
  for (const prop of snapshot.props) {
    if (prop.kind === 'crate')
      objects.push(`${prop.label}（${prop.id}）在${describePlace(prop.pos, snapshot.anchors)}`);
    if (prop.kind === 'exit')
      objects.push(`${prop.label}（${prop.id}）在${describePlace(prop.pos, snapshot.anchors)}`);
  }
  if (objects.length > 0) lines.push(`物体：${objects.join('；')}。`);

  const hazards: string[] = [];
  for (const prop of snapshot.props) {
    if (prop.kind !== 'hazard') continue;
    const phase =
      prop.phase === 'warning' ? '预警中' : prop.phase === 'active' ? '正在喷发' : '安全';
    const seconds = prop.secondsUntilPhase !== undefined ? Math.ceil(prop.secondsUntilPhase) : 0;
    hazards.push(`${prop.label}（${prop.id}）${phase}，约 ${seconds} 秒后变化`);
  }
  if (hazards.length > 0) lines.push(`危险：${hazards.join('；')}。`);

  const reachable = snapshot.anchors.filter((anchor) => anchor.reachable);
  if (reachable.length > 0) {
    lines.push(
      `可达：${reachable.map((anchor) => `${anchor.label}（${anchor.id}）`).join('、')}。`,
    );
  }
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
  if (options.playerText) parts.push(`[A 说]\n${options.playerText}`);
  return parts.join('\n\n');
}
