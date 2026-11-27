<script setup lang="ts">
import { FolderOpen } from '@lucide/vue';
import { computed, onMounted, ref } from 'vue';
import HelpTip from '../components/HelpTip.vue';
import PageHeader from '../components/PageHeader.vue';
import Panel from '../components/Panel.vue';
import Segmented from '../components/Segmented.vue';
import { inputMode } from '../engine/uci.ts';
import { useBackup } from '../stores/backup.ts';
import { useBooks } from '../stores/books.ts';
import { useEngines } from '../stores/engines.ts';
import { RELOAD_MS, useManager } from '../stores/manager.ts';
import { useSettings } from '../stores/settings.ts';
import { bytes, whenText } from '../ui/format.ts';
import BackupReview from './settings/BackupReview.vue';
import DeviceSpeedPanel from './settings/DeviceSpeedPanel.vue';

const settings = useSettings();
const backup = useBackup();
const books = useBooks();
const engines = useEngines();
const manager = useManager();
const readClock = computed(() =>
  manager.readAt === null
    ? ''
    : new Date(manager.readAt).toLocaleTimeString('en-US', { hourCycle: 'h23' }),
);
const draft = ref(settings.managerUrl);

const THEMES = [
  { value: 'system', label: 'System', title: 'Match operating system theme' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
] as const;

const threads = navigator.hardwareConcurrency;
const mode = inputMode();

function disconnect(): void {
  settings.managerUrl = '';
  draft.value = '';
}

const archive = ref<HTMLInputElement | null>(null);
function picked(e: Event): void {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) void backup.importArchive(file);
  input.value = '';
}

const userBytes = computed(() => books.user.reduce((n, b) => n + b.bytes, 0));
const userEngineBytes = computed(() => engines.user.reduce((n, e) => n + e.bytes, 0));
const when = (ms: number | null) =>
  ms === null ? 'never' : whenText(new Date(ms).toISOString(), Date.now());

onMounted(() => {
  void backup.readStorage();
  void books.load();
  void engines.load();
});
</script>

