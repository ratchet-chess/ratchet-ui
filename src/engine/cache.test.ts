import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  loadEngineCache,
  persistEngineInspection,
  persistEngineProbe,
  persistEngineWasi,
  type EngineInspection,
  type EngineProbe,
  type WasiCheckReport,
} from './cache.ts';

const storage = new Map<string, string>();
const fakeStorage: Storage = {
  get length() {
    return storage.size;
  },
  clear: () => storage.clear(),
  getItem: (k: string) => storage.get(k) ?? null,
  key: (i: number) => [...storage.keys()][i] ?? null,
  removeItem: (k: string) => {
    storage.delete(k);
  },
  setItem: (k: string, v: string) => {
    storage.set(k, v);
  },
};

const origLocalStorageDesc = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

beforeEach(() => {
  storage.clear();
  Object.defineProperty(globalThis, 'localStorage', {
    value: fakeStorage,
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  if (origLocalStorageDesc) {
    Object.defineProperty(globalThis, 'localStorage', origLocalStorageDesc);
  }
});

const sampleInspection: EngineInspection = {
  state: 'done',
  idName: 'TestEngine',
  idAuthor: 'Author',
  startMs: 12,
  options: [
    { name: 'Hash', type: 'spin', defaultValue: '16', range: '1..1024', min: 1, max: 1024 },
  ],
  error: '',
};

const sampleProbe: EngineProbe = {
  state: 'done',
  suite: 'startpos',
  depth: 10,
  startMs: 15,
  rows: [
    { label: 'Startpos', state: 'done', last: null, nodes: 5000, elapsedMs: 50, best: 'e2e4' },
  ],
  error: '',
};

const sampleWasi: WasiCheckReport = {
  fileName: 'test.wasm',
  size: 1024,
  state: 'pass',
  info: {
    profile: 'polls',
    requires: [],
    threadSpawn: false,
    sharedMemory: false,
    atomics: false,
    exceptionHandling: false,
    relaxed: [],
  },
  identity: { name: 'TestEngine', author: 'Author' },
  results: [{ name: 'uci', status: 'pass', detail: 'ok' }],
  fatalError: '',
  staticNote: '',
};

describe('engine cache persistence and validation', () => {
  it('merges inspection, probe, and WASI reports without dropping sibling engines or fields', () => {
    persistEngineInspection('eng-a', 'sha-a', sampleInspection);
    persistEngineProbe('eng-a', 'sha-a', sampleProbe);
    persistEngineWasi('eng-a', 'sha-a', sampleWasi);
    persistEngineInspection('eng-b', 'sha-b', sampleInspection);

    const loaded = loadEngineCache();
    expect(loaded['eng-a']?.inspection).toEqual(sampleInspection);
    expect(loaded['eng-a']?.probe).toEqual(sampleProbe);
    expect(loaded['eng-a']?.wasi).toEqual(sampleWasi);
    expect(loaded['eng-b']?.inspection).toEqual(sampleInspection);
  });

  it('drops malformed nested options, probe rows, and WASI reports on load', () => {
    fakeStorage.setItem(
      'ratchet-ui.engine-cache',
      JSON.stringify({
        bad: {
          sha256: 'sha-bad',
          inspection: { ...sampleInspection, options: [{ name: 42 }] },
          probe: { ...sampleProbe, rows: [{ label: 'Startpos', state: 'bogus' }] },
          wasi: { ...sampleWasi, info: { profile: 'polls', requires: 'not-array' } },
        },
      }),
    );

    const loaded = loadEngineCache();
    expect(loaded.bad).toEqual({ sha256: 'sha-bad' });
  });
});
