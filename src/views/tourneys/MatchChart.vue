<script setup lang="ts">
/**
 * One of a match's statistics over its finished pairs: a line, with a shaded interval or dashed
 * reference lines, and a crosshair that reads every value at the pair under the pointer.
 */
import { computed, ref } from 'vue';

export interface ChartPoint {
  pairs: number;
  value: number;
  /** the half-width of a 95% interval around `value`; omitted for none */
  ci?: number;
  /** what the tooltip reads at this point, after the value */
  note?: string;
}

const props = defineProps<{
  title: string;
  points: ChartPoint[];
  /** an SPRT's bounds, drawn dashed across the chart: the upper accepts H1, the lower H0 */
  bounds?: { lower: number; upper: number };
  /** a dashed line down the chart at this many pairs, such as where an SPRT decided */
  at?: number | null;
  /** how a value is written, in the axis and the tooltip */
  digits?: number;
  /** what the x axis counts: pairs, or games when each opening is one game */
  unit: 'pairs' | 'games';
}>();

const W = 1000;
const H = 160;
const finite = (v: number | undefined): v is number => v !== undefined && Number.isFinite(v);

/**
 * The y range: the values and their intervals, past the first tenth of the pairs, where a few
 * games give intervals hundreds wide; and the bounds, which must stay in view.
 */
const range = computed(() => {
  const last = props.points.at(-1)?.pairs ?? 1;
  const settled = props.points.filter((p) => p.pairs >= last / 10);
  const ys: number[] = props.bounds ? [props.bounds.lower, props.bounds.upper] : [];
  for (const p of settled.length > 0 ? settled : props.points) {
    if (!finite(p.value)) continue;
    ys.push(p.value);
    if (finite(p.ci)) ys.push(p.value - p.ci, p.value + p.ci);
  }
  if (ys.length === 0) return { lo: -1, hi: 1 };
  let lo = Math.min(...ys, 0);
  let hi = Math.max(...ys, 0);
  if (hi - lo < 1e-9) [lo, hi] = [lo - 1, hi + 1];
  const pad = (hi - lo) * 0.06;
  return { lo: lo - pad, hi: hi + pad };
});

const maxPairs = computed(() => Math.max(1, props.points.at(-1)?.pairs ?? 1));
const x = (pairs: number) => (W * pairs) / maxPairs.value;
const y = (v: number) => {
  const { lo, hi } = range.value;
  return H - (H * (Math.min(hi, Math.max(lo, v)) - lo)) / (hi - lo);
};

/** the line, broken where a value is not finite */
const line = computed(() => {
  let d = '';
  let open = false;
  for (const p of props.points) {
    if (!finite(p.value)) {
      open = false;
      continue;
    }
    d += `${open ? 'L' : 'M'}${x(p.pairs).toFixed(1)},${y(p.value).toFixed(1)}`;
    open = true;
  }
  return d;
});

/** the interval as one shape, over the points that have a finite one */
const band = computed(() => {
  const with_ = props.points.filter((p) => finite(p.value) && finite(p.ci));
  if (with_.length < 2) return '';
  const upper = with_.map((p) => `${x(p.pairs).toFixed(1)},${y(p.value + (p.ci ?? 0)).toFixed(1)}`);
  const lower = with_
    .toReversed()
    .map((p) => `${x(p.pairs).toFixed(1)},${y(p.value - (p.ci ?? 0)).toFixed(1)}`);
  return `M${upper.join('L')}L${lower.join('L')}Z`;
});

/** labels on the y axis: the ends of the range, and zero in place of an end too near it */
const ticks = computed(() => {
  const { lo, hi } = range.value;
  if (lo >= 0 || hi <= 0) return [hi, lo];
  const near = (hi - lo) * 0.12;
  return [...(hi > near ? [hi] : []), 0, ...(-lo > near ? [lo] : [])];
});
const pct = (v: number) => `${(100 * y(v)) / H}%`;
const write = (v: number) =>
  Number.isFinite(v) ? `${v > 0 ? '+' : ''}${v.toFixed(props.digits ?? 1)}` : v > 0 ? '+∞' : '−∞';

/** no point has a finite value, as when every pair went one way */
const unbounded = computed(() => !props.points.some((p) => finite(p.value)));

