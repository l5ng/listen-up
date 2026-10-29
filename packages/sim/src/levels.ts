import type { BlockSpec, DecorSpec, LevelDef, LevelProp, Vec3 } from './types';
import { COMPANION_NAME, PLAYER_NAME } from './names';

function slab(
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  topY: number,
  kind: BlockSpec['kind'] = 'grass',
): BlockSpec[] {
  const blocks: BlockSpec[] = [];
  for (let x = x0; x < x1; x += 1) {
    for (let z = z0; z < z1; z += 1) {
      blocks.push({ at: { x, y: topY - 1, z }, size: { x: 1, y: 1, z: 1 }, kind });
    }
  }
  return blocks;
}

const prop = <T extends LevelProp>(value: T): T => value;

function decor(id: string, model: string, at: Vec3, scale = 1, rotation = 0): DecorSpec {
  return { id, model, at, scale, rotation };
}

const levelOne: LevelDef = {
  id: 'sky-01',
  name: '垫脚箱',
  summary: `让 ${COMPANION_NAME} 把木箱推下来，帮你爬上去。`,
  goal: '两个人都到达高台上的旗门。',
  spawns: {
    a: { x: 3.5, y: 0.02, z: 4.5 },
    b: { x: 6, y: 2.02, z: 10.5 },
  },
  blocks: [...slab(0, 0, 8, 8, 0), ...slab(7, 0, 12, 7, 2), ...slab(4, 8, 8, 12, 2)],
  props: [
    prop({
      id: 'crate_1',
      kind: 'crate',
      label: '木箱',
      aliases: ['箱子'],
      at: { x: 5.5, y: 2, z: 7.9 },
      size: { x: 1, y: 1, z: 1 },
    }),
    prop({
      id: 'lever_1',
      kind: 'lever',
      label: '拉杆',
      aliases: ['开关', '机关拉杆'],
      at: { x: 10, y: 2, z: 3 },
      size: { x: 0.6, y: 1.2, z: 0.6 },
      link: 'bridge_1',
    }),
    prop({
      id: 'bridge_1',
      kind: 'bridge',
      label: '桥',
      aliases: ['木桥'],
      at: { x: 6, y: 1.85, z: 7 },
      size: { x: 2, y: 0.15, z: 1 },
    }),
    prop({
      id: 'exit',
      kind: 'exit',
      label: '旗门',
      aliases: ['出口', '终点'],
      at: { x: 10, y: 2, z: 1 },
      size: { x: 1.2, y: 1.2, z: 1.2 },
    }),
  ],
  zones: [
    { id: 'yard_a', label: '下层院子', aliases: ['院子', '下面'], at: { x: 3.5, y: 0, z: 4.5 } },
    {
      id: 'high_ledge',
      label: '高台',
      aliases: ['上层高台', '对面高台'],
      at: { x: 9.5, y: 2, z: 3.5 },
    },
    {
      id: 'b_platform',
      label: `${COMPANION_NAME} 所在的上层平台`,
      aliases: ['上层平台', '你所在的平台'],
      at: { x: 6, y: 2, z: 10.5 },
    },
    { id: 'bridge_edge', label: '桥边', aliases: ['桥头'], at: { x: 7, y: 2, z: 7.5 } },
    { id: 'crate_landing', label: '木箱落点', aliases: ['箱子下面'], at: { x: 6, y: 0, z: 6.5 } },
  ],
  cameraYaw: 0.5,
  decor: [
    decor('tree_a', 'tree', { x: 1.2, y: 0, z: 1.2 }, 1.1),
    decor('tree_b', 'tree-pine', { x: 6.8, y: 2, z: 5.7 }, 0.9),
    decor('flowers_a', 'flowers', { x: 2.2, y: 0, z: 6.8 }, 1),
    decor('flowers_b', 'flowers', { x: 9.2, y: 2, z: 6 }, 1),
    decor('sign_a', 'sign', { x: 4.5, y: 0, z: 2.5 }, 1, -0.4),
    decor('rocks_a', 'rocks', { x: 0.8, y: 0, z: 6.8 }, 0.8),
    decor('mushrooms_a', 'mushrooms', { x: 11.2, y: 2, z: 5.2 }, 0.9),
  ],
  briefing: [
    '地图：',
    `- 下层院子（${PLAYER_NAME} 起点）：西侧低处，长着草。`,
    `- 上层平台（${COMPANION_NAME} 起点）：北侧高台，木箱 crate_1 在靠近院子一侧的边缘。`,
    '- 高台：东侧，比院子高 2 米，旗门在高台上。',
    '- 从上层平台到高台之间有一道缺口，拉杆 lever_1 会展开木桥 bridge_1。',
    `关系：木箱被推下后会落在院子的 crate_landing 附近，${PLAYER_NAME} 可以踩着它跳上高台。`,
  ].join('\n'),
  hints: [
    `试试对 ${COMPANION_NAME} 说：把木箱推下来给我垫脚。`,
    `${PLAYER_NAME} 踩上木箱后再跳一次，就能到高台。`,
    `高台上有拉杆，按 E 拉下它，${COMPANION_NAME} 就能过桥。`,
  ],
};

