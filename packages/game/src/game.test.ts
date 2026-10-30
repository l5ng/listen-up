import { describe, expect, it } from 'vitest';
import { COMPANION_NAME, World, getLevel } from '@listen-up/sim';
import { RuleStore } from './rules';
import { ToolExecutor } from './tools';
import { formatObservation } from './observation';

describe('game tools and observation', () => {
  it('formats anchors and mechanisms for the model', () => {
    const level = getLevel('sky-01');
    const world = new World(level);
    const text = formatObservation(world.getSnapshot(), level);
    expect(text).toContain('木箱');
    expect(text).toContain('crate_1');
    expect(text).toContain('旗门');
    expect(text).toContain(`你（${COMPANION_NAME}）`);
  });

  it('remembers and forgets a rule through the tool surface', async () => {
    const level = getLevel('sky-01');
    const world = new World(level);
    const rules = new RuleStore();
    const executor = new ToolExecutor({ world, rules, onRulesChanged: () => undefined });
    const remembered = await executor.execute(
      {
        id: 'call_1',
        type: 'function',
        function: { name: 'remember_rule', arguments: '{"text":"不要踩红色地板"}' },
      },
      new AbortController().signal,
    );
    expect(remembered.ok).toBe(true);
    expect(rules.list()).toHaveLength(1);
    const rule = rules.list()[0];
    expect(rule?.text).toBe('不要踩红色地板');
    const forgotten = await executor.execute(
      {
        id: 'call_2',
        type: 'function',
        function: { name: 'forget_rule', arguments: JSON.stringify({ id: rule?.id }) },
      },
      new AbortController().signal,
    );
    expect(forgotten.ok).toBe(true);
    expect(rules.list()).toHaveLength(0);
  });

  it('returns actionable errors for unknown targets', async () => {
    const level = getLevel('sky-01');
    const world = new World(level);
    const rules = new RuleStore();
    const executor = new ToolExecutor({ world, rules, onRulesChanged: () => undefined });
    const result = await executor.execute(
      {
        id: 'call_1',
        type: 'function',
        function: { name: 'walk_to', arguments: '{"target":"moon"}' },
      },
      new AbortController().signal,
    );
    expect(result.ok).toBe(false);
    expect(result.summary).toContain('moon');
  });
});
