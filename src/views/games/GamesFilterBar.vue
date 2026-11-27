<script setup lang="ts">
/**
 * Filter controls for a PGN collection: space-separated word search, result, ending/forfeit,
 * ECO/opening range or words, and optional date range, plus Download filtered.
 * Renders as a single toolbar above the full game table, or stacked in the narrow games rail.
 */
import { Download, X } from '@lucide/vue';
import { computed } from 'vue';
import { EMPTY_FILTER, isFiltered, type GameFilter } from '../../games/index.ts';
import { count } from '../../ui/format.ts';

const props = defineProps<{
  total: number;
  matched: number;
  compact?: boolean;
}>();

const emit = defineEmits<{ download: [] }>();
const filter = defineModel<GameFilter>({ required: true });

const active = computed(() => isFiltered(filter.value));
const hasDates = computed(() => filter.value.dateFrom !== '' || filter.value.dateTo !== '');
const patch = (next: Partial<GameFilter>) => {
  filter.value = { ...filter.value, ...next };
};
const clear = () => {
  filter.value = { ...EMPTY_FILTER };
};
</script>

<template>
  <div v-if="compact" class="flex flex-col gap-1.5 border-b border-line bg-panel2 p-2">
    <input
      :value="filter.query"
      type="search"
      placeholder="Search players, opening, ECO, date…"
      class="field-sm w-full"
      aria-label="search games"
      @input="patch({ query: ($event.target as HTMLInputElement).value })"
    />
    <div class="flex items-center gap-1.5">
      <select
        :value="filter.result"
        class="field-sm min-w-0 flex-1"
        aria-label="result filter"
        @change="
          patch({ result: ($event.target as HTMLSelectElement).value as GameFilter['result'] })
        "
      >
        <option value="">All results</option>
        <option value="1-0">1-0</option>
        <option value="1/2-1/2">1/2-1/2</option>
        <option value="0-1">0-1</option>
        <option value="*">*</option>
      </select>
      <select
        :value="filter.termination"
        class="field-sm min-w-0 flex-1"
        aria-label="ending filter"
        @change="
          patch({
            termination: ($event.target as HTMLSelectElement).value as GameFilter['termination'],
          })
        "
      >
        <option value="">Any ending</option>
        <option value="normal">Normal</option>
        <option value="adjudication">Adjudication</option>
        <option value="forfeit">Forfeits</option>
      </select>
      <button
        v-if="active"
        type="button"
        class="btn-sm shrink-0"
        title="Clear filters"
        @click="clear"
      >
        <X :size="12" />
      </button>
    </div>
    <input
      :value="filter.opening"
      type="search"
      placeholder="ECO (B20-B99) or opening…"
      class="field-sm w-full"
      aria-label="opening filter"
      @input="patch({ opening: ($event.target as HTMLInputElement).value })"
    />
    <div v-if="hasDates" class="num flex items-center justify-between gap-1 text-small text-dim">
      <span>Dates: {{ filter.dateFrom || '…' }} – {{ filter.dateTo || '…' }}</span>
      <button
        type="button"
        class="btn-sm shrink-0"
        title="Clear date filter"
        @click="patch({ dateFrom: '', dateTo: '' })"
      >
        <X :size="11" />
      </button>
    </div>
  </div>

  <div
    v-else
    class="mb-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-2 rounded-md border border-line bg-panel px-2.5 py-2"
  >
    <input
      :value="filter.query"
      type="search"
      placeholder="Search players, event, round, date, opening…"
      class="field-sm min-w-44 flex-1"
      aria-label="search games"
      @input="patch({ query: ($event.target as HTMLInputElement).value })"
    />
    <select
      :value="filter.result"
      class="field-sm"
      aria-label="result filter"
      @change="
        patch({ result: ($event.target as HTMLSelectElement).value as GameFilter['result'] })
      "
    >
      <option value="">All results</option>
      <option value="1-0">1-0</option>
      <option value="1/2-1/2">1/2-1/2</option>
      <option value="0-1">0-1</option>
      <option value="*">*</option>
    </select>
    <select
      :value="filter.termination"
      class="field-sm"
      aria-label="ending filter"
      @change="
        patch({
          termination: ($event.target as HTMLSelectElement).value as GameFilter['termination'],
        })
      "
    >
      <option value="">Any ending</option>
      <option value="normal">Normal</option>
      <option value="adjudication">Adjudication</option>
      <option value="forfeit">Forfeits</option>
    </select>
    <input
      :value="filter.opening"
      type="search"
      placeholder="ECO / B20-B99"
      class="field-sm num w-32"
      aria-label="opening or ECO filter"
      @input="patch({ opening: ($event.target as HTMLInputElement).value })"
    />
    <input
      :value="filter.dateFrom"
      type="date"
      class="field-sm num w-32"
      title="From date"
      aria-label="from date"
      @input="patch({ dateFrom: ($event.target as HTMLInputElement).value })"
    />
    <input
      :value="filter.dateTo"
      type="date"
      class="field-sm num w-32"
      title="To date"
      aria-label="to date"
      @input="patch({ dateTo: ($event.target as HTMLInputElement).value })"
    />
    <button v-if="active" type="button" class="btn-sm" title="Clear filters" @click="clear">
      Clear
    </button>
    <span class="num text-dense whitespace-nowrap text-dim">
      <template v-if="active">{{ count(matched) }} of {{ count(total) }}</template>
      <template v-else>{{ count(total) }} games</template>
    </span>
    <button
      type="button"
      class="btn-sm"
      :disabled="matched === 0"
      title="Download matching games as PGN"
      @click="emit('download')"
    >
      <Download :size="12" />
      <span>{{ active ? 'Download filtered' : 'Download PGN' }}</span>
    </button>
  </div>
</template>
