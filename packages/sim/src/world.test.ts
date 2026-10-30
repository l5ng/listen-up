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
      world.startAction({ kind: 'push', box: 'crate_1', direction: '北' }),
    );
    expect(result.message).toContain('木箱');
    const crate = world.getSnapshot().props.find((prop) => prop.id === 'crate_1');
    expect(crate?.pos.y).toBe(0);
    expect(crate?.pos.z).toBeLessThan(7.5);
  });

  it('stops a direction walk at a ledge instead of falling off', async () => {
    const world = new World(getLevel('sky-01'));
    // Echo's platform is 2m above the yard; walking south leads to the edge.
    const result = await advance(
      world,
      world.startAction({ kind: 'walk', direction: '南', seconds: 5 }),
    );
    expect(result.message).toContain('边缘');
    expect(world.b.pos.y).toBeGreaterThan(1.5); // still on the upper platform
    expect(world.b.respawnCooldown ?? 0).toBe(0);
  });

  it('reports BLOCKED when a direction walk runs into a wall', async () => {
    const world = new World(getLevel('sky-03'));
    // Echo faces the closed gate when walking west from its eastern spawn.
    const failure = await advance(
      world,
      world.startAction({ kind: 'walk', direction: '西', seconds: 5 }),
    ).then(
      () => undefined,
      (error: { code?: string }) => error,
    );
    expect(failure?.code).toBe('BLOCKED');
    expect(world.b.pos.x).toBeGreaterThan(7); // stopped before/at the gate
  });

  it('resolves a jump once Echo lands again', async () => {
    const world = new World(getLevel('sky-03'));
    const result = await advance(world, world.startAction({ kind: 'jump', direction: '北' }));
    expect(result.message).toContain('跳');
    expect(world.b.grounded).toBe(true);
    // Jump moved Echo some distance north but it landed safely.
    expect(world.b.pos.z).toBeLessThan(6.5);
  });

  it('requires Dash on the plate before Echo can cross the bridge', async () => {
    const world = new World(getLevel('sky-02'));
    // Without the bridge, walking toward the exit stops at the gap edge.
    const result = await advance(world, world.startAction({ kind: 'walk_to', target: 'exit' }));
    expect(result.message).toContain('边缘');
    expect(world.b.pos.x).toBeGreaterThan(10);

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

    // Straight-line steering: cross via the bridge center first, then head
    // to the exit, because a direct diagonal leaves the bridge's width.
    await advance(world, world.startAction({ kind: 'walk_to', target: 'bridge_center' }));
    const moving = advance(world, world.startAction({ kind: 'walk_to', target: 'exit' }), 1200);
    await moving;
    expect(world.b.pos.x).toBeLessThan(3);
  });

  it('opens the gate while Echo holds the red plate and respawns Echo when it stays in the hazard', async () => {
    const world = new World(getLevel('sky-03'));
    await advance(world, world.startAction({ kind: 'walk_to', target: 'plate_red' }));
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

  it('only wins when both characters are at the exit ring', () => {
    const world = new World(getLevel('sky-02'));
    const exit = world.getSnapshot().props.find((prop) => prop.id === 'exit');
    expect(exit).toBeDefined();
    if (!exit) return;
    world.a.pos = { x: exit.pos.x, y: 0.02, z: exit.pos.z };
    world.b.pos = { x: exit.pos.x + 1.7, y: 0.02, z: exit.pos.z };
    world.step(1 / 60);
    expect(world.status).toBe('playing');

    world.b.pos = { x: exit.pos.x + 1.4, y: 0.02, z: exit.pos.z };
    world.step(1 / 60);
    expect(world.status).toBe('won');
  });

  it('keeps the gate open while a character stands inside its frame', async () => {
    const world = new World(getLevel('sky-03'));
    // Echo stands on plate_red so the gate wants to stay open, then walks off;
    // Dash is inside the gate frame at x ∈ [8, 8.4], z = 4.
    await advance(world, world.startAction({ kind: 'walk_to', target: 'plate_red' }));
    for (let index = 0; index < 10; index += 1) world.step(1 / 60);
    expect(world.getSnapshot().props.find((prop) => prop.id === 'gate_1')?.open).toBe(true);

    world.a.pos = { x: 8.2, y: 0.02, z: 4 };
    // Echo leaves the plate → gate wants to close but Dash blocks it.
    world.b.pos = { x: 15, y: 0.02, z: 7 };
    for (let index = 0; index < 30; index += 1) world.step(1 / 60);
    expect(world.getSnapshot().props.find((prop) => prop.id === 'gate_1')?.open).toBe(true);
    expect(world.a.pos.y).toBeLessThan(0.1); // not teleported to the gate top
  });

  it('does not let an embedded character walk through the closed gate', () => {
    const world = new World(getLevel('sky-03'));
    // Reproduce the review experiment: embed Dash inside the closed gate and walk east.
    world.a.pos = { x: 8.2, y: 0.02, z: 4 };
    for (let index = 0; index < 60; index += 1) {
      world.setPlayerInput({ x: 1, z: 0, jump: false });
      world.step(1 / 60);
    }
    expect(world.a.pos.x).toBeLessThan(8 - 0.34); // ejected to the west face, not past 8.4
    expect(world.a.pos.x).toBeGreaterThan(6);
    expect(world.a.pos.y).toBeLessThan(0.5);
  });

  it('lets the player shove a crate by walking into it', () => {
    const world = new World(getLevel('sky-01'));
    // Teleport the crate into the yard, then stand east of it and walk west:
    // the crate must be shoved west too, with the player staying behind it.
    const crates = (
      world as unknown as {
        crates: Map<string, { pos: { x: number; y: number; z: number } }>;
      }
    ).crates;
    const crateObj = crates.get('crate_1');
    expect(crateObj).toBeDefined();
    if (!crateObj) return;
    crateObj.pos = { x: 5.5, y: 0, z: 3 };
    world.a.pos = { x: 7, y: 0.02, z: 3 };
    const before = crateObj.pos.x;
    for (let index = 0; index < 90; index += 1) {
      world.setPlayerInput({ x: -1, z: 0, jump: false });
      world.step(1 / 60);
    }
    expect(crateObj.pos.x).toBeLessThan(before - 0.5); // shoved west
    expect(world.a.pos.x).toBeGreaterThan(crateObj.pos.x); // still east of it
    expect(world.a.pos.y).toBeLessThan(0.5); // walked on the ground, not on top
  });

  it('stops Echo pushing a landed crate further and lets the player finish the job', async () => {
    const world = new World(getLevel('sky-01'));
    // First push drops the crate into the yard.
    const first = await advance(
      world,
      world.startAction({ kind: 'push', box: 'crate_1', direction: '北' }),
    );
    expect(first.message).toContain('木箱');
    const landed = world.getSnapshot().props.find((prop) => prop.id === 'crate_1');
    expect(landed).toBeDefined();
    if (!landed) return;
    expect(landed.pos.y).toBe(0);
    const landingZ = landed.pos.z;
    // The push stopped driving the crate the moment it left support: it must
    // land right below the platform edge instead of sliding across the yard.
    expect(landingZ).toBeGreaterThan(6.5);
    expect(landingZ).toBeLessThan(7.5);

    // Echo is still on the platform; there is no stand point behind the crate,
    // so a second Echo push must fail instead of teleporting it anywhere.
    const second = await advance(
      world,
      world.startAction({ kind: 'push', box: 'crate_1', direction: '北' }),
    ).then(
      () => undefined,
      (error: { code?: string }) => error,
    );
    expect(second?.code).toBe('NO_PATH');
    const after = world.getSnapshot().props.find((prop) => prop.id === 'crate_1');
    expect(after).toBeDefined();
    if (!after) return;
    expect(after.pos.z).toBe(landingZ); // unchanged

    // The player, standing in the yard beside the platform, can keep
    // shoving the crate west along the ground (the south side of the crate
    // hangs over the void, so north/east/west shoves are the reachable ones).
    world.a.pos = { x: after.pos.x + 1.5, y: 0.02, z: after.pos.z };
    for (let index = 0; index < 90; index += 1) {
      world.setPlayerInput({ x: -1, z: 0, jump: false });
      world.step(1 / 60);
    }
    const final = world.getSnapshot().props.find((prop) => prop.id === 'crate_1');
    expect(final).toBeDefined();
    if (!final) return;
    expect(final.pos.x).toBeLessThan(after.pos.x - 0.5); // shoved west by the player
    expect(final.pos.z).toBe(landingZ); // unchanged along z
  });

  it('fails a blocked push when a character stands in the crate path', async () => {
    const world = new World(getLevel('sky-01'));
    // First push drops the crate into the yard at ground level.
    await advance(world, world.startAction({ kind: 'push', box: 'crate_1', direction: '北' }));
    const landed = world.getSnapshot().props.find((prop) => prop.id === 'crate_1');
    expect(landed).toBeDefined();
    if (!landed) return;
    expect(landed.pos.y).toBe(0);

    // Push again eastward along the ground. Dash stands in the path so the
    // crate must stop instead of sweeping him away.
    world.a.pos = { x: landed.pos.x + 1.3, y: 0.02, z: landed.pos.z };
    world.b.pos = { x: landed.pos.x - 1.5, y: 0.02, z: landed.pos.z };
    const beforeX = landed.pos.x;
    const result = await advance(
      world,
      world.startAction({ kind: 'push', box: 'crate_1', direction: '东' }),
    );
    expect(result.message).toContain('挡住');
    const crate = world.getSnapshot().props.find((prop) => prop.id === 'crate_1');
    expect(crate).toBeDefined();
    if (!crate) return;
    // The crate stopped short of Dash instead of pushing through him.
    expect(crate.pos.x).toBeLessThan(beforeX + 1.0);
    expect(crate.pos.x).toBeGreaterThan(beforeX - 0.1);
  });

  it('wins when Dash joins Echo at the edge of the exit ring', async () => {
    const world = new World(getLevel('sky-02'));
    for (let index = 0; index < 10; index += 1) {
      world.a.pos = { x: 4.5, y: 0.02, z: 3.5 };
      world.step(1 / 60);
    }
    await advance(world, world.startAction({ kind: 'walk_to', target: 'bridge_center' }));
    await advance(world, world.startAction({ kind: 'walk_to', target: 'exit' }), 1200);
    const exit = world.getSnapshot().props.find((prop) => prop.id === 'exit');
    expect(exit).toBeDefined();
    if (!exit) return;
    const echoDistance = Math.hypot(world.b.pos.x - exit.pos.x, world.b.pos.z - exit.pos.z);
    expect(echoDistance).toBeLessThan(0.9);

    world.a.pos = { x: exit.pos.x - 1, y: 0.02, z: exit.pos.z };
    for (let index = 0; index < 15; index += 1) world.step(1 / 60);
    expect(world.status).toBe('won');
  });
});
