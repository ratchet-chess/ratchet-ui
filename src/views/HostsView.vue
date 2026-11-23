<script setup lang="ts">
import { computed } from 'vue';
import ManagerGate from '../components/ManagerGate.vue';
import PageHeader from '../components/PageHeader.vue';
import Panel from '../components/Panel.vue';
import type { Condition } from '../manager/api.ts';
import { headline, runningText, runningUnits } from '../manager/show.ts';
import { useManager } from '../stores/manager.ts';

const manager = useManager();
const sub = computed(() =>
  manager.readAt === null ? 'manager · condition and units' : headline(manager.hosts, manager.jobs),
);

/** a condition's color: open takes work, silent says nothing, and the rest take none for a stated reason */
const TONE: Record<Condition, string> = {
  open: 'text-good',
  closed: 'text-warn',
  allocated: 'text-accent',
  retiring: 'text-warn',
  drained: 'text-warn',
  silent: 'text-bad',
};
</script>

<template>
  <PageHeader title="Hosts" :sub="sub" />
  <ManagerGate />

  <Panel v-if="manager.readAt !== null">
    <div class="overflow-x-auto">
      <table class="w-full text-left text-dense">
        <thead class="text-small text-dim">
          <tr>
            <th class="th pl-3">host</th>
            <th class="th">condition</th>
            <th class="th">taints</th>
            <th class="th text-right">units</th>
            <th class="th text-right">threads</th>
            <th class="th pr-3">jobs</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="h in manager.hosts" :key="h.name" class="border-b border-row last:border-b-0">
            <td class="num px-2 py-1 pl-3 whitespace-nowrap">{{ h.name }}</td>
            <td class="px-2 py-1">
              <span :class="TONE[h.condition]">{{ h.condition }}</span>
              <span v-if="h.reason" class="text-dim"> · {{ h.reason }}</span>
            </td>
            <td class="num px-2 py-1 whitespace-nowrap text-dim">{{ h.taints.join(' ') }}</td>
            <td class="num px-2 py-1 text-right">{{ runningUnits(h) }}</td>
            <td class="num px-2 py-1 text-right text-dim">{{ h.threads ?? '—' }}</td>
            <td class="num px-2 py-1 pr-3 text-small whitespace-nowrap">{{ runningText(h) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </Panel>
</template>
