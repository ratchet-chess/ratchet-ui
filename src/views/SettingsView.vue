<script setup lang="ts">
import { onMounted, ref } from 'vue';
import Panel from '../components/Panel.vue';
import { inputMode } from '../engine/uci.ts';
import { useSettings } from '../stores/settings.ts';

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

const threads = navigator.hardwareConcurrency;
const mode = inputMode();

function disconnect(): void {
  settings.managerUrl = '';
  draft.value = '';
}

const mb = (bytes: number | null) =>
  bytes === null
    ? '—'
    : bytes >= 1e9
      ? `${(bytes / 1e9).toFixed(1)} GB`
      : `${(bytes / 1e6).toFixed(1)} MB`;

onMounted(() => void readStorage());
</script>

<template>
  <h1 class="mb-2.5 text-[15px] font-semibold">Settings</h1>

  <Panel title="Manager" note="a ratchet-bench manager on this network; read only">
    <form
      class="flex flex-wrap items-center gap-2 px-3 py-2.5"
      @submit.prevent="settings.managerUrl = draft.trim()"
    >
      <input
        v-model="draft"
        placeholder="http://host:port"
        class="num w-72 rounded border border-line bg-panel2 px-2 py-1 text-[13px] outline-none focus:border-accent"
      />
      <button class="rounded border border-line bg-panel2 px-2.5 py-1 text-xs">Save</button>
      <button
        v-if="settings.managerUrl"
        type="button"
        class="rounded border border-line bg-panel2 px-2.5 py-1 text-xs"
        @click="disconnect"
      >
        Disconnect
      </button>
    </form>
  </Panel>

  <Panel title="Storage in this browser">
    <div class="grid grid-cols-[max-content_1fr] gap-x-3.5 gap-y-1 px-3 py-2.5 text-[13px]">
      <span class="text-dim">used</span><span class="num">{{ mb(used) }} of {{ mb(quota) }}</span>
      <span class="text-dim">persistent</span>
      <span>
        <template v-if="persisted"
          >yes <span class="text-dim">· the browser will not clear it</span></template
        >
        <template v-else>
          no
          <button
            class="ml-2 rounded border border-line bg-panel2 px-2 py-0.5 text-xs"
            @click="askPersist"
          >
            Ask
          </button>
        </template>
      </span>
    </div>
  </Panel>

  <Panel title="This browser">
    <div class="grid grid-cols-[max-content_1fr] gap-x-3.5 gap-y-1 px-3 py-2.5 text-[13px]">
      <span class="text-dim">engine input</span><span class="num">{{ mode }}</span>
      <span class="text-dim">hardware threads</span><span class="num">{{ threads }}</span>
    </div>
  </Panel>
</template>
