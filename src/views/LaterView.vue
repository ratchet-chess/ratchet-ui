<script setup lang="ts">
import { computed } from 'vue';
import PageHeader from '../components/PageHeader.vue';
import Panel from '../components/Panel.vue';
import { sections } from '../sections.ts';

const props = defineProps<{ section: string }>();

/** what each section will hold, for the page it shows until it is built */
const plans: Record<string, string> = {
  ratings: "The manager's ratings, and each version's progress.",
};

const label = computed(() => sections.find((s) => s.path === `/${props.section}`)?.label ?? '');
</script>

<template>
  <PageHeader :title="label" />
  <Panel>
    <div class="px-3 py-4 text-dim">{{ plans[section] ?? '' }} Not built yet.</div>
  </Panel>
</template>
