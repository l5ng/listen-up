import { COMPANION_NAME, getLevel, levels, PLAYER_NAME, World } from '@listen-up/sim';

function parseLevel(): string | undefined {
  const index = process.argv.indexOf('--level');
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function stepUntil(world: World, promise: Promise<unknown>, maxSteps = 900): Promise<void> {
  let settled = false;
  promise.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  for (let index = 0; index < maxSteps && !settled; index += 1) {
    world.step(1 / 60);
    await Promise.resolve();
    if (index % 30 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function exercise(id: string): Promise<void> {
  const level = getLevel(id);
  const world = new World(level);
  const snapshot = world.getSnapshot();
  console.log(`\n[${id}] ${level.name}`);
  console.log('  目标:', level.goal);
  console.log(
    '  锚点:',
    snapshot.anchors.map((anchor) => `${anchor.id}(${anchor.label})`).join(', '),
  );
  console.log(
    '  可行走锚点:',
    snapshot.anchors
      .filter((anchor) => anchor.reachable)
      .map((anchor) => anchor.id)
      .join(', '),
  );

  if (id === 'sky-01') {
    await stepUntil(world, world.startAction({ kind: 'push', box: 'crate_1', direction: '南' }));
    const crate = world.getSnapshot().props.find((prop) => prop.id === 'crate_1');
    console.log('  推箱后木箱:', crate?.pos);
  } else if (id === 'sky-02') {
    world.a.pos = { x: 4.5, y: 0.02, z: 3.5 };
    for (let index = 0; index < 20; index += 1) world.step(1 / 60);
    const bridge = world.getSnapshot().props.find((prop) => prop.id === 'bridge_1');
    console.log(`  ${PLAYER_NAME} 站机关后桥:`, bridge?.open);
    await stepUntil(world, world.startAction({ kind: 'walk_to', target: 'bridge_center' }));
    await stepUntil(world, world.startAction({ kind: 'walk_to', target: 'exit' }), 1200);
    console.log(`  ${COMPANION_NAME} 位置:`, world.b.pos);
  } else {
    await stepUntil(world, world.startAction({ kind: 'walk_to', target: 'plate_red' }));
    for (let index = 0; index < 10; index += 1) world.step(1 / 60);
    const gate = world.getSnapshot().props.find((prop) => prop.id === 'gate_1');
    console.log(`  ${COMPANION_NAME} 踩住机关后闸门:`, gate?.open);
    const events = [];
    for (let index = 0; index < 900; index += 1) {
      world.step(1 / 60);
      events.push(...world.consumeEvents());
    }
    console.log(
      '  危险事件:',
      events
        .filter((event) => event.kind.startsWith('hazard'))
        .map((event) => event.kind)
        .join(', '),
    );
    console.log(`  ${COMPANION_NAME} 最终位置:`, world.b.pos);
  }
}

async function main(): Promise<void> {
  const requested = parseLevel();
  const list = requested ? [requested] : levels.map((level) => level.id);
  for (const id of list) await exercise(id);
}

void main();
