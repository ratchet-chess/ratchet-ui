<script setup lang="ts">
/** Pages of a long list: back, where, on, and optional page jump. The page counts from 0. */
import { count } from '../ui/format.ts';

const props = defineProps<{ pages: number; jump?: boolean }>();
const model = defineModel<number>({ required: true });

function onJump(e: Event): void {
  const input = e.target as HTMLInputElement;
  const n = Number.parseInt(input.value, 10);
  if (Number.isFinite(n)) {
    model.value = Math.min(props.pages - 1, Math.max(0, n - 1));
  }
  input.value = String(model.value + 1);
}
</script>

<template>
  <div v-if="pages > 1" class="flex items-center gap-1.5">
    <button class="btn-sm" :disabled="model <= 0" aria-label="previous page" @click="model--">
      ‹
    </button>
    <template v-if="jump && pages > 5">
      <input
        type="number"
        min="1"
        :max="pages"
        :value="model + 1"
        aria-label="page number"
        class="field-sm no-spin num h-6 w-14 px-1.5 text-right text-small"
        @change="onJump"
      />
      <span class="num text-small text-dim">of {{ count(pages) }}</span>
    </template>
    <span v-else class="num text-small text-dim">{{ count(model + 1) }} of {{ count(pages) }}</span>
    <button class="btn-sm" :disabled="model >= pages - 1" aria-label="next page" @click="model++">
      ›
    </button>
  </div>
</template>
