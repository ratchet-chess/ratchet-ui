<script setup lang="ts">
/**
 * Focused live chessboard with player/clock bars, PV arrows, ply navigation, board flip, and
 * finished-game result overlay. Shared between B1 wide (One game or inline panel) and B2 narrow.
 */
import {
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
  FlipVertical2,
  Pin,
} from '@lucide/vue';
import type { Key } from 'chessground/types';
import type { Color } from 'chessops/types';
import { opposite } from 'chessops/util';
import { computed } from 'vue';
import Board from '../../components/Board.vue';
import type { LiveSnapshot } from '../../match/runner.ts';
import { isLowClock, liveClockText, pvShapes, uciMoveAt } from './live.ts';

const props = withDefaults(
  defineProps<{
    snapshot: LiveSnapshot;
    whiteName: string;
    blackName: string;
    controlLabel: string;
    /** null follows the live ply; a number inspects an earlier ply */
    viewingPly: number | null;
    orientation: Color;
    showPvArrows: boolean;
    pinned: boolean;
    hasOtherLive: boolean;
    /** compact bar sizing for the inline B1 inspector board */
    compact?: boolean;
    /** show PV-arrows / Pin controls in the bottom bar (omitted when the parent header already has them) */
    showToggles?: boolean;
  }>(),
  { compact: false, showToggles: true },
);

const emit = defineEmits<{
  'update:viewingPly': [ply: number | null];
  'update:orientation': [color: Color];
  'update:showPvArrows': [value: boolean];
  'update:pinned': [value: boolean];
  'next-live': [];
}>();

const totalPlies = computed(() => props.snapshot.full?.san.length ?? props.snapshot.plies);
const activePly = computed(() =>
  props.viewingPly === null ? totalPlies.value : Math.min(totalPlies.value, props.viewingPly),
);
const viewingLive = computed(
  () => props.viewingPly === null || activePly.value >= totalPlies.value,
);

function goTo(ply: number): void {
  const clamped = Math.max(0, Math.min(totalPlies.value, ply));
  emit('update:viewingPly', clamped >= totalPlies.value ? null : clamped);
}

const boardFen = computed(() => {
  const fens = props.snapshot.full?.fens;
  if (fens && fens[activePly.value]) return fens[activePly.value] ?? props.snapshot.fen;
  return props.snapshot.fen;
});

const boardTurn = computed<Color>(() => (boardFen.value.split(' ')[1] === 'b' ? 'black' : 'white'));

const boardLastMove = computed<[Key, Key] | undefined>(() => {
  if (viewingLive.value) return props.snapshot.lastMove as [Key, Key] | undefined;
  const uci = props.snapshot.full?.uci;
  return uci ? uciMoveAt(uci, activePly.value) : undefined;
});

const shapes = computed(() => pvShapes(props.snapshot, props.showPvArrows, viewingLive.value));

const sides = computed(() => {
  const bottom = props.orientation;
  return { top: opposite(bottom), bottom };
});

const names = computed<Record<Color, string>>(() => ({
  white: props.whiteName,
  black: props.blackName,
}));
</script>

