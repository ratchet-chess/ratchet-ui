<script setup lang="ts">
/**
 * A tournament's field picked from the available engines, designed for lists of a hundred or more:
 * search, family, Elo range, and kind/rating filters above a sortable engine list with Ratings'
 * Elo; the selected field beside or below it in seeding order, reordered by headers, drag, or
 * arrows, with duplicates added through +.
 */
import { computed, ref, watch } from 'vue';
import type { ServedEngine } from '../../engine/manifest.ts';
import type { RatingList } from '../../ratings/list.ts';
import {
  KIND_FILTERS,
  familiesOf,
  filterEngines,
  formatPickerElo,
  kindCountsOf,
  ratingsByEngine,
  sortEngines,
  sortFieldIds,
  type EngineKindFilter,
  type PickerSort,
  type PickerSortKey,
  type RatedFilter,
} from './picker.ts';

const props = defineProps<{
  engines: readonly ServedEngine[];
  ratings: RatingList;
  /** how many at the top of the field are seeds, tagged as such */
  seeds: number;
}>();
const model = defineModel<string[]>({ required: true });

/**
 * the field as edited here: each edit reads this, not the prop, which the parent updates a render
 * later, so two edits in one task both count
 */
const field = ref<string[]>([...model.value]);
watch(model, (m) => {
  if (m.join('\n') !== field.value.join('\n')) field.value = [...m];
});
watch(field, (f) => (model.value = [...f]));

// ── filters and sorting ────────────────────────────────────────────────────
const query = ref('');
const familiesAll = ref(true);
const familiesSelected = ref(new Set<string>());
const familyQuery = ref('');
const kinds = ref(new Set<EngineKindFilter>());
const rated = ref<RatedFilter>('any');
const eloMin = ref('');
const eloMax = ref('');
const openPopover = ref<'family' | 'filters' | null>(null);

const leftSort = ref<PickerSort>({ key: 'name', dir: 'asc' });
/** active one-shot reorder of the selected field; null after any manual order change */
const rightSort = ref<PickerSort | null>(null);

const ratingsMap = computed(() => ratingsByEngine(props.ratings));
const families = computed(() => familiesOf(props.engines));
const kindCounts = computed(() => kindCountsOf(props.engines));

const shownFamilies = computed(() => {
  const q = familyQuery.value.trim().toLowerCase();
  return q ? families.value.filter(([f]) => f.toLowerCase().includes(q)) : families.value;
});

const moreCount = computed(() => (kinds.value.size > 0 ? 1 : 0) + (rated.value !== 'any' ? 1 : 0));
const hasActiveFilters = computed(
  () =>
    !familiesAll.value ||
    eloMin.value.trim() !== '' ||
    eloMax.value.trim() !== '' ||
    moreCount.value > 0,
);

const filtered = computed(() =>
  filterEngines(props.engines, ratingsMap.value, {
    query: query.value,
    familiesAll: familiesAll.value,
    families: familiesSelected.value,
    kinds: kinds.value,
    rated: rated.value,
    eloMin: eloMin.value,
    eloMax: eloMax.value,
  }),
);
const shown = computed(() => sortEngines(filtered.value, ratingsMap.value, leftSort.value));

const inField = computed(() => new Set(field.value));
const addable = computed(() => shown.value.filter((e) => !inField.value.has(e.id)));

function toggleFamily(fam: string, on: boolean): void {
  const all = families.value.map(([f]) => f);
  if (familiesAll.value) {
    familiesAll.value = false;
    familiesSelected.value = new Set(all.filter((f) => f !== fam));
    return;
  }
  const next = new Set(familiesSelected.value);
  if (on) next.add(fam);
  else next.delete(fam);
  if (next.size === all.length) {
    familiesAll.value = true;
    familiesSelected.value = new Set();
  } else {
    familiesSelected.value = next;
  }
}

