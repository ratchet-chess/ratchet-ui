<script setup lang="ts">
/**
 * Focused live game inspector: board with PV arrows, live clocks, both engines' UCI search
 * telemetry, clickable move list with opening badge, and Evaluation / Depth / Nodes charts.
 * Supports B1 wide (tabbed panel below Overview) and B2 narrow (full vertical focused view).
 */
import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, Pin } from '@lucide/vue';
import type { Color } from 'chessops/types';
import { computed, nextTick, ref, watch } from 'vue';
import EvalGraph from '../../components/EvalGraph.vue';
import Panel from '../../components/Panel.vue';
import Segmented from '../../components/Segmented.vue';
import Tabs from '../../components/Tabs.vue';
import { findOpening } from '../../chess/openings.ts';
import { extractGameEval, formatEval } from '../../games/eval.ts';
import type { LiveSnapshot } from '../../match/runner.ts';
import { thousands } from '../../ui/format.ts';
import { scrollChildIntoView } from '../../ui/scroll.ts';
import LiveFocusBoard from './LiveFocusBoard.vue';
import LiveMetricChart from './LiveMetricChart.vue';
import { formatSideScore, scoreTone, whitePovScore } from './live.ts';

const props = defineProps<{
  snapshot: LiveSnapshot;
  gameNo: number;
  whiteName: string;
  blackName: string;
  controlLabel: string;
  /** `panel` = B1 tabbed right-bottom inspector; `full` = B2 stacked focused view */
  layout: 'panel' | 'full';
  /** when true in `panel` layout, hides the inline board because the left pane shows it */
  hideBoard?: boolean;
  /** null follows live ply; a number scrubs an earlier ply */
  viewingPly: number | null;
  orientation: Color;
  showPvArrows: boolean;
  /** whether auto-follow is paused (pinned) when this game finishes */
  pinned: boolean;
  /** whether another live game is available to jump to */
  hasOtherLive: boolean;
}>();

const emit = defineEmits<{
  'update:viewingPly': [ply: number | null];
  'update:orientation': [color: Color];
  'update:showPvArrows': [value: boolean];
  'update:pinned': [value: boolean];
  'next-live': [];
}>();

const inspectorTab = ref<'search' | 'charts' | 'moves'>('search');
const chartTab = ref<'eval' | 'depth' | 'nodes'>('eval');

const totalPlies = computed(() => props.snapshot.full?.san.length ?? props.snapshot.plies);
const activePly = computed(() =>
  props.viewingPly === null ? totalPlies.value : Math.min(totalPlies.value, props.viewingPly),
);
const viewingLive = computed(
  () => props.viewingPly === null || activePly.value >= totalPlies.value,
);

function goTo(ply: number): void {
  const clamped = Math.max(0, Math.min(totalPlies.value, ply));
  emit('update:viewingPly', clamped >= totalPlies.value ? null : clamped);
}

const names = computed<Record<Color, string>>(() => ({
  white: props.whiteName,
  black: props.blackName,
}));

const startFen = computed(() => props.snapshot.full?.startFen ?? props.snapshot.fen);
const blackFirst = computed(() => startFen.value.split(' ')[1] === 'b');
const firstNumber = computed(() => Number(startFen.value.split(' ')[5] ?? 1));
const sans = computed(() => ['', ...(props.snapshot.full?.san ?? [])]);

// Derive move evaluations and opening name only when `moveSeq` or `key` changes (never on clock ticks)
const derived = ref({
  key: '',
  seq: -1,
  gameEval: extractGameEval([]),
  opening: null as { eco: string; name: string } | null,
});

watch(
  () => [props.snapshot.key, props.snapshot.moveSeq] as const,
  ([key, seq]) => {
    const full = props.snapshot.full;
    if (!full) return;
    if (derived.value.key === key && derived.value.seq === seq) return;
    const steps = full.fens.map((fen, i) => {
      const c = i > 0 ? full.comments[i - 1] : undefined;
      return { fen, comments: c ? [c] : [] };
    });
    const hit = findOpening(full.fens);
    derived.value = {
      key,
      seq,
      gameEval: extractGameEval(steps),
      opening: hit ? { eco: hit.eco, name: hit.name } : null,
    };
  },
  { immediate: true },
);