<template>
  <div class="min-w-0">
    <!-- Top player bar -->
    <div
      class="flex items-center justify-between gap-2 rounded-md border bg-panel2"
      :class="[
        compact ? 'mb-1 px-2 py-1 text-small' : 'mb-1.5 px-2.5 py-1.5',
        !snapshot.outcome && snapshot.turn === sides.top ? 'border-accent' : 'border-line',
      ]"
    >
      <span class="flex min-w-0 items-center gap-1.5">
        <span
          class="inline-block shrink-0 rounded-full border border-dim"
          :class="[
            compact ? 'size-2' : 'size-2.5',
            sides.top === 'white' ? 'bg-white' : 'bg-black',
          ]"
        />
        <span class="truncate font-semibold" :title="names[sides.top]">{{ names[sides.top] }}</span>
      </span>
      <span
        v-if="snapshot.clock"
        class="num shrink-0"
        :class="[
          compact ? '' : 'text-stat',
          isLowClock(snapshot.clock[sides.top], snapshot.clock.baseMs)
            ? 'font-semibold text-warn'
            : '',
        ]"
      >
        {{ liveClockText(snapshot.clock[sides.top]) }}
      </span>
      <span v-else-if="!compact" class="tag tone-dim shrink-0">{{ controlLabel }}</span>
    </div>

    <!-- Board with PV arrows and finished overlay -->
    <div class="relative overflow-hidden rounded border border-line">
      <Board
        :fen="boardFen"
        :orientation="orientation"
        :turn="boardTurn"
        :last-move="boardLastMove"
        :check="viewingLive ? snapshot.check : false"
        view-only
        :animated="false"
        :shapes="shapes"
      />
      <div
        v-if="snapshot.outcome"
        class="absolute inset-x-1.5 bottom-1.5 flex items-center justify-between gap-2 rounded border border-line-strong bg-popover/90 px-2 py-1 text-small"
      >
        <span class="min-w-0 truncate">
          <span class="num mr-1.5 font-semibold text-text">{{ snapshot.outcome.result }}</span>
          <span class="text-dim">{{ snapshot.outcome.reason }}</span>
        </span>
        <button
          v-if="hasOtherLive"
          type="button"
          class="btn-sm shrink-0"
          @click="emit('next-live')"
        >
          Next live
        </button>
      </div>
    </div>

    <!-- Bottom player bar -->
    <div
      class="flex items-center justify-between gap-2 rounded-md border bg-panel2"
      :class="[
        compact ? 'mt-1 px-2 py-1 text-small' : 'mt-1.5 px-2.5 py-1.5',
        !snapshot.outcome && snapshot.turn === sides.bottom ? 'border-accent' : 'border-line',
      ]"
    >
      <span class="flex min-w-0 items-center gap-1.5">
        <span
          class="inline-block shrink-0 rounded-full border border-dim"
          :class="[
            compact ? 'size-2' : 'size-2.5',
            sides.bottom === 'white' ? 'bg-white' : 'bg-black',
          ]"
        />
        <span class="truncate font-semibold" :title="names[sides.bottom]">{{
          names[sides.bottom]
        }}</span>
      </span>
      <span
        v-if="snapshot.clock"
        class="num shrink-0"
        :class="[
          compact ? '' : 'text-stat',
          isLowClock(snapshot.clock[sides.bottom], snapshot.clock.baseMs)
            ? 'font-semibold text-warn'
            : '',
        ]"
      >
        {{ liveClockText(snapshot.clock[sides.bottom]) }}
      </span>
      <span v-else-if="!compact" class="tag tone-dim shrink-0">{{ controlLabel }}</span>
    </div>

    <!-- Navigation & flip controls -->
    <div class="mt-1.5 flex flex-wrap items-center justify-between gap-1.5">
      <div class="flex items-center gap-1">
        <button
          v-if="!compact"
          type="button"
          class="btn-sm px-1.5"
          :disabled="activePly === 0"
          title="Start"
          @click="goTo(0)"
        >
          <ChevronFirst :size="13" />
        </button>
        <button
          type="button"
          class="btn-sm px-1.5"
          :disabled="activePly === 0"
          title="Previous move"
          @click="goTo(activePly - 1)"
        >
          <ChevronLeft :size="13" />
        </button>
        <button
          type="button"
          class="btn-sm px-1.5"
          :disabled="viewingLive"
          title="Next move"
          @click="goTo(activePly + 1)"
        >
          <ChevronRight :size="13" />
        </button>
        <button
          type="button"
          class="btn-sm px-1.5"
          :disabled="viewingLive"
          title="Back to live position"
          @click="goTo(totalPlies)"
        >
          <ChevronLast v-if="!compact" :size="13" />
          <span v-else>Live</span>
        </button>
        <button
          type="button"
          class="btn-sm px-1.5"
          title="Flip board"
          @click="emit('update:orientation', opposite(orientation))"
        >
          <FlipVertical2 :size="13" />
        </button>
      </div>

      <div v-if="showToggles" class="flex items-center gap-2">
        <label class="flex cursor-pointer items-center gap-1 text-small text-dim select-none">
          <input
            :checked="showPvArrows"
            type="checkbox"
            class="accent-accent"
            @change="emit('update:showPvArrows', ($event.target as HTMLInputElement).checked)"
          />
          <span>PV arrows</span>
        </label>
        <button
          type="button"
          class="btn-sm"
          :class="pinned ? 'border-accent-line bg-chosen text-text' : ''"
          :title="
            pinned
              ? 'Pinned on this game; click to auto-follow the next live game when it ends'
              : 'Auto-following live games; click to pin this board when it ends'
          "
          @click="emit('update:pinned', !pinned)"
        >
          <Pin :size="12" />
          {{ pinned ? 'Pinned' : 'Auto-follow' }}
        </button>
      </div>
    </div>
  </div>
</template>
