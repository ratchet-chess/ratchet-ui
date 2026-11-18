<script setup lang="ts">
/** The setup of a new match or tournament. */
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import Panel from '../../components/Panel.vue';
import { TIME_CONTROLS } from '../../chess/clock.ts';
import { STANDARD_ADJUDICATION, type Adjudication } from '../../match/adjudicate.ts';
import { plannedGames, type Format, type TournamentConfig } from '../../match/format.ts';
import { sprtGames } from '../../match/stats.ts';
import { useBooks } from '../../stores/books.ts';
import { useEngines } from '../../stores/engines.ts';
import { useTournaments } from '../../stores/tournaments.ts';
import { buttonClass, inputClass } from './show.ts';

const tournaments = useTournaments();
const engines = useEngines();
const books = useBooks();
const router = useRouter();

onMounted(async () => {
  await books.load();
  reset();
});

const hardwareThreads = navigator.hardwareConcurrency;
const kind = ref<Format['kind']>('match');
const name = ref('');
const tested = ref('');
const base = ref('');
/** a round robin's or a gauntlet's field, in seeding order; an engine may appear twice */
const field = ref<string[]>([]);
const adding = ref('');
/** a fixed match's pairs, or an SPRT's cap */
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
/**
 * the pairs a match plays until the user sets them: with an SPRT, as many pairs as the games it
 * takes at a bound, twice the pairs it expects there, since runs between the bounds last longer,
 * rounded up to a thousand; so the SPRT, not the cap, ends nearly every run
 */
const defaultPairs = () =>
  useSprt.value && sprtEstimate.value !== null ? Math.ceil(sprtEstimate.value / 1000) * 1000 : 500;
watch([useSprt, sprtEstimate], () => {
  if (!pairsEdited.value) pairs.value = defaultPairs();
});

/** the setup as a new tournament starts: each New begins here, not from the last one's values */
function reset(): void {
  kind.value = 'match';
  name.value = '';
  tested.value = engines.list.at(-1)?.id ?? '';
  base.value = engines.list.at(-2)?.id ?? tested.value;
  field.value = [];
  adding.value = '';
  useSprt.value = true;
  [elo0.value, elo1.value] = [SPRT_PRESETS[0].elo0, SPRT_PRESETS[0].elo1];
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
      return { kind: 'knockout', pairs: matchPairs.value };
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
</script>

<template>
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
            @input="pairsEdited = true"
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
            <button class="text-faint hover:text-text" title="Remove" @click="field.splice(n, 1)">
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
              v-model.number="matchPairs"
              type="number"
              min="1"
              :class="inputClass"
              class="w-16"
            /> <span class="text-dim"
              >a match; while tied, one more at a time up to 10, then the higher seed goes
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
          /> <span class="text-dim">each a pair per match</span></span
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
        <option v-for="b in books.usable" :key="b.id" :value="b.id">
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
</template>
