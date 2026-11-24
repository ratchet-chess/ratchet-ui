import { describe, expect, it } from 'vitest';
import pkg from '../package.json';
import { libraries } from './credits.ts';

describe('the credits', () => {
  it('list every dependency the built app ships', () => {
    const listed = libraries.map((l) => l.name);
    for (const dep of Object.keys(pkg.dependencies)) expect(listed).toContain(dep);
  });
});
