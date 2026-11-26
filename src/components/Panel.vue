<script setup lang="ts">
/** A panel of a page, under a quiet tinted header with an optional note and right-side actions. */
defineProps<{ title?: string; note?: string }>();
</script>

<template>
  <section class="mb-3 rounded-md border border-line bg-panel">
    <h2
      v-if="title"
      class="subhead flex items-center gap-2 rounded-t-md border-b border-line bg-panel2 px-3 py-1.5"
    >
      <span class="truncate">{{ title }}</span>
      <span v-if="note" class="shrink-0 font-normal text-faint">{{ note }}</span>
      <span v-if="$slots['actions']" class="ml-auto flex shrink-0 items-center gap-1.5 font-normal">
        <slot name="actions" />
      </span>
    </h2>
    <slot />
  </section>
</template>
