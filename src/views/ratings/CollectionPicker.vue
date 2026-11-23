<script setup lang="ts">
/** Which collections Ratings counts: a button with the count, opening a searchable list by kind. */
import { computed, ref } from 'vue';
import type { Collection } from '../../stores/games.ts';
import type { RatedCollection } from '../../stores/ratings.ts';
import { count } from '../../ui/format.ts';

const props = defineProps<{
  collections: readonly RatedCollection[];
  picked: ReadonlySet<string>;
}>();
const emit = defineEmits<{ set: [ids: string[], on: boolean] }>();

const open = ref(false);
const query = ref('');
const GROUPS: { source: Collection['source']; name: string }[] = [
  { source: 'match', name: 'Tournaments' },
  { source: 'file', name: 'Files' },
  { source: 'play', name: 'Played here' },
];
const groups = computed(() => {
  const q = query.value.trim().toLowerCase();
  return GROUPS.map((g) => ({
    ...g,
    items: props.collections.filter(
      (c) => c.collection.source === g.source && c.collection.name.toLowerCase().includes(q),
    ),
  })).filter((g) => g.items.length > 0);
});
const shown = computed(() => groups.value.flatMap((g) => g.items.map((c) => c.id)));
</script>

<template>
  <span class="relative inline-block">
    <button class="btn h-7" :aria-expanded="open" @click="open = !open">
      Collections
      <span class="num text-small text-dim">{{ picked.size }}/{{ collections.length }}</span>
      <span class="text-dim">▾</span>
    </button>
    <template v-if="open">
      <span class="fixed inset-0 z-10" @click="open = false" />
      <span
        class="absolute top-8 left-0 z-20 flex w-80 max-w-[90vw] flex-col rounded-md border border-line bg-popover shadow-lg"
      >
        <span class="flex gap-1.5 border-b border-row p-1.5">
          <input
            v-model="query"
            type="search"
            placeholder="Search collections"
            class="field-sm min-w-0 flex-1"
          />
          <button class="btn-sm" @click="emit('set', shown, true)">All</button>
          <button class="btn-sm" @click="emit('set', shown, false)">None</button>
        </span>
        <span class="max-h-72 overflow-auto py-1">
          <template v-for="g in groups" :key="g.source">
            <span class="caps block px-2.5 pt-1.5 pb-0.5 text-label">{{ g.name }}</span>
            <label
              v-for="c in g.items"
              :key="c.id"
              class="grid cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 px-2.5 py-0.5 text-dense hover:bg-hover"
            >
              <input
                type="checkbox"
                class="accent-accent"
                :checked="picked.has(c.id)"
                @change="emit('set', [c.id], ($event.target as HTMLInputElement).checked)"
              />
              <span class="truncate" :title="c.collection.name">{{ c.collection.name }}</span>
              <span class="num text-small text-faint">{{ count(c.collection.games) }}</span>
            </label>
          </template>
          <span v-if="groups.length === 0" class="block px-2.5 py-1 text-dense text-faint">
            none match
          </span>
        </span>
      </span>
    </template>
  </span>
</template>
