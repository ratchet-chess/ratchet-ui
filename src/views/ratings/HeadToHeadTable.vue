<script setup lang="ts">
/** Head to head: a record for each two engines that met, most games first, a page at a time. */
import { computed, ref, watch } from 'vue';
import HelpTip from '../../components/HelpTip.vue';
import Pager from '../../components/Pager.vue';
import type { HeadToHead } from '../../ratings/list.ts';
import { losText } from '../../ratings/report.ts';
import { count, signed } from '../../ui/format.ts';

const props = defineProps<{ records: readonly HeadToHead[] }>();

const PAGE = 40;
const page = ref(0);
const pages = computed(() => Math.ceil(props.records.length / PAGE));
const shown = computed(() => props.records.slice(page.value * PAGE, (page.value + 1) * PAGE));
watch(
  () => props.records,
  () => (page.value = 0),
);
const score = (m: HeadToHead) => ((100 * (m.wins + m.draws / 2)) / m.games).toFixed(1);
</script>

<template>
  <div class="overflow-x-auto">
    <table class="w-full border-collapse text-dense">
      <thead>
        <tr class="text-right text-small text-dim">
          <th class="th w-[30%] text-left">engine</th>
          <th class="th w-[30%] text-left">opponent</th>
          <th class="th">games</th>
          <th class="th">W</th>
          <th class="th">D</th>
          <th class="th">L</th>
          <th class="th">score %</th>
          <th class="th">
            <span class="inline-flex items-center gap-1"
              >Elo diff
              <HelpTip side="left"
                >The gap between the two engines' ratings in the list, which every game counted
                sets, not a fit of these games alone. Its ± is half the 95% interval of that gap,
                and LOS the likelihood that the first engine is the stronger, both from the whole
                fit. Blank where no interval reads: an engine that won or lost every game, or one
                with no spread in its pairs.</HelpTip
              ></span
            >
          </th>
          <th class="th">±</th>
          <th class="th">LOS</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="m in shown"
          :key="`${m.a} ${m.b}`"
          class="border-b border-row last:border-b-0 hover:bg-hover"
        >
          <td class="max-w-0 truncate px-2 py-1" :title="m.a">{{ m.a }}</td>
          <td class="max-w-0 truncate px-2 py-1" :title="m.b">{{ m.b }}</td>
          <td class="num px-2 py-1 text-right">{{ count(m.games) }}</td>
          <td class="num px-2 py-1 text-right text-good">{{ count(m.wins) }}</td>
          <td class="num px-2 py-1 text-right text-dim">{{ count(m.draws) }}</td>
          <td class="num px-2 py-1 text-right text-bad">{{ count(m.losses) }}</td>
          <td class="num px-2 py-1 text-right">{{ score(m) }}</td>
          <td class="num px-2 py-1 text-right">{{ m.mark }}{{ signed(m.gap, 0) }}</td>
          <td class="num px-2 py-1 text-right text-dim">
            {{ Number.isNaN(m.error) ? '' : `±${count(Math.round(m.error))}` }}
          </td>
          <td class="num px-2 py-1 text-right">{{ losText(m.los) }}</td>
        </tr>
      </tbody>
    </table>
    <div class="flex items-center gap-3 border-t border-line px-2.5 py-1.5 text-small text-dim">
      <span>{{ count(records.length) }} head-to-head records, most games first</span>
      <span class="flex-1" />
      <Pager v-model="page" :pages="pages" />
    </div>
  </div>
</template>
