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
import { useSettings } from '../stores/settings.ts';
import { bytes, whenText } from '../ui/format.ts';
import BackupReview from './settings/BackupReview.vue';

const settings = useSettings();
const backup = useBackup();
const books = useBooks();
const draft = ref(settings.managerUrl);

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

const archive = ref<HTMLInputElement | null>(null);
function picked(e: Event): void {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) void backup.importArchive(file);
  input.value = '';
}

const userBytes = computed(() => books.user.reduce((n, b) => n + b.bytes, 0));
const when = (ms: number | null) =>
  ms === null ? 'never' : whenText(new Date(ms).toISOString(), Date.now());

onMounted(() => {
  void backup.readStorage();
  void books.load();
});
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
      <button class="btn">Save</button>
      <button v-if="settings.managerUrl" type="button" class="btn" @click="disconnect">
        Disconnect
      </button>
    </form>
  </Panel>

  <Panel title="Storage in this browser">
    <div class="grid grid-cols-[max-content_1fr] gap-x-3.5 gap-y-1 px-3 py-2.5 text-dense">
      <span class="text-dim">used</span>
      <span class="num">
        <template v-if="backup.usage">
          {{ bytes(backup.usage.used) }} of {{ bytes(backup.usage.quota) }}
        </template>
        <template v-else>—</template>
      </span>
      <span class="text-dim">persistent</span>
      <span>
        <template v-if="backup.persisted">
          yes <span class="text-dim">· the browser will not clear it to free space</span>
        </template>
        <template v-else>
          no <span class="text-dim">· the browser may clear it to free space</span>
          <button class="btn-sm ml-2" @click="backup.askPersist()">Ask</button>
          <HelpTip>
            Chrome and Edge grant it to a site in use often, or installed; Firefox asks you. A
            backup below keeps the data either way.
          </HelpTip>
        </template>
      </span>
    </div>
  </Panel>

  <BackupReview v-if="backup.review" :review="backup.review" />

  <Panel title="Backup" note="everything but pulled books, in this browser's own layout">
    <div
      class="grid grid-cols-[max-content_1fr] items-center gap-x-3.5 gap-y-2 px-3 py-2.5 text-dense"
    >
      <span class="text-dim">archive</span>
      <span class="flex flex-wrap items-center gap-2">
        <button class="btn-sm" :disabled="backup.busy !== ''" @click="backup.exportAll()">
          Export
        </button>
        <input ref="archive" type="file" accept=".zip" class="hidden" @change="picked" />
        <button class="btn-sm" :disabled="backup.busy !== ''" @click="archive?.click()">
          Import…
        </button>
        <span class="text-dim">last export {{ when(backup.exportedAt) }}</span>
        <HelpTip>
          One zip file of the tournaments, games, settings and your books. An import adds what is
          new and asks about each item both hold.
        </HelpTip>
      </span>

      <span class="text-dim">folder</span>
      <span class="flex flex-wrap items-center gap-2">
        <template v-if="backup.mirror.state === 'unsupported'">
          <span class="text-dim">Chrome and Edge can copy each change to a folder of yours</span>
        </template>
        <template v-else-if="backup.mirror.state === 'none'">
          <button class="btn-sm" @click="backup.chooseFolder()">
            <FolderOpen :size="13" /> Choose…
          </button>
          <span class="text-dim">each change is copied to it; best an empty one</span>
        </template>
        <template v-else>
          <span class="num">{{ backup.mirror.folder }}</span>
          <span v-if="backup.mirror.state === 'on'" class="text-good">
            copied {{ when(backup.mirror.at) }}
          </span>
          <span v-else-if="backup.mirror.state === 'checking'" class="text-dim">comparing…</span>
          <template v-else-if="backup.mirror.state === 'allow'">
            <span class="text-warn">the browser asks again after a reload</span>
            <button class="btn-sm" @click="backup.allowFolder()">Allow</button>
          </template>
          <template v-else-if="backup.mirror.state === 'review'">
            <span class="text-warn">differs from this browser</span>
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

      <span class="text-dim">your books</span>
      <label class="flex items-center gap-1.5">
        <input v-model="settings.backupBooks" type="checkbox" class="accent-accent" />
        in the backup
        <span class="num text-dim">· {{ bytes(userBytes) }}</span>
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

  <Panel title="This browser">
    <div class="grid grid-cols-[max-content_1fr] gap-x-3.5 gap-y-1 px-3 py-2.5 text-dense">
      <span class="text-dim">engine input</span><span class="num">{{ mode }}</span>
      <span class="text-dim">hardware threads</span><span class="num">{{ threads }}</span>
    </div>
  </Panel>
</template>
