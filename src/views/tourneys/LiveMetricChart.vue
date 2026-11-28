<script setup lang="ts">
/**
 * Per-ply search depth or node-count line chart for a focused live game, with separate White and
 * Black series, hover crosshair, and click/drag ply scrubbing matching EvalGraph.
 */
import type { Color } from 'chessops/types';
import { computed, ref } from 'vue';
import type { PlyMetric } from '../../match/runner.ts';
import { thousands } from '../../ui/format.ts';

const props = withDefaults(
  defineProps<{
    kind: 'depth' | 'nodes';
    metrics: readonly PlyMetric[];
    /** total plies played in the game */
    totalPlies: number;
    /** currently inspected ply */
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
const PAD = 6;
const INNER_W = W - 2 * PAD;
const H = 112;
const TOP_PAD = 8;
const BOT_PAD = 8;
const INNER_H = H - TOP_PAD - BOT_PAD;

interface Sample {
  ply: number;
  mover: Color;
  value: number;
}

const samples = computed<Sample[]>(() => {
  const out: Sample[] = [];
  for (const m of props.metrics) {
    const v = props.kind === 'depth' ? m.depth : m.nodes;
    if (v !== undefined && v > 0) out.push({ ply: m.ply, mover: m.mover, value: v });
  }
  return out;
});

const byPly = computed(() => {
  const map = new Map<number, Sample>();
  for (const s of samples.value) map.set(s.ply, s);
  return map;
});

const maxVal = computed(() => {
  let hi = 0;
  for (const s of samples.value) if (s.value > hi) hi = s.value;
  return Math.max(hi, props.kind === 'depth' ? 10 : 1000);
});

const total = computed(() => Math.max(props.totalPlies, samples.value.at(-1)?.ply ?? 0));
const clampPly = (p: number) => Math.min(total.value, Math.max(0, p));
const xAt = (p: number) => (total.value <= 0 ? PAD : PAD + (INNER_W * clampPly(p)) / total.value);
const yAt = (v: number) => TOP_PAD + INNER_H * (1 - Math.min(1, v / maxVal.value));
const xPct = (p: number) => (100 * xAt(p)) / W;
const yPct = (v: number) => (100 * yAt(v)) / H;

function pathFor(color: Color): { line: string; single: Sample | null; count: number } {
  const list = samples.value.filter((s) => s.mover === color);
  if (list.length === 0) return { line: '', single: null, count: 0 };
  if (list.length === 1) return { line: '', single: list[0] ?? null, count: 1 };
  const first = list[0];
  if (!first) return { line: '', single: null, count: 0 };
  const line =
    `M${xAt(first.ply).toFixed(1)},${yAt(first.value).toFixed(1)}` +
    list
      .slice(1)
      .map((s) => `L${xAt(s.ply).toFixed(1)},${yAt(s.value).toFixed(1)}`)
      .join('');
  return { line, single: null, count: list.length };
}

const series = computed(() => ({
  white: pathFor('white'),
  black: pathFor('black'),
}));

function moveLabel(ply: number): string {
  if (ply <= 0) return 'Start';
  const offset = props.blackFirst ? ply : ply - 1;
  const n = props.firstMove + Math.floor(offset / 2);
  const isBlack = props.blackFirst ? ply % 2 === 1 : ply % 2 === 0;
  const san = props.sans[ply] ?? '';
  return `${n}${isBlack ? '…' : '.'}${san}`;
}

function formatVal(v: number): string {
  return props.kind === 'depth' ? `depth ${v}` : `${thousands(v)} nodes`;
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

const shownSample = computed(() => {
  const p = hoverPly.value ?? props.ply;
  return byPly.value.get(p) ?? null;
});
const activeSample = computed(() => byPly.value.get(props.ply) ?? null);
const hoverSample = computed(() =>
  hoverPly.value !== null && hoverPly.value !== props.ply
    ? (byPly.value.get(hoverPly.value) ?? null)
    : null,
);
const totalMoves = computed(() => Math.ceil((total.value + (props.blackFirst ? 1 : 0)) / 2));
</script>

<template>
  <div class="px-2.5 pt-2 pb-1.5">
    <div v-if="samples.length === 0" class="py-4 text-center text-dense text-faint">
      Waiting for {{ kind === 'depth' ? 'depth' : 'node' }} data
    </div>
    <template v-else>
      <div class="num mb-1 flex items-center justify-between gap-2 text-small text-dim">
        <span class="flex min-w-0 items-center gap-1.5">
          <span
            v-if="shownSample"
            class="inline-block size-2 shrink-0 rounded-full"
            :class="shownSample.mover === 'white' ? 'bg-eval-white' : 'bg-eval-black'"
          />
          <span class="truncate">
            <template v-if="shownSample">
              {{ moveLabel(shownSample.ply) }} · {{ formatVal(shownSample.value) }}
            </template>
            <template v-else>Click or drag to inspect ply</template>
          </span>
        </span>
        <span class="shrink-0 text-label text-faint">
          max {{ kind === 'depth' ? `d${maxVal}` : thousands(maxVal) }}
        </span>
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
        <svg :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="none" class="block h-28 w-full">
          <line
            x1="0"
            :x2="W"
            :y1="yAt(maxVal * 0.5)"
            :y2="yAt(maxVal * 0.5)"
            class="stroke-line"
            stroke-dasharray="3 3"
            vector-effect="non-scaling-stroke"
          />
          <line
            x1="0"
            :x2="W"
            :y1="yAt(0)"
            :y2="yAt(0)"
            class="stroke-line-strong"
            vector-effect="non-scaling-stroke"
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
            :x1="xAt(ply)"
            :x2="xAt(ply)"
            y1="0"
            :y2="H"
            class="stroke-text opacity-65"
            vector-effect="non-scaling-stroke"
          />
        </svg>

        <span
          v-if="series.black.single"
          class="pointer-events-none absolute size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-eval-black"
          :style="{
            left: `${xPct(series.black.single.ply)}%`,
            top: `${yPct(series.black.single.value)}%`,
          }"
        />
        <span
          v-if="series.white.single"
          class="pointer-events-none absolute size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-eval-white"
          :style="{
            left: `${xPct(series.white.single.ply)}%`,
            top: `${yPct(series.white.single.value)}%`,
          }"
        />
        <span
          v-if="hoverSample"
          class="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-panel opacity-85"
          :class="hoverSample.mover === 'white' ? 'bg-eval-white' : 'bg-eval-black'"
          :style="{ left: `${xPct(hoverSample.ply)}%`, top: `${yPct(hoverSample.value)}%` }"
        />
        <span
          v-if="activeSample"
          class="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-panel"
          :class="activeSample.mover === 'white' ? 'bg-eval-white' : 'bg-eval-black'"
          :style="{ left: `${xPct(activeSample.ply)}%`, top: `${yPct(activeSample.value)}%` }"
        />
        <div
          v-if="hoverPly !== null && hoverPly !== ply"
          class="pointer-events-none absolute top-0 bottom-0 w-px bg-dim opacity-70"
          :style="{ left: `${xPct(hoverPly)}%` }"
        />
      </div>

      <div class="num mt-0.5 flex justify-between text-label text-faint">
        <span>Move {{ firstMove }}</span>
        <span>Move {{ firstMove + Math.max(0, totalMoves - 1) }}</span>
      </div>
    </template>
  </div>
</template>