const moveRows = computed(() => {
  const list = props.snapshot.full?.san ?? [];
  const rows: {
    n: number;
    wPly: number | null;
    white: string;
    bPly: number | null;
    black: string;
  }[] = [];
  let i = 0;
  if (blackFirst.value && list.length > 0) {
    rows.push({ n: firstNumber.value, wPly: null, white: '', bPly: 1, black: list[0] ?? '' });
    i = 1;
  }
  for (; i < list.length; i += 2) {
    rows.push({
      n: firstNumber.value + rows.length,
      wPly: i + 1,
      white: list[i] ?? '',
      bPly: i + 1 < list.length ? i + 2 : null,
      black: list[i + 1] ?? '',
    });
  }
  return rows;
});

function rowEvalText(wPly: number | null, bPly: number | null): string {
  const lastIdx = bPly ?? wPly;
  if (lastIdx === null) return '';
  const p = derived.value.gameEval.points[lastIdx - 1];
  return p ? formatEval(p) : '';
}

const movesBox = ref<HTMLElement | null>(null);
watch([activePly, totalPlies], async ([p]) => {
  await nextTick();
  const box = movesBox.value;
  if (!box) return;
  if (p === 0) {
    box.scrollTop = 0;
    return;
  }
  const el = box.querySelector<HTMLElement>(`[data-ply="${p}"]`);
  if (el) scrollChildIntoView(box, el);
});

const inspectorTabs = computed(
  () =>
    [
      { key: 'search', name: props.hideBoard ? 'Search' : 'Search & board' },
      { key: 'charts', name: 'Charts' },
      { key: 'moves', name: 'Moves', count: totalPlies.value },
    ] as const,
);

const CHART_OPTIONS = [
  { value: 'eval', label: 'Evaluation' },
  { value: 'depth', label: 'Depth' },
  { value: 'nodes', label: 'Nodes' },
] as const;

function sideMetrics(color: Color): string {
  const s = props.snapshot.search[color];
  if (!s) return '';
  const parts: string[] = [];
  if (s.depth !== undefined) {
    parts.push(s.seldepth !== undefined ? `d${s.depth}/${s.seldepth}` : `d${s.depth}`);
  }
  if (s.nodes !== undefined) parts.push(`${thousands(s.nodes)}n`);
  if (s.nps !== undefined) parts.push(`${thousands(s.nps)}n/s`);
  if (s.hashfull !== undefined) parts.push(`hash ${Math.round(s.hashfull / 10)}%`);
  return parts.join(' · ');
}
</script>

