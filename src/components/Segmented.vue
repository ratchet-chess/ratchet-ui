<script setup lang="ts" generic="V extends string | number">
/** One choice of a few, side by side; the chosen one underlined. */
defineProps<{ options: readonly { value: V; label: string; title?: string }[] }>();
const model = defineModel<V>({ required: true });
</script>

<template>
  <div
    class="inline-flex w-fit flex-wrap overflow-hidden rounded-md border border-line bg-panel2"
    role="radiogroup"
  >
    <button
      v-for="o in options"
      :key="o.value"
      type="button"
      role="radio"
      :aria-checked="model === o.value"
      :title="o.title"
      class="border-r border-line px-2.5 py-[5px] text-dense last:border-r-0"
      :class="
        model === o.value
          ? 'bg-chosen text-text shadow-[inset_0_-2px_0_var(--color-accent)]'
          : 'text-dim hover:text-text'
      "
      @click="model = o.value"
    >
      {{ o.label }}
    </button>
  </div>
</template>
