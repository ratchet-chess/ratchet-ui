<script setup lang="ts">
/**
 * Move-by-move evaluation graph (win-chance sigmoid on [-1.05, 1.05], mates pinned to ±1) with
 * separate White and Black lines so two engines' evaluations never interleave, plus an optional
 * move-time strip beneath the axis (White bars up, Black bars down). Supports hover crosshair and
 * click/drag scrubbing to jump to any ply. Shared between Games and Play.
 */
import type { Color } from 'chessops/types';
import { computed, ref } from 'vue';
import Panel from './Panel.vue';
import {
  evalSeries,
  formatClock,
  formatEval,
  formatMoveTime,
  winChance,
  type EvalSample,
  type GameEval,
  type MoveEval,
} from '../games/eval.ts';

const props = withDefaults(
  defineProps<{
    gameEval: GameEval;
    /** active ply: 0 is the start position, 1..N is after move N */
    ply: number;
    /** SAN per ply (`sans[1]` is ply 1's SAN) */
    sans?: readonly string[];
    firstMove?: number;
    blackFirst?: boolean;
  }>(),
  { sans: () => [], firstMove: 1, blackFirst: false },
);

const emit = defineEmits<{ select: [ply: number] }>();

const W = 500;
const PAD = 4;
const INNER_W = W - 2 * PAD;
const H = 112;
const TH = 36;
const MID_Y = H / 2;
const SCALE_Y = H / 2 / 1.05;
const MID_T = TH / 2;

const total = computed(() => props.gameEval.points.length);
const clampPly = (ply: number) => Math.min(total.value, Math.max(0, ply));
const xAt = (ply: number) =>
  total.value <= 0 ? PAD : PAD + (INNER_W * clampPly(ply)) / total.value;
const yAt = (w: number) => MID_Y - SCALE_Y * w;
const xPct = (ply: number) => (100 * xAt(ply)) / W;
const yPct = (w: number) => (100 * yAt(w)) / H;

const hasScore = (p: MoveEval | null | undefined): p is MoveEval =>
  Boolean(p && (p.cp !== undefined || p.mate !== undefined));

/** contiguous runs of book moves for subtle background shading */
const bookSpans = computed(() => {
  const spans: { x: number; w: number }[] = [];
  let start = -1;
  for (const p of props.gameEval.points) {
    if (p.book) {
      if (start < 0) start = p.ply - 1;
    } else if (start >= 0) {
      spans.push({ x: xAt(start), w: xAt(p.ply - 1) - xAt(start) });
      start = -1;
    }
  }
  if (start >= 0) spans.push({ x: xAt(start), w: xAt(total.value) - xAt(start) });
  return spans;
});

interface SidePath {
  line: string;
  area: string;
  single: EvalSample | null;
  count: number;
}

function buildSidePath(samples: readonly EvalSample[]): SidePath {
  if (samples.length === 0) return { line: '', area: '', single: null, count: 0 };
  if (samples.length === 1) {
    return { line: '', area: '', single: samples[0] ?? null, count: 1 };
  }
  const coords = samples.map((s) => ({ x: xAt(s.ply), y: yAt(s.win) }));
  const first = coords[0];
  const last = coords.at(-1);
  if (!first || !last) return { line: '', area: '', single: null, count: 0 };
  const line =
    `M${first.x.toFixed(1)},${first.y.toFixed(1)}` +
    coords
      .slice(1)
      .map((c) => `L${c.x.toFixed(1)},${c.y.toFixed(1)}`)
      .join('');
  const area = `${line}L${last.x.toFixed(1)},${MID_Y.toFixed(1)}L${first.x.toFixed(1)},${MID_Y.toFixed(1)}Z`;
  return { line, area, single: null, count: samples.length };
}

/** separate White and Black SVG paths so each engine traces its own evaluation line */
const series = computed<Record<Color, SidePath>>(() => {
  const split = evalSeries(props.gameEval.points);
  return {
    white: buildSidePath(split.white),
    black: buildSidePath(split.black),
  };
});

/** only shade the area to 0 when a single side has evaluations (such as person vs engine) */
const singleSeriesColor = computed<Color | null>(() => {
  const w = series.value.white.count > 0;
  const b = series.value.black.count > 0;
  if (w && !b) return 'white';
  if (b && !w) return 'black';
  return null;
});

/** move-time bars under the axis: White bars rise above midline, Black bars hang below */
const timeBars = computed(() => {
  if (!props.gameEval.hasTime || total.value === 0) return [];
  const maxT = Math.max(props.gameEval.maxTimeSec, 0.05);
  const bw = Math.max(1.5, Math.min(8, INNER_W / total.value - 1));
  const out: { ply: number; x: number; y: number; w: number; h: number; white: boolean }[] = [];
  for (const p of props.gameEval.points) {
    if (p.timeSec === undefined || p.timeSec <= 0) continue;
    const h = Math.max(1.5, (p.timeSec / maxT) * (MID_T - 2));
    const white = p.mover === 'white';
    out.push({
      ply: p.ply,
      x: Math.max(0, Math.min(W - bw, xAt(p.ply) - bw / 2)),
      y: white ? MID_T - h : MID_T,
      w: bw,
      h,
      white,
    });
  }
  return out;
});

