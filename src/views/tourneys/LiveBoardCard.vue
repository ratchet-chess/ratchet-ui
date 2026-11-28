<script setup lang="ts">
/** One live game tile in the Tourneys Live mosaic: clocks, time bars, view-only board, and optional details. */
import type { Key } from 'chessground/types';
import type { Color } from 'chessops/types';
import { computed } from 'vue';
import Board from '../../components/Board.vue';
import type { LiveSnapshot } from '../../match/runner.ts';
import { thousands } from '../../ui/format.ts';
import { formatSideScore, isLowClock, liveClockText, timeShare } from './live.ts';

const props = defineProps<{
  snapshot: LiveSnapshot;
  gameNo: number;
  whiteName: string;
  blackName: string;
  selected: boolean;
  details: boolean;
}>();

const emit = defineEmits<{ select: [key: string] }>();

const activeSide = computed(() => (props.snapshot.outcome ? null : props.snapshot.turn));

const activeSearch = computed(() => {
  const s = props.snapshot.search[props.snapshot.turn];
  if (s) return { color: props.snapshot.turn, search: s };
  const other: Color = props.snapshot.turn === 'white' ? 'black' : 'white';
  const o = props.snapshot.search[other];
  return o ? { color: other, search: o } : null;
});

function sideRight(color: 'white' | 'black'): string {
  const clk = props.snapshot.clock;
  if (clk) return liveClockText(clk[color]);
  const s = props.snapshot.search[color];
  if (!s) return '—';
  const parts: string[] = [];
  if (s.depth !== undefined) parts.push(`d${s.depth}`);
  if (s.nodes !== undefined) parts.push(thousands(s.nodes));
  return parts.join(' · ') || '—';
}

function low(color: 'white' | 'black'): boolean {
  const clk = props.snapshot.clock;
  return clk ? isLowClock(clk[color], clk.baseMs) : false;
}

function barWidth(color: 'white' | 'black'): string {
  const clk = props.snapshot.clock;
  return clk ? `${timeShare(clk[color], clk.baseMs)}%` : '0%';
}
</script>

<template>
  <div
    role="button"
    tabindex="0"
    class="flex cursor-pointer flex-col overflow-hidden rounded-md border bg-panel transition-colors"
    :class="
      selected
        ? 'border-accent ring-1 ring-accent-line'
        : snapshot.outcome
          ? 'border-good-line'
          : 'border-line hover:border-line-strong'
    "
    @click="emit('select', snapshot.key)"
    @keydown.enter.prevent="emit('select', snapshot.key)"
    @keydown.space.prevent="emit('select', snapshot.key)"
  >
    <!-- Black (top) -->
    <div
      class="flex items-center justify-between gap-1.5 bg-panel2 px-2 py-1 text-small"
      :class="activeSide === 'black' ? 'font-semibold text-text' : 'text-dim'"
    >
      <span class="flex min-w-0 items-center gap-1.5">
        <span class="inline-block size-2 shrink-0 rounded-full border border-dim bg-black" />
        <span class="truncate" :title="blackName">{{ blackName }}</span>
      </span>
      <span class="num shrink-0" :class="low('black') ? 'font-semibold text-warn' : ''">
        {{ sideRight('black') }}
      </span>
    </div>
    <div v-if="snapshot.clock" class="h-0.5 w-full bg-track">
      <div
        class="h-full"
        :class="low('black') ? 'bg-warn' : activeSide === 'black' ? 'bg-accent' : 'bg-dim'"
        :style="{ width: barWidth('black') }"
      />
    </div>

    <!-- Board -->
    <div class="relative">
      <Board
        :fen="snapshot.fen"
        orientation="white"
        :turn="snapshot.turn"
        :last-move="snapshot.lastMove as [Key, Key] | undefined"
        :check="snapshot.check"
        view-only
        :coordinates="false"
        :animated="false"
      />
      <div
        v-if="snapshot.outcome"
        class="absolute inset-x-1.5 bottom-1.5 flex items-center justify-between gap-2 rounded border border-line-strong bg-popover/90 px-2 py-1 text-small"
      >
        <span class="num font-semibold text-text">{{ snapshot.outcome.result }}</span>
        <span class="truncate text-dim">{{ snapshot.outcome.reason }}</span>
      </div>
    </div>

    <!-- White (bottom) -->
    <div v-if="snapshot.clock" class="h-0.5 w-full bg-track">
      <div
        class="h-full"
        :class="low('white') ? 'bg-warn' : activeSide === 'white' ? 'bg-accent' : 'bg-dim'"
        :style="{ width: barWidth('white') }"
      />
    </div>
    <div
      class="flex items-center justify-between gap-1.5 bg-panel2 px-2 py-1 text-small"
      :class="activeSide === 'white' ? 'font-semibold text-text' : 'text-dim'"
    >
      <span class="flex min-w-0 items-center gap-1.5">
        <span class="inline-block size-2 shrink-0 rounded-full border border-dim bg-white" />
        <span class="truncate" :title="whiteName">{{ whiteName }}</span>
      </span>
      <span class="num shrink-0" :class="low('white') ? 'font-semibold text-warn' : ''">
        {{ sideRight('white') }}
      </span>
    </div>

    <!-- Optional details footer -->
    <div
      v-if="details"
      class="num flex items-center justify-between gap-1.5 border-t border-row bg-panel px-2 py-0.5 text-label text-dim"
    >
      <span class="shrink-0 whitespace-nowrap">#{{ gameNo }} · {{ snapshot.plies }}p</span>
      <span v-if="activeSearch" class="truncate">
        {{ formatSideScore(activeSearch.search, activeSearch.color) || '—' }}
        <template v-if="activeSearch.search.depth !== undefined">
          · d{{ activeSearch.search.depth }}
        </template>
        <template v-if="activeSearch.search.nps !== undefined">
          · {{ thousands(activeSearch.search.nps) }}n/s
        </template>
      </span>
      <span v-else class="text-faint">starting…</span>
    </div>
  </div>
</template>
