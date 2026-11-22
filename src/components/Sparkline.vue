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
const extent = computed(() => {
  const all = props.level === undefined ? props.points : [...props.points, props.level];
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  return hi > lo ? { lo, hi } : { lo: lo - 1, hi: hi + 1 };
});
const y = (v: number) =>
  H - 1 - ((v - extent.value.lo) / (extent.value.hi - extent.value.lo)) * (H - 2);
const line = computed(() =>
  props.points
    .map(
      (v, i) => `${((i / Math.max(1, props.points.length - 1)) * W).toFixed(1)},${y(v).toFixed(1)}`,
    )
    .join(' '),
);
</script>

<template>
  <svg :viewBox="`0 0 ${W} ${H}`" :width="W" :height="H" class="block" aria-hidden="true">
    <line
      v-if="level !== undefined"
      x1="0"
      :x2="W"
      :y1="y(level)"
      :y2="y(level)"
      class="stroke-faint"
      stroke-dasharray="2 2"
    />
    <polyline :points="line" fill="none" class="stroke-accent" stroke-width="1.25" />
  </svg>
</template>
