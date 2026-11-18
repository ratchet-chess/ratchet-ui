<script setup lang="ts">
/** Pages of a long list: back, where, on. The page counts from 0; nothing shows for one page. */
defineProps<{ pages: number }>();
const model = defineModel<number>({ required: true });
</script>

<template>
  <div v-if="pages > 1" class="flex items-center gap-2">
    <button class="btn-sm" :disabled="model <= 0" aria-label="previous page" @click="model--">
      ‹
    </button>
    <span class="num text-small text-dim">{{ model + 1 }} of {{ pages }}</span>
    <button class="btn-sm" :disabled="model >= pages - 1" aria-label="next page" @click="model++">
      ›
    </button>
  </div>
</template>
