<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import Panel from '../components/Panel.vue';
import { TIME_CONTROLS } from '../chess/clock.ts';
import { STANDARD_ADJUDICATION, type Adjudication } from '../match/adjudicate.ts';
import { bracket } from '../match/director.ts';
import { plannedGames, type Format, type TournamentConfig } from '../match/format.ts';
import { sprtGames } from '../match/stats.ts';
import { useBooks } from '../stores/books.ts';
import { useEngines } from '../stores/engines.ts';
import { collectionOf, useTournaments, type Item } from '../stores/tournaments.ts';

const tournaments = useTournaments();
const engines = useEngines();
const books = useBooks();
const route = useRoute();
const router = useRouter();

onMounted(async () => {
  await Promise.all([tournaments.load(), books.load()]);
  if (creating.value) reset();
});

const selected = computed(() => (typeof route.params['id'] === 'string' ? route.params['id'] : ''));
const creating = computed(() => selected.value === 'new');
const item = computed<Item | undefined>(() =>
  tournaments.items.find((i) => i.config.id === selected.value),
);

// ── the setup ──────────────────────────────────────────────────────────────
const hardwareThreads = navigator.hardwareConcurrency;
const kind = ref<Format['kind']>('match');
const name = ref('');
const tested = ref('');
const base = ref('');
/** a round robin's or a gauntlet's field, in seeding order; an engine may appear twice */
const field = ref<string[]>([]);
const adding = ref('');
const pairs = ref(500);
const useSprt = ref(true);
const elo0 = ref(0);
const elo1 = ref(5);
const cycles = ref(1);
const seeds = ref(1);
const rounds = ref(5);
const boutPairs = ref(1);
const control = ref('10+0.1');
const book = ref('');
const adjudicationChoice = ref<'standard' | 'draw' | 'none'>('standard');
const concurrency = ref(1);
const concurrencyEdited = ref(false);

/** the bounds a match's SPRT offers; the first is the default */
const SPRT_PRESETS = [
  { label: '[0, 5]', elo0: 0, elo1: 5 },
  { label: '[0, 10]', elo0: 0, elo1: 10 },
  { label: '[-10, 0]', elo0: -10, elo1: 0 },
] as const;
const sprtPreset = computed({
  get: () =>
    SPRT_PRESETS.find((p) => p.elo0 === elo0.value && p.elo1 === elo1.value)?.label ?? 'custom',
  set: (label: string) => {
    const p = SPRT_PRESETS.find((x) => x.label === label);
    if (p) [elo0.value, elo1.value] = [p.elo0, p.elo1];
  },
});
const sprtEstimate = computed(() =>
  elo1.value > elo0.value ? sprtGames(elo0.value, elo1.value) : null,
);

/** the setup as a new tournament starts: each New begins here, not from the last one's values */
function reset(): void {
  kind.value = 'match';
  name.value = '';
  tested.value = engines.list.at(-1)?.id ?? '';
  base.value = engines.list.at(-2)?.id ?? tested.value;
  field.value = [];
  adding.value = '';
  pairs.value = 500;
  useSprt.value = true;
  [elo0.value, elo1.value] = [SPRT_PRESETS[0].elo0, SPRT_PRESETS[0].elo1];
  cycles.value = 1;
  seeds.value = 1;
  rounds.value = 5;
  boutPairs.value = 1;
  control.value = '10+0.1';
  book.value = books.pulled.has('8moves_v3.pgn') ? '8moves_v3.pgn' : '';
  adjudicationChoice.value = 'standard';
  concurrencyEdited.value = false;
  concurrency.value = defaultConcurrency();
}
watch(creating, (now) => {
  if (now) reset();
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

/** fastchess-gui's rule: a game per hardware thread under a node budget, half the threads less one on a clock */
function defaultConcurrency(): number {
  const threads = navigator.hardwareConcurrency || 2;
  const tc = TIME_CONTROLS.find((t) => t.label === control.value);
  return tc?.kind === 'nodes' ? threads : Math.max(1, Math.floor(threads / 2) - 1);
}
watch(
  control,
  () => {
    if (!concurrencyEdited.value) concurrency.value = defaultConcurrency();
  },
  { immediate: true },
);

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
const defaultName = computed(() =>
  kind.value === 'match'
    ? `${tested.value} vs ${base.value}`
    : `${KIND_NAMES[kind.value]} of ${field.value.length}`,
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
      return { kind: 'knockout', pairs: boutPairs.value };
  }
});
const totalGames = computed(() => plannedGames(format.value, entrants.value.length));
/** the rounds a Swiss needs for one engine to be alone on top */
const settling = computed(() => Math.max(1, Math.ceil(Math.log2(Math.max(2, field.value.length)))));
/** how the planned games bound the games played */
const bound = (f: Format) =>
  f.kind === 'match' && f.sprt ? ' at most' : f.kind === 'knockout' ? ' at least' : '';
