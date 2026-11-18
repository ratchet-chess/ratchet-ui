<script setup lang="ts">
defineProps<{ title?: string; note?: string }>();
</script>

<template>
  <section class="mb-3 rounded-md border border-line bg-panel">
    <h2
      v-if="title"
      class="flex items-baseline gap-2 border-b border-line px-3 py-1.5 text-[11.5px] tracking-widest text-dim uppercase"
    >
      {{ title }}
      <span v-if="note" class="tracking-normal text-faint normal-case">{{ note }}</span>
    </h2>
    <slot />
  </section>
</template>
