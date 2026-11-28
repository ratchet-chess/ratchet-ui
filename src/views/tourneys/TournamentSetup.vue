<script setup lang="ts">
/**
 * The setup of a new match or tournament: the form in sections beside a summary with Start. It
 * starts from the user's starting template, or from a tournament it clones (`?from=<id>`).
 */
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import HelpTip from '../../components/HelpTip.vue';
import OpeningSelect from '../../components/OpeningSelect.vue';
import Segmented from '../../components/Segmented.vue';
import { resolveControl } from '../../chess/clock.ts';
import { STANDARD_ADJUDICATION, type Adjudication } from '../../match/adjudicate.ts';
import { mayUnpair, plannedGames, type Format, type TournamentConfig } from '../../match/format.ts';
import { sprtGames } from '../../match/stats.ts';
import { makeId } from '../../storage/id.ts';
import { useBooks } from '../../stores/books.ts';
import { defaultEngine, useEngines } from '../../stores/engines.ts';
import { useRatings } from '../../stores/ratings.ts';
import { useSettings, type Setup } from '../../stores/settings.ts';
import { useTournaments } from '../../stores/tournaments.ts';
import ControlPicker from './ControlPicker.vue';
import EngineCombo from './EngineCombo.vue';
import EnginePicker from './EnginePicker.vue';
import { groupOf } from './overview.ts';
import { cloneName } from './show.ts';

const tournaments = useTournaments();
const engines = useEngines();
const books = useBooks();
const ratings = useRatings();
const settings = useSettings();
const route = useRoute();
const router = useRouter();

// ── the form's values ──────────────────────────────────────────────────────
const hardwareThreads = navigator.hardwareConcurrency || 2;
const kind = ref<Format['kind']>('match');
const name = ref('');
const tested = ref('');
const base = ref('');
/** a tournament's field, in seeding order; an engine may appear twice */
const field = ref<string[]>([]);
/** a fixed match's openings, or an SPRT's cap */
const pairs = ref(500);
const pairsEdited = ref(false);
const useSprt = ref(true);
const elo0 = ref(0);
const elo1 = ref(5);
const cycles = ref(1);
const seeds = ref(1);
const rounds = ref(5);
const matchPairs = ref(1);
const control = ref('10+0.1');
const book = ref('');
const adjudicationChoice = ref<'standard' | 'draw' | 'none'>('standard');
const paired = ref(true);
const concurrency = ref(1);
const concurrencyEdited = ref(false);
const engineIds = computed(() => engines.list.map((e) => e.id));

/** the bounds a match's SPRT offers; the first is the default */
const SPRT_PRESETS = [
  { label: '[0, 5]', elo0: 0, elo1: 5 },
  { label: '[0, 10]', elo0: 0, elo1: 10 },
  { label: '[-10, 0]', elo0: -10, elo1: 0 },
] as const;
const sprtPreset = computed(
  () => SPRT_PRESETS.find((p) => p.elo0 === elo0.value && p.elo1 === elo1.value)?.label ?? 'custom',
);
const customBounds = ref(false);
// the LLR's fit, as fastchess's, finds no solution past about ±200 nElo
const SPRT_LIMIT = 100;
const posInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1;
const finiteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const sprtBoundsOk = computed(
  () =>
    finiteNum(elo0.value) &&
    finiteNum(elo1.value) &&
    Math.abs(elo0.value) <= SPRT_LIMIT &&
    Math.abs(elo1.value) <= SPRT_LIMIT &&
    elo1.value > elo0.value,
);
const sprtEstimate = computed(() =>
  sprtBoundsOk.value ? sprtGames(elo0.value, elo1.value) : null,
);
const unpairable = computed(() => mayUnpair(format.value));
/** games an opening gives */
const perOpening = computed(() => (paired.value || !unpairable.value ? 2 : 1));
/**
 * a match's openings until the user sets them: with an SPRT, twice the openings it expects at a
 * bound, rounded up to a thousand, so the SPRT rather than the cap ends nearly every run
 */
const defaultPairs = () =>
  useSprt.value && sprtEstimate.value !== null
    ? Math.ceil((2 * sprtEstimate.value) / perOpening.value / 1000) * 1000
    : 500;