const canStart = computed(
  () =>
    entrants.value.length >= 2 &&
    entrants.value.every((e) => e) &&
    totalGames.value > 0 &&
    !(kind.value === 'match' && useSprt.value && elo1.value <= elo0.value),
);

function adjudication(): Adjudication | null {
  if (adjudicationChoice.value === 'none') return null;
  if (adjudicationChoice.value === 'draw') return { ...STANDARD_ADJUDICATION, resign: null };
  return STANDARD_ADJUDICATION;
}

async function startNew(): Promise<void> {
  const config: TournamentConfig = {
    id: crypto.randomUUID(),
    name: name.value.trim() || defaultName.value,
    created: new Date().toISOString(),
    format: format.value,
    entrants: [...entrants.value],
    control: control.value,
    book: book.value,
    adjudication: adjudication(),
    concurrency: Math.max(1, concurrency.value),
    seed: Math.floor(Math.random() * 2 ** 31),
  };
  await tournaments.create(config);
  await router.push(`/tournaments/${config.id}`);
}

// ── a tournament ───────────────────────────────────────────────────────────
const label = (i: Item, n: number) => {
  const id = i.config.entrants[n] ?? '?';
  return i.config.entrants.filter((x) => x === id).length > 1
    ? `${id} #${i.config.entrants.slice(0, n + 1).filter((x) => x === id).length}`
    : id;
};
function formatText(f: Format): string {
  if (f.kind === 'match') {
    return f.sprt
      ? `SPRT nElo [${f.sprt.elo0}, ${f.sprt.elo1}], up to ${f.pairs * 2} games`
      : `match of ${f.pairs * 2} games`;
  }
  if (f.kind === 'roundrobin') return `round robin, ${f.cycles} cycle${f.cycles > 1 ? 's' : ''}`;
  if (f.kind === 'swiss') return `Swiss, ${f.rounds} round${f.rounds > 1 ? 's' : ''}`;
  if (f.kind === 'knockout')
    return `knockout, ${f.pairs} pair${f.pairs > 1 ? 's' : ''} a meeting, more while tied`;
  return `gauntlet, ${f.seeds} seed${f.seeds > 1 ? 's' : ''}, ${f.cycles} cycle${f.cycles > 1 ? 's' : ''}`;
}
const planned = (i: Item) => plannedGames(i.config.format, i.config.entrants.length);
/** a knockout's bracket, round by round */
const bouts = computed(() => {
  const i = item.value;
  if (i?.config.format.kind !== 'knockout') return [];
  return bracket(i.config.entrants.length, i.config.format.pairs, i.state.pairs, i.state.games);
});
const roundName = (r: number, total: number) =>
  r === total - 1 ? 'final' : r === total - 2 ? 'semifinals' : `round ${r + 1}`;
function statusText(i: Item): string {
  if (i.elsewhere) return 'in another tab';
  if (i.state.status === 'running') return 'running';
  if (i.state.status === 'stopping') return 'stopping';
  if (i.ended === 'done') return i.state.summary.match?.verdict ?? 'done';
  return i.ended === 'stopped' ? 'stopped' : 'interrupted';
}
const statusClass = (s: string) =>
  s === 'H1'
    ? 'text-good border-[#2c6b4d]'
    : s === 'H0'
      ? 'text-bad border-[#7a3a30]'
      : s === 'running' || s === 'in another tab'
        ? 'text-accent border-[#2c4a66]'
        : s === 'interrupted'
          ? 'text-warn border-[#7a5d24]'
          : 'text-dim border-line';

