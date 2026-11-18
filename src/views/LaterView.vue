<script setup lang="ts">
import { computed } from 'vue';
import Panel from '../components/Panel.vue';
import { sections } from '../sections.ts';

const props = defineProps<{ section: string }>();

/** what each section will hold, for the page it shows until it is built */
const plans: Record<string, string> = {
  tournaments: 'Matches and tournaments played in this browser, with SPRT and standings.',
  hosts: "The manager's hosts: condition, reason, units and benchtop's health line.",
  ratings: "The manager's ratings, and each version's progress.",
};

const label = computed(() => sections.find((s) => s.path === `/${props.section}`)?.label ?? '');
</script>

<template>
  <h1 class="mb-2.5 text-[15px] font-semibold">{{ label }}</h1>
  <Panel>
    <div class="px-3 py-4 text-dim">{{ plans[section] ?? '' }} Not built yet.</div>
  </Panel>
</template>