watch([useSprt, sprtEstimate, perOpening], () => {
  if (!pairsEdited.value) pairs.value = defaultPairs();
});

/** fastchess-gui's rule: a game per hardware thread with no clock, half the threads less one on a clock */
function defaultConcurrency(): number {
  const tc = resolveControl(control.value);
  return tc && (tc.kind === 'nodes' || tc.kind === 'depth')
    ? hardwareThreads
    : Math.max(1, Math.floor(hardwareThreads / 2) - 1);
}
watch(control, () => {
  if (!concurrencyEdited.value) concurrency.value = defaultConcurrency();
});

// ── what the form makes ────────────────────────────────────────────────────
const entrants = computed(() =>
  kind.value === 'match' ? [tested.value, base.value] : field.value,
);
const KIND_NAMES: Record<Format['kind'], string> = {
  match: 'Match',
  roundrobin: 'Round robin',
  gauntlet: 'Gauntlet',
  swiss: 'Swiss',
  knockout: 'Knockout',
};
const KIND_OPTIONS = (Object.keys(KIND_NAMES) as Format['kind'][]).map((k) => ({
  value: k,
  label: KIND_NAMES[k],
}));
const ADJUDICATION_OPTIONS = [
  { value: 'standard', label: 'Draw and resign' },
  { value: 'draw', label: 'Draw only' },
  { value: 'none', label: 'None' },
] as const;
const SPRT_OPTIONS = [
  ...SPRT_PRESETS.map((p) => ({ value: p.label, label: p.label })),
  { value: 'custom', label: 'Custom' },
];
/** a preset's bounds, or custom ones typed in */
const sprtChoice = computed<string>({
  get: () => (customBounds.value ? 'custom' : sprtPreset.value),
  set: (v) => {
    const p = SPRT_PRESETS.find((x) => x.label === v);
    customBounds.value = !p;
    if (p) [elo0.value, elo1.value] = [p.elo0, p.elo1];
  },
});
const defaultName = computed(() =>
  kind.value === 'match'
    ? `${tested.value} vs ${base.value}`
    : `${KIND_NAMES[kind.value].replace(/^./, (c) => c.toUpperCase())} of ${field.value.length}`,
);
const format = computed<Format>(() => {
  switch (kind.value) {
    case 'match':
      return {
        kind: 'match',
        pairs: posInt(pairs.value) ? pairs.value : 0,
        sprt: useSprt.value
          ? {
              elo0: finiteNum(elo0.value) ? elo0.value : 0,
              elo1: finiteNum(elo1.value) ? elo1.value : 0,
              alpha: 0.05,
              beta: 0.05,
            }
          : null,
      };
    case 'roundrobin':
      return { kind: 'roundrobin', cycles: posInt(cycles.value) ? cycles.value : 0 };
    case 'gauntlet':
      return {
        kind: 'gauntlet',
        seeds: posInt(seeds.value) ? seeds.value : 0,
        cycles: posInt(cycles.value) ? cycles.value : 0,
      };
    case 'swiss':
      return { kind: 'swiss', rounds: posInt(rounds.value) ? rounds.value : 0 };
    default:
      return { kind: 'knockout', pairs: posInt(matchPairs.value) ? matchPairs.value : 0 };
  }
});
const totalGames = computed(() =>
  Math.max(0, plannedGames(format.value, entrants.value.length, paired.value)),
);
/** the rounds a Swiss needs for one engine to be alone on top */
const settling = computed(() => Math.max(1, Math.ceil(Math.log2(Math.max(2, field.value.length)))));
const seedCount = computed(() =>
  kind.value === 'gauntlet'
    ? posInt(seeds.value)
      ? seeds.value
      : 0
    : kind.value === 'swiss' || kind.value === 'knockout'
      ? 1
      : 0,
);
const controlOk = computed(() => resolveControl(control.value) !== null);
const canStart = computed(
  () => !blocked.value && entrants.value.every((e) => e) && totalGames.value > 0,
);

function adjudication(): Adjudication | null {
  if (adjudicationChoice.value === 'none') return null;
  if (adjudicationChoice.value === 'draw') return { ...STANDARD_ADJUDICATION, resign: null };
  return STANDARD_ADJUDICATION;
}

