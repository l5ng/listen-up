import { describe, expect, it } from 'vitest';
import { copy } from './copy';

describe('static UI copy', () => {
  it('contains no emoji', () => {
    const text = Object.values(copy).join('\n');
    expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});