<template>
  <!-- ── B1 wide: tabbed focused inspector panel ──────────────────────── -->
  <Panel
    v-if="layout === 'panel'"
    :title="`Focused · #${gameNo}`"
    :note="`${whiteName} vs ${blackName}`"
  >
    <template #actions>
      <label class="flex cursor-pointer items-center gap-1 text-small text-dim select-none">
        <input
          :checked="showPvArrows"
          type="checkbox"
          class="accent-accent"
          @change="emit('update:showPvArrows', ($event.target as HTMLInputElement).checked)"
        />
        <span>PV arrows</span>
      </label>
      <button
        type="button"
        class="btn-sm"
        :class="pinned ? 'border-accent-line bg-chosen text-text' : ''"
        :title="
          pinned
            ? 'Pinned on this game; click to auto-follow the next live game when it ends'
            : 'Auto-following live games; click to pin this board when it ends'
        "
        @click="emit('update:pinned', !pinned)"
      >
        <Pin :size="12" />
        {{ pinned ? 'Pinned' : 'Auto-follow' }}
      </button>
      <button
        v-if="snapshot.outcome && hasOtherLive"
        type="button"
        class="btn-sm"
        @click="emit('next-live')"
      >
        Next live
      </button>
    </template>

    <div class="px-3 pt-2 pb-2.5">
      <Tabs v-model="inspectorTab" :tabs="inspectorTabs" />

      <!-- Search & board -->
      <div
        v-if="inspectorTab === 'search'"
        class="grid items-start gap-3"
        :class="hideBoard ? '' : 'grid-cols-[minmax(180px,220px)_minmax(0,1fr)]'"
      >
        <LiveFocusBoard
          v-if="!hideBoard"
          :snapshot="snapshot"
          :white-name="whiteName"
          :black-name="blackName"
          :control-label="controlLabel"
          :viewing-ply="viewingPly"
          :orientation="orientation"
          :show-pv-arrows="showPvArrows"
          :pinned="pinned"
          :has-other-live="hasOtherLive"
          compact
          :show-toggles="false"
          @update:viewing-ply="emit('update:viewingPly', $event)"
          @update:orientation="emit('update:orientation', $event)"
          @update:show-pv-arrows="emit('update:showPvArrows', $event)"
          @update:pinned="emit('update:pinned', $event)"
          @next-live="emit('next-live')"
        />

        <!-- Search telemetry for both sides -->
        <div class="min-w-0 rounded-md border border-line bg-panel2">
          <div
            v-for="c in ['white', 'black'] as const"
            :key="c"
            class="border-b border-row px-2.5 py-2 text-small last:border-b-0"
          >
            <div class="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
              <span class="flex min-w-0 items-center gap-1.5 font-semibold text-text">
                <span
                  class="inline-block size-2 shrink-0 rounded-full border border-dim"
                  :class="c === 'white' ? 'bg-white' : 'bg-black'"
                />
                <span class="truncate">{{ names[c] }}</span>
              </span>
              <span v-if="snapshot.search[c]" class="num flex items-center gap-1.5 text-dim">
                <span
                  v-if="formatSideScore(snapshot.search[c], c)"
                  class="tag"
                  :class="scoreTone(whitePovScore(snapshot.search[c], c))"
                >
                  {{ formatSideScore(snapshot.search[c], c) }}
                </span>
                <span>{{ sideMetrics(c) }}</span>
              </span>
              <span v-else class="text-faint">waiting</span>
            </div>
            <div
              v-if="snapshot.full?.pvSan[c]?.length"
              class="num mt-1 truncate text-dim"
              :title="snapshot.full.pvSan[c].join(' ')"
            >
              {{ snapshot.full.pvSan[c].join(' ') }}
            </div>
          </div>
          <div
            v-if="derived.opening"
            class="flex items-baseline gap-1.5 border-t border-row px-2.5 py-1.5 text-small"
          >
            <span class="tag tone-accent">{{ derived.opening.eco }}</span>
            <span class="truncate text-dim" :title="derived.opening.name">
              {{ derived.opening.name }}
            </span>
          </div>
        </div>
      </div>

      <!-- Charts (Evaluation / Depth / Nodes) -->
      <div v-else-if="inspectorTab === 'charts'">
        <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
          <Segmented v-model="chartTab" :options="CHART_OPTIONS" size="sm" />
          <div class="flex items-center gap-2 text-label text-dim">
            <span class="flex items-center gap-1">
              <i class="inline-block h-0.5 w-3 rounded-full bg-eval-white" />White
            </span>
            <span class="flex items-center gap-1">
              <i class="inline-block h-0.5 w-3 rounded-full bg-eval-black" />Black
            </span>
          </div>
        </div>
        <div class="rounded-md border border-line bg-panel2">
          <EvalGraph
            v-if="chartTab === 'eval'"
            bare
            :game-eval="derived.gameEval"
            :ply="activePly"
            :sans="sans"
            :first-move="firstNumber"
            :black-first="blackFirst"
            @select="goTo"
          />
          <LiveMetricChart
            v-else
            :kind="chartTab"
            :metrics="snapshot.full?.metrics ?? []"
            :total-plies="totalPlies"
            :ply="activePly"
            :sans="sans"
            :first-move="firstNumber"
            :black-first="blackFirst"
            @select="goTo"
          />
        </div>
      </div>

      <!-- Moves -->
      <div v-else class="rounded-md border border-line bg-panel2">
        <div class="flex items-center justify-between gap-2 border-b border-row px-2.5 py-1.5">
          <div class="flex min-w-0 items-baseline gap-1.5 text-small">
            <template v-if="derived.opening">
              <span class="tag tone-accent">{{ derived.opening.eco }}</span>
              <span class="truncate text-dim">{{ derived.opening.name }}</span>
            </template>
            <span v-else class="text-dim">{{ totalPlies }} plies</span>
            <span v-if="!viewingLive" class="tag tone-warn">ply {{ activePly }}</span>
          </div>
          <div class="flex shrink-0 items-center gap-1">
            <button
              type="button"
              class="btn-sm px-1.5"
              :disabled="activePly === 0"
              title="Start"
              @click="goTo(0)"
            >
              <ChevronFirst :size="12" />
            </button>
            <button
              type="button"
              class="btn-sm px-1.5"
              :disabled="activePly === 0"
              title="Previous"
              @click="goTo(activePly - 1)"
            >
              <ChevronLeft :size="12" />
            </button>
            <button
              type="button"
              class="btn-sm px-1.5"
              :disabled="viewingLive"
              title="Next"
              @click="goTo(activePly + 1)"
            >
              <ChevronRight :size="12" />
            </button>
            <button
              type="button"
              class="btn-sm px-1.5"
              :disabled="viewingLive"
              title="Live position"
              @click="goTo(totalPlies)"
            >
              <ChevronLast :size="12" />
            </button>
          </div>
        </div>
        <div ref="movesBox" class="num max-h-56 overflow-auto px-3 py-2 text-dense">
          <div
            v-for="r in moveRows"
            :key="r.n"
            class="grid grid-cols-[2.2rem_5rem_5rem_1fr] items-baseline"
          >
            <span class="text-faint">{{ r.n }}.</span>
            <button
              v-if="r.wPly !== null"
              :data-ply="r.wPly"
              type="button"
              class="w-fit rounded px-1 text-left hover:bg-active"
              :class="r.wPly === activePly ? 'bg-accent-line font-semibold text-text' : ''"
              @click="goTo(r.wPly)"
            >
              {{ r.white }}
            </button>
            <span v-else class="px-1 text-faint">…</span>
            <button
              v-if="r.bPly !== null"
              :data-ply="r.bPly"
              type="button"
              class="w-fit rounded px-1 text-left hover:bg-active"
              :class="r.bPly === activePly ? 'bg-accent-line font-semibold text-text' : ''"
              @click="goTo(r.bPly)"
            >
              {{ r.black }}
            </button>
            <span v-else class="px-1 text-faint">…</span>
            <span class="text-right text-label text-faint">{{ rowEvalText(r.wPly, r.bPly) }}</span>
          </div>
          <div v-if="moveRows.length === 0" class="text-faint">No moves yet</div>
        </div>
      </div>
    </div>
  </Panel>

  <!-- ── B2 narrow: full stacked focused view ─────────────────────────── -->
  <div v-else class="space-y-3">
    <div class="mx-auto max-w-[440px]">
      <LiveFocusBoard
        :snapshot="snapshot"
        :white-name="whiteName"
        :black-name="blackName"
        :control-label="controlLabel"
        :viewing-ply="viewingPly"
        :orientation="orientation"
        :show-pv-arrows="showPvArrows"
        :pinned="pinned"
        :has-other-live="hasOtherLive"
        @update:viewing-ply="emit('update:viewingPly', $event)"
        @update:orientation="emit('update:orientation', $event)"
        @update:show-pv-arrows="emit('update:showPvArrows', $event)"
        @update:pinned="emit('update:pinned', $event)"
        @next-live="emit('next-live')"
      />
    </div>

    <!-- Search panel -->
    <Panel title="Search" :note="`Game #${gameNo}`">
      <div
        v-for="c in ['white', 'black'] as const"
        :key="c"
        class="border-b border-row px-3 py-2 text-small last:border-b-0"
      >
        <div class="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
          <span class="flex min-w-0 items-center gap-1.5 font-semibold text-text">
            <span
              class="inline-block size-2 shrink-0 rounded-full border border-dim"
              :class="c === 'white' ? 'bg-white' : 'bg-black'"
            />
            <span class="truncate">{{ names[c] }}</span>
          </span>
          <span v-if="snapshot.search[c]" class="num flex items-center gap-1.5 text-dim">
            <span
              v-if="formatSideScore(snapshot.search[c], c)"
              class="tag"
              :class="scoreTone(whitePovScore(snapshot.search[c], c))"
            >
              {{ formatSideScore(snapshot.search[c], c) }}
            </span>
            <span>{{ sideMetrics(c) }}</span>
          </span>
          <span v-else class="text-faint">waiting</span>
        </div>
        <div
          v-if="snapshot.full?.pvSan[c]?.length"
          class="num mt-1 truncate text-dim"
          :title="snapshot.full.pvSan[c].join(' ')"
        >
          {{ snapshot.full.pvSan[c].join(' ') }}
        </div>
      </div>
    </Panel>

    <!-- Charts panel (Evaluation / Depth / Nodes) -->
    <Panel title="Charts">
      <template #actions>
        <Segmented v-model="chartTab" :options="CHART_OPTIONS" size="sm" />
      </template>
      <EvalGraph
        v-if="chartTab === 'eval'"
        bare
        :game-eval="derived.gameEval"
        :ply="activePly"
        :sans="sans"
        :first-move="firstNumber"
        :black-first="blackFirst"
        @select="goTo"
      />
      <LiveMetricChart
        v-else
        :kind="chartTab"
        :metrics="snapshot.full?.metrics ?? []"
        :total-plies="totalPlies"
        :ply="activePly"
        :sans="sans"
        :first-move="firstNumber"
        :black-first="blackFirst"
        @select="goTo"
      />
    </Panel>

    <!-- Moves panel -->
    <Panel title="Moves" :note="`${totalPlies} plies`">
      <div
        v-if="derived.opening"
        class="flex items-baseline gap-2 border-b border-row bg-panel2 px-3 py-1.5 text-small"
      >
        <span class="tag tone-accent">{{ derived.opening.eco }}</span>
        <span class="truncate text-text" :title="derived.opening.name">{{
          derived.opening.name
        }}</span>
      </div>
      <div ref="movesBox" class="num max-h-60 overflow-auto px-3 py-2 text-dense">
        <div
          v-for="r in moveRows"
          :key="r.n"
          class="grid grid-cols-[2.2rem_5rem_5rem_1fr] items-baseline"
        >
          <span class="text-faint">{{ r.n }}.</span>
          <button
            v-if="r.wPly !== null"
            :data-ply="r.wPly"
            type="button"
            class="w-fit rounded px-1 text-left hover:bg-active"
            :class="r.wPly === activePly ? 'bg-accent-line font-semibold text-text' : ''"
            @click="goTo(r.wPly)"
          >
            {{ r.white }}
          </button>
          <span v-else class="px-1 text-faint">…</span>
          <button
            v-if="r.bPly !== null"
            :data-ply="r.bPly"
            type="button"
            class="w-fit rounded px-1 text-left hover:bg-active"
            :class="r.bPly === activePly ? 'bg-accent-line font-semibold text-text' : ''"
            @click="goTo(r.bPly)"
          >
            {{ r.black }}
          </button>
          <span v-else class="px-1 text-faint">…</span>
          <span class="text-right text-label text-faint">{{ rowEvalText(r.wPly, r.bPly) }}</span>
        </div>
        <div v-if="moveRows.length === 0" class="text-faint">No moves yet</div>
      </div>
    </Panel>
  </div>
</template>
