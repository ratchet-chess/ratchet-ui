<script setup lang="ts">
import { count } from '../ui/format.ts';

/** A match's pair counts, each under its bucket's name: LL LD DD WD WW from the tested side. */
defineProps<{ counts: readonly number[] }>();

const BUCKETS = ['LL', 'LD', 'DD', 'WD', 'WW'] as const;
</script>

<template>
  <span class="num inline-grid grid-cols-5 gap-x-2 text-right">
    <span v-for="b in BUCKETS" :key="b" class="text-label text-faint">{{ b }}</span>
    <span v-for="(n, k) in counts" :key="k">{{ count(n) }}</span>
  </span>
</template>
