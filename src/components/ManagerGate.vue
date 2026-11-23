<script setup lang="ts">
import { computed } from 'vue';
import { useManager } from '../stores/manager.ts';
import Panel from './Panel.vue';

/** What a manager-view page shows in place of its rows: no manager set, the first read out, or a read that failed. */
const manager = useManager();
/** the clock time of the last good read, whose rows the page still shows */
const rowsFrom = computed(() =>
  manager.readAt === null
    ? ''
    : new Date(manager.readAt).toLocaleTimeString('en-US', { hourCycle: 'h23' }),
);
</script>

<template>
  <Panel v-if="manager.link === 'none'">
    <div class="px-3 py-4 text-dim">
      No manager configured. Set URL in
      <RouterLink to="/settings" class="text-accent">Settings</RouterLink>.
    </div>
  </Panel>
  <Panel v-else-if="manager.link === 'reading'">
    <div class="px-3 py-4 text-dim">
      Loading <span class="num text-text">{{ manager.url }}</span>…
    </div>
  </Panel>
  <Panel v-else-if="manager.link === 'unreachable'">
    <div class="px-3 py-3 text-dense">
      <span class="text-bad">Not connected.</span>
      <span class="ml-1.5 text-dim">{{ manager.problem }}</span>
      <span v-if="rowsFrom" class="num ml-1.5 text-dim">· cached {{ rowsFrom }}</span>
      <button class="btn-sm ml-2" @click="manager.read()">Retry</button>
    </div>
  </Panel>
</template>
