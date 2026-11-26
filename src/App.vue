<script setup lang="ts">
import { onMounted } from 'vue';
import BackupBar from './components/BackupBar.vue';
import IconBar from './components/IconBar.vue';
import { useBackup } from './stores/backup.ts';
import { useBooks } from './stores/books.ts';
import { useTournaments } from './stores/tournaments.ts';
import { useTheme } from './ui/theme.ts';

useTheme();
const backup = useBackup();
const tournaments = useTournaments();
const books = useBooks();
onMounted(() => {
  void backup.start();
  // the bar's Tourneys badge reads the tournaments before Tourneys is opened
  void Promise.all([tournaments.load(), books.load()]);
});
</script>

<template>
  <div class="grid h-dvh grid-rows-[auto_1fr] wide:grid-cols-[76px_1fr] wide:grid-rows-1">
    <IconBar />
    <main class="min-h-0 overflow-auto px-3.5 pt-3 pb-8 wide:px-5 wide:pt-4">
      <BackupBar />
      <RouterView />
    </main>
  </div>
</template>
