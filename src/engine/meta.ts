/** Shared provenance and historical metadata for a served WASI build (release, adapted, or own). */

export type EngineKind = 'own' | 'adapted' | 'release';

export type BuildBasis =
  | 'original'
  | 'adapted-from-code'
  | 'ported-from-code'
  | 'written-from-record'
  | 'reconstructed-from-papers';

interface ExternalSource {
  label: string;
  url: string;
  role: 'source' | 'archive' | 'emulator' | 'record' | 'upstream' | 'cpw';
  sha256?: string;
  commit?: string;
  note?: string;
}

interface CreditEntry {
  name: string;
  role: string;
  url?: string;
}

interface HardwareEntry {
  platform: string;
  speed: string;
}

interface HistoricalResult {
  where: string;
  result: string;
  date: string;
  kind: 'tournament' | 'match' | 'rating';
}

interface CalibratedRating {
  label: string;
  elo: number;
  error: number;
  protocol: string;
}

interface FidelitySummary {
  status: 'exact' | 'matched' | 'approximate';
  headline: string;
  referenceOf: string;
  games?: string;
  notes?: string;
}

type FeatureGroup = 'Board' | 'Search' | 'Ordering' | 'Evaluation' | 'Tables';

interface CpwFeature {
  /** Exact Chess Programming Wiki page or Page#Section key */
  key: string;
  label: string;
  group: FeatureGroup;
  implementation: string;
  ref?: string;
  landmark?: boolean;
}

interface ProbeHint {
  depths: number[];
  defaultDepth: number;
}

export interface EngineMeta {
  kind: EngineKind;
  buildBasis: BuildBasis;
  date: string;
  year: number;
  originalAuthors: string[];
  affiliation?: string;
  originalLanguage?: string;
  originalLicense?: string;
  originalLicenseNote?: string;
  sources: ExternalSource[];
  credits?: CreditEntry[];
  cpwPage?: string;
  blurb: string;
  hardware?: HardwareEntry[];
  results?: HistoricalResult[];
  ratings?: CalibratedRating[];
  fidelity?: FidelitySummary;
  features: CpwFeature[];
  probe?: ProbeHint;
}

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;
const isStr = (x: unknown): x is string => typeof x === 'string';
const isOptStr = (x: unknown): boolean => x === undefined || typeof x === 'string';

const KINDS = new Set<string>(['own', 'adapted', 'release']);
const BASES = new Set<string>([
  'original',
  'adapted-from-code',
  'ported-from-code',
  'written-from-record',
  'reconstructed-from-papers',
]);
const SOURCE_ROLES = new Set<string>([
  'source',
  'archive',
  'emulator',
  'record',
  'upstream',
  'cpw',
]);
const RESULT_KINDS = new Set<string>(['tournament', 'match', 'rating']);
const FIDELITY_STATUSES = new Set<string>(['exact', 'matched', 'approximate']);
const GROUPS = new Set<string>(['Board', 'Search', 'Ordering', 'Evaluation', 'Tables']);

function isExternalSource(x: unknown): x is ExternalSource {
  return (
    isRecord(x) &&
    isStr(x.label) &&
    isStr(x.url) &&
    isStr(x.role) &&
    SOURCE_ROLES.has(x.role) &&
    isOptStr(x.sha256) &&
    isOptStr(x.commit) &&
    isOptStr(x.note)
  );
}

function isCredit(x: unknown): x is CreditEntry {
  return isRecord(x) && isStr(x.name) && isStr(x.role) && isOptStr(x.url);
}

function isHardware(x: unknown): x is HardwareEntry {
  return isRecord(x) && isStr(x.platform) && isStr(x.speed);
}

function isResult(x: unknown): x is HistoricalResult {
  return (
    isRecord(x) &&
    isStr(x.where) &&
    isStr(x.result) &&
    isStr(x.date) &&
    isStr(x.kind) &&
    RESULT_KINDS.has(x.kind)
  );
}

