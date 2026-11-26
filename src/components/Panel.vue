<script setup lang="ts">
/** A panel of a page, under a title in capitals with an optional note and right-side actions. */
defineProps<{ title?: string; note?: string }>();
</script>

<template>
  <section class="mb-3 rounded-md border border-line bg-panel">
    <h2
      v-if="title"
      class="caps flex items-center gap-2 border-b border-line px-3 py-1.5 text-small"
    >
      <span class="truncate">{{ title }}</span>
      <span v-if="note" class="shrink-0 text-small tracking-normal text-faint normal-case">{{
        note
      }}</span>
      <span
        v-if="$slots['actions']"
        class="ml-auto flex shrink-0 items-center gap-1.5 tracking-normal normal-case"
      >
        <slot name="actions" />
      </span>
    </h2>
    <slot />
  </section>
</template>
