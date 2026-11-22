<script setup lang="ts">
/**
 * An SPSA tune's values as a table: each one's start and value now, where they sit in its range, its effect so
 * far, and the path it took. The rows sort by how far each value moved in its range, or by its effect.
 */
import { computed, ref } from 'vue';
import HelpTip from '../../components/HelpTip.vue';
import Panel from '../../components/Panel.vue';
import Segmented from '../../components/Segmented.vue';
import Sparkline from '../../components/Sparkline.vue';
import type { PathPoint, TunedValue } from '../../manager/api.ts';
import { moveText, placeAt, tunedText, tuneOrder } from '../../manager/show.ts';
import { signed } from '../../ui/format.ts';

const props = defineProps<{ values: TunedValue[]; path: PathPoint[] }>();

const by = ref<'move' | 'effect'>('move');
const SORTS = [
  { value: 'move', label: 'by move', title: 'how far each value moved, as a share of its range' },
  { value: 'effect', label: 'by effect', title: 'the size of each value’s effect' },
] as const;
/** the rows in the chosen order: each value, with its path; a path shows once it has two points */
const rows = computed(() =>
  tuneOrder(props.values, by.value).flatMap((i) => {
    const v = props.values[i];
    if (v === undefined) return [];
    const path = props.path.flatMap((q) => {
      const x = q.values.length === props.values.length ? q.values[i] : undefined;
      return x === undefined ? [] : [x];
    });
    return [{ v, path: path.length >= 2 ? path : [] }];
  }),
);
</script>

<template>
  <Panel title="Values" :note="String(values.length)">
    <div class="flex items-center gap-2 px-3 pt-2 pb-1">
      <Segmented v-model="by" :options="SORTS" size="sm" />
    </div>
    <div class="overflow-x-auto">
      <table class="w-full text-left text-dense">
        <thead class="text-small text-dim">
          <tr>
            <th class="th pl-3">value</th>
            <th class="th text-right">start</th>
            <th class="th text-right">now</th>
            <th class="th text-right">move</th>
            <th class="th">
              <span class="inline-flex items-center gap-1.5"
                >range
                <HelpTip
                  >The value's bounds in the map. The faint tick is its start; the mark is where it
                  is now.</HelpTip
                ></span
              >
            </th>
            <th class="th text-right">
              <span class="inline-flex items-center gap-1.5"
                >effect
                <HelpTip side="left"
                  >The side moved up against the side moved down, in nElo, over every game so far.
                  It is a slope along the tune's path, not a gain over the start.</HelpTip
                ></span
              >
            </th>
            <th class="th pr-3">path</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.v.name" class="border-b border-row last:border-b-0">
            <td class="num px-2 py-1 pl-3 whitespace-nowrap">{{ r.v.name }}</td>
            <td class="num px-2 py-1 text-right text-dim">{{ tunedText(r.v.start) }}</td>
            <td class="num px-2 py-1 text-right">{{ tunedText(r.v.now) }}</td>
            <td class="num px-2 py-1 text-right" :class="r.v.now === r.v.start ? 'text-faint' : ''">
              {{ moveText(r.v) }}
            </td>
            <td class="px-2 py-1" :title="`${r.v.min} to ${r.v.max}`">
              <div class="relative h-1.5 w-28 rounded bg-track">
                <div
                  class="absolute top-[-3px] h-3 w-px bg-dim"
                  :style="{ left: `${placeAt(r.v.start, r.v.min, r.v.max)}%` }"
                />
                <div
                  class="absolute top-[-2px] h-2.5 w-1 -translate-x-1/2 rounded bg-accent"
                  :style="{ left: `${placeAt(r.v.now, r.v.min, r.v.max)}%` }"
                />
              </div>
            </td>
            <td class="num px-2 py-1 text-right" :class="r.v.effect === null ? 'text-faint' : ''">
              {{ r.v.effect === null ? '—' : signed(r.v.effect) }}
            </td>
            <td class="px-2 py-1 pr-3">
              <Sparkline v-if="r.path.length" :points="r.path" :level="r.v.start" />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </Panel>
</template>