const hover = ref<ChartPoint | null>(null);
function move(e: PointerEvent): void {
  const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const at = ((e.clientX - box.left) / box.width) * maxPairs.value;
  let best: ChartPoint | null = null;
  for (const p of props.points)
    if (!best || Math.abs(p.pairs - at) < Math.abs(best.pairs - at)) best = p;
  hover.value = best;
}
const hoverLeft = computed(() => (hover.value ? (100 * x(hover.value.pairs)) / W : 0));
</script>

<template>
  <figure class="min-w-0">
    <figcaption class="mb-1 flex items-baseline gap-3 text-label text-dim">
      <span class="tracking-wider uppercase">{{ title }}</span>
      <template v-if="bounds">
        <span class="flex items-center gap-1"
          ><i class="inline-block h-0 w-3 border-t border-dashed border-good" />H1</span
        >
        <span class="flex items-center gap-1"
          ><i class="inline-block h-0 w-3 border-t border-dashed border-bad" />H0</span
        >
      </template>
    </figcaption>
    <div class="flex gap-1.5">
      <div class="num relative w-10 shrink-0 text-right text-label text-faint">
        <span
          v-for="t in ticks"
          :key="t"
          class="absolute right-0 -translate-y-1/2"
          :style="{ top: pct(t) }"
          >{{ write(t) }}</span
        >
      </div>
      <div
        class="relative h-40 min-w-0 flex-1 cursor-crosshair"
        @pointermove="move"
        @pointerleave="hover = null"
      >
        <svg :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="none" class="h-full w-full">
          <line
            :x1="0"
            :x2="W"
            :y1="y(range.lo)"
            :y2="y(range.lo)"
            class="stroke-line"
            vector-effect="non-scaling-stroke"
          />
          <line
            v-if="range.lo < 0 && range.hi > 0"
            :x1="0"
            :x2="W"
            :y1="y(0)"
            :y2="y(0)"
            class="stroke-line"
            vector-effect="non-scaling-stroke"
          />
          <template v-if="bounds">
            <line
              v-for="b in [
                { at: bounds.upper, tone: 'stroke-good' },
                { at: bounds.lower, tone: 'stroke-bad' },
              ]"
              :key="b.tone"
              :x1="0"
              :x2="W"
              :y1="y(b.at)"
              :y2="y(b.at)"
              :class="b.tone"
              stroke-dasharray="4 4"
              vector-effect="non-scaling-stroke"
            />
          </template>
          <line
            v-if="at !== undefined && at !== null"
            :x1="x(at)"
            :x2="x(at)"
            :y1="0"
            :y2="H"
            class="stroke-faint"
            stroke-dasharray="4 4"
            vector-effect="non-scaling-stroke"
          />
          <path v-if="band" :d="band" class="fill-accent opacity-15" />
          <path
            :d="line"
            class="fill-none stroke-accent"
            stroke-width="2"
            stroke-linejoin="round"
            vector-effect="non-scaling-stroke"
          />
        </svg>
        <div
          v-if="unbounded"
          class="pointer-events-none absolute inset-0 flex items-center justify-center text-dense text-dim"
        >
          not finite yet: every pair so far went one way
        </div>
        <template v-if="hover">
          <div
            class="pointer-events-none absolute top-0 bottom-0 w-px bg-dim"
            :style="{ left: `${hoverLeft}%` }"
          />
          <div
            class="num pointer-events-none absolute top-1 z-10 rounded border border-line bg-panel px-2 py-1 text-small whitespace-nowrap shadow"
            :style="
              hoverLeft > 60 ? { right: `${100 - hoverLeft + 1}%` } : { left: `${hoverLeft + 1}%` }
            "
          >
            <div class="text-text">
              {{ write(hover.value) }}
              <span v-if="hover.ci !== undefined" class="text-dim">
                ± {{ Number.isFinite(hover.ci) ? hover.ci.toFixed(digits ?? 1) : '∞' }}</span
              >
            </div>
            <div class="text-dim">
              after {{ hover.pairs.toLocaleString('en-US') }} {{ unit
              }}<template v-if="hover.note"> · {{ hover.note }}</template>
            </div>
          </div>
        </template>
      </div>
    </div>
    <div class="num mt-0.5 flex justify-between pl-11.5 text-label text-faint">
      <span>0</span><span>{{ maxPairs.toLocaleString('en-US') }} {{ unit }}</span>
    </div>
  </figure>
</template>
