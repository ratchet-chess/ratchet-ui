<script setup lang="ts">
/**
 * Anchor engine picker and rating input in one joined control. Clicking the engine opens a
 * searchable popover scaled to 100+ engines: None (average 0) first, stockfish-10 next when
 * present, then the remaining engines by games played.
 */
import { computed, nextTick, ref, useId, watch } from 'vue';
import { ANCHOR_NAME, ANCHOR_RATING, type RatingList } from '../../ratings/list.ts';
import { count } from '../../ui/format.ts';
import { scrollChildIntoView } from '../../ui/scroll.ts';
import { anchorOptions, pickAnchor } from './anchor.ts';

const props = defineProps<{
  list: RatingList;
  anchorName: string | null;
  anchorRating: number | null;
  present: boolean;
}>();

const emit = defineEmits<{
  'update:anchorName': [name: string | null];
  'update:anchorRating': [rating: number | null];
}>();

const listId = useId();
const open = ref(false);
const query = ref('');
const active = ref(0);
const searchInput = ref<HTMLInputElement | null>(null);
const ratingInput = ref<HTMLInputElement | null>(null);
const listbox = ref<HTMLElement | null>(null);

const isNone = computed(() => props.anchorName === null);
const isAbsent = computed(() => !isNone.value && !props.present);
const displayLabel = computed(() => (isNone.value ? 'None (average 0)' : (props.anchorName ?? '')));
const showReset = computed(
  () => props.anchorName !== ANCHOR_NAME || props.anchorRating !== ANCHOR_RATING,
);

const options = computed(() => anchorOptions(props.list.rows, query.value, props.anchorName));

function scrollActive(): void {
  void nextTick(() => {
    const box = listbox.value;
    const el = box?.querySelector<HTMLElement>(`[data-opt-idx="${active.value}"]`);
    if (box && el) scrollChildIntoView(box, el);
  });
}

watch(active, () => {
  if (open.value) scrollActive();
});

function toggle(): void {
  if (open.value) {
    close();
    return;
  }
  open.value = true;
  query.value = '';
  const idx = options.value.hits.findIndex((o) => o.name === props.anchorName);
  active.value = idx >= 0 ? idx : 0;
  void nextTick(() => {
    searchInput.value?.focus();
    scrollActive();
  });
}

function close(): void {
  open.value = false;
  query.value = '';
}

function choose(nextName: string | null): void {
  const picked = pickAnchor(props.list, nextName);
  emit('update:anchorName', picked.name);
  emit('update:anchorRating', picked.rating);
  close();
  if (picked.needsRating) {
    void nextTick(() => {
      ratingInput.value?.focus();
      ratingInput.value?.select();
    });
  }
}

function resetDefault(): void {
  emit('update:anchorName', ANCHOR_NAME);
  emit('update:anchorRating', ANCHOR_RATING);
  close();
}

function onSearchInput(e: Event): void {
  query.value = (e.target as HTMLInputElement).value;
  active.value = 0;
}

function onSearchKey(e: KeyboardEvent): void {
  const hits = options.value.hits;
  if (e.key === 'ArrowDown') {
    active.value = Math.min(Math.max(0, hits.length - 1), active.value + 1);
  } else if (e.key === 'ArrowUp') {
    active.value = Math.max(0, active.value - 1);
  } else if (e.key === 'Enter') {
    const hit = hits[active.value];
    if (hit) choose(hit.name);
  } else if (e.key === 'Escape') {
    close();
  } else {
    return;
  }
  e.preventDefault();
}