/** a signed value; an unbounded one, as an all-or-nothing score gives, shows as ±∞ */
const fmt = (v: number, d = 1) =>
  Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(d)}` : v > 0 ? '+∞' : '−∞';
/** games played over games planned; a knockout plays at least its planned games */
const progress = (i: Item) =>
  i.config.format.kind === 'knockout'
    ? `${i.state.games.length} of ${planned(i)} or more`
    : `${i.state.games.length}/${planned(i)}`;
const pct = (i: Item) => Math.min(100, (100 * i.state.games.length) / Math.max(1, planned(i)));
const llrAt = (v: number, lo: number, hi: number) =>
  (100 * (Math.min(hi, Math.max(lo, v)) - lo)) / (hi - lo);
/** a tournament this tab may play on or delete: not done, and not played by a tab */
const idle = (i: Item) => !tournaments.running(i.config.id) && !i.elsewhere;

async function remove(i: Item): Promise<void> {
  if (!confirm(`Delete “${i.config.name}”? Its games stay in Games.`)) return;
  try {
    await tournaments.remove(i.config.id);
    await router.push('/tournaments');
  } catch (e) {
    i.state.error = `It could not be deleted: ${e instanceof Error ? e.message : String(e)}`;
  }
}

const recent = computed(() => (item.value ? item.value.state.games.slice(-12).toReversed() : []));

const th = 'border-b border-line px-2 py-1 font-medium whitespace-nowrap';
const inputClass = 'num rounded border border-line bg-panel2 px-1.5 py-0.5 text-[12.5px] text-text';
const buttonClass = 'rounded border border-line bg-panel2 px-2.5 py-1 text-xs disabled:text-faint';
</script>

<template>
  <div class="mb-2.5 flex items-baseline gap-2.5">
    <h1 class="text-[15px] font-semibold">Tourneys</h1>
    <span class="text-xs text-dim">matches and tournaments played in this browser</span>
    <span class="flex-1" />
    <RouterLink to="/tournaments/new" :class="buttonClass">New…</RouterLink>
  </div>
  <div v-if="tournaments.error" class="mb-3 text-bad">{{ tournaments.error }}</div>

  <div class="grid gap-3.5 wide:grid-cols-[minmax(300px,380px)_1fr]">
    <div :class="selected ? 'hidden wide:block' : ''">
      <Panel>
        <div
          v-for="i in tournaments.items"
          :key="i.config.id"
          class="cursor-pointer border-b border-row px-3 py-2 last:border-0 hover:bg-[#1c2128]"
          :class="i.config.id === selected ? 'bg-[#1d2631]' : ''"
          @click="router.push(`/tournaments/${i.config.id}`)"
        >
          <div class="flex items-baseline gap-2">
            <span class="flex-1 truncate">{{ i.config.name }}</span>
            <span
              class="num rounded border px-1.5 text-[10.5px]"
              :class="statusClass(statusText(i))"
              >{{ statusText(i) }}</span
            >
          </div>
          <div class="num mt-0.5 flex justify-between text-[11.5px] text-dim">
            <span>{{ formatText(i.config.format) }} · {{ i.config.control }}</span>
            <span>{{ progress(i) }}</span>
          </div>
          <div class="mt-1 h-1 overflow-hidden rounded bg-[#262c35]">
            <div class="h-full bg-accent" :style="{ width: `${pct(i)}%` }" />
          </div>
        </div>
        <div v-if="tournaments.items.length === 0" class="px-3 py-3 text-dim">None yet.</div>
      </Panel>
    </div>

    <!-- the setup -->
    <div v-if="creating">
      <RouterLink to="/tournaments" class="mb-2 inline-block text-[12.5px] text-accent wide:hidden"
        >‹ Tourneys</RouterLink
      >
      <Panel title="New">
        <div
          class="grid grid-cols-[max-content_1fr] items-center gap-x-3 gap-y-2 px-3 py-3 text-[13px]"
        >
          <span class="text-dim">format</span>
          <select v-model="kind" :class="inputClass" class="w-fit">
            <option value="match">match</option>
            <option value="roundrobin">round robin</option>
            <option value="gauntlet">gauntlet</option>
            <option value="swiss">Swiss</option>
            <option value="knockout">knockout</option>
          </select>

          <template v-if="kind === 'match'">
            <span class="text-dim">tested</span>
            <select v-model="tested" :class="inputClass" class="w-fit">
              <option v-for="e in engines.list" :key="e.id" :value="e.id">{{ e.id }}</option>
            </select>
            <span class="text-dim">base</span>
            <select v-model="base" :class="inputClass" class="w-fit">
              <option v-for="e in engines.list" :key="e.id" :value="e.id">{{ e.id }}</option>
            </select>
            <span class="text-dim">pairs</span>
            <span
              ><input
                v-model.number="pairs"
                type="number"
                min="1"
                :class="inputClass"
                class="w-24"
              /> <span class="text-dim"
                >{{ pairs * 2 }} games{{ useSprt ? ' at most' : '' }}</span
              ></span
            >
            <span class="text-dim">SPRT</span>
            <span class="flex flex-wrap items-center gap-2">
              <input v-model="useSprt" type="checkbox" />
              <template v-if="useSprt">
                <select v-model="sprtPreset" :class="inputClass">
                  <option v-for="p in SPRT_PRESETS" :key="p.label" :value="p.label">
                    {{ p.label }}
                  </option>
                  <option value="custom" disabled>custom</option>
                </select>
                nElo [<input
                  v-model.number="elo0"
                  type="number"
                  step="0.5"
                  :class="inputClass"
                  class="w-16"
                />,
                <input
                  v-model.number="elo1"
                  type="number"
                  step="0.5"
                  :class="inputClass"
                  class="w-16"
                />]
                <span class="text-dim">α = β = 0.05</span>
              </template>
            </span>
            <template v-if="useSprt">
              <span />
              <span class="text-xs text-dim">{{
                sprtEstimate === null
                  ? 'the upper bound must be above the lower'
                  : `about ${sprtEstimate.toLocaleString()} games when the true nElo is on a bound; more between the bounds, fewer far outside them${sprtEstimate > pairs * 2 ? `. Its ${(pairs * 2).toLocaleString()} games may end it before a verdict` : ''}`
              }}</span>
            </template>
          </template>

          <template v-else>
            <span class="self-start pt-1 text-dim">field</span>
            <div>
              <div
                v-for="(id, n) in field"
                :key="n"
                class="num flex items-center gap-2 py-0.5 text-[12.5px]"
              >
                <span class="w-5 text-faint">{{ n + 1 }}</span>
                <span :class="kind === 'gauntlet' && n < seeds ? 'text-accent' : ''">{{ id }}</span>
                <button
                  class="text-faint hover:text-text"
                  title="Remove"
                  @click="field.splice(n, 1)"
                >
                  ✕
                </button>
              </div>
              <div class="mt-1 flex gap-1.5">
                <select v-model="adding" :class="inputClass">
                  <option value="" disabled>engine…</option>
                  <option v-for="e in engines.list" :key="e.id" :value="e.id">{{ e.id }}</option>
                </select>
                <button :class="buttonClass" :disabled="!adding" @click="field.push(adding)">
                  Add
                </button>
              </div>
            </div>
            <template v-if="kind === 'gauntlet'">
              <span class="text-dim">seeds</span>
              <span
                ><input
                  v-model.number="seeds"
                  type="number"
                  min="1"
                  :class="inputClass"
                  class="w-16"
                /> <span class="text-dim">the first in the field play all the others</span></span
              >
            </template>
            <template v-if="kind === 'swiss'">
              <span class="text-dim">rounds</span>
              <span
                ><input
                  v-model.number="rounds"
                  type="number"
                  min="1"
                  :class="inputClass"
                  class="w-16"
                /> <span class="text-dim"
                  >a pair each; {{ settling }} can leave one engine alone on top</span
                ></span
              >
            </template>
            <template v-if="kind === 'knockout'">
              <span class="text-dim">pairs</span>
              <span
                ><input
                  v-model.number="boutPairs"
                  type="number"
                  min="1"
                  :class="inputClass"
                  class="w-16"
                /> <span class="text-dim"
                  >a meeting; while tied, one more at a time up to 10, then the higher seed goes
                  through</span
                ></span
              >
            </template>
            <span v-if="kind === 'roundrobin' || kind === 'gauntlet'" class="text-dim">cycles</span>
            <span v-if="kind === 'roundrobin' || kind === 'gauntlet'"
              ><input
                v-model.number="cycles"
                type="number"
                min="1"
                :class="inputClass"
                class="w-16"
              /> <span class="text-dim">each a pair per meeting</span></span
            >
          </template>

          <span class="text-dim">time</span>
          <select v-model="control" :class="inputClass" class="w-fit">
            <option v-for="t in TIME_CONTROLS" :key="t.label" :value="t.label">
              {{ t.label }}
            </option>
          </select>
          <span class="text-dim">opening</span>
          <select v-model="book" :class="inputClass" class="w-fit">
            <option value="">start position</option>
            <option
              v-for="b in books.list.filter((x) => books.pulled.has(x.id))"
              :key="b.id"
              :value="b.id"
            >
              {{ b.id }}
            </option>
          </select>
          <span class="text-dim">adjudication</span>
          <select v-model="adjudicationChoice" :class="inputClass" class="w-fit">
            <option value="standard">draw and resign</option>
            <option value="draw">draw only</option>
            <option value="none">none</option>
          </select>
          <span class="text-dim">at once</span>
          <span>
            <input
              v-model.number="concurrency"
              type="number"
              min="1"
              :class="inputClass"
              class="w-16"
              @input="concurrencyEdited = true"
            />
            <span class="text-dim">
              games; this browser has {{ hardwareThreads }} hardware threads</span
            >
          </span>
          <span class="text-dim">name</span>
          <input
            v-model="name"
            :placeholder="defaultName"
            :class="inputClass"
            class="w-full max-w-md"
          />
        </div>
        <div class="flex items-center gap-3 border-t border-row px-3 py-2">
          <button :class="buttonClass" :disabled="!canStart" @click="startNew">Start</button>
          <span class="num text-xs text-dim">{{ totalGames }} games{{ bound(format) }}</span>
        </div>
      </Panel>
    </div>

    <!-- a tournament -->
    <div v-else-if="item">
      <RouterLink to="/tournaments" class="mb-2 inline-block text-[12.5px] text-accent wide:hidden"
        >‹ Tourneys</RouterLink
      >
      <div class="mb-2 flex flex-wrap items-baseline gap-2">
        <h2 class="text-[15px] font-semibold">{{ item.config.name }}</h2>
        <span
          class="num rounded border px-1.5 text-[10.5px]"
          :class="statusClass(statusText(item))"
          >{{ statusText(item) }}</span
        >
        <span class="flex-1" />
        <template v-if="tournaments.running(item.config.id)">
          <button
            :class="buttonClass"
            :disabled="item.state.status !== 'running'"
            @click="tournaments.stop(item.config.id, false)"
          >
            Stop after these games
          </button>
          <button :class="buttonClass" @click="tournaments.stop(item.config.id, true)">
            Stop now
          </button>
        </template>
        <template v-else-if="idle(item)">
          <button
            v-if="item.ended !== 'done'"
            :class="buttonClass"
            title="Plays the unfinished games of its pairs, then the rest"
            @click="tournaments.resume(item.config.id)"
          >
            Resume
          </button>
          <button :class="buttonClass" @click="remove(item)">Delete</button>
        </template>
        <RouterLink :to="`/games/${collectionOf(item.config.id)}`" :class="buttonClass"
          >Games</RouterLink
        >
      </div>
      <div class="num mb-3 text-[12px] text-dim">
        {{ formatText(item.config.format) }} · {{ item.config.control }} ·
        {{ item.config.book || 'start position' }} ·
        {{
          item.config.adjudication
            ? item.config.adjudication.resign
              ? 'draw and resign adjudication'
              : 'draw adjudication'
            : 'no adjudication'
        }}
        · {{ item.config.concurrency }} at once · {{ progress(item) }} games
      </div>
      <div v-if="item.state.error" class="mb-3 text-bad">{{ item.state.error }}</div>

      <template v-if="item.state.summary.match">
        <div class="mb-3 grid grid-cols-2 gap-2 wide:grid-cols-5">
          <div
            v-if="item.state.summary.match.llr !== null && item.state.summary.match.bounds"
            class="col-span-2 rounded-md border border-line bg-panel2 px-2.5 py-2"
          >
            <div class="text-[10.5px] tracking-wider text-dim uppercase">LLR</div>
            <div class="num text-lg">
              {{ item.state.summary.match.llr.toFixed(2) }}
              <span class="text-xs text-dim"
                >of [{{ item.state.summary.match.bounds.lower.toFixed(2) }},
                {{ item.state.summary.match.bounds.upper.toFixed(2) }}]</span
              >
            </div>
            <div class="relative mt-1.5 h-2 rounded bg-[#262c35]">
              <div
                class="absolute top-[-2px] h-3 w-1 -translate-x-1/2 rounded bg-accent"
                :style="{
                  left: `${llrAt(item.state.summary.match.llr, item.state.summary.match.bounds.lower, item.state.summary.match.bounds.upper)}%`,
                }"
              />
              <div class="absolute top-0 left-1/2 h-2 w-px bg-faint" />
            </div>
          </div>
          <div class="rounded-md border border-line bg-panel2 px-2.5 py-2">
            <div class="text-[10.5px] tracking-wider text-dim uppercase">nElo</div>
            <div class="num text-lg">{{ fmt(item.state.summary.match.nelo.value) }}</div>
            <div class="num text-xs text-dim">
              ±
              {{
                Number.isFinite(item.state.summary.match.nelo.ci)
                  ? item.state.summary.match.nelo.ci.toFixed(1)
                  : '—'
              }}
            </div>
          </div>
          <div class="rounded-md border border-line bg-panel2 px-2.5 py-2">
            <div class="text-[10.5px] tracking-wider text-dim uppercase">Elo</div>
            <div class="num text-lg">{{ fmt(item.state.summary.match.elo.value) }}</div>
            <div class="num text-xs text-dim">
              ±
              {{
                Number.isFinite(item.state.summary.match.elo.ci)
                  ? item.state.summary.match.elo.ci.toFixed(1)
                  : '—'
              }}
            </div>
          </div>
          <div class="rounded-md border border-line bg-panel2 px-2.5 py-2">
            <div class="text-[10.5px] tracking-wider text-dim uppercase">W D L · pairs</div>
            <div class="num text-[15px]">{{ item.state.summary.match.wdl.join(' ') }}</div>
            <div class="num text-xs text-dim">{{ item.state.summary.match.ptnml.join(' ') }}</div>
          </div>
        </div>
      </template>

      <Panel title="Standings">
        <div class="overflow-x-auto">
          <table class="w-full border-collapse text-[12.5px]">
            <thead>
              <tr class="text-left text-[11.5px] text-dim">
                <th :class="th">#</th>
                <th :class="th">engine</th>
                <th :class="th" class="text-right">games</th>
                <th :class="th" class="text-right">W</th>
                <th :class="th" class="text-right">D</th>
                <th :class="th" class="text-right">L</th>
                <th :class="th" class="text-right">points</th>
                <th :class="th" class="text-right">score</th>
                <th :class="th" class="text-right">Elo vs field</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(r, n) in item.state.summary.standings"
                :key="r.entrant"
                class="border-b border-row last:border-0"
              >
                <td class="num px-2 py-1 text-faint">{{ n + 1 }}</td>
                <td class="num px-2 py-1 whitespace-nowrap">{{ label(item, r.entrant) }}</td>
                <td class="num px-2 py-1 text-right">{{ r.games }}</td>
                <td class="num px-2 py-1 text-right">{{ r.wins }}</td>
                <td class="num px-2 py-1 text-right">{{ r.draws }}</td>
                <td class="num px-2 py-1 text-right">{{ r.losses }}</td>
                <td class="num px-2 py-1 text-right">{{ r.points }}</td>
                <td class="num px-2 py-1 text-right">
                  {{ r.games ? ((100 * (r.points - r.byes)) / r.games).toFixed(1) + '%' : '—' }}
                </td>
                <td class="num px-2 py-1 text-right">{{ r.elo === null ? '—' : fmt(r.elo, 0) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel v-if="bouts.length > 0" title="Bracket" note="points over finished pairs">
        <div class="grid gap-3 px-3 py-2 text-[12.5px] wide:grid-flow-col">
          <div v-for="(round, r) in bouts" :key="r">
            <div class="mb-1 text-[10.5px] tracking-wider text-dim uppercase">
              {{ roundName(r, bouts.length) }}
            </div>
            <div
              v-for="(t, k) in round"
              :key="k"
              class="num mb-1.5 rounded border border-line bg-panel2 px-2 py-1"
            >
              <div
                v-for="(side, s) in [t.a, t.b]"
                :key="s"
                class="flex gap-2"
                :class="t.winner !== null && side === t.winner ? 'text-text' : 'text-dim'"
              >
                <span class="flex-1 truncate">{{
                  side === null ? (t.by === 'bye' ? 'bye' : '…') : label(item, side)
                }}</span>
                <span v-if="t.pairs.length > 0">{{ t.points[s] }}</span>
              </div>
              <div v-if="t.by === 'seed'" class="text-[11px] text-faint">
                tied after {{ t.done }} pairs: the higher seed goes through
              </div>
            </div>
          </div>
        </div>
      </Panel>

      <Panel
        v-if="
          (item.config.format.kind === 'roundrobin' || item.config.format.kind === 'swiss') &&
          item.config.entrants.length <= 12
        "
        title="Crosstable"
        note="points of the row's engine against the column's"
      >
        <div class="overflow-x-auto">
          <table class="border-collapse text-[12px]">
            <tbody>
              <tr v-for="(row, i) in item.state.summary.points" :key="i">
                <td class="num px-2 py-0.5 whitespace-nowrap text-dim">{{ label(item, i) }}</td>
                <td
                  v-for="(p, j) in row"
                  :key="j"
                  class="num px-2 py-0.5 text-center"
                  :class="i === j ? 'text-faint' : ''"
                >
                  {{
                    i === j
                      ? '·'
                      : (item.state.summary.games[i]?.[j] ?? 0)
                        ? `${p}/${item.state.summary.games[i]?.[j]}`
                        : ''
                  }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel
        v-if="item.state.live.length > 0"
        title="Playing"
        :note="`${item.state.live.length} game${item.state.live.length === 1 ? '' : 's'}`"
      >
        <div class="num max-h-60 overflow-auto px-3 py-1.5 text-[12px]">
          <div v-for="g in item.state.live" :key="`${g.pair}.${g.game}`" class="flex gap-2 py-0.5">
            <span class="w-14 text-faint">{{ g.pair * 2 + g.game + 1 }}</span>
            <span class="flex-1 truncate"
              >{{ label(item, g.white) }} <span class="text-dim">vs</span>
              {{ label(item, g.black) }}</span
            >
            <span class="text-dim">{{ g.plies }} plies {{ g.last }}</span>
          </div>
        </div>
      </Panel>

      <Panel title="Last games">
        <div class="num px-3 py-1.5 text-[12px]">
          <div v-for="g in recent" :key="`${g.pair}.${g.game}`" class="flex gap-2 py-0.5">
            <span class="w-14 text-faint">{{ g.pair * 2 + g.game + 1 }}</span>
            <span class="flex-1 truncate"
              >{{ label(item, g.white) }} <span class="text-dim">vs</span>
              {{ label(item, g.black) }}</span
            >
            <span class="w-14 text-right">{{ g.result }}</span>
            <span class="w-56 truncate text-dim">{{ g.reason }}</span>
          </div>
          <div v-if="recent.length === 0" class="text-faint">none yet</div>
        </div>
      </Panel>
    </div>
  </div>
</template>