/** the form as a template keeps it */
const setup = computed<Setup>(() => ({
  format: format.value,
  entrants: [...entrants.value],
  control: control.value,
  book: book.value,
  adjudication: adjudication(),
  concurrency: Math.max(1, concurrency.value),
  // a Swiss and a knockout always play pairs, whatever the switch said under another format
  paired: paired.value || !unpairable.value,
}));

function defaultPair(): [string, string] {
  const first = defaultEngine(engines.list)?.id ?? '';
  const second =
    engines.list.find((e) => e.id === 'stockfish-10' && e.id !== first)?.id ??
    engines.list.filter((e) => e.id !== first).at(-1)?.id ??
    first;
  return [first, second];
}

// ── loading a setup: the defaults, a template, or a tournament to clone ───
function reset(): void {
  kind.value = 'match';
  name.value = '';
  [tested.value, base.value] = defaultPair();
  field.value = [];
  useSprt.value = true;
  [elo0.value, elo1.value] = [SPRT_PRESETS[0].elo0, SPRT_PRESETS[0].elo1];
  customBounds.value = false;
  paired.value = true;
  pairsEdited.value = false;
  pairs.value = defaultPairs();
  cycles.value = 1;
  seeds.value = 1;
  rounds.value = 5;
  matchPairs.value = 1;
  control.value = '10+0.1';
  book.value = books.pulled.has('8moves_v3.pgn') ? '8moves_v3.pgn' : '';
  adjudicationChoice.value = 'standard';
  concurrencyEdited.value = false;
  concurrency.value = defaultConcurrency();
}

/** fills the form from a saved setup; an engine no longer served stays, and Start says so */
function load(s: Setup): void {
  reset();
  const f = s.format;
  kind.value = f.kind;
  if (f.kind === 'match') {
    [tested.value, base.value] = [s.entrants[0] ?? '', s.entrants[1] ?? ''];
    useSprt.value = f.sprt !== null;
    if (f.sprt) [elo0.value, elo1.value] = [f.sprt.elo0, f.sprt.elo1];
    customBounds.value = sprtPreset.value === 'custom';
    pairs.value = f.pairs;
    pairsEdited.value = true;
  } else field.value = [...s.entrants];
  if (f.kind === 'roundrobin' || f.kind === 'gauntlet') cycles.value = f.cycles;
  if (f.kind === 'gauntlet') seeds.value = f.seeds;
  if (f.kind === 'swiss') rounds.value = f.rounds;
  if (f.kind === 'knockout') matchPairs.value = f.pairs;
  control.value = s.control;
  book.value = s.book;
  adjudicationChoice.value = !s.adjudication ? 'none' : s.adjudication.resign ? 'standard' : 'draw';
  paired.value = s.paired;
  concurrency.value = s.concurrency;
  concurrencyEdited.value = true;
}

const template = ref('');
const touched = ref(false);
const submitting = ref(false);
const submitError = ref('');

onMounted(async () => {
  void ratings.load();
  await Promise.all([books.load(), engines.load(), tournaments.load()]);
  if (touched.value) return;
  const from = route.query['from'];
  const cloned =
    typeof from === 'string' ? tournaments.items.find((i) => i.config.id === from) : undefined;
  const start = settings.templates.find((t) => t.name === settings.startTemplate);
  if (cloned) {
    load(cloned.config);
    name.value = cloneName(
      cloned.config.name,
      tournaments.items.map((i) => i.config.name),
    );
  } else if (start) {
    load(start.setup);
    template.value = start.name;
  } else reset();
});
watch(
  () => engines.list.length,
  () => {
    const [first, second] = defaultPair();
    tested.value ||= first;
    base.value ||= second;
  },
  { immediate: true },
);

function useTemplate(n: string): void {
  template.value = n;
  const t = settings.templates.find((x) => x.name === n);
  if (t) load(t.setup);
  else reset();
}
function saveTemplate(): void {
  const n = prompt('Save this setup as a template named', template.value || defaultName.value);
  if (!n?.trim()) return;
  if (settings.saveTemplate(n.trim(), setup.value)) template.value = n.trim();
  else alert('Invalid setup: check the form, then save again.');
}
function deleteTemplate(): void {
  if (!template.value || !confirm(`Delete the template “${template.value}”?`)) return;
  settings.removeTemplate(template.value);
  template.value = '';
}

