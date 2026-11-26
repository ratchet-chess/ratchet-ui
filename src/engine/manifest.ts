import { isEngineMeta, type EngineMeta } from './meta.ts';

/** One engine the app serves: a WASI build that speaks UCI, run in the app's own host. */
export interface ServedEngine {
  /** the build's file name without .wasm, such as ratchet-0.3.14 */
  id: string;
  name: string;
  version: string | null;
  /** the build's file, in public/engines/ */
  wasm: string;
  /** raw .wasm size in bytes; null if absent from an older manifest */
  bytes: number | null;
  sha256: string;
  /** `<owner/repo> <tag>` for a GitHub release; `local` for a build on this machine */
  source: string;
  /** SPDX identifier; null for a local build */
  license: string | null;
  /** optional provenance, history, and CPW features from `<id>.meta.json` */
  meta?: EngineMeta;
}

/** public/engines.json, which scripts/engines.ts writes from engines.json and engines.local.json */
export interface Served {
  /** the host's Worker script, in public/engines/; it runs the build its URL's hash names */
  host: string;
  engines: ServedEngine[];
}

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;
const isText = (x: unknown): x is string => typeof x === 'string';
const isTextOrNull = (x: unknown) => x === null || typeof x === 'string';

const isNumberOrNull = (x: unknown) => x === undefined || x === null || typeof x === 'number';

function isEngine(x: unknown): x is ServedEngine {
  if (!isRecord(x)) return false;
  const { id, name, version, wasm, bytes, sha256, source, license, meta } = x;
  return (
    isText(id) &&
    isText(name) &&
    isTextOrNull(version) &&
    isText(wasm) &&
    isNumberOrNull(bytes) &&
    isText(sha256) &&
    isText(source) &&
    isTextOrNull(license) &&
    (meta === undefined || isEngineMeta(meta))
  );
}

/** Reads public/engines.json's text; throws when it is not such a list. */
export function parseServed(text: string): Served {
  const x: unknown = JSON.parse(text);
  if (!isRecord(x)) throw new Error('engines.json is not a list of engines');
  const { host, engines } = x;
  if (!isText(host) || !Array.isArray(engines) || !engines.every(isEngine)) {
    throw new Error('engines.json is not a list of engines');
  }
  return {
    host,
    engines: engines.map((e) => ({ ...e, bytes: typeof e.bytes === 'number' ? e.bytes : null })),
  };
}
