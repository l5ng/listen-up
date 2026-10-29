import { describe, expect, it } from 'vitest';
import { getLevel } from './levels';
import { World } from './world';
import type { ActionResult } from './types';

async function advance(
  world: World,
  promise: Promise<ActionResult>,
  maxSteps = 900,
): Promise<ActionResult> {
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
  return promise;
}

describe('world', () => {
  it('lets Echo push the crate off the ledge into the yard', async () => {
    const world = new World(getLevel('sky-01'));
    const result = await advance(
      world,
      world.startAction({ kind: 'push', box: 'crate_1', to: 'yard_a' }),
    );
    expect(result.message).toContain('木箱');
    const crate = world.getSnapshot().props.find((prop) => prop.id === 'crate_1');
    expect(crate?.pos.y).toBe(0);
    expect(crate?.pos.z).toBeCloseTo(6.6, 1);
  });

  it('requires Dash on the plate before Echo can cross the bridge', async () => {
    const world = new World(getLevel('sky-02'));
    await expect(world.startAction({ kind: 'move', target: 'exit' })).rejects.toMatchObject({
      code: 'NO_PATH',
    });

    const waiting = advance(
      world,
      world.startAction({
        kind: 'wait_until',
        condition: { kind: 'player_on', target: 'plate_blue' },
        timeoutSeconds: 2,
      }),
    );
    world.a.pos = { x: 4.5, y: 0.02, z: 3.5 };
    await waiting;
    expect(world.getSnapshot().bridgeStates.bridge_1).toBe(true);

    const moving = advance(world, world.startAction({ kind: 'move', target: 'exit' }));
    await moving;
    expect(world.b.pos.x).toBeLessThan(3);
  });

  it('opens the gate while Echo holds the red plate and respawns Echo when it stays in the hazard', async () => {
    const world = new World(getLevel('sky-03'));
    await advance(world, world.startAction({ kind: 'move', target: 'plate_red' }));
    for (let index = 0; index < 10; index += 1) world.step(1 / 60);
    const gate = world.getSnapshot().props.find((prop) => prop.id === 'gate_1');
    expect(gate?.open).toBe(true);

    const events = [];
    for (let index = 0; index < 900; index += 1) {
      world.step(1 / 60);
      events.push(...world.consumeEvents());
    }
    expect(events.some((event) => event.kind === 'hazard_warning')).toBe(true);
    expect(events.some((event) => event.kind === 'hazard_hit_b')).toBe(true);
    expect(world.b.pos.x).toBe(12);
    expect(world.b.pos.z).toBe(6);
    expect(world.b.pos.y).toBeLessThan(0.05);
  });

  it('wins only when both characters stand in the exit', () => {
    const world = new World(getLevel('sky-01'));
    world.a.pos = { x: 10.6, y: 2, z: 1.6 };
    world.b.pos = { x: 10.6, y: 2, z: 1.6 };
    world.step(1 / 60);
    expect(world.status).toBe('won');
    expect(world.consumeEvents().some((event) => event.kind === 'level_won')).toBe(true);
  });
});
