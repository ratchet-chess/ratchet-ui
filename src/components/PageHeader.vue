<script setup lang="ts">
/** A page's title line: its name, a few words on what it holds, and its actions at the right. */
defineProps<{ title: string; sub?: string }>();
</script>

<template>
  <div class="mb-2.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
    <h1 class="text-title font-semibold">{{ title }}</h1>
    <span v-if="sub" class="text-dense text-dim">{{ sub }}</span>
    <span class="flex-1" />
    <slot />
  </div>
</template>
