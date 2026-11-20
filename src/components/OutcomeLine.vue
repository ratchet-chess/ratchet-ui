<script setup lang="ts">
/**
 * A match's outcome in one line under its row: the LLR between its bounds, where the match stands
 * in words, and its pair counts as bars.
 */
import { count } from '../ui/format.ts';

defineProps<{
  /** an SPRT's LLR and the two bounds that end it; null for a match with no such test */
  llr: { value: number; lower: number; upper: number } | null;
  text: string;
  /** pair counts, from two losses to two wins; null when the games are not counted in pairs */
  ptnml: readonly number[] | null;
  /** what stands in the bars' place without pair counts */
  tail?: string;
}>();

const PTNML = ['LL', 'LD', 'DD', 'WD', 'WW'];
/** where the LLR's mark is on its track, in percent */
const markAt = (v: number, lo: number, hi: number) =>
  hi > lo ? (100 * (Math.min(hi, Math.max(lo, v)) - lo)) / (hi - lo) : 50;
/** the bars' heights in pixels, of 14 */
const bars = (p: readonly number[]) => {
  const top = Math.max(1, ...p);
  return p.map((x) => Math.max(x > 0 ? 2 : 1, Math.round((14 * x) / top)));
};
</script>

<template>
  <div class="num mt-1.5 flex items-center gap-2.5 text-small text-dim">
    <template v-if="llr">
      <span
        class="relative h-2.5 w-24 shrink-0"
        :title="`LLR between its bounds ${llr.lower.toFixed(2)} and ${llr.upper.toFixed(2)}`"
      >
        <span class="absolute inset-x-0 top-1 h-0.5 bg-line-strong" />
        <span class="absolute top-px left-1/2 h-2 w-px bg-faint" />
        <span
          class="absolute top-0 h-2.5 w-1 -translate-x-1/2 rounded-sm bg-accent"
          :style="{ left: `${markAt(llr.value, llr.lower, llr.upper)}%` }"
        />
      </span>
      <span class="shrink-0 text-text">LLR {{ llr.value.toFixed(2) }}</span>
    </template>
    <span class="min-w-0 truncate" :title="text">{{ text }}</span>
    <span class="flex-1" />
    <span
      v-if="ptnml"
      class="inline-flex h-3.5 shrink-0 items-end gap-px"
      :title="PTNML.map((k, n) => `${k} ${count(ptnml?.[n] ?? 0)}`).join(' · ')"
    >
      <span
        v-for="(h, n) in bars(ptnml)"
        :key="n"
        class="w-1.5 rounded-[1px] bg-dim"
        :style="{ height: `${h}px` }"
      />
    </span>
    <span v-else-if="tail" class="shrink-0">{{ tail }}</span>
  </div>
</template>