function setAllFamilies(on: boolean): void {
  if (on) {
    familiesAll.value = true;
    familiesSelected.value = new Set();
  } else {
    familiesAll.value = false;
    familiesSelected.value = new Set();
  }
}

function toggleKind(k: EngineKindFilter, on: boolean): void {
  const next = new Set(kinds.value);
  if (on) next.add(k);
  else next.delete(k);
  kinds.value = next;
}

function resetFilters(): void {
  familiesAll.value = true;
  familiesSelected.value = new Set();
  familyQuery.value = '';
  kinds.value = new Set();
  rated.value = 'any';
  eloMin.value = '';
  eloMax.value = '';
  openPopover.value = null;
}

function toggleLeftSort(key: PickerSortKey): void {
  if (leftSort.value.key === key) {
    leftSort.value = { key, dir: leftSort.value.dir === 'asc' ? 'desc' : 'asc' };
  } else {
    leftSort.value = { key, dir: key === 'elo' ? 'desc' : 'asc' };
  }
}

function reorderField(key: PickerSortKey): void {
  if (field.value.length < 2) return;
  const dir: PickerSort['dir'] =
    rightSort.value?.key === key
      ? rightSort.value.dir === 'asc'
        ? 'desc'
        : 'asc'
      : key === 'elo'
        ? 'desc'
        : 'asc';
  const nextSort: PickerSort = { key, dir };
  rightSort.value = nextSort;
  field.value = sortFieldIds(field.value, ratingsMap.value, nextSort);
}

// ── field edits ────────────────────────────────────────────────────────────
function tick(id: string, on: boolean): void {
  field.value = on ? [...field.value, id] : field.value.filter((x) => x !== id);
  rightSort.value = null;
}
function addShown(): void {
  field.value = [...field.value, ...addable.value.map((e) => e.id)];
  rightSort.value = null;
}
function clearField(): void {
  field.value = [];
  rightSort.value = null;
}
function move(from: number, to: number): void {
  if (to < 0 || to >= field.value.length || from === to) return;
  const next = [...field.value];
  const [x] = next.splice(from, 1);
  if (x !== undefined) next.splice(to, 0, x);
  field.value = next;
  rightSort.value = null;
}
function again(i: number): void {
  const next = [...field.value];
  const x = next[i];
  if (x !== undefined) next.splice(i + 1, 0, x);
  field.value = next;
  rightSort.value = null;
}
function remove(i: number): void {
  field.value = field.value.filter((_, k) => k !== i);
}

const dragging = ref<number | null>(null);
function drop(to: number): void {
  if (dragging.value !== null) move(dragging.value, to);
  dragging.value = null;
}

const eloOf = (id: string) => formatPickerElo(ratingsMap.value.get(id));

const RATED_OPTIONS: readonly { value: RatedFilter; label: string }[] = [
  { value: 'any', label: 'Any' },
  { value: 'rated', label: 'Rated only' },
  { value: 'unrated', label: 'Unrated only' },
];

const head =
  'flex min-h-10 items-center gap-1.5 border-b border-row px-2 py-1.5 text-dense text-dim';
const icon = 'px-0.5 text-dense text-faint hover:text-text';
const sortBtn =
  'inline-flex items-center gap-1 text-small font-medium text-dim hover:text-text cursor-pointer';
</script>

