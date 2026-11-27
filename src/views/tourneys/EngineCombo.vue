<script setup lang="ts">
/** One engine picked from many: a box that filters the served engines as it is typed in. */
import { computed, nextTick, ref, useId, watch } from 'vue';

const props = defineProps<{ engines: string[] }>();
const value = defineModel<string>({ required: true });

const listId = useId();
const listbox = ref<HTMLElement | null>(null);
const open = ref(false);
const query = ref('');
/** a long list shows its first matches; typing narrows it */
const LIMIT = 80;
const matched = computed(() => {
  const q = query.value.trim().toLowerCase();
  return props.engines.filter((e) => e.toLowerCase().includes(q));
});
const hits = computed(() => {
  const sliced = matched.value.slice(0, LIMIT);
  if (
    !query.value.trim() &&
    value.value &&
    matched.value.includes(value.value) &&
    !sliced.includes(value.value)
  )
    return [value.value, ...sliced.slice(0, LIMIT - 1)];
  return sliced;
});
const truncated = computed(() => matched.value.length > hits.value.length);
const active = ref(0);

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
  open.value = true;
  query.value = '';
  active.value = Math.max(0, hits.value.indexOf(value.value));
  scrollActive();
}
function pick(e: string | undefined): void {
  if (e) value.value = e;
  open.value = false;
}
function key(e: KeyboardEvent): void {
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
  <span class="relative inline-block w-60 max-w-full">
    <input
      :value="open ? query : value"
      type="search"
      :placeholder="open ? `Search ${engines.length} engines` : ''"
      class="field num w-full"
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
      @keydown="key"
      @blur="open = false"
    />
    <span
      v-if="open"
      :id="listId"
      ref="listbox"
      class="absolute top-[34px] right-0 left-0 z-20 max-h-56 overflow-auto rounded-md border border-line bg-popover py-0.5 shadow-lg"
      role="listbox"
    >
      <span
        v-for="(e, i) in hits"
        :id="`${listId}-${i}`"
        :key="e"
        class="num block cursor-pointer px-2 py-0.5 text-dense"
        :class="i === active ? 'bg-chosen text-text' : e === value ? 'text-accent' : ''"
        role="option"
        :aria-selected="e === value"
        @mousedown.prevent="pick(e)"
        @mouseenter="active = i"
        >{{ e }}</span
      >
      <span v-if="truncated" class="block border-t border-row px-2 py-1 text-small text-faint">
        Showing {{ hits.length }} of {{ matched.length }} — type to filter
      </span>
      <span v-if="hits.length === 0" class="block px-2 py-1 text-dense text-faint"
        >No matching engines.</span
      >
    </span>
  </span>
</template>
