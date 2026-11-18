/** One engine the app can run in a Worker: a WASI build and the Worker script that hosts it. */
export interface EngineEntry {
  /** the package's name, such as ratchet-0.3.14; also the stem of both files */
  id: string;
  name: string;
  /** Ratchet's own version; null for a release, whose name says it */
  version: string | null;
  kind: 'own engine' | 'release';
  /** the Worker script, with stockfish.js's interface; it loads `wasm` beside it */
  worker: string;
  wasm: string;
  /** each file's sha256, by file name, as its package's SHA256SUMS states it */
  sha256: Record<string, string>;
}

export interface Manifest {
  engines: EngineEntry[];
}

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;

function isEntry(x: unknown): x is EngineEntry {
  if (!isRecord(x)) return false;
  const { id, name, version, kind, worker, wasm, sha256 } = x;
  return (
    typeof id === 'string' &&
    typeof name === 'string' &&
    (version === null || typeof version === 'string') &&
    (kind === 'own engine' || kind === 'release') &&
    typeof worker === 'string' &&
    typeof wasm === 'string' &&
    isRecord(sha256) &&
    Object.values(sha256).every((v) => typeof v === 'string')
  );
}

/** Reads engines.json's text; throws when it is not a manifest. */
export function parseManifest(text: string): Manifest {
  const x: unknown = JSON.parse(text);
  if (!isRecord(x) || !Array.isArray(x.engines) || !x.engines.every(isEntry)) {
    throw new Error('engines.json is not a manifest of engines');
  }
  return { engines: x.engines };
}