/** the form as a new tournament, with its own id and seed */
const newConfig = (): TournamentConfig => {
  const now = new Date();
  const title = name.value.trim() || defaultName.value;
  return {
    ...setup.value,
    id: makeId(title, now),
    name: title,
    created: now.toISOString(),
    seed: Math.floor(Math.random() * 2 ** 31),
  };
};

async function startNew(): Promise<void> {
  if (submitting.value || !canStart.value) return;
  submitting.value = true;
  submitError.value = '';
  try {
    const config = newConfig();
    await tournaments.create(config);
    await router.push(`/tournaments/${config.id}`);
  } catch (e) {
    submitError.value = `Could not start: ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    submitting.value = false;
  }
}

/** the form as a new tournament at the queue's end; it starts at once when nothing runs */
async function queueNew(): Promise<void> {
  if (submitting.value || !canStart.value) return;
  submitting.value = true;
  submitError.value = '';
  try {
    const config = newConfig();
    await tournaments.enqueue(config);
    await router.push(`/tournaments/${config.id}`);
  } catch (e) {
    submitError.value = `Could not add to queue: ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    submitting.value = false;
  }
}

/** where Add to queue puts the setup, and whether it starts at once */
const queueHint = computed(() => {
  const running = tournaments.items.filter((i) => groupOf(i) === 'running').length;
  const place = tournaments.queue.filter((i) => groupOf(i) === 'queued').length + 1;
  if (running > 0)
    return `#${place} in queue · starts after ${running === 1 ? 'the run ends' : `${running} runs end`}`;
  return tournaments.paused.length > 0
    ? `#${place} in queue · paused`
    : 'Nothing runs: it starts now';
});

// ── the summary ────────────────────────────────────────────────────────────
const formatSummary = computed(() => {
  const f = format.value;
  if (f.kind === 'match') return f.sprt ? `SPRT nElo [${f.sprt.elo0}, ${f.sprt.elo1}]` : `match`;
  if (f.kind === 'swiss') return `Swiss, ${f.rounds} rounds`;
  if (f.kind === 'knockout') return `knockout, ${f.pairs} pair${f.pairs > 1 ? 's' : ''} a match`;
  if (f.kind === 'gauntlet') return `gauntlet, ${f.seeds} seed${f.seeds > 1 ? 's' : ''}`;
  return `round robin${f.cycles > 1 ? ` ×${f.cycles}` : ''}`;
});
const gamesBound = computed(() =>
  kind.value === 'match' && useSprt.value ? 'at most' : kind.value === 'knockout' ? 'at least' : '',
);
const blocked = computed(() => {
  if (entrants.value.length < 2) return 'Select at least two engines.';
  const gone = entrants.value.filter((e) => e && !engineIds.value.includes(e));
  if (gone.length > 0) return `Missing engine: ${gone.join(', ')}.`;
  if (!controlOk.value) return 'Invalid time control.';
  if (!posInt(concurrency.value)) return 'Concurrent games must be a whole number ≥ 1.';
  if (kind.value === 'match') {
    if (useSprt.value) {
      if (!finiteNum(elo0.value) || !finiteNum(elo1.value)) return 'Enter both SPRT bounds.';
      if (Math.abs(elo0.value) > SPRT_LIMIT || Math.abs(elo1.value) > SPRT_LIMIT)
        return `SPRT bounds must stay within ±${SPRT_LIMIT} nElo.`;
      if (elo1.value <= elo0.value) return 'Upper bound must exceed lower bound.';
    }
    if (!posInt(pairs.value)) return 'Pairs must be a whole number ≥ 1.';
  } else if (kind.value === 'roundrobin') {
    if (!posInt(cycles.value)) return 'Cycles must be a whole number ≥ 1.';
  } else if (kind.value === 'gauntlet') {
    if (!posInt(seeds.value) || seeds.value >= field.value.length)
      return `Seeds must be a whole number from 1 to ${Math.max(1, field.value.length - 1)}.`;
    if (!posInt(cycles.value)) return 'Cycles must be a whole number ≥ 1.';
  } else if (kind.value === 'swiss') {
    if (!posInt(rounds.value)) return 'Rounds must be a whole number ≥ 1.';
  } else if (!posInt(matchPairs.value)) {
    return 'Pairs per match must be a whole number ≥ 1.';
  }
  return '';
});

