<script setup lang="ts" generic="V extends string | number">
/** One choice of a few, side by side; the chosen one underlined. `sm` fits a table's row. */
defineProps<{
  options: readonly { value: V; label: string; title?: string }[];
  size?: 'sm';
  disabled?: boolean;
}>();
const model = defineModel<V>({ required: true });
</script>

<template>
  <div
    class="inline-flex w-fit overflow-hidden rounded-md border border-line bg-panel2"
    :class="size === 'sm' ? 'flex-nowrap' : 'flex-wrap'"
    role="radiogroup"
  >
    <button
      v-for="o in options"
      :key="o.value"
      type="button"
      role="radio"
      :aria-checked="model === o.value"
      :disabled="disabled"
      :title="o.title"
      class="border-r border-line text-dense last:border-r-0 disabled:cursor-not-allowed disabled:opacity-50"
      :class="[
        size === 'sm' ? 'px-2 py-px whitespace-nowrap' : 'px-2.5 py-[5px]',
        model === o.value
          ? 'bg-chosen text-text shadow-[inset_0_-2px_0_var(--color-accent)]'
          : 'text-dim hover:text-text',
      ]"
      @click="model = o.value"
    >
      {{ o.label }}
    </button>
  </div>
</template>
