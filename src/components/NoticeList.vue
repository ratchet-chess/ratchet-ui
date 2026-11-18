<script setup lang="ts">
/** Notices of what wants a look: a dot for how bad, where (a link when it has a page), and what. */
defineProps<{
  notices: readonly { severity: 'bad' | 'warn'; where: string; to?: string; text: string }[];
}>();
</script>

<template>
  <div class="px-3 py-1">
    <div
      v-for="(n, k) in notices"
      :key="k"
      class="flex items-baseline gap-2 border-b border-row py-1 text-dense last:border-0"
    >
      <span
        class="size-[7px] shrink-0 -translate-y-px rounded-full"
        :class="n.severity === 'bad' ? 'bg-bad' : 'bg-warn'"
        :aria-label="n.severity === 'bad' ? 'problem' : 'warning'"
      />
      <RouterLink
        v-if="n.to"
        :to="n.to"
        class="max-w-[40%] shrink-0 truncate text-dim hover:text-text"
        >{{ n.where }}</RouterLink
      >
      <span v-else class="shrink-0 text-dim">{{ n.where }}</span>
      <span class="min-w-0">{{ n.text }}</span>
    </div>
  </div>
</template>
