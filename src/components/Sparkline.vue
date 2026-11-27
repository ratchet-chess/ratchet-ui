<script setup lang="ts">
/** A series as a small line, scaled to its own extent, with an optional level drawn faint across it. */
import { computed } from 'vue';

const props = defineProps<{
  points: number[];
  /** a level to draw across, such as where the series started */
  level?: number;
}>();

const W = 80;
const H = 18;
const finitePoints = computed(() =>
  props.points.flatMap((v, i) => (Number.isFinite(v) ? [{ i, v }] : [])),
);
const finiteLevel = computed(() =>
  props.level !== undefined && Number.isFinite(props.level) ? props.level : undefined,
);
const extent = computed(() => {
  let lo = Infinity;
  let hi = -Infinity;
  for (const { v } of finitePoints.value) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (finiteLevel.value !== undefined) {
    if (finiteLevel.value < lo) lo = finiteLevel.value;
    if (finiteLevel.value > hi) hi = finiteLevel.value;
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { lo: -1, hi: 1 };
  return hi > lo ? { lo, hi } : { lo: lo - 1, hi: hi + 1 };
});
const x = (i: number) => (props.points.length <= 1 ? W / 2 : (i / (props.points.length - 1)) * W);
const y = (v: number) =>
  H - 1 - ((v - extent.value.lo) / (extent.value.hi - extent.value.lo)) * (H - 2);
const line = computed(() =>
  finitePoints.value.length >= 2
    ? finitePoints.value.map(({ i, v }) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
    : '',
);
const single = computed(() =>
  finitePoints.value.length === 1 ? (finitePoints.value[0] ?? null) : null,
);
</script>

<template>
  <svg :viewBox="`0 0 ${W} ${H}`" :width="W" :height="H" class="block" aria-hidden="true">
    <line
      v-if="finiteLevel !== undefined"
      x1="0"
      :x2="W"
      :y1="y(finiteLevel)"
      :y2="y(finiteLevel)"
      class="stroke-faint"
      stroke-dasharray="2 2"
    />
    <polyline v-if="line" :points="line" fill="none" class="stroke-accent" stroke-width="1.25" />
    <circle v-else-if="single" :cx="x(single.i)" :cy="y(single.v)" r="1.75" class="fill-accent" />
  </svg>
</template>