function isRating(x: unknown): x is CalibratedRating {
  return (
    isRecord(x) &&
    isStr(x.label) &&
    typeof x.elo === 'number' &&
    typeof x.error === 'number' &&
    isStr(x.protocol)
  );
}

function isFidelity(x: unknown): x is FidelitySummary {
  return (
    isRecord(x) &&
    isStr(x.status) &&
    FIDELITY_STATUSES.has(x.status) &&
    isStr(x.headline) &&
    isStr(x.referenceOf) &&
    isOptStr(x.games) &&
    isOptStr(x.notes)
  );
}

function isFeature(x: unknown): x is CpwFeature {
  return (
    isRecord(x) &&
    isStr(x.key) &&
    isStr(x.label) &&
    isStr(x.group) &&
    GROUPS.has(x.group) &&
    isStr(x.implementation) &&
    isOptStr(x.ref) &&
    (x.landmark === undefined || typeof x.landmark === 'boolean')
  );
}

function isProbeHint(x: unknown): x is ProbeHint {
  return (
    isRecord(x) &&
    Array.isArray(x.depths) &&
    x.depths.length > 0 &&
    x.depths.every((d) => typeof d === 'number' && Number.isInteger(d) && d > 0) &&
    typeof x.defaultDepth === 'number' &&
    Number.isInteger(x.defaultDepth) &&
    x.defaultDepth > 0
  );
}

/** Validates an untrusted JSON value against the shared EngineMeta schema. */
export function isEngineMeta(x: unknown): x is EngineMeta {
  if (!isRecord(x)) return false;
  return (
    isStr(x.kind) &&
    KINDS.has(x.kind) &&
    isStr(x.buildBasis) &&
    BASES.has(x.buildBasis) &&
    isStr(x.date) &&
    typeof x.year === 'number' &&
    Number.isInteger(x.year) &&
    Array.isArray(x.originalAuthors) &&
    x.originalAuthors.every(isStr) &&
    isOptStr(x.affiliation) &&
    isOptStr(x.originalLanguage) &&
    isOptStr(x.originalLicense) &&
    isOptStr(x.originalLicenseNote) &&
    Array.isArray(x.sources) &&
    x.sources.every(isExternalSource) &&
    (x.credits === undefined || (Array.isArray(x.credits) && x.credits.every(isCredit))) &&
    isOptStr(x.cpwPage) &&
    isStr(x.blurb) &&
    (x.hardware === undefined || (Array.isArray(x.hardware) && x.hardware.every(isHardware))) &&
    (x.results === undefined || (Array.isArray(x.results) && x.results.every(isResult))) &&
    (x.ratings === undefined || (Array.isArray(x.ratings) && x.ratings.every(isRating))) &&
    (x.fidelity === undefined || isFidelity(x.fidelity)) &&
    Array.isArray(x.features) &&
    x.features.every(isFeature) &&
    (x.probe === undefined || isProbeHint(x.probe))
  );
}

/** Public URL for a Chess Programming Wiki page or `Page#Section` key. */
export function cpwUrl(key: string): string {
  return `https://www.chessprogramming.org/${key}`;
}

/** Short display label for how a WASI build relates to its original program. */
export function buildBasisLabel(basis: BuildBasis): string {
  switch (basis) {
    case 'written-from-record':
      return 'Written from record';
    case 'ported-from-code':
      return 'Ported from code';
    case 'adapted-from-code':
      return 'WASI adaptation';
    case 'reconstructed-from-papers':
      return 'Reconstruction';
    case 'original':
      return 'Original';
  }
}

/** Short display label for an engine's kind badge. */
export function kindLabel(kind: EngineKind): string {
  switch (kind) {
    case 'release':
      return 'Historical release';
    case 'adapted':
      return 'Adapted engine';
    case 'own':
      return 'Own engine';
  }
}
