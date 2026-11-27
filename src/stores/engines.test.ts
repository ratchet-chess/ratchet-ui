import { describe, expect, it } from 'vitest';
import type { ServedEngine } from '../engine/manifest.ts';
import { defaultEngine, defaultEngineId, isUserEngine, isValidEngineId } from './engines.ts';

describe('engine id helpers', () => {
  it('derives a clean default engine id from a filename', () => {
    expect(defaultEngineId('ratchet-0.3.14.wasm')).toBe('ratchet-0.3.14');
    expect(defaultEngineId('My Engine v2.WASM')).toBe('My-Engine-v2');
    expect(defaultEngineId('path/to/stockfish 16.wasm')).toBe('stockfish-16');
    expect(defaultEngineId('..wasm')).toBe('engine');
  });

  it('validates safe engine identifiers', () => {
    expect(isValidEngineId('my-engine-1.0')).toBe(true);
    expect(isValidEngineId('my-engine (2)')).toBe(true);
    expect(isValidEngineId('')).toBe(false);
    expect(isValidEngineId(' padded ')).toBe(false);
    expect(isValidEngineId('.')).toBe(false);
    expect(isValidEngineId('..')).toBe(false);
    expect(isValidEngineId('a/b')).toBe(false);
    expect(isValidEngineId('a#b')).toBe(false);
    expect(isValidEngineId('foo.wasm')).toBe(false);
  });

  it('validates persisted UserEngine entries', () => {
    expect(
      isUserEngine({
        id: 'test-engine',
        name: 'Test Engine 1.0',
        wasm: 'test-engine.wasm',
        bytes: 1234,
        sha256: 'deadbeef',
        added: 1700000000000,
      }),
    ).toBe(true);
    expect(
      isUserEngine({
        id: 'bad/id',
        name: 'Bad',
        wasm: 'bad.wasm',
        bytes: 100,
        sha256: 'abc',
        added: 0,
      }),
    ).toBe(false);
    expect(
      isUserEngine({
        id: 'zero',
        name: 'Zero',
        wasm: 'zero.wasm',
        bytes: 0,
        sha256: 'abc',
        added: 0,
      }),
    ).toBe(false);
  });

  it('prefers the newest Ratchet build over alphabetically later engines', () => {
    const mk = (id: string): ServedEngine => ({
      id,
      name: id,
      version: null,
      wasm: `${id}.wasm`,
      bytes: 100,
      sha256: 'abc',
      source: 'test',
      license: 'GPL-3.0-or-later',
    });
    expect(
      defaultEngine([mk('clovis-iii'), mk('ratchetHCE-0.4.0'), mk('stockfish-10'), mk('zurichess')])
        ?.id,
    ).toBe('ratchetHCE-0.4.0');
    expect(defaultEngine([mk('clovis-iii'), mk('stockfish-10')])?.id).toBe('stockfish-10');
    expect(defaultEngine([])).toBeUndefined();
  });
});
