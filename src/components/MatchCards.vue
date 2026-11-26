<script setup lang="ts">
/**
 * A match's statistics as cards: the LLR between its bounds, nElo and Elo with their 95% intervals,
 * LOS where the page gives it, and a last card that its page fills with the match's counts, two
 * columns wide on a wide page. A page may put a line under the LLR in the `llr` slot.
 */
import HelpTip from './HelpTip.vue';
import StatCard from './StatCard.vue';
import { signed } from '../ui/format.ts';

defineProps<{
  /** an SPRT's LLR and the two bounds that end it; null for a match with no such test */
  llr: { value: number; lower: number; upper: number } | null;
  nelo: { value: number; ci: number };
  elo: { value: number; ci: number } | null;
  /** the likelihood that the tested engine is the stronger; the card shows only when given */
  los?: number;
}>();

/** a 95% interval's half-width, or a dash while it is unbounded */
const interval = (ci: number) => (Number.isFinite(ci) ? ci.toFixed(1) : '—');
/** a likelihood as a percent, never rounded up to a certainty */
const percent = (p: number) =>
  p > 0.999 ? '>99.9%' : p < 0.001 ? '<0.1%' : `${(100 * p).toFixed(1)}%`;
/** where the LLR's mark is on its track, in percent */
const markAt = (v: number, lo: number, hi: number) =>
  hi > lo ? (100 * (Math.min(hi, Math.max(lo, v)) - lo)) / (hi - lo) : 50;
</script>

<template>
  <div
    class="mb-3 grid grid-cols-2 gap-2"
    :class="los === undefined ? '@4xl:grid-cols-6' : '@4xl:grid-cols-7'"
  >
    <StatCard v-if="llr" label="LLR" class="col-span-2">
      <template #help>
        <HelpTip
          >Log-likelihood ratio: SPRT accepts H1 at the upper bound and H0 at the lower. Bar marks
          current progress.</HelpTip
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
          >Normalized Elo (as reported by Fishtest and OpenBench); SPRT bounds are in nElo. ± shows
          the 95% confidence interval.</HelpTip
        >
      </template>
      {{ signed(nelo.value) }}
      <template #sub>± {{ interval(nelo.ci) }}</template>
    </StatCard>
    <StatCard v-if="elo" label="Elo">
      {{ signed(elo.value) }}
      <template #sub>± {{ interval(elo.ci) }}</template>
    </StatCard>
    <StatCard v-if="los !== undefined" label="LOS">
      <template #help>
        <HelpTip
          >Likelihood of superiority: the chance the tested engine is the stronger, from the same
          counts as nElo. Not a stopping rule.</HelpTip
        >
      </template>
      {{ percent(los) }}
    </StatCard>
    <div v-if="$slots.default" class="grid @4xl:col-span-2"><slot /></div>
  </div>
</template>