const levelTwo: LevelDef = {
  id: 'sky-02',
  name: '等我过桥',
  summary: `让 ${COMPANION_NAME} 等你踩住机关，再过桥。`,
  goal: '两个人都到达西岛的旗门。',
  spawns: {
    a: { x: 2, y: 0.02, z: 4 },
    b: { x: 13, y: 0.02, z: 4 },
  },
  blocks: [...slab(0, 0, 6, 8, 0), ...slab(10, 0, 16, 8, 0)],
  props: [
    prop({
      id: 'plate_blue',
      kind: 'plate',
      label: '蓝色机关',
      aliases: ['蓝机关', '蓝色按钮'],
      at: { x: 4, y: 0, z: 3 },
      size: { x: 1, y: 0.1, z: 1 },
      link: 'bridge_1',
    }),
    prop({
      id: 'bridge_1',
      kind: 'bridge',
      label: '桥',
      aliases: ['木桥'],
      at: { x: 6, y: -0.15, z: 3 },
      size: { x: 4, y: 0.15, z: 2 },
    }),
    prop({
      id: 'exit',
      kind: 'exit',
      label: '旗门',
      aliases: ['出口', '终点'],
      at: { x: 1, y: 0, z: 1 },
      size: { x: 1.2, y: 1.2, z: 1.2 },
    }),
  ],
  zones: [
    {
      id: 'west_island',
      label: '西岛',
      aliases: [`${PLAYER_NAME} 这一边`, '出发的岛'],
      at: { x: 2, y: 0, z: 4 },
    },
    {
      id: 'east_island',
      label: '东岛',
      aliases: [`${COMPANION_NAME} 那一侧`, '对面岛'],
      at: { x: 13, y: 0, z: 4 },
    },
    { id: 'bridge_center', label: '桥中央', aliases: ['桥上'], at: { x: 8, y: 0, z: 4 } },
    { id: 'exit_side', label: '旗门附近', aliases: ['终点旁'], at: { x: 2, y: 0, z: 1.5 } },
  ],
  cameraYaw: 0.25,
  decor: [
    decor('tree_a', 'tree', { x: 1, y: 0, z: 6.5 }, 1.1),
    decor('tree_b', 'tree-pine', { x: 14.5, y: 0, z: 6.8 }, 1),
    decor('flowers_a', 'flowers', { x: 5, y: 0, z: 6.8 }, 1),
    decor('sign_a', 'sign', { x: 3, y: 0, z: 2.2 }, 1, 0.3),
    decor('rock_a', 'rocks', { x: 11.5, y: 0, z: 1.2 }, 0.8),
  ],
  briefing: [
    '地图：',
    `- 西岛（${PLAYER_NAME} 起点）：旗门在西岛西南角；蓝色机关 plate_blue 在西岛中部。`,
    `- 东岛（${COMPANION_NAME} 起点）：隔着 4 米宽的缺口，与西岛相望。`,
    '- 桥 bridge_1 只在蓝色机关被踩住时展开。',
    `关系：${PLAYER_NAME} 踩住机关，桥才会出现；${COMPANION_NAME} 必须在桥展开时过桥。${PLAYER_NAME} 离开机关，桥会收起。`,
  ].join('\n'),
  hints: [
    `对 ${COMPANION_NAME} 说：等我踩上蓝色机关，你再过桥。`,
    `${PLAYER_NAME} 先站上蓝色机关，等 ${COMPANION_NAME} 走到西岛再离开。`,
  ],
};

