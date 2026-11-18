<script setup lang="ts">
/**
 * The setup of a new match or tournament: the form in sections beside a summary with Start. It
 * starts from the user's starting template, or from a tournament it clones (`?from=<id>`).
 */
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import HelpTip from '../../components/HelpTip.vue';
import Segmented from '../../components/Segmented.vue';
import { resolveControl } from '../../chess/clock.ts';
import { STANDARD_ADJUDICATION, type Adjudication } from '../../match/adjudicate.ts';
import { mayUnpair, plannedGames, type Format, type TournamentConfig } from '../../match/format.ts';
import { sprtGames } from '../../match/stats.ts';
import { useBooks } from '../../stores/books.ts';
import { useEngines } from '../../stores/engines.ts';
import { useSettings, type Setup } from '../../stores/settings.ts';
import { useTournaments } from '../../stores/tournaments.ts';
import ControlPicker from './ControlPicker.vue';
import EngineCombo from './EngineCombo.vue';
import EnginePicker from './EnginePicker.vue';
import { cloneName } from './show.ts';

const tournaments = useTournaments();
const engines = useEngines();
const books = useBooks();
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
const sprtEstimate = computed(() =>
  elo1.value > elo0.value ? sprtGames(elo0.value, elo1.value) : null,
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
  match: 'match',
  roundrobin: 'round robin',
  gauntlet: 'gauntlet',
  swiss: 'Swiss',
  knockout: 'knockout',
};
const KIND_OPTIONS = (Object.keys(KIND_NAMES) as Format['kind'][]).map((k) => ({
  value: k,
  label: KIND_NAMES[k],
}));
const ADJUDICATION_OPTIONS = [
  { value: 'standard', label: 'draw and resign' },
  { value: 'draw', label: 'draw only' },
  { value: 'none', label: 'none' },
] as const;
const SPRT_OPTIONS = [
  ...SPRT_PRESETS.map((p) => ({ value: p.label, label: p.label })),
  { value: 'custom', label: 'custom' },
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
        pairs: pairs.value,
        sprt: useSprt.value
          ? { elo0: elo0.value, elo1: elo1.value, alpha: 0.05, beta: 0.05 }
          : null,
      };
    case 'roundrobin':
      return { kind: 'roundrobin', cycles: cycles.value };
    case 'gauntlet':
      return { kind: 'gauntlet', seeds: seeds.value, cycles: cycles.value };
    case 'swiss':
      return { kind: 'swiss', rounds: rounds.value };
    default:
      return { kind: 'knockout', pairs: matchPairs.value };
  }
});
const totalGames = computed(() => plannedGames(format.value, entrants.value.length, paired.value));
/** the rounds a Swiss needs for one engine to be alone on top */
const settling = computed(() => Math.max(1, Math.ceil(Math.log2(Math.max(2, field.value.length)))));
const seedCount = computed(() =>
  kind.value === 'gauntlet'
    ? seeds.value
    : kind.value === 'swiss' || kind.value === 'knockout'
      ? 1
      : 0,
);
const controlOk = computed(() => resolveControl(control.value) !== null);
const canStart = computed(
  () =>
    entrants.value.length >= 2 &&
    entrants.value.every((e) => e) &&
    totalGames.value > 0 &&
    controlOk.value &&
    !(kind.value === 'match' && useSprt.value && elo1.value <= elo0.value),
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

// ── loading a setup: the defaults, a template, or a tournament to clone ───
function reset(): void {
  kind.value = 'match';
  name.value = '';
  tested.value = engines.list.at(-1)?.id ?? '';
  base.value = engines.list.at(-2)?.id ?? tested.value;
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
onMounted(async () => {
  await Promise.all([books.load(), engines.load(), tournaments.load()]);
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
    const newest = engines.list.at(-1)?.id ?? '';
    tested.value ||= newest;
    base.value ||= engines.list.at(-2)?.id ?? newest;
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
  settings.saveTemplate(n.trim(), setup.value);
  template.value = n.trim();
}
function deleteTemplate(): void {
  if (!template.value || !confirm(`Delete the template “${template.value}”?`)) return;
  settings.removeTemplate(template.value);
  template.value = '';
}

async function startNew(): Promise<void> {
  const config: TournamentConfig = {
    ...setup.value,
    id: crypto.randomUUID(),
    name: name.value.trim() || defaultName.value,
    created: new Date().toISOString(),
    seed: Math.floor(Math.random() * 2 ** 31),
  };
  await tournaments.create(config);
  await router.push(`/tournaments/${config.id}`);
}

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
  if (entrants.value.length < 2) return 'Two engines or more are needed.';
  const gone = entrants.value.filter((e) => e && !engineIds.value.includes(e));
  if (gone.length > 0) return `Not served here: ${gone.join(', ')}.`;
  if (!controlOk.value) return 'The time control does not read.';
  if (kind.value === 'match' && useSprt.value && elo1.value <= elo0.value)
    return 'The upper bound must be above the lower.';
  return '';
});

// ── looks ──────────────────────────────────────────────────────────────────
const section = 'border-b border-row px-3.5 py-3 last:border-b-0';
const sectionTitle = 'caps mb-2.5 text-label font-semibold';
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
      <section class="min-w-0 rounded-lg border border-line bg-panel">
        <!-- ── templates ─────────────────────────────────────────────────── -->
        <div class="flex flex-wrap items-center gap-2 border-b border-line px-3.5 py-2">
          <span class="caps text-label font-semibold">New</span>
          <span class="flex-1" />
          <select
            :value="template"
            class="field-sm max-w-56"
            title="Start from a saved setup"
            @change="useTemplate(($event.target as HTMLSelectElement).value)"
          >
            <option value="">no template</option>
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
                  ? 'Each New starts from this template; click to stop'
                  : 'Start each New from this template'
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
            <span :class="label">format</span>
            <Segmented v-model="kind" :options="KIND_OPTIONS" />
          </div>

          <div v-if="kind === 'match'" :class="row">
            <span :class="label"
              >engines
              <HelpTip>The <b>first</b> is tested: every statistic is from its side.</HelpTip></span
            >
            <span class="flex flex-wrap items-center gap-2">
              <EngineCombo v-model="tested" :engines="engineIds" />
              <button class="btn" title="Swap" @click="[tested, base] = [base, tested]">⇄</button>
              <EngineCombo v-model="base" :engines="engineIds" />
            </span>
          </div>
          <div v-else :class="row">
            <span :class="label"
              >field
              <HelpTip v-if="seedCount > 0">
                The field's order is its <b>seeding</b>: drag or use ↑ ↓.
                <template v-if="kind === 'gauntlet'">
                  The first {{ seeds }} each play every other engine; the others do not meet.
                </template>
                <template v-else> The first is the top seed.</template>
              </HelpTip></span
            >
            <EnginePicker v-model="field" :engines="engineIds" :seeds="seedCount" />
          </div>

          <template v-if="kind === 'match'">
            <div :class="row">
              <span :class="label"
                >SPRT
                <HelpTip>
                  Stops once the result is clear: <b>H1</b> when the tested engine gains at least
                  the upper bound, <b>H0</b> at most the lower, in normalized Elo, α = β = 0.05. The
                  count is the expected games with the true difference on a bound; between them it
                  runs longer.
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
                >{{ useSprt ? 'at most' : paired ? 'pairs' : 'games' }}
                <HelpTip v-if="useSprt"
                  >A cap on the SPRT. Under the estimated games, most runs stop here with no
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
                <span v-if="paired" class="num" :class="terse"
                  >{{ (pairs * 2).toLocaleString('en-US') }} games</span
                >
                <span
                  v-if="useSprt && sprtEstimate !== null && pairs * perOpening < sprtEstimate"
                  class="text-dense text-warn"
                  >below the estimate</span
                >
              </span>
            </div>
          </template>
          <div v-if="kind === 'swiss'" :class="row">
            <span :class="label"
              >rounds
              <HelpTip
                >Each round pairs engines of about equal points; an odd field gives one a
                <b>bye</b>, worth a point. With {{ field.length }} engines, {{ settling }} rounds
                can leave one alone on top.</HelpTip
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
              >per match
              <HelpTip
                >A tied match plays one more pair at a time, up to ten in all; then the higher seed
                goes through.</HelpTip
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
            <span :class="label">seeds</span>
            <input
              v-model.number="seeds"
              type="number"
              min="1"
              class="field num no-spin w-24 text-right"
            />
          </div>
          <div v-if="kind === 'roundrobin' || kind === 'gauntlet'" :class="row">
            <span :class="label">cycles</span>
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
              >time
              <HelpTip>
                <b>10+0.1</b>: 10 s, then 0.1 s added a move; <b>2m+1</b> in minutes. <b>40/15</b>:
                40 moves in 15 min, repeating. <b>1s/move</b>: a fixed time a move.
                <b>200k nodes</b>, <b>depth 12</b>: a fixed search a move, with no clock, the same
                on any machine. Yours have a dashed edge.
              </HelpTip></span
            >
            <ControlPicker v-model="control" />
          </div>
          <div :class="row">
            <span :class="label">opening</span>
            <select v-model="book" class="field num w-60 max-w-full">
              <option value="">start position</option>
              <option v-for="b in books.usable" :key="b.id" :value="b.id">{{ b.id }}</option>
            </select>
          </div>
          <div v-if="unpairable" :class="row">
            <span :class="label"
              >colors
              <HelpTip>
                <b>On</b>: each opening twice, each engine White once: a <b>pair</b>. It cancels an
                opening's bias, and a match's statistics count pairs (pentanomial).<br />
                <b>Off</b>: one game an opening, colors alternating; a match's statistics count
                games (trinomial). Wants a balanced book.
              </HelpTip></span
            >
            <label class="flex cursor-pointer items-center gap-2 pt-1 text-dense">
              <input v-model="paired" type="checkbox" class="accent-accent" />
              <span :class="paired ? 'text-text' : 'text-dim'">{{
                paired ? 'each opening twice, swapped' : 'each opening once'
              }}</span>
            </label>
          </div>
          <div :class="row">
            <span :class="label"
              >adjudication
              <HelpTip>
                <b>draw</b>: from move 40, after 8 moves of each side within 10 cp. <b>resign</b>:
                after 3 moves of one side at −600 cp or worse.
              </HelpTip></span
            >
            <Segmented v-model="adjudicationChoice" :options="ADJUDICATION_OPTIONS" />
          </div>
        </div>

        <!-- ── this run ──────────────────────────────────────────────────── -->
        <div :class="section">
          <div :class="sectionTitle">This run</div>
          <div :class="row">
            <span :class="label">at once</span>
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
            <span :class="label">name</span>
            <input v-model="name" :placeholder="defaultName" class="field w-full max-w-md" />
          </div>
        </div>
      </section>

      <!-- ── the summary and Start ─────────────────────────────────────── -->
      <aside class="rounded-lg border border-line bg-panel p-3.5 @5xl:sticky @5xl:top-3">
        <div class="mb-2.5 text-title font-semibold break-words">
          {{ name.trim() || defaultName }}
        </div>
        <div :class="terse">games{{ gamesBound ? `, ${gamesBound}` : '' }}</div>
        <div class="num mb-2.5 text-hero font-semibold">
          {{ totalGames.toLocaleString('en-US') }}
        </div>
        <dl class="mb-3.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-dense">
          <dt class="text-dim">format</dt>
          <dd>{{ formatSummary }}</dd>
          <dt class="text-dim">engines</dt>
          <dd class="num break-words">
            {{ kind === 'match' ? `${tested} vs ${base}` : `${field.length} entered` }}
          </dd>
          <dt class="text-dim">time</dt>
          <dd class="num">{{ control }}</dd>
          <dt class="text-dim">opening</dt>
          <dd class="num break-words">{{ book || 'start position' }}</dd>
          <template v-if="unpairable">
            <dt class="text-dim">colors</dt>
            <dd>{{ paired ? 'pairs, swapped' : 'one game each' }}</dd>
          </template>
          <dt class="text-dim">at once</dt>
          <dd class="num">{{ concurrency }}</dd>
        </dl>
        <button
          class="btn-primary w-full py-2.5"
          :disabled="!canStart || blocked !== ''"
          @click="startNew"
        >
          Start
        </button>
        <div v-if="blocked" class="mt-2 text-dense text-warn">{{ blocked }}</div>
      </aside>
    </div>
  </div>
</template>
