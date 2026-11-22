<script setup lang="ts">
/**
 * A match's statistics as cards: the LLR between its bounds, nElo and Elo with their 95% intervals,
 * and a last card that its page fills with the match's counts. A page may put a line under the LLR
 * in the `llr` slot.
 */
import HelpTip from './HelpTip.vue';
import StatCard from './StatCard.vue';
import { signed } from '../ui/format.ts';

defineProps<{
  /** an SPRT's LLR and the two bounds that end it; null for a match with no such test */
  llr: { value: number; lower: number; upper: number } | null;
  nelo: { value: number; ci: number };
  elo: { value: number; ci: number } | null;
}>();

/** a 95% interval's half-width, or a dash while it is unbounded */
const interval = (ci: number) => (Number.isFinite(ci) ? ci.toFixed(1) : '—');
/** where the LLR's mark is on its track, in percent */
const markAt = (v: number, lo: number, hi: number) =>
  hi > lo ? (100 * (Math.min(hi, Math.max(lo, v)) - lo)) / (hi - lo) : 50;
</script>

<template>
  <div class="mb-3 grid grid-cols-2 gap-2 @4xl:grid-cols-5">
    <StatCard v-if="llr" label="LLR" class="col-span-2">
      <template #help>
        <HelpTip
          >The evidence so far: the SPRT accepts H1 at the upper bound and H0 at the lower. The
          marker is where it sits between them.</HelpTip
        >
      </template>
      {{ llr.value.toFixed(2) }}
      <span class="text-dense text-dim"
        >of [{{ llr.lower.toFixed(2) }}, {{ llr.upper.toFixed(2) }}]</span
      >
      <template v-if="$slots.llr" #sub><slot name="llr" /></template>
      <template #below>
        <div class="relative mt-1.5 h-2 rounded bg-track">
          <div
            class="absolute top-[-2px] h-3 w-1 -translate-x-1/2 rounded bg-accent"
            :style="{ left: `${markAt(llr.value, llr.lower, llr.upper)}%` }"
          />
          <div class="absolute top-0 left-1/2 h-2 w-px bg-faint" />
        </div>
      </template>
    </StatCard>
    <StatCard label="nElo">
      <template #help>
        <HelpTip
          >Normalized Elo: the difference scaled by how much results vary, as fishtest and OpenBench
          report it; the SPRT's bounds are in nElo. ± is the 95% interval.</HelpTip
        >
      </template>
      {{ signed(nelo.value) }}
      <template #sub>± {{ interval(nelo.ci) }}</template>
    </StatCard>
    <StatCard v-if="elo" label="Elo">
      {{ signed(elo.value) }}
      <template #sub>± {{ interval(elo.ci) }}</template>
    </StatCard>
    <slot />
  </div>
</template>
