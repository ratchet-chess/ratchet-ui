<script setup lang="ts">
/**
 * Searchable side picker for Play: `You` plus 100+ served engines, filtered as typed.
 * Compact `field-sm` height matches Play's Game panel.
 */
import { computed, ref } from 'vue';

interface Item {
  value: string;
  label: string;
}

const props = defineProps<{
  engines: string[];
  disabled?: boolean;
  label: string;
}>();
const model = defineModel<string>({ required: true });

const open = ref(false);
const query = ref('');
const active = ref(0);
const LIMIT = 80;

const display = computed(() => (model.value === 'person' ? 'You' : model.value));

const hits = computed<Item[]>(() => {
  const q = query.value.trim().toLowerCase();
  const out: Item[] = [];
  if (!q || 'you'.includes(q) || 'person'.includes(q) || 'human'.includes(q)) {
    out.push({ value: 'person', label: 'You' });
  }
  for (const id of props.engines) {
    if (out.length >= LIMIT) break;
    if (!q || id.toLowerCase().includes(q)) out.push({ value: id, label: id });
  }
  return out;
});

function show(): void {
  if (props.disabled) return;
  open.value = true;
  query.value = '';
  const idx = hits.value.findIndex((h) => h.value === model.value);
  active.value = Math.max(0, idx);
}

function pick(item: Item | undefined): void {
  if (item) model.value = item.value;
  open.value = false;
}

function onKey(e: KeyboardEvent): void {
  if (!open.value) return;
  if (e.key === 'ArrowDown') active.value = Math.min(hits.value.length - 1, active.value + 1);
  else if (e.key === 'ArrowUp') active.value = Math.max(0, active.value - 1);
  else if (e.key === 'Enter') pick(hits.value[active.value]);
  else if (e.key === 'Escape') open.value = false;
  else return;
  e.preventDefault();
}
</script>

<template>
  <span class="relative block min-w-0 flex-1">
    <input
      :value="open ? query : display"
      type="search"
      :disabled="disabled"
      :aria-label="label"
      :placeholder="open ? `Search ${engines.length} engines…` : ''"
      class="field-sm num w-full disabled:cursor-not-allowed disabled:opacity-65"
      role="combobox"
      :aria-expanded="open"
      @focus="show"
      @input="
        query = ($event.target as HTMLInputElement).value;
        active = 0;
      "
      @keydown="onKey"
      @blur="open = false"
    />
    <span
      v-if="open"
      class="absolute top-8 right-0 left-0 z-30 max-h-56 overflow-auto rounded-md border border-line bg-popover py-0.5 shadow-lg"
      role="listbox"
    >
      <span
        v-for="(item, i) in hits"
        :key="item.value"
        class="num block cursor-pointer truncate px-2 py-1 text-dense"
        :class="
          i === active ? 'bg-chosen text-text' : item.value === model ? 'text-accent' : 'text-text'
        "
        role="option"
        :aria-selected="item.value === model"
        @mousedown.prevent="pick(item)"
        @mouseenter="active = i"
      >
        {{ item.label }}
      </span>
      <span v-if="hits.length === 0" class="block px-2 py-1 text-dense text-faint">
        No matching engines
      </span>
    </span>
  </span>
</template>
