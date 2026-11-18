<script setup lang="ts">
import type { Key } from 'chessground/types';
import type { Color } from 'chessops/types';
import type { Game as PgnGame, PgnNodeData } from 'chessops/pgn';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, FlipVertical2 } from '@lucide/vue';
import { replay } from '../games/pgn.ts';
import Board from './Board.vue';
import Panel from './Panel.vue';

/** Steps through one game's main line on a board that takes no moves. */
const props = defineProps<{ game: PgnGame<PgnNodeData> }>();

const rp = computed(() => replay(props.game));
/** the shown position: 0 is the start, n is after the n-th half-move */
const ply = ref(0);
watch(
  () => props.game,
  () => (ply.value = rp.value.steps.length - 1),
  { immediate: true },
);

const last = computed(() => Math.max(0, rp.value.steps.length - 1));
const step = computed(() => rp.value.steps[ply.value]);
const orientation = ref<Color>('white');
const turn = computed<Color>(() => (step.value?.fen.split(' ')[1] === 'b' ? 'black' : 'white'));
const noDests = new Map<Key, Key[]>();

const go = (n: number) => (ply.value = Math.min(last.value, Math.max(0, n)));

function onKey(e: KeyboardEvent): void {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  const to: Record<string, number> = {
    ArrowLeft: ply.value - 1,
    ArrowRight: ply.value + 1,
    Home: 0,
    End: last.value,
  };
  const n = to[e.key];
  if (n === undefined) return;
  e.preventDefault();
  go(n);
}
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));

/** the half-moves as numbered pairs, each with its place in the replay */
const rows = computed(() => {
  const steps = rp.value.steps;
  const blackFirst = steps[0]?.fen.split(' ')[1] === 'b';
  const firstNumber = Number(steps[0]?.fen.split(' ')[5] ?? 1);
  const out: { n: number; white: number | null; black: number | null }[] = [];
  let i = 1;
  if (blackFirst && steps.length > 1) {
    out.push({ n: firstNumber, white: null, black: 1 });
    i = 2;
  }
  for (; i < steps.length; i += 2) {
    out.push({ n: firstNumber + out.length, white: i, black: i + 1 < steps.length ? i + 1 : null });
  }
  return out;
});

const tag = (k: string) => props.game.headers.get(k) ?? '?';
const TAGS = ['Event', 'Site', 'Date', 'Round', 'TimeControl', 'Termination'];
const buttonClass = 'rounded border border-line bg-panel2 px-3 py-1.5 disabled:text-faint';
</script>

<template>
  <div class="grid gap-3.5 wide:grid-cols-[minmax(0,520px)_minmax(240px,1fr)]">
    <div class="max-w-[520px]">
      <div class="mb-1.5 flex items-baseline justify-between gap-2 text-[13px]">
        <span class="truncate">
          <span class="font-semibold">{{ tag('White') }}</span>
          <span class="text-dim"> vs </span>
          <span class="font-semibold">{{ tag('Black') }}</span>
        </span>
        <span class="num">{{ tag('Result') }}</span>
      </div>
      <Board
        :fen="step?.fen ?? ''"
        :orientation="orientation"
        :turn="turn"
        :dests="noDests"
        :movable="undefined"
        :last-move="step?.lastMove as [Key, Key] | undefined"
        :check="step?.check ?? false"
      />
      <div class="mt-1.5 flex gap-1.5">
        <button :class="buttonClass" :disabled="ply === 0" title="Home" @click="go(0)">
          <ChevronFirst :size="16" />
        </button>
        <button :class="buttonClass" :disabled="ply === 0" title="←" @click="go(ply - 1)">
          <ChevronLeft :size="16" />
        </button>
        <button :class="buttonClass" :disabled="ply === last" title="→" @click="go(ply + 1)">
          <ChevronRight :size="16" />
        </button>
        <button :class="buttonClass" :disabled="ply === last" title="End" @click="go(last)">
          <ChevronLast :size="16" />
        </button>
        <button
          :class="buttonClass"
          title="Flip"
          @click="orientation = orientation === 'white' ? 'black' : 'white'"
        >
          <FlipVertical2 :size="16" />
        </button>
      </div>
      <div v-if="step && step.comments.length > 0" class="num mt-1.5 text-[12px] text-dim">
        {{ step.comments.join(' ') }}
      </div>
    </div>

    <div>
      <Panel title="Moves">
        <div class="num max-h-96 overflow-auto px-3 py-2 text-[12.5px]">
          <div v-for="r in rows" :key="r.n" class="grid grid-cols-[2.5rem_1fr_1fr]">
            <span class="text-faint">{{ r.n }}.</span>
            <template v-for="i in [r.white, r.black]" :key="String(i)">
              <button
                v-if="i !== null"
                class="w-fit rounded px-1 text-left hover:bg-[#232b35]"
                :class="i === ply ? 'bg-[#2c4a66] text-text' : ''"
                @click="go(i)"
              >
                {{ rp.steps[i]?.san }}
              </button>
              <span v-else class="px-1 text-faint">…</span>
            </template>
          </div>
          <div v-if="rows.length === 0" class="text-faint">no moves</div>
          <div v-if="rp.error" class="mt-1 text-bad">{{ rp.error }}</div>
        </div>
      </Panel>
      <Panel title="Tags">
        <div class="grid grid-cols-[max-content_1fr] gap-x-3 px-3 py-2 text-[12.5px]">
          <template v-for="k in TAGS" :key="k">
            <span class="text-dim">{{ k }}</span><span class="num">{{ tag(k) }}</span>
          </template>
        </div>
      </Panel>
    </div>
  </div>
</template>
