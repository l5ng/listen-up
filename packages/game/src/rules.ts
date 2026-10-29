import type { StandingRule } from './types';

export class RuleStore {
  private rules: StandingRule[] = [];
  private counter = 0;

  list(): StandingRule[] {
    return this.rules.map((rule) => ({ ...rule }));
  }

  add(text: string): StandingRule {
    const clean = text.trim().slice(0, 240);
    if (!clean) throw new Error('规则内容不能为空。');
    const existing = this.rules.find((rule) => rule.text === clean);
    if (existing) return { ...existing };
    this.counter += 1;
    const rule = { id: `rule_${this.counter}`, text: clean };
    this.rules.push(rule);
    return { ...rule };
  }

  remove(id: string): boolean {
    const index = this.rules.findIndex((rule) => rule.id === id);
    if (index < 0) return false;
    this.rules.splice(index, 1);
    return true;
  }

  clear(): void {
    this.rules = [];
  }

  format(): string {
    if (this.rules.length === 0) return '（无）';
    return this.rules.map((rule, index) => `${index + 1}. ${rule.text}`).join('\n');
  }
}