<template>
  <PageHeader title="Settings" />

  <Panel title="Look">
    <div class="flex flex-wrap items-center gap-3 px-3 py-2.5 text-dense">
      <span class="text-dim">Theme</span>
      <Segmented v-model="settings.theme" :options="THEMES" />
    </div>
  </Panel>

  <Panel title="Manager" note="LAN ratchet-bench manager · read only">
    <form
      class="flex flex-wrap items-center gap-2 px-3 py-2.5"
      @submit.prevent="settings.managerUrl = draft.trim()"
    >
      <input v-model="draft" placeholder="http://host:port" class="field num w-72" />
      <button class="btn">Save</button>
      <button v-if="settings.managerUrl" type="button" class="btn" @click="disconnect">
        Disconnect
      </button>
    </form>
    <div v-if="manager.link !== 'none'" class="num border-t border-row px-3 py-1.5 text-dense">
      <template v-if="manager.link === 'connected'">
        <span class="text-good">Connected</span>
        <span class="text-dim"> · updated {{ readClock }} (every {{ RELOAD_MS / 1000 }} s)</span>
      </template>
      <template v-else-if="manager.link === 'reading'">
        <span class="text-dim">Connecting to {{ manager.url }}…</span>
      </template>
      <template v-else>
        <span class="text-bad">Not connected</span>
        <span class="text-dim"> · {{ manager.problem }}</span>
      </template>
    </div>
  </Panel>

  <Panel title="Browser storage">
    <div class="grid grid-cols-[max-content_1fr] gap-x-3.5 gap-y-1 px-3 py-2.5 text-dense">
      <span class="text-dim">Used</span>
      <span class="num">
        <template v-if="backup.usage">
          {{ bytes(backup.usage.used) }} of {{ bytes(backup.usage.quota) }}
        </template>
        <template v-else>—</template>
      </span>
      <span class="text-dim">Persistent</span>
      <span>
        <template v-if="backup.persisted">
          Yes <span class="text-dim">· protected from automatic eviction</span>
        </template>
        <template v-else>
          No <span class="text-dim">· browser may clear if low on space</span>
          <button class="btn-sm ml-2" @click="backup.askPersist()">Ask</button>
          <HelpTip>
            Chrome and Edge grant persistent storage to frequently used or installed sites; Firefox
            prompts you. Use Backup below to keep a copy either way.
          </HelpTip>
        </template>
      </span>
    </div>
  </Panel>

  <BackupReview v-if="backup.review" :review="backup.review" />

  <Panel title="Backup" note="excludes pulled books">
    <div
      class="grid grid-cols-[max-content_1fr] items-center gap-x-3.5 gap-y-2 px-3 py-2.5 text-dense"
    >
      <span class="text-dim">Archive</span>
      <span class="flex flex-wrap items-center gap-2">
        <button class="btn-sm" :disabled="backup.busy !== ''" @click="backup.exportAll()">
          Export
        </button>
        <input ref="archive" type="file" accept=".zip" class="hidden" @change="picked" />
        <button class="btn-sm" :disabled="backup.busy !== ''" @click="archive?.click()">
          Import…
        </button>
        <span class="text-dim">Last export: {{ when(backup.exportedAt) }}</span>
        <HelpTip>
          Zip archive containing tournaments, games, settings, local books, and in-browser engines.
          Import adds new items and prompts on conflicts.
        </HelpTip>
      </span>

      <span class="text-dim">Mirror folder</span>
      <span class="flex flex-wrap items-center gap-2">
        <template v-if="backup.mirror.state === 'unsupported'">
          <span class="text-dim">Auto-mirroring to a local folder requires Chrome or Edge</span>
        </template>
        <template v-else-if="backup.mirror.state === 'none'">
          <button class="btn-sm" @click="backup.chooseFolder()">
            <FolderOpen :size="13" /> Choose…
          </button>
          <span class="text-dim">Auto-syncs changes (use an empty folder)</span>
        </template>
        <template v-else>
          <span class="num">{{ backup.mirror.folder }}</span>
          <span v-if="backup.mirror.state === 'on'" class="text-good">
            Synced {{ when(backup.mirror.at) }}
          </span>
          <span v-else-if="backup.mirror.state === 'checking'" class="text-dim">Comparing…</span>
          <template v-else-if="backup.mirror.state === 'allow'">
            <span class="text-warn">Permission needed after reload</span>
            <button class="btn-sm" @click="backup.allowFolder()">Allow</button>
          </template>
          <template v-else-if="backup.mirror.state === 'review'">
            <span class="text-warn">Differs from browser storage</span>
            <button class="btn-sm" @click="backup.openFolderReview()">Review</button>
          </template>
          <template v-else-if="backup.mirror.state === 'failed'">
            <span class="text-bad">{{ backup.mirror.error }}</span>
            <button class="btn-sm" @click="backup.check()">Retry</button>
          </template>
          <button class="btn-sm" @click="backup.chooseFolder()">Change…</button>
          <button class="btn-sm" @click="backup.stopMirror()">Stop</button>
        </template>
      </span>

      <span class="text-dim">Local books</span>
      <label class="flex items-center gap-1.5">
        <input v-model="settings.backupBooks" type="checkbox" class="accent-accent" />
        Include in backup
        <span class="num text-dim">· {{ bytes(userBytes) }}</span>
      </label>

      <span class="text-dim">In-browser engines</span>
      <label class="flex items-center gap-1.5">
        <input v-model="settings.backupEngines" type="checkbox" class="accent-accent" />
        Include in backup
        <span class="num text-dim">· {{ bytes(userEngineBytes) }}</span>
      </label>
    </div>
    <p
      v-if="backup.note || backup.busy"
      class="border-t border-row px-3 py-1.5 text-dense"
      :class="backup.failed ? 'text-bad' : 'text-dim'"
    >
      {{ backup.busy || backup.note }}
    </p>
  </Panel>

  <DeviceSpeedPanel />

  <Panel title="Browser">
    <div class="grid grid-cols-[max-content_1fr] gap-x-3.5 gap-y-1 px-3 py-2.5 text-dense">
      <span class="text-dim">Engine input</span><span class="num">{{ mode }}</span>
      <span class="text-dim">Hardware threads</span><span class="num">{{ threads }}</span>
    </div>
  </Panel>
</template>