interface MarkerDot {
  leftPct: number;
  topPct: number;
  color: Color;
}

function dotFor(p: MoveEval | null): MarkerDot | null {
  if (!hasScore(p)) return null;
  return { leftPct: xPct(p.ply), topPct: yPct(winChance(p)), color: p.mover };
}

const activePoint = computed<MoveEval | null>(() =>
  props.ply > 0 ? (props.gameEval.points[props.ply - 1] ?? null) : null,
);
const activeX = computed(() => xAt(props.ply));
const activeDot = computed(() => dotFor(activePoint.value));

function moveLabel(ply: number): string {
  if (ply <= 0) return 'Start';
  const offset = props.blackFirst ? ply : ply - 1;
  const n = props.firstMove + Math.floor(offset / 2);
  const isBlack = props.blackFirst ? ply % 2 === 1 : ply % 2 === 0;
  const san = props.sans[ply] ?? '';
  return `${n}${isBlack ? '…' : '.'}${san}`;
}

function summarize(p: MoveEval | null): string {
  if (!p) return 'Start position · click or drag to jump';
  const parts = [moveLabel(p.ply)];
  const ev = formatEval(p);
  if (ev) parts.push(ev);
  if (p.depth) parts.push(`d${p.depth}`);
  if (p.book) parts.push('book');
  else if (p.timeSec !== undefined) parts.push(formatMoveTime(p.timeSec));
  else if (p.clockSec !== undefined) parts.push(formatClock(p.clockSec));
  return parts.join(' · ');
}

const hoverPly = ref<number | null>(null);
const dragging = ref(false);

function plyFromPointer(e: PointerEvent): number {
  const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
  if (box.width <= 0 || total.value <= 0) return 0;
  const padPx = (PAD / W) * box.width;
  const innerPx = Math.max(1, box.width - 2 * padPx);
  const frac = Math.min(1, Math.max(0, (e.clientX - box.left - padPx) / innerPx));
  return Math.round(frac * total.value);
}

function onPointerDown(e: PointerEvent): void {
  if (e.button !== 0) return;
  dragging.value = true;
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  const p = plyFromPointer(e);
  hoverPly.value = p;
  emit('select', p);
}

function onPointerMove(e: PointerEvent): void {
  const p = plyFromPointer(e);
  hoverPly.value = p;
  if (dragging.value) emit('select', p);
}

function onPointerUp(e: PointerEvent): void {
  if (!dragging.value) return;
  dragging.value = false;
  if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) {
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  }
}

const hoverPoint = computed<MoveEval | null>(() =>
  hoverPly.value !== null && hoverPly.value > 0
    ? (props.gameEval.points[hoverPly.value - 1] ?? null)
    : null,
);
const hoverDot = computed(() =>
  hoverPly.value !== null && hoverPly.value !== props.ply ? dotFor(hoverPoint.value) : null,
);
const shownPoint = computed<MoveEval | null>(() => {
  const idx = hoverPly.value ?? props.ply;
  return idx > 0 ? (props.gameEval.points[idx - 1] ?? null) : null;
});
const hoverLeftPct = computed(() =>
  hoverPly.value === null || total.value === 0 ? 0 : xPct(hoverPly.value),
);
const totalMoves = computed(() => Math.ceil((total.value + (props.blackFirst ? 1 : 0)) / 2));
const legendNote = computed(() =>
  props.gameEval.hasEval && props.gameEval.hasTime
    ? 'Win % · Time'
    : props.gameEval.hasEval
      ? 'Win %'
      : 'Time',
);
</script>

