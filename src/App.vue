<script setup lang="ts">
import IconBar from './components/IconBar.vue';
import { useTheme } from './ui/theme.ts';

useTheme();
</script>

<template>
  <div class="grid h-dvh grid-rows-[auto_1fr] wide:grid-cols-[76px_1fr] wide:grid-rows-1">
    <IconBar />
    <main class="min-h-0 overflow-auto px-3.5 pt-3 pb-8 wide:px-5 wide:pt-4">
      <RouterView />
    </main>
  </div>
</template>
