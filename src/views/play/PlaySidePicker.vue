<script setup lang="ts">
/**
 * Searchable side picker for Play: `You` plus 100+ served engines, filtered as typed.
 * Compact `field-sm` height matches Play's Game panel.
 */
import { computed, nextTick, ref, useId, watch } from 'vue';

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

const listId = useId();
const listbox = ref<HTMLElement | null>(null);
const open = ref(false);
const query = ref('');
const active = ref(0);
const LIMIT = 80;

const display = computed(() => (model.value === 'person' ? 'You' : model.value));

const matched = computed<Item[]>(() => {
  const q = query.value.trim().toLowerCase();
  const out: Item[] = [];
  if (!q || 'you'.includes(q) || 'person'.includes(q) || 'human'.includes(q)) {
    out.push({ value: 'person', label: 'You' });
  }
  for (const id of props.engines) {
    if (!q || id.toLowerCase().includes(q)) out.push({ value: id, label: id });
  }
  return out;
});

const hits = computed<Item[]>(() => {
  const sliced = matched.value.slice(0, LIMIT);
  if (!query.value.trim() && model.value && !sliced.some((h) => h.value === model.value)) {
    const selected = matched.value.find((h) => h.value === model.value);
    if (selected) return [selected, ...sliced.slice(0, LIMIT - 1)];
  }
  return sliced;
});

const truncated = computed(() => matched.value.length > hits.value.length);

function scrollActive(): void {
  void nextTick(() => {
    const el = listbox.value?.children[active.value];
    if (el instanceof HTMLElement) el.scrollIntoView({ block: 'nearest' });
  });
}

watch(active, () => {
  if (open.value) scrollActive();
});

function show(): void {
  if (props.disabled) return;
  open.value = true;
  query.value = '';
  const idx = hits.value.findIndex((h) => h.value === model.value);
  active.value = Math.max(0, idx);
  scrollActive();
}

function pick(item: Item | undefined): void {
  if (item) model.value = item.value;
  open.value = false;
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'ArrowDown') {
    if (!open.value) show();
    else active.value = Math.min(hits.value.length - 1, active.value + 1);
  } else if (e.key === 'ArrowUp') {
    if (!open.value) show();
    else active.value = Math.max(0, active.value - 1);
  } else if (e.key === 'Enter' && open.value) pick(hits.value[active.value]);
  else if (e.key === 'Escape' && open.value) open.value = false;
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
      :aria-controls="open ? listId : undefined"
      :aria-activedescendant="open && hits[active] ? `${listId}-${active}` : undefined"
      @focus="show"
      @click="if (!open) show();"
      @input="
        query = ($event.target as HTMLInputElement).value;
        active = 0;
      "
      @keydown="onKey"
      @blur="open = false"
    />
    <span
      v-if="open"
      :id="listId"
      ref="listbox"
      class="absolute top-8 right-0 left-0 z-30 max-h-56 overflow-auto rounded-md border border-line bg-popover py-0.5 shadow-lg"
      role="listbox"
    >
      <span
        v-for="(item, i) in hits"
        :id="`${listId}-${i}`"
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
      <span v-if="truncated" class="block border-t border-row px-2 py-1 text-small text-faint">
        Showing {{ hits.length }} of {{ matched.length }} — type to filter
      </span>
      <span v-if="hits.length === 0" class="block px-2 py-1 text-dense text-faint">
        No matching engines
      </span>
    </span>
  </span>
</template>
