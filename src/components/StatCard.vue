<script setup lang="ts">
/** One figure in a box: its label (and a help note), the value, and a line under it. */
defineProps<{ label: string }>();
</script>

<template>
  <div class="rounded-md border border-line bg-panel2 px-2.5 py-2">
    <div class="flex items-center gap-1.5 text-small font-medium text-dim">
      {{ label }}
      <slot name="help" />
    </div>
    <div class="num text-stat font-semibold tracking-tight"><slot /></div>
    <div v-if="$slots.sub" class="num text-dense text-dim"><slot name="sub" /></div>
    <slot name="below" />
  </div>
</template>