<template>
  <div class="@container" @keydown.escape="openPopover = null">
    <div
      class="grid rounded-md border border-line bg-panel2 @2xl:grid-cols-2 @2xl:divide-x @2xl:divide-line"
    >
      <!-- ── available engines ────────────────────────────────────────────── -->
      <div class="flex min-w-0 flex-col max-@2xl:border-b max-@2xl:border-line">
        <div :class="head">
          <input
            v-model="query"
            type="search"
            :placeholder="`Search ${engines.length} engines`"
            class="field-sm num min-w-0 flex-1 placeholder:text-faint placeholder:italic"
          />
          <button
            type="button"
            class="btn-sm shrink-0"
            :disabled="addable.length === 0"
            title="Add all matching engines"
            @click="addShown"
          >
            Add all ({{ addable.length }})
          </button>
        </div>

        <!-- filter bar -->
        <div
          class="flex flex-wrap items-center gap-1.5 border-b border-row bg-panel px-2 py-1.5 text-small text-dim"
        >
          <!-- Family dropdown -->
          <span v-if="families.length > 1" class="relative inline-block">
            <button
              type="button"
              class="btn-sm"
              :class="!familiesAll ? 'border-accent-line bg-selected text-accent' : ''"
              :aria-expanded="openPopover === 'family'"
              @click="openPopover = openPopover === 'family' ? null : 'family'"
            >
              Family
              <span v-if="!familiesAll" class="num text-label">
                {{ familiesSelected.size }}/{{ families.length }}
              </span>
              <span class="text-dim">▾</span>
            </button>
            <template v-if="openPopover === 'family'">
              <span class="fixed inset-0 z-10" @click="openPopover = null" />
              <span
                class="absolute top-7 left-0 z-20 flex w-64 max-w-[85vw] flex-col rounded-md border border-line bg-popover shadow-lg"
              >
                <span class="flex gap-1 border-b border-row p-1.5">
                  <input
                    v-model="familyQuery"
                    type="search"
                    placeholder="Search families"
                    class="field-sm min-w-0 flex-1"
                  />
                  <button type="button" class="btn-sm" @click="setAllFamilies(true)">All</button>
                  <button type="button" class="btn-sm" @click="setAllFamilies(false)">None</button>
                </span>
                <span class="max-h-60 overflow-auto py-1">
                  <label
                    v-for="[fam, n] in shownFamilies"
                    :key="fam"
                    class="grid cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 px-2.5 py-0.5 text-dense text-text hover:bg-hover"
                  >
                    <input
                      type="checkbox"
                      class="accent-accent"
                      :checked="familiesAll || familiesSelected.has(fam)"
                      @change="toggleFamily(fam, ($event.target as HTMLInputElement).checked)"
                    />
                    <span class="truncate" :title="fam">{{ fam }}</span>
                    <span class="num text-small text-faint">{{ n }}</span>
                  </label>
                  <span
                    v-if="shownFamilies.length === 0"
                    class="block px-2.5 py-1.5 text-dense text-faint"
                  >
                    No matching families.
                  </span>
                </span>
              </span>
            </template>
          </span>

          <!-- Elo range -->
          <span class="num inline-flex items-center gap-1">
            <span>Elo</span>
            <input
              :value="eloMin"
              type="number"
              placeholder="min"
              aria-label="minimum Elo"
              class="field-sm no-spin num w-14 text-right placeholder:text-faint"
              @input="eloMin = ($event.target as HTMLInputElement).value"
            />
            <span>–</span>
            <input
              :value="eloMax"
              type="number"
              placeholder="max"
              aria-label="maximum Elo"
              class="field-sm no-spin num w-14 text-right placeholder:text-faint"
              @input="eloMax = ($event.target as HTMLInputElement).value"
            />
          </span>

          <span class="flex-1" />

          <!-- More filters popover (Kind, Rating, future options) -->
          <span class="relative inline-block">
            <button
              type="button"
              class="btn-sm"
              :class="moreCount > 0 ? 'border-accent-line bg-selected text-accent' : ''"
              :aria-expanded="openPopover === 'filters'"
              @click="openPopover = openPopover === 'filters' ? null : 'filters'"
            >
              Filters
              <span v-if="moreCount > 0" class="num text-label">{{ moreCount }}</span>
              <span class="text-dim">▾</span>
            </button>
            <template v-if="openPopover === 'filters'">
              <span class="fixed inset-0 z-10" @click="openPopover = null" />
              <span
                class="absolute top-7 right-0 z-20 flex w-60 max-w-[85vw] flex-col rounded-md border border-line bg-popover py-1 shadow-lg"
              >
                <span class="subhead block px-2.5 pt-1 pb-0.5">Kind</span>
                <label
                  v-for="k in KIND_FILTERS"
                  :key="k.key"
                  class="grid cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 px-2.5 py-0.5 text-dense text-text hover:bg-hover"
                >
                  <input
                    type="checkbox"
                    class="accent-accent"
                    :checked="kinds.has(k.key)"
                    @change="toggleKind(k.key, ($event.target as HTMLInputElement).checked)"
                  />
                  <span class="truncate">{{ k.label }}</span>
                  <span class="num text-small text-faint">{{ kindCounts[k.key] }}</span>
                </label>
                <span class="my-1 border-t border-row" />
                <span class="subhead block px-2.5 pt-1 pb-0.5">Rating</span>
                <label
                  v-for="opt in RATED_OPTIONS"
                  :key="opt.value"
                  class="grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-center gap-2 px-2.5 py-0.5 text-dense text-text hover:bg-hover"
                >
                  <input v-model="rated" type="radio" :value="opt.value" class="accent-accent" />
                  <span>{{ opt.label }}</span>
                </label>
              </span>
            </template>
          </span>

          <button
            v-if="hasActiveFilters"
            type="button"
            class="text-small text-accent hover:underline"
            @click="resetFilters"
          >
            Reset
          </button>
        </div>

        <div
          v-if="shown.length < engines.length"
          class="num border-b border-row bg-selected px-2 py-0.5 text-label text-dim"
        >
          Showing {{ shown.length }} of {{ engines.length }}
        </div>

        <!-- clickable column headers -->
        <div
          class="grid grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-1.5 border-b border-line px-2 py-1 select-none"
        >
          <span />
          <button
            type="button"
            :class="[sortBtn, leftSort.key === 'name' ? 'text-text' : '']"
            @click="toggleLeftSort('name')"
          >
            engine
            <span
              class="text-label"
              :class="leftSort.key === 'name' ? 'text-accent' : 'text-faint'"
            >
              {{ leftSort.key === 'name' ? (leftSort.dir === 'asc' ? '▲' : '▼') : '⇅' }}
            </span>
          </button>
          <button
            type="button"
            class="justify-self-end"
            :class="[sortBtn, leftSort.key === 'elo' ? 'text-text' : '']"
            @click="toggleLeftSort('elo')"
          >
            Elo
            <span class="text-label" :class="leftSort.key === 'elo' ? 'text-accent' : 'text-faint'">
              {{ leftSort.key === 'elo' ? (leftSort.dir === 'asc' ? '▲' : '▼') : '⇅' }}
            </span>
          </button>
        </div>

        <!-- engine rows -->
        <div class="max-h-56 min-h-16 overflow-auto py-0.5">
          <label
            v-for="e in shown"
            :key="e.id"
            class="num grid cursor-pointer grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-1.5 px-2 py-0.5 text-dense hover:bg-hover"
          >
            <input
              type="checkbox"
              class="accent-accent"
              :checked="inField.has(e.id)"
              @change="tick(e.id, ($event.target as HTMLInputElement).checked)"
            />
            <span class="truncate" :title="e.id">{{ e.id }}</span>
            <span
              class="num text-right text-small whitespace-nowrap"
              :class="
                eloOf(e.id).unrated ? 'text-faint' : eloOf(e.id).dimmed ? 'text-dim opacity-75' : ''
              "
              :title="eloOf(e.id).title"
            >
              {{ eloOf(e.id).text
              }}<span
                v-if="eloOf(e.id).errorText"
                class="ml-0.5 text-label"
                :class="eloOf(e.id).errorWarn ? 'text-warn' : 'text-dim'"
                >{{ eloOf(e.id).errorText }}</span
              >
            </span>
          </label>
          <div v-if="shown.length === 0" class="px-2 py-3 text-dense text-faint">
            No matching engines.
          </div>
        </div>
      </div>

      <!-- ── selected field ───────────────────────────────────────────────── -->
      <div class="flex min-w-0 flex-col">
        <div :class="head">
          <b class="font-semibold text-text">{{ field.length }}</b> selected
          <span class="flex-1" />
          <button type="button" class="btn-sm" :disabled="field.length === 0" @click="clearField">
            Clear
          </button>
        </div>

        <!-- clickable reorder headers -->
        <div
          class="grid grid-cols-[1.75rem_minmax(0,1fr)_auto_3.5rem] items-center gap-1.5 border-b border-line px-2 py-1 select-none"
        >
          <span class="text-small text-faint">#</span>
          <button
            type="button"
            :disabled="field.length < 2"
            title="Reorder selected engines by name"
            :class="[
              sortBtn,
              rightSort?.key === 'name' ? 'text-text' : '',
              field.length < 2 ? 'cursor-not-allowed opacity-50' : '',
            ]"
            @click="reorderField('name')"
          >
            engine
            <span
              class="text-label"
              :class="rightSort?.key === 'name' ? 'text-accent' : 'text-faint'"
            >
              {{ rightSort?.key === 'name' ? (rightSort.dir === 'asc' ? '▲' : '▼') : '⇅' }}
            </span>
          </button>
          <button
            type="button"
            :disabled="field.length < 2"
            title="Reorder selected engines by Elo"
            class="justify-self-end"
            :class="[
              sortBtn,
              rightSort?.key === 'elo' ? 'text-text' : '',
              field.length < 2 ? 'cursor-not-allowed opacity-50' : '',
            ]"
            @click="reorderField('elo')"
          >
            Elo
            <span
              class="text-label"
              :class="rightSort?.key === 'elo' ? 'text-accent' : 'text-faint'"
            >
              {{ rightSort?.key === 'elo' ? (rightSort.dir === 'asc' ? '▲' : '▼') : '⇅' }}
            </span>
          </button>
          <span />
        </div>

        <!-- selected rows -->
        <div class="max-h-56 min-h-16 overflow-auto @2xl:max-h-[17.5rem]">
          <div
            v-for="(e, i) in field"
            :key="`${i}.${e}`"
            draggable="true"
            class="num grid cursor-grab grid-cols-[1.75rem_minmax(0,1fr)_auto_3.5rem] items-center gap-1.5 border-b border-row px-2 py-0.5 text-dense last:border-b-0 hover:bg-hover"
            :class="dragging === i ? 'opacity-40' : ''"
            @dragstart="dragging = i"
            @dragover.prevent
            @drop.prevent="drop(i)"
            @dragend="dragging = null"
          >
            <span class="text-faint">{{ i + 1 }}</span>
            <span class="truncate" :title="e">
              {{ e }} <span v-if="i < seeds" class="tag tone-accent ml-1">Seed</span>
            </span>
            <span
              class="num text-right text-small whitespace-nowrap"
              :class="
                eloOf(e).unrated ? 'text-faint' : eloOf(e).dimmed ? 'text-dim opacity-75' : ''
              "
              :title="eloOf(e).title"
            >
              {{ eloOf(e).text }}
            </span>
            <span class="flex justify-end whitespace-nowrap">
              <button type="button" :class="icon" title="Up" @click="move(i, i - 1)">↑</button>
              <button type="button" :class="icon" title="Down" @click="move(i, i + 1)">↓</button>
              <button type="button" :class="icon" title="Add duplicate" @click="again(i)">+</button>
              <button type="button" :class="icon" title="Remove" @click="remove(i)">✕</button>
            </span>
          </div>
          <div v-if="field.length === 0" class="px-2 py-3 text-dense text-faint">
            Select engines to add.
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