<template>
  <Panel title="Evaluation" :note="legendNote">
    <template v-if="gameEval.hasEval" #actions>
      <span v-if="series.white.count > 0" class="flex items-center gap-1 text-label text-dim">
        <i class="inline-block h-0.5 w-3 rounded-full bg-eval-white" />White
      </span>
      <span v-if="series.black.count > 0" class="flex items-center gap-1 text-label text-dim">
        <i class="inline-block h-0.5 w-3 rounded-full bg-eval-black" />Black
      </span>
    </template>

    <div class="px-2.5 pt-2 pb-1.5">
      <div
        class="num mb-1 flex items-center gap-1.5 text-small text-dim"
        :title="summarize(shownPoint)"
      >
        <span
          v-if="hasScore(shownPoint)"
          class="inline-block size-2 shrink-0 rounded-full"
          :class="shownPoint.mover === 'white' ? 'bg-eval-white' : 'bg-eval-black'"
        />
        <span class="truncate">{{ summarize(shownPoint) }}</span>
      </div>
      <div
        class="relative cursor-crosshair touch-none select-none"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="
          dragging = false;
          hoverPly = null;
        "
        @pointerleave="hoverPly = null"
      >
        <div v-if="gameEval.hasEval" class="relative">
          <svg :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="none" class="block h-28 w-full">
            <rect
              v-for="(b, i) in bookSpans"
              :key="i"
              :x="b.x"
              y="0"
              :width="b.w"
              :height="H"
              class="fill-dim opacity-10"
            />
            <line
              x1="0"
              :x2="W"
              :y1="yAt(0.5)"
              :y2="yAt(0.5)"
              class="stroke-line"
              stroke-dasharray="3 3"
              vector-effect="non-scaling-stroke"
            />
            <line
              x1="0"
              :x2="W"
              :y1="yAt(-0.5)"
              :y2="yAt(-0.5)"
              class="stroke-line"
              stroke-dasharray="3 3"
              vector-effect="non-scaling-stroke"
            />
            <line
              x1="0"
              :x2="W"
              :y1="MID_Y"
              :y2="MID_Y"
              class="stroke-line-strong"
              vector-effect="non-scaling-stroke"
            />
            <path
              v-if="singleSeriesColor && series[singleSeriesColor].area"
              :d="series[singleSeriesColor].area"
              :class="
                singleSeriesColor === 'white'
                  ? 'fill-eval-white opacity-15'
                  : 'fill-eval-black opacity-15'
              "
            />
            <path
              v-if="series.black.line"
              :d="series.black.line"
              class="fill-none stroke-eval-black"
              stroke-width="1.75"
              stroke-linecap="round"
              stroke-linejoin="round"
              vector-effect="non-scaling-stroke"
            />
            <path
              v-if="series.white.line"
              :d="series.white.line"
              class="fill-none stroke-eval-white"
              stroke-width="1.75"
              stroke-linecap="round"
              stroke-linejoin="round"
              vector-effect="non-scaling-stroke"
            />
            <line
              :x1="activeX"
              :x2="activeX"
              y1="0"
              :y2="H"
              class="stroke-text opacity-65"
              vector-effect="non-scaling-stroke"
            />
          </svg>

          <!-- single-point markers when a side has only one evaluated ply so far -->
          <span
            v-if="series.black.single"
            class="pointer-events-none absolute size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-eval-black"
            :style="{
              left: `${xPct(series.black.single.ply)}%`,
              top: `${yPct(series.black.single.win)}%`,
            }"
          />
          <span
            v-if="series.white.single"
            class="pointer-events-none absolute size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-eval-white"
            :style="{
              left: `${xPct(series.white.single.ply)}%`,
              top: `${yPct(series.white.single.win)}%`,
            }"
          />

          <span
            v-if="hoverDot"
            class="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-panel opacity-85"
            :class="hoverDot.color === 'white' ? 'bg-eval-white' : 'bg-eval-black'"
            :style="{ left: `${hoverDot.leftPct}%`, top: `${hoverDot.topPct}%` }"
          />
          <span
            v-if="activeDot"
            class="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-panel"
            :class="activeDot.color === 'white' ? 'bg-eval-white' : 'bg-eval-black'"
            :style="{ left: `${activeDot.leftPct}%`, top: `${activeDot.topPct}%` }"
          />
        </div>

        <svg
          v-if="gameEval.hasTime"
          :viewBox="`0 0 ${W} ${TH}`"
          preserveAspectRatio="none"
          class="mt-0.5 block h-9 w-full"
        >
          <line
            x1="0"
            :x2="W"
            :y1="MID_T"
            :y2="MID_T"
            class="stroke-line"
            vector-effect="non-scaling-stroke"
          />
          <rect
            v-for="bar in timeBars"
            :key="bar.ply"
            :x="bar.x"
            :y="bar.y"
            :width="bar.w"
            :height="bar.h"
            :class="
              bar.ply === ply
                ? 'fill-accent opacity-95'
                : bar.white
                  ? 'fill-text opacity-45'
                  : 'fill-dim opacity-55'
            "
          />
          <line
            :x1="activeX"
            :x2="activeX"
            y1="0"
            :y2="TH"
            class="stroke-accent opacity-65"
            vector-effect="non-scaling-stroke"
          />
        </svg>

        <div
          v-if="hoverPly !== null && hoverPly !== ply"
          class="pointer-events-none absolute top-0 bottom-0 w-px bg-dim opacity-70"
          :style="{ left: `${hoverLeftPct}%` }"
        />
      </div>

      <div class="num mt-0.5 flex justify-between text-label text-faint">
        <span>Move {{ firstMove }}</span>
        <span v-if="totalMoves > 2">Move {{ firstMove + Math.floor(totalMoves / 2) }}</span>
        <span>
          Move {{ firstMove + Math.max(0, totalMoves - 1)
          }}<template v-if="gameEval.hasTime">
            · max {{ formatMoveTime(gameEval.maxTimeSec) }}</template
          >
        </span>
      </div>
    </div>
  </Panel>
</template>
