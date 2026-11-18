<script setup lang="ts">
import PageHeader from '../components/PageHeader.vue';
import Panel from '../components/Panel.vue';
import { useSettings } from '../stores/settings.ts';

const settings = useSettings();
</script>

<template>
  <PageHeader title="Jobs" sub="on the manager · read only" />
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
