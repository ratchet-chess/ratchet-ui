<script setup lang="ts">
import { onMounted, ref } from 'vue';
import PageHeader from '../components/PageHeader.vue';
import Panel from '../components/Panel.vue';
import Segmented from '../components/Segmented.vue';
import { inputMode } from '../engine/uci.ts';
import { useSettings } from '../stores/settings.ts';
import { bytes } from '../ui/format.ts';

const settings = useSettings();
const draft = ref(settings.managerUrl);

const used = ref<number | null>(null);
const quota = ref<number | null>(null);
const persisted = ref<boolean | null>(null);

async function readStorage(): Promise<void> {
  const est = await navigator.storage.estimate();
  used.value = est.usage ?? null;
  quota.value = est.quota ?? null;
  persisted.value = await navigator.storage.persisted();
}

async function askPersist(): Promise<void> {
  persisted.value = await navigator.storage.persist();
}

const THEMES = [
  { value: 'system', label: 'system', title: 'As this computer is set' },
  { value: 'light', label: 'light' },
  { value: 'dark', label: 'dark' },
] as const;

const threads = navigator.hardwareConcurrency;
const mode = inputMode();

function disconnect(): void {
  settings.managerUrl = '';
  draft.value = '';
}

const size = (b: number | null) => (b === null ? '—' : bytes(b));

onMounted(() => void readStorage());
</script>

<template>
  <PageHeader title="Settings">
    <RouterLink to="/style" class="text-dense text-accent hover:underline"
      >Style reference ›</RouterLink
    >
  </PageHeader>

  <Panel title="Look">
    <div class="flex flex-wrap items-center gap-3 px-3 py-2.5 text-dense">
      <span class="text-dim">theme</span>
      <Segmented v-model="settings.theme" :options="THEMES" />
    </div>
  </Panel>

  <Panel title="Manager" note="a ratchet-bench manager on this network; read only">
    <form
      class="flex flex-wrap items-center gap-2 px-3 py-2.5"
      @submit.prevent="settings.managerUrl = draft.trim()"
    >
      <input v-model="draft" placeholder="http://host:port" class="field num w-72" />
      <button class="rounded border border-line bg-panel2 px-2.5 py-1 text-dense">Save</button>
      <button
        v-if="settings.managerUrl"
        type="button"
        class="rounded border border-line bg-panel2 px-2.5 py-1 text-dense"
        @click="disconnect"
      >
        Disconnect
      </button>
    </form>
  </Panel>

  <Panel title="Storage in this browser">
    <div class="grid grid-cols-[max-content_1fr] gap-x-3.5 gap-y-1 px-3 py-2.5 text-dense">
      <span class="text-dim">used</span
      ><span class="num">{{ size(used) }} of {{ size(quota) }}</span>
      <span class="text-dim">persistent</span>
      <span>
        <template v-if="persisted"
          >yes <span class="text-dim">· the browser will not clear it</span></template
        >
        <template v-else>
          no
          <button
            class="ml-2 rounded border border-line bg-panel2 px-2 py-0.5 text-dense"
            @click="askPersist"
          >
            Ask
          </button>
        </template>
      </span>
    </div>
  </Panel>

  <Panel title="This browser">
    <div class="grid grid-cols-[max-content_1fr] gap-x-3.5 gap-y-1 px-3 py-2.5 text-dense">
      <span class="text-dim">engine input</span><span class="num">{{ mode }}</span>
      <span class="text-dim">hardware threads</span><span class="num">{{ threads }}</span>
    </div>
  </Panel>
</template>