const levelThree: LevelDef = {
  id: 'sky-03',
  name: '红地板',
  summary: `${COMPANION_NAME} 要替你开门，也要躲开会喷发的红地板。`,
  goal: '两个人都到达东侧的旗门。',
  spawns: {
    a: { x: 2, y: 0.02, z: 4 },
    b: { x: 12, y: 0.02, z: 6 },
  },
  blocks: [...slab(0, 0, 16, 8, 0)],
  props: [
    prop({
      id: 'gate_1',
      kind: 'gate',
      label: '闸门',
      aliases: ['门', '大门'],
      at: { x: 8, y: 0, z: 0 },
      size: { x: 0.4, y: 2.6, z: 8 },
    }),
    prop({
      id: 'plate_red',
      kind: 'plate',
      label: '红色机关',
      aliases: ['红机关', '红色按钮'],
      at: { x: 11.5, y: 0, z: 3.5 },
      size: { x: 1, y: 0.1, z: 1 },
      link: 'gate_1',
    }),
    prop({
      id: 'hazard_1',
      kind: 'hazard',
      label: '红地板',
      aliases: ['喷发地板', '危险地板'],
      at: { x: 10.5, y: 0, z: 2.5 },
      size: { x: 3, y: 0.1, z: 3 },
      cycle: { warning: 3, active: 1.5, safe: 7.5, offset: 5 },
    }),
    prop({
      id: 'exit',
      kind: 'exit',
      label: '旗门',
      aliases: ['出口', '终点'],
      at: { x: 14.5, y: 0, z: 1 },
      size: { x: 1.2, y: 1.2, z: 1.2 },
    }),
  ],
  zones: [
    { id: 'safe_pad', label: '安全垫', aliases: ['安全区', '旁边'], at: { x: 15, y: 0, z: 7 } },
    { id: 'gate_side', label: '闸门旁', aliases: ['门边'], at: { x: 7, y: 0, z: 4 } },
    {
      id: 'east_side',
      label: '东侧',
      aliases: [`${COMPANION_NAME} 那一侧`, '出口那侧'],
      at: { x: 14, y: 0, z: 4 },
    },
  ],
  cameraYaw: 0.75,
  decor: [
    decor('tree_a', 'tree', { x: 1.2, y: 0, z: 6.8 }, 1.1),
    decor('tree_b', 'tree-pine', { x: 10, y: 0, z: 7.2 }, 0.9),
    decor('flowers_a', 'flowers', { x: 5, y: 0, z: 1.2 }, 1),
    decor('sign_red', 'sign', { x: 9.5, y: 0, z: 1 }, 1, 0.2),
    decor('rocks_b', 'rocks', { x: 7, y: 0, z: 7 }, 0.8),
  ],
  briefing: [
    '地图：',
    `- 这是一整块长岛，西边是 ${PLAYER_NAME} 起点，东边是 ${COMPANION_NAME} 起点。`,
    `- 闸门 gate_1 横在中间，挡住 ${PLAYER_NAME} 去东侧旗门的路。`,
    '- 红色机关 plate_red 在东侧红地板 hazard_1 中间；踩住它，闸门才会打开。',
    '- 红地板会循环：预警、喷发、安全。喷发时站在上面会被送回安全点。',
    '- 安全垫 safe_pad 在红地板东南侧，不在危险范围内。',
    `关系：${COMPANION_NAME} 踩住红色机关，${PLAYER_NAME} 才能穿过闸门；${COMPANION_NAME} 离开机关，闸门会关闭。`,
  ].join('\n'),
  hints: [
    `对 ${COMPANION_NAME} 说：站到红色机关上，等我穿过闸门。`,
    `红地板预警时，让 ${COMPANION_NAME} 跳到安全垫；等它安全了再让它回去。`,
    `${PLAYER_NAME} 穿过闸门后，就可以让 ${COMPANION_NAME} 离开机关，一起到旗门。`,
  ],
};

export const levels: LevelDef[] = [levelOne, levelTwo, levelThree];

export function getLevel(id: string): LevelDef {
  const level = levels.find((entry) => entry.id === id);
  if (!level) throw new Error(`unknown level: ${id}`);
  return level;
}

export const defaultLevelId = levelOne.id;
