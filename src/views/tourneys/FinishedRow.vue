<script setup lang="ts">
/** A finished tournament's row: its format, outcome, games, verdict and end; one line when wide. */
import type { Item } from '../../stores/tournaments.ts';
import { endedText, problemsLine, problemTotal, standingText } from './overview.ts';
import { count } from '../../ui/format.ts';
import { formatShort, statusClass, statusText } from './show.ts';

defineProps<{ item: Item; now: number }>();
</script>

<template>
  <RouterLink
    :to="`/tournaments/${item.config.id}`"
    class="grid grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-x-3 hover:bg-hover @4xl:grid-cols-(--finished-cols)"
  >
    <span class="col-start-1 row-start-1 truncate">{{ item.config.name }}</span>
    <span class="col-span-3 col-start-1 row-start-2 flex min-w-0 gap-2 @4xl:contents">
      <span class="num shrink-0 truncate text-small text-dim @4xl:col-start-2 @4xl:row-start-1"
        >{{ formatShort(item.config.format) }} · {{ item.config.control }}</span
      >
      <span
        class="num min-w-0 truncate text-small @4xl:col-start-3 @4xl:row-start-1 @4xl:text-dense"
        >{{ standingText(item)
        }}<span v-if="problemTotal(item.state.games) > 0" class="text-bad">
          · {{ problemsLine(item.state.games) }}</span
        ></span
      >
    </span>
    <span
      class="num hidden text-right text-dense text-dim @4xl:col-start-4 @4xl:row-start-1 @4xl:inline"
      >{{ count(item.state.games.length) }}</span
    >
    <span class="col-start-2 row-start-1 text-right @4xl:col-start-5"
      ><span class="tag" :class="statusClass(statusText(item))">{{ statusText(item) }}</span></span
    >
    <span class="num col-start-3 row-start-1 text-right text-small text-dim @4xl:col-start-6">{{
      endedText(item, now)
    }}</span>
  </RouterLink>
</template>
