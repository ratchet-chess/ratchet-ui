<script setup lang="ts">
/** One engine picked from many: a box that filters the served engines as it is typed in. */
import { computed, ref } from 'vue';

const props = defineProps<{ engines: string[] }>();
const value = defineModel<string>({ required: true });

const open = ref(false);
const query = ref('');
/** a long list shows its first matches; typing narrows it */
const LIMIT = 80;
const hits = computed(() => {
  const q = query.value.trim().toLowerCase();
  return props.engines.filter((e) => e.toLowerCase().includes(q)).slice(0, LIMIT);
});
const active = ref(0);

function show(): void {
  open.value = true;
  query.value = '';
  active.value = Math.max(0, hits.value.indexOf(value.value));
}
function pick(e: string | undefined): void {
  if (e) value.value = e;
  open.value = false;
}
function key(e: KeyboardEvent): void {
  if (e.key === 'ArrowDown') active.value = Math.min(hits.value.length - 1, active.value + 1);
  else if (e.key === 'ArrowUp') active.value = Math.max(0, active.value - 1);
  else if (e.key === 'Enter') pick(hits.value[active.value]);
  else if (e.key === 'Escape') open.value = false;
  else return;
  e.preventDefault();
}
</script>

<template>
  <span class="relative inline-block w-60 max-w-full">
    <input
      :value="open ? query : value"
      type="search"
      :placeholder="open ? `search ${engines.length} engines` : ''"
      class="field num w-full"
      role="combobox"
      :aria-expanded="open"
      @focus="show"
      @input="
        query = ($event.target as HTMLInputElement).value;
        active = 0;
      "
      @keydown="key"
      @blur="open = false"
    />
    <span
      v-if="open"
      class="absolute top-[34px] right-0 left-0 z-20 max-h-56 overflow-auto rounded-md border border-line bg-popover py-0.5 shadow-lg"
      role="listbox"
    >
      <span
        v-for="(e, i) in hits"
        :key="e"
        class="num block cursor-pointer px-2 py-0.5 text-dense"
        :class="i === active ? 'bg-chosen text-text' : e === value ? 'text-accent' : ''"
        role="option"
        :aria-selected="e === value"
        @mousedown.prevent="pick(e)"
        @mouseenter="active = i"
        >{{ e }}</span
      >
      <span v-if="hits.length === 0" class="block px-2 py-1 text-dense text-faint">none match</span>
    </span>
  </span>
</template>
