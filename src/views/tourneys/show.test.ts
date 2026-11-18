import { describe, expect, it } from 'vitest';
import { cloneName } from './show.ts';

describe('cloneName', () => {
  it('numbers a clone after the highest number taken', () => {
    expect(cloneName('Swiss of 5', ['Swiss of 5'])).toBe('Swiss of 5 (2)');
    expect(cloneName('Swiss of 5', ['Swiss of 5', 'Swiss of 5 (2)', 'Swiss of 5 (4)'])).toBe(
      'Swiss of 5 (5)',
    );
  });

  it('counts a clone of a clone from the first name', () => {
    expect(cloneName('Swiss of 5 (2)', ['Swiss of 5', 'Swiss of 5 (2)'])).toBe('Swiss of 5 (3)');
  });

  it('leaves names that only start alike alone', () => {
    expect(cloneName('a vs b', ['a vs b', 'a vs bc (7)', 'a vs b (x)'])).toBe('a vs b (2)');
  });
});
