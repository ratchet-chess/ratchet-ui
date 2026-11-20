<script setup lang="ts">
import { computed } from 'vue';
import { sections } from '../sections.ts';
import { useManager } from '../stores/manager.ts';

const manager = useManager();
/** the manager's dot and word: green while its reads arrive, red when the last one failed */
const dot = computed(() =>
  manager.link === 'connected' ? 'bg-good' : manager.link === 'unreachable' ? 'bg-bad' : 'bg-faint',
);
const word = computed(() =>
  manager.link === 'none'
    ? 'no manager'
    : manager.link === 'unreachable'
      ? 'manager lost'
      : 'manager',
);
</script>

<!-- The app's sections: a row on top in a narrow window, a column at the side in a wide one. -->
<template>
  <nav
    class="flex items-center gap-0.5 border-b border-line bg-bar px-2 py-1 wide:flex-col wide:items-stretch wide:gap-1 wide:border-r wide:border-b-0 wide:px-1.5 wide:py-2.5"
  >
    <span class="mr-2 text-dense font-bold wide:mr-0 wide:mb-2.5 wide:text-center wide:text-dense">
      Ratchet
    </span>
    <div class="flex gap-0.5 wide:flex-col wide:gap-1">
      <RouterLink
        v-for="s in sections"
        :key="s.path"
        :to="s.path"
        :title="s.label"
        class="relative flex flex-col items-center gap-px rounded-md px-1.5 py-1 text-label text-dim hover:bg-hover hover:text-text wide:px-0.5 wide:pt-1.5 wide:pb-1"
        active-class="!bg-active !text-text"
      >
        <component :is="s.icon" :size="20" :stroke-width="1.7" />
        <span class="hidden wide:block">{{ s.label }}</span>
      </RouterLink>
    </div>
    <span class="flex-1" />
    <div
      class="flex items-center gap-2.5 text-small whitespace-nowrap text-dim wide:flex-col wide:gap-1.5 wide:text-center wide:text-label wide:whitespace-normal"
    >
      <RouterLink to="/settings" title="Settings › Manager">
        <span class="mr-1 inline-block size-[7px] rounded-full align-[1px]" :class="dot" />{{
          word
        }}
      </RouterLink>
    </div>
  </nav>
</template>