// ── looks ──────────────────────────────────────────────────────────────────
const section = 'border-b border-row px-3.5 py-3 last:border-b-0';
const sectionTitle = 'subhead mb-2.5';
const row = 'mb-3 grid grid-cols-[7.5rem_minmax(0,1fr)] items-start gap-3 last:mb-0';
const label = 'flex items-center justify-between gap-2 pt-1.5 text-dense text-dim';
const terse = 'text-dense text-dim';
</script>

<template>
  <div class="@container">
    <RouterLink to="/tournaments" class="mb-2 inline-block text-dense text-accent wide:hidden"
      >‹ Tourneys</RouterLink
    >
    <div class="grid items-start gap-4 @5xl:grid-cols-[minmax(0,1fr)_17rem]">
      <section
        class="min-w-0 rounded-md border border-line bg-panel"
        @input="touched = true"
        @change="touched = true"
      >
        <!-- ── templates ─────────────────────────────────────────────────── -->
        <div
          class="flex flex-wrap items-center gap-2 rounded-t-md border-b border-line bg-panel2 px-3.5 py-2"
        >
          <span class="subhead">New</span>
          <span class="flex-1" />
          <select
            :value="template"
            class="field-sm max-w-56"
            title="Start from a saved setup"
            @change="useTemplate(($event.target as HTMLSelectElement).value)"
          >
            <option value="">No template</option>
            <option v-for="t in settings.templates" :key="t.name" :value="t.name">
              {{ t.name }}{{ t.name === settings.startTemplate ? ' ★' : '' }}
            </option>
          </select>
          <button class="btn" @click="saveTemplate">Save as template…</button>
          <template v-if="template">
            <button
              class="btn"
              :title="
                settings.startTemplate === template
                  ? 'Default template for New (click to clear)'
                  : 'Use as default template for New'
              "
              @click="settings.startTemplate = settings.startTemplate === template ? '' : template"
            >
              {{ settings.startTemplate === template ? '★' : '☆' }}
            </button>
            <button class="btn" title="Delete this template" @click="deleteTemplate">✕</button>
          </template>
        </div>

        <!-- ── who plays ─────────────────────────────────────────────────── -->
        <div :class="section">
          <div :class="sectionTitle">Who plays</div>
          <div :class="row">
            <span :class="label">Format</span>
            <Segmented v-model="kind" :options="KIND_OPTIONS" />
          </div>

          <div v-if="kind === 'match'" :class="row">
            <span :class="label"
              >Engines
              <HelpTip
                >The <b>first</b> engine is tested; all statistics are from its side.</HelpTip
              ></span
            >
            <span class="flex flex-wrap items-center gap-2">
              <EngineCombo v-model="tested" :engines="engineIds" />
              <button class="btn" title="Swap" @click="[tested, base] = [base, tested]">⇄</button>
              <EngineCombo v-model="base" :engines="engineIds" />
            </span>
          </div>
          <div v-else :class="row">
            <span :class="label"
              >Field
              <HelpTip v-if="seedCount > 0">
                Order sets <b>seeding</b> (drag or use ↑ ↓).
                <template v-if="kind === 'gauntlet'">
                  The first {{ seeds }} play every other engine; others do not meet.
                </template>
                <template v-else> First engine is the top seed.</template>
              </HelpTip></span
            >
            <EnginePicker
              v-model="field"
              :engines="engines.list"
              :ratings="ratings.defaultList"
              :seeds="seedCount"
            />
          </div>

          <template v-if="kind === 'match'">
            <div :class="row">
              <span :class="label"
                >SPRT
                <HelpTip>
                  Stops once the result is clear: <b>H1</b> when tested engine gains at least the
                  upper bound, <b>H0</b> at most the lower, in nElo (α = β = 0.05). Expected game
                  count assumes the true Elo sits on a bound.
                </HelpTip></span
              >
              <span class="flex flex-wrap items-center gap-2">
                <input v-model="useSprt" type="checkbox" class="accent-accent" />
                <template v-if="useSprt">
                  <Segmented v-model="sprtChoice" :options="SPRT_OPTIONS" class="num" />
                  <span v-if="customBounds || sprtPreset === 'custom'" class="num text-dense">
                    [<input
                      v-model.number="elo0"
                      type="number"
                      step="0.5"
                      class="field num no-spin w-16 text-right"
                    />,
                    <input
                      v-model.number="elo1"
                      type="number"
                      step="0.5"
                      class="field num no-spin w-16 text-right"
                    />]
                  </span>
                  <span v-if="sprtEstimate !== null" class="num" :class="terse"
                    >~{{ sprtEstimate.toLocaleString('en-US') }} games</span
                  >
                </template>
              </span>
            </div>
            <div :class="row">
              <span :class="label"
                >{{ useSprt ? 'Max pairs' : paired ? 'Pairs' : 'Games' }}
                <HelpTip v-if="useSprt"
                  >Maximum pairs for the SPRT. Below the estimate, most runs stop without a
                  verdict.</HelpTip
                ></span
              >
              <span class="flex flex-wrap items-center gap-2">
                <input
                  v-model.number="pairs"
                  type="number"
                  min="1"
                  class="field num no-spin w-24 text-right"
                  @input="pairsEdited = true"
                />
                <span v-if="paired && posInt(pairs)" class="num" :class="terse"
                  >{{ (pairs * 2).toLocaleString('en-US') }} games</span
                >
                <span
                  v-if="
                    useSprt &&
                    sprtEstimate !== null &&
                    posInt(pairs) &&
                    pairs * perOpening < sprtEstimate
                  "
                  class="text-dense text-warn"
                  >below estimate</span
                >
              </span>
            </div>
          </template>
          <div v-if="kind === 'swiss'" :class="row">
            <span :class="label"
              >Rounds
              <HelpTip
                >Each round pairs engines with similar points; an odd field awards a <b>bye</b> (1
                pt). With {{ field.length }} engines, {{ settling }} rounds can produce a clear
                winner.</HelpTip
              ></span
            >
            <span class="flex items-center gap-2">
              <input
                v-model.number="rounds"
                type="number"
                min="1"
                class="field num no-spin w-24 text-right"
              />
              <span :class="terse">{{ settling }} to settle</span>
            </span>
          </div>
          <div v-if="kind === 'knockout'" :class="row">
            <span :class="label"
              >Per match
              <HelpTip
                >Tied matches play extra pairs up to 10 total; higher seed advances if still
                tied.</HelpTip
              ></span
            >
            <span class="flex items-center gap-2">
              <input
                v-model.number="matchPairs"
                type="number"
                min="1"
                class="field num no-spin w-24 text-right"
              />
              <span :class="terse">pairs</span>
            </span>
          </div>
          <div v-if="kind === 'gauntlet'" :class="row">
            <span :class="label">Seeds</span>
            <input
              v-model.number="seeds"
              type="number"
              min="1"
              class="field num no-spin w-24 text-right"
            />
          </div>
          <div v-if="kind === 'roundrobin' || kind === 'gauntlet'" :class="row">
            <span :class="label">Cycles</span>
            <input
              v-model.number="cycles"
              type="number"
              min="1"
              class="field num no-spin w-24 text-right"
            />
          </div>
        </div>

        <!-- ── how each game is played ───────────────────────────────────── -->
        <div :class="section">
          <div :class="sectionTitle">How each game is played</div>
          <div :class="row">
            <span :class="label"
              >Time
              <HelpTip>
                <b>10+0.1</b>: 10 s + 0.1 s/move; <b>2m+1</b> in minutes. <b>40/15</b>: 40 moves in
                15 min, repeating. <b>1s/move</b>: fixed time per move. <b>200k nodes</b>,
                <b>depth 12</b>: fixed search per move (clock-independent). Saved custom controls
                have a dashed border.
              </HelpTip></span
            >
            <ControlPicker v-model="control" :concurrency="concurrency" />
          </div>
          <div :class="row">
            <span :class="label">Opening</span>
            <OpeningSelect v-model="book" />
          </div>
          <div v-if="unpairable" :class="row">
            <span :class="label"
              >Colors
              <HelpTip>
                <b>On</b>: each opening twice with colors swapped (a <b>pair</b>), canceling opening
                bias (pentanomial stats).<br />
                <b>Off</b>: one game per opening, alternating colors (trinomial stats; requires a
                balanced book).
              </HelpTip></span
            >
            <label class="flex cursor-pointer items-center gap-2 pt-1 text-dense">
              <input v-model="paired" type="checkbox" class="accent-accent" />
              <span :class="paired ? 'text-text' : 'text-dim'">{{
                paired ? 'Paired (swap colors)' : 'Single game per opening'
              }}</span>
            </label>
          </div>
          <div :class="row">
            <span :class="label"
              >Adjudication
              <HelpTip>
                <b>Draw</b>: from move 40, after 8 consecutive moves within 10 cp. <b>Resign</b>:
                after 3 moves at −600 cp or worse.
              </HelpTip></span
            >
            <Segmented v-model="adjudicationChoice" :options="ADJUDICATION_OPTIONS" />
          </div>
        </div>

        <!-- ── this run ──────────────────────────────────────────────────── -->
        <div :class="section">
          <div :class="sectionTitle">This run</div>
          <div :class="row">
            <span :class="label">Concurrent</span>
            <span class="flex items-center gap-2">
              <input
                v-model.number="concurrency"
                type="number"
                min="1"
                class="field num no-spin w-24 text-right"
                @input="concurrencyEdited = true"
              />
              <span class="num" :class="terse">of {{ hardwareThreads }} threads</span>
            </span>
          </div>
          <div :class="row">
            <span :class="label">Name</span>
            <input v-model="name" :placeholder="defaultName" class="field w-full max-w-md" />
          </div>
        </div>
      </section>

      <!-- ── the summary and Start ─────────────────────────────────────── -->
      <aside class="rounded-md border border-line bg-panel p-3.5 @5xl:sticky @5xl:top-3">
        <div class="mb-2.5 text-title font-semibold break-words">
          {{ name.trim() || defaultName }}
        </div>
        <div :class="terse">Games{{ gamesBound ? ` (${gamesBound})` : '' }}</div>
        <div class="num mb-2.5 text-hero font-semibold">
          {{ totalGames.toLocaleString('en-US') }}
        </div>
        <dl class="mb-3.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-dense">
          <dt class="text-dim">Format</dt>
          <dd>{{ formatSummary }}</dd>
          <dt class="text-dim">Engines</dt>
          <dd class="num break-words">
            {{ kind === 'match' ? `${tested} vs ${base}` : `${field.length} selected` }}
          </dd>
          <dt class="text-dim">Time</dt>
          <dd class="num">{{ control }}</dd>
          <dt class="text-dim">Opening</dt>
          <dd class="num break-words">{{ book || 'Start position' }}</dd>
          <template v-if="unpairable">
            <dt class="text-dim">Colors</dt>
            <dd>{{ paired ? 'Paired (swapped)' : 'Single game each' }}</dd>
          </template>
          <dt class="text-dim">Concurrent</dt>
          <dd class="num">{{ concurrency }}</dd>
        </dl>
        <button
          class="btn-primary w-full py-2.5"
          :disabled="submitting || !canStart"
          @click="startNew"
        >
          {{ submitting ? 'Starting…' : 'Start' }}
        </button>
        <button
          class="btn-secondary mt-1.5 w-full py-2.5"
          :disabled="submitting || !canStart"
          @click="queueNew"
        >
          Add to queue
        </button>
        <div v-if="!blocked && !submitError" class="mt-1.5 text-small text-dim">
          {{ queueHint }}
        </div>
        <div v-if="blocked" class="mt-2 text-dense text-warn">{{ blocked }}</div>
        <div v-if="submitError" class="mt-2 text-dense text-bad">{{ submitError }}</div>
      </aside>
    </div>
  </div>
</template>
