<script setup lang="ts">
/**
 * A bar of shares laid end to end over its track, as games done, faulted and in play. Each share
 * is in percent of the whole.
 */
defineProps<{
  parts: readonly { share: number; tone: 'accent' | 'live' | 'bad' | 'good' | 'warn' }[];
  /** thin under a list's row, thick on a card */
  size?: 'thin' | 'thick';
}>();

const FILL = {
  accent: 'bg-accent',
  live: 'bg-live',
  bad: 'bg-bad',
  good: 'bg-good',
  warn: 'bg-warn',
} as const;
</script>

<template>
  <div
    class="flex overflow-hidden rounded bg-track"
    :class="size === 'thick' ? 'h-1.5' : 'h-1'"
    role="presentation"
  >
    <div
      v-for="(p, k) in parts"
      :key="k"
      class="h-full shrink-0"
      :class="FILL[p.tone]"
      :style="{ width: `${Math.max(0, Math.min(100, p.share))}%` }"
    />
  </div>
</template>
