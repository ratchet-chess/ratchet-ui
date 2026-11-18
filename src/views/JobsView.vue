<script setup lang="ts">
import Panel from '../components/Panel.vue';
import { useSettings } from '../stores/settings.ts';

const settings = useSettings();
</script>

<template>
  <h1 class="mb-2.5 flex items-baseline gap-2.5 text-[15px] font-semibold">
    Jobs <span class="text-xs font-normal text-dim">on the manager · read only</span>
  </h1>
  <Panel>
    <div class="px-3 py-4 text-dim">
      <template v-if="settings.managerUrl === ''">
        No manager is connected. Set its address in
        <RouterLink to="/settings" class="text-accent">Settings</RouterLink>.
      </template>
      <template v-else>
        A manager is set at <span class="num text-text">{{ settings.managerUrl }}</span>, but the
        manager has no read API yet. Jobs appear here once ratchet-bench serves it.
      </template>
    </div>
  </Panel>
</template>
