<script setup lang="ts">
/** A panel of a page, under a title in capitals with an optional note beside it. */
defineProps<{ title?: string; note?: string }>();
</script>

<template>
  <section class="mb-3 rounded-md border border-line bg-panel">
    <h2
      v-if="title"
      class="caps flex items-baseline gap-2 border-b border-line px-3 py-1.5 text-small"
    >
      {{ title }}
      <span v-if="note" class="text-small tracking-normal text-faint normal-case">{{ note }}</span>
    </h2>
    <slot />
  </section>
</template>
