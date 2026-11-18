<script setup lang="ts">
/** A line above every page while the mirror folder needs the user: leave to write, or a review. */
import { useRoute, useRouter } from 'vue-router';
import { useBackup } from '../stores/backup.ts';

const backup = useBackup();
const route = useRoute();
const router = useRouter();

async function review(): Promise<void> {
  backup.openFolderReview();
  await router.push('/settings');
}
</script>

<template>
  <div
    v-if="backup.attention && route.path !== '/settings'"
    class="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-warn-line bg-panel px-3 py-1.5 text-dense"
  >
    <span class="size-[7px] shrink-0 rounded-full bg-warn" aria-label="warning" />
    <span class="text-dim">mirror folder</span>
    <span class="num">{{ backup.mirror.folder }}</span>
    <template v-if="backup.mirror.state === 'allow'">
      <span>is not copied to until you allow it again</span>
      <button class="btn-sm" @click="backup.allowFolder()">Allow</button>
    </template>
    <template v-else-if="backup.mirror.state === 'review'">
      <span>differs from this browser</span>
      <button class="btn-sm" @click="review()">Review ›</button>
    </template>
    <template v-else>
      <span class="text-bad">{{ backup.mirror.error }}</span>
      <button class="btn-sm" @click="backup.check()">Retry</button>
    </template>
  </div>
</template>
