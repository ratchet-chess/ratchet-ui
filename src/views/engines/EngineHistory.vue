<script setup lang="ts">
import { ChevronDown, ChevronRight } from '@lucide/vue';
import { computed, ref, watch } from 'vue';
import Panel from '../../components/Panel.vue';
import type { ServedEngine } from '../../engine/manifest.ts';
import { cpwUrl, type EngineMeta } from '../../engine/meta.ts';

const props = defineProps<{
  engine: ServedEngine;
  meta: EngineMeta;
}>();

/** Opens rolled up on page load and on engine switch, matching WasiChecker.vue. */
const expanded = ref(false);

watch(
  () => props.engine.id,
  () => {
    expanded.value = false;
  },
);

const authorsSummary = computed(() => {
  const list = props.meta.originalAuthors;
  if (list.length <= 2) return list.join(', ');
  return `${list.slice(0, 2).join(', ')} et al.`;
});

const topContext = computed(
  () => props.meta.hardware?.[0]?.platform ?? props.meta.originalLanguage ?? '',
);

const topResult = computed(() => {
  const r = props.meta.results?.[0];
  return r ? `${r.where}: ${r.result}` : '';
});

const stripColCount = computed(
  () =>
    ((props.meta.hardware?.length ?? 0) > 0 ? 1 : 0) +
    ((props.meta.results?.length ?? 0) > 0 ? 1 : 0) +
    ((props.meta.ratings?.length ?? 0) > 0 ? 1 : 0),
);

const stripColsClass = computed(() =>
  stripColCount.value >= 3
    ? 'wide:grid-cols-3'
    : stripColCount.value === 2
      ? 'wide:grid-cols-2'
      : '',
);
</script>

<template>
  <Panel
    title="History & features"
    :note="meta.kind === 'release' ? 'from inventory record' : 'upstream provenance'"
  >
    <div
      class="flex cursor-pointer flex-wrap items-center gap-x-2.5 gap-y-1 px-3 py-2 text-dense select-none hover:bg-hover"
      :class="expanded ? 'border-b border-row' : ''"
      @click="expanded = !expanded"
    >
      <button
        type="button"
        class="-ml-1 inline-flex items-center text-dim hover:text-text"
        :title="expanded ? 'Collapse history and features' : 'Expand history and features'"
        :aria-expanded="expanded"
        @click.stop="expanded = !expanded"
      >
        <ChevronDown v-if="expanded" :size="14" />
        <ChevronRight v-else :size="14" />
      </button>
      <span class="tag tone-accent">{{ meta.year }}</span>
      <span class="font-medium text-text">{{ authorsSummary }}</span>
      <span v-if="topContext" class="text-small text-dim">· {{ topContext }}</span>
      <span class="num ml-auto text-small text-dim"> {{ meta.features.length }} CPW features </span>
    </div>

    <div
      v-if="!expanded"
      class="flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-1 border-t border-row px-3 py-1.5 text-small text-dim hover:bg-hover"
      @click="expanded = true"
    >
      <span v-if="topResult"> Record: <span class="text-text">{{ topResult }}</span> </span>
      <span v-if="meta.fidelity">
        Fidelity: <span class="text-good">{{ meta.fidelity.headline }}</span>
      </span>
      <span class="ml-auto text-accent">Expand blurb &amp; features</span>
    </div>

    <div v-else class="px-3 py-2.5 text-dense">
      <p class="mb-2.5 text-text">{{ meta.blurb }}</p>

      <div
        v-if="stripColCount > 0"
        class="mb-3 grid gap-2.5 rounded border border-row bg-panel2 px-2.5 py-2"
        :class="stripColsClass"
      >
        <div v-if="meta.hardware?.length">
          <div class="caps mb-1 text-label">Period hardware</div>
          <ul class="space-y-1 text-small text-dim">
            <li v-for="h in meta.hardware" :key="h.platform">
              <div class="font-medium text-text">{{ h.platform }}</div>
              <div>{{ h.speed }}</div>
            </li>
          </ul>
        </div>

        <div v-if="meta.results?.length">
          <div class="caps mb-1 text-label">Historical record</div>
          <ul class="space-y-1 text-small text-dim">
            <li v-for="r in meta.results" :key="`${r.date}-${r.where}`">
              <span class="num">{{ r.date }}</span> ·
              <span class="font-medium text-text">{{ r.where }}</span> — {{ r.result }}
            </li>
          </ul>
        </div>

        <div v-if="meta.ratings?.length">
          <div class="caps mb-1 text-label">Calibrated ratings</div>
          <ul class="space-y-1 text-small text-dim">
            <li v-for="rt in meta.ratings" :key="rt.label">
              <span class="num font-medium text-text">{{ rt.label }}</span>:
              <span class="num text-text">{{ rt.elo }} ± {{ rt.error }}</span>
              <span class="text-faint"> ({{ rt.protocol }})</span>
            </li>
          </ul>
        </div>
      </div>

      <div v-if="meta.features.length > 0" class="overflow-x-auto rounded border border-row">
        <table class="w-full border-collapse text-dense">
          <thead>
            <tr class="text-left text-small text-dim">
              <th class="th">feature (CPW)</th>
              <th class="th">area</th>
              <th class="th">implementation</th>
              <th v-if="meta.kind === 'release'" class="th text-right">ref</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="f in meta.features" :key="f.key" class="border-b border-row last:border-0">
              <td class="px-2 py-1.5 whitespace-nowrap">
                <a
                  :href="cpwUrl(f.key)"
                  target="_blank"
                  rel="noopener"
                  class="text-accent hover:underline"
                  >{{ f.label }}</a
                >
                <span v-if="f.landmark" class="tag tone-good ml-1.5">early</span>
              </td>
              <td class="num px-2 py-1.5 whitespace-nowrap text-dim">{{ f.group }}</td>
              <td class="px-2 py-1.5 text-dim">{{ f.implementation }}</td>
              <td
                v-if="meta.kind === 'release'"
                class="num px-2 py-1.5 text-right whitespace-nowrap text-faint"
              >
                {{ f.ref ?? '—' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div
        v-if="meta.fidelity"
        class="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 border-t border-row pt-2 text-small text-dim"
      >
        <span>
          <span class="font-medium text-text">Reference:</span> {{ meta.fidelity.referenceOf }}
        </span>
        <span v-if="meta.fidelity.games">
          <span class="font-medium text-text">Games:</span> {{ meta.fidelity.games }}
        </span>
        <span v-if="meta.fidelity.notes">
          <span class="font-medium text-text">Notes:</span> {{ meta.fidelity.notes }}
        </span>
      </div>

      <div
        v-if="meta.credits?.length"
        class="mt-2 flex flex-wrap gap-x-2 gap-y-1 border-t border-row pt-2 text-small text-dim"
      >
        <span class="font-medium text-text">Preservation &amp; tooling credits:</span>
        <template v-for="(c, idx) in meta.credits" :key="c.name">
          <span v-if="idx > 0">·</span>
          <span>
            <a
              v-if="c.url"
              :href="c.url"
              target="_blank"
              rel="noopener"
              class="text-accent hover:underline"
              >{{ c.name }}</a
            >
            <span v-else>{{ c.name }}</span>
            ({{ c.role }})
          </span>
        </template>
      </div>
    </div>
  </Panel>
</template>
