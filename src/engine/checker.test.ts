import { describe, expect, it } from 'vitest';
import { inspectModule, runChecks, type CheckDriver } from '../../vendor/uci-over-wasi/check.ts';

/** builds a minimal valid WebAssembly module with optional custom `uci_over_wasi` section */
function makeWasm(declaration?: string): Uint8Array {
  const header = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];
  if (declaration === undefined) return new Uint8Array(header);
  const name = new TextEncoder().encode('uci_over_wasi');
  const body = new TextEncoder().encode(declaration);
  const payload = [name.length, ...name, ...body];
  return new Uint8Array([...header, 0x00, payload.length, ...payload]);
}

const unusedDriver: CheckDriver = () => {
  throw new Error('driver should not be called');
};

describe('vendored WASI checker', () => {
  it('defaults to polls with no requirements when no custom section exists', async () => {
    const wasm = makeWasm();
    const insp = inspectModule(wasm, true);
    expect(insp.declaration).toEqual({ profile: 'polls', requires: [] });
    expect(insp.refusal).toBeUndefined();
    const res = await runChecks(wasm, unusedDriver, { only: 'declaration' });
    expect(res).toHaveLength(1);
    expect(res[0]?.status).toBe('pass');
  });

  it('reads profile=deaf and refuses threads when the host cannot spawn', () => {
    const wasm = makeWasm('profile=deaf\nrequires=threads\n');
    const insp = inspectModule(wasm, false);
    expect(insp.declaration).toEqual({ profile: 'deaf', requires: ['threads'] });
    expect(insp.refusal).toMatch(/threads/);
  });

  it('fails declaration check when a module requires a feature it does not use', async () => {
    const wasm = makeWasm('requires=relaxed-simd\n');
    const res = await runChecks(wasm, unusedDriver, { only: 'declaration' });
    expect(res[0]?.status).toBe('fail');
    expect(res[0]?.detail).toMatch(/requires relaxed-simd and does not use it/);
  });

  it('throws on an unknown profile in uci_over_wasi', () => {
    const wasm = makeWasm('profile=bogus\n');
    expect(() => inspectModule(wasm, true)).toThrow(/profile=bogus/);
  });
});