function onRatingChange(e: Event): void {
  const v = (e.target as HTMLInputElement).value.trim();
  emit('update:anchorRating', v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
}

function onRatingKey(e: KeyboardEvent): void {
  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
}
</script>

<template>
  <span class="relative inline-flex items-center">
    <span
      class="inline-flex h-7 items-stretch rounded-md border bg-panel2 focus-within:border-accent"
      :class="isAbsent ? 'border-warn-line' : 'border-line hover:border-line-strong'"
    >
      <button
        type="button"
        class="inline-flex max-w-52 min-w-0 cursor-pointer items-center gap-1.5 rounded-l-md px-2 text-dense outline-none"
        :class="isNone ? 'text-dim' : 'text-text'"
        :title="displayLabel"
        :aria-expanded="open"
        :aria-controls="open ? listId : undefined"
        aria-label="Anchor engine"
        @click="toggle"
      >
        <span class="truncate">{{ displayLabel }}</span>
        <span class="flex-none text-small text-dim">▾</span>
      </button>
      <template v-if="!isNone && !isAbsent">
        <span class="my-1 w-px bg-line" />
        <input
          ref="ratingInput"
          :value="anchorRating ?? ''"
          type="number"
          placeholder="Elo"
          aria-label="Anchor rating"
          class="no-spin num w-16 rounded-r-md bg-transparent px-2 text-right text-dense text-text outline-none placeholder:text-faint placeholder:italic"
          @change="onRatingChange"
          @keydown="onRatingKey"
        />
      </template>
      <template v-else-if="isAbsent">
        <span class="my-1 w-px bg-line" />
        <span class="inline-flex items-center px-2 text-small text-warn">not in games</span>
      </template>
    </span>

    <template v-if="open">
      <span class="fixed inset-0 z-10" @click="close" />
      <span
        class="absolute top-8 right-0 z-20 flex w-80 max-w-[90vw] flex-col rounded-md border border-line bg-popover shadow-lg"
      >
        <span class="flex gap-1.5 border-b border-row p-1.5">
          <input
            ref="searchInput"
            :value="query"
            type="search"
            :placeholder="`Search ${count(list.rows.length)} engines`"
            class="field-sm min-w-0 flex-1"
            aria-label="Search anchor engines"
            :aria-controls="listId"
            :aria-activedescendant="options.hits[active] ? `${listId}-${active}` : undefined"
            @input="onSearchInput"
            @keydown="onSearchKey"
          />
        </span>
        <span :id="listId" ref="listbox" class="max-h-72 overflow-auto py-1" role="listbox">
          <template v-for="(opt, idx) in options.hits" :key="opt.name ?? '__none__'">
            <button
              :id="`${listId}-${idx}`"
              :data-opt-idx="idx"
              type="button"
              role="option"
              :aria-selected="opt.name === anchorName"
              class="grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-2.5 py-1 text-left text-dense"
              :class="idx === active ? 'bg-chosen text-text' : 'hover:bg-hover'"
              @mouseenter="active = idx"
              @mousedown.prevent="choose(opt.name)"
            >
              <span class="flex min-w-0 items-center gap-1.5">
                <span
                  class="truncate"
                  :class="opt.name === anchorName ? 'font-medium text-accent' : 'text-text'"
                  :title="opt.label"
                  >{{ opt.label }}</span
                >
                <span v-if="opt.isDefault" class="tag tone-dim">default</span>
                <span
                  v-if="list.pools > 1 && opt.pool !== null && opt.pool > 0"
                  class="tag tone-dim"
                  >pool {{ opt.pool + 1 }}</span
                >
              </span>
              <span v-if="opt.games !== null" class="num text-small text-faint"
                >{{ count(opt.games) }} games</span
              >
            </button>
            <span
              v-if="opt.name === null && options.hits[idx + 1]"
              class="my-1 block h-px bg-row"
            />
          </template>
          <span v-if="options.hits.length === 0" class="block px-2.5 py-1.5 text-dense text-faint">
            No matching engines.
          </span>
        </span>
        <span
          v-if="options.truncated || showReset"
          class="flex items-center justify-between gap-2 border-t border-row px-2.5 py-1 text-small text-faint"
        >
          <span v-if="options.truncated"
            >Showing {{ count(options.hits.length - (options.hits[0]?.name === null ? 1 : 0)) }} of
            {{ count(options.matchedEngines) }} — type to filter</span
          >
          <span v-else>{{ count(list.rows.length) }} engines in these games</span>
          <button v-if="showReset" type="button" class="btn-sm" @mousedown.prevent="resetDefault">
            Reset default
          </button>
        </span>
      </span>
    </template>
  </span>
</template>
