import { describe, expect, it } from 'vitest';
import { parseServed } from './manifest.ts';
import { buildBasisLabel, cpwUrl, isEngineMeta, kindLabel, type EngineMeta } from './meta.ts';

const CHESS_46_META: EngineMeta = {
  kind: 'release',
  buildBasis: 'written-from-record',
  date: '1977-05-03',
  year: 1977,
  originalAuthors: ['David Slate', 'Larry Atkin'],
  affiliation: 'Northwestern University',
  originalLanguage: 'COMPASS (CDC 6000/CYBER 170 assembly)',
  originalLicense: 'COPYRIGHT NORTHWESTERN UNIVERSITY 1976, ALL RIGHTS RESERVED.',
  sources: [
    {
      label: 'CHM source listing (PDF)',
      url: 'http://archive.computerhistory.org/projects/chess/related_materials/software/3-3.Chess_4.6_Sourcecode.102645430/chess_4-6.sourcecode.102645430.pdf',
      role: 'source',
      sha256: '918dca91419fa0d9702544414af239d7d0bf87da0e0bd1070997decdbf4d641d',
    },
  ],
  cpwPage: 'Chess_(Program)',
  blurb: 'Northwestern University chess program of 1977.',
  fidelity: {
    status: 'exact',
    headline: 'Exact on 192 positions (depths 2-6)',
    referenceOf: 'CHESE46 on DtCyber',
  },
  features: [
    {
      key: 'Delta_Pruning',
      label: 'Delta Pruning',
      group: 'Search',
      ref: 'S8',
      landmark: true,
      implementation: 'Skips captures whose material plus positional bound cannot raise alpha.',
    },
  ],
  probe: { depths: [2, 3, 4, 5, 6], defaultDepth: 4 },
};

describe('EngineMeta and manifest parsing', () => {
  it('validates release and adapted metadata and rejects invalid shapes', () => {
    expect(isEngineMeta(CHESS_46_META)).toBe(true);
    expect(isEngineMeta({ ...CHESS_46_META, kind: 'unknown' })).toBe(false);
    expect(isEngineMeta({ ...CHESS_46_META, probe: { depths: [], defaultDepth: 4 } })).toBe(false);
    expect(isEngineMeta(null)).toBe(false);
  });

  it('parses served manifests both with and without meta', () => {
    const served = parseServed(
      JSON.stringify({
        host: 'wasi-host.js',
        engines: [
          {
            id: 'ratchet-0.3.14',
            name: 'Ratchet',
            version: '0.3.14',
            wasm: 'ratchet-0.3.14.wasm',
            bytes: 117486,
            sha256: 'abc',
            source: 'local',
            license: null,
          },
          {
            id: 'chess-4.6',
            name: 'Chess',
            version: '4.6',
            wasm: 'chess-4.6.wasm',
            bytes: 68412,
            sha256: 'def',
            source: 'ratchet-historical v0.1.0',
            license: 'GPL-3.0-or-later',
            meta: CHESS_46_META,
          },
        ],
      }),
    );
    expect(served.engines).toHaveLength(2);
    expect(served.engines[0]?.meta).toBeUndefined();
    expect(served.engines[1]?.meta?.cpwPage).toBe('Chess_(Program)');
  });

  it('formats CPW URLs and display labels', () => {
    expect(cpwUrl('Move_Generation#Staged_Move_Generation')).toBe(
      'https://www.chessprogramming.org/Move_Generation#Staged_Move_Generation',
    );
    expect(buildBasisLabel('written-from-record')).toBe('written from record');
    expect(buildBasisLabel('adapted-from-code')).toBe('WASI adaptation');
    expect(kindLabel('release')).toBe('historical release');
    expect(kindLabel('adapted')).toBe('adapted engine');
  });
});
