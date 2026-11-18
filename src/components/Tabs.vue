<script setup lang="ts" generic="K extends string">
/** Tabs that filter a page, each with its count. */
import { count } from '../ui/format.ts';

defineProps<{ tabs: readonly { key: K; name: string; count?: number }[] }>();
const model = defineModel<K>({ required: true });
</script>

<template>
  <div class="mb-2.5 flex flex-wrap items-baseline gap-0.5" role="tablist">
    <button
      v-for="t in tabs"
      :key="t.key"
      role="tab"
      :aria-selected="model === t.key"
      class="rounded px-2.5 py-0.5 text-dense"
      :class="model === t.key ? 'bg-active text-text' : 'text-dim hover:text-text'"
      @click="model = t.key"
    >
      {{ t.name
      }}<span v-if="t.count !== undefined" class="num ml-1 text-small text-faint">{{
        count(t.count)
      }}</span>
    </button>
  </div>
</template>
