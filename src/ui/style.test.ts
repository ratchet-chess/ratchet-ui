import { describe, expect, it } from 'vitest';

/** the app's sources a reader sees drawn: views, components and their helpers, by path */
const SOURCES = import.meta.glob<string>(['../**/*.vue', '../**/*.ts', '!../**/*.test.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** what style.css names instead: a color by its role, a size from the type scale */
const BANNED: [RegExp, string][] = [
  [/\b[a-z-]+-\[#[0-9a-fA-F]+\]/g, 'a raw color in a class; name it in style.css'],
  [
    /\b(?:fill|stroke|color|background(?:-color)?)\s*[:=]\s*["']?#[0-9a-fA-F]{3,8}\b/g,
    'a raw color',
  ],
  [/\brgba?\(/g, 'a raw color'],
  [/\btext-\[(?:\d|calc)[^\]]*\]/g, 'a font size outside the type scale'],
  [/\btext-(?:xs|sm|lg|xl|[2-9]xl)\b/g, "Tailwind's own size; use the type scale"],
  [/\bfont-size\s*:/g, 'a font size outside the type scale'],
];

describe('the look', () => {
  it('draws every color and size from style.css', () => {
    // the glob finds the views, so an empty list means a moved folder, not a clean one
    expect(Object.keys(SOURCES)).toContain('../views/TournamentsView.vue');
    const found: string[] = [];
    for (const [file, text] of Object.entries(SOURCES)) {
      for (const [pattern, why] of BANNED)
        for (const m of text.matchAll(pattern)) {
          const line = text.slice(0, m.index).split('\n').length;
          found.push(`${file.slice(3)}:${line} ${m[0]} (${why})`);
        }
    }
    expect(found).toEqual([]);
  });
});
