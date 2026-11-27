<script setup lang="ts">
import type { Key } from 'chessground/types';
import type { Color } from 'chessops/types';
import { makePgn, type Game as PgnGame, type PgnNodeData } from 'chessops/pgn';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  FlipVertical2,
} from '@lucide/vue';
import { findOpening } from '../chess/openings.ts';
import { extractGameEval, formatClock, formatEval, formatMoveTime } from '../games/eval.ts';
import { replay } from '../games/pgn.ts';
import { scrollChildIntoView } from '../ui/scroll.ts';
import Board from './Board.vue';
import EvalGraph from './EvalGraph.vue';
import Panel from './Panel.vue';

/**
 * Steps through one game's main line on a read-only board, showing its opening, formatted engine
 * evaluation and move time, evaluation graph with move-time strip, clickable moves, and PGN tags.
 */
const props = withDefaults(
  defineProps<{
    game: PgnGame<PgnNodeData>;
    /** original PGN text slice for verbatim Copy/Download; falls back to makePgn(game) */
    rawPgn?: string;
    /** starting ply on game open (defaults to 0, the game's start position) */
    initialPly?: number;
  }>(),
  { rawPgn: '', initialPly: 0 },
);

const rp = computed(() => replay(props.game));
const last = computed(() => Math.max(0, rp.value.steps.length - 1));
/** the shown position: 0 is the start, n is after the n-th half-move */
const ply = ref(0);
watch(
  () => [props.game, props.initialPly] as const,
  ([, init]) => {
    ply.value = Math.min(last.value, Math.max(0, init));
  },
  { immediate: true },
);

const step = computed(() => rp.value.steps[ply.value]);
const orientation = ref<Color>('white');
const turn = computed<Color>(() => (step.value?.fen.split(' ')[1] === 'b' ? 'black' : 'white'));
const noDests = new Map<Key, Key[]>();

const go = (n: number) => (ply.value = Math.min(last.value, Math.max(0, n)));
const flip = () => (orientation.value = orientation.value === 'white' ? 'black' : 'white');

const movesBox = ref<HTMLElement | null>(null);
watch(ply, async (p) => {
  await nextTick();
  const box = movesBox.value;
  if (!box) return;
  if (p === 0) {
    box.scrollTop = 0;
    return;
  }
  const el = box.querySelector<HTMLElement>(`[data-ply="${p}"]`);
  if (el) scrollChildIntoView(box, el);
});

function onKey(e: KeyboardEvent): void {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (
    e.target instanceof HTMLInputElement ||
    e.target instanceof HTMLSelectElement ||
    e.target instanceof HTMLTextAreaElement ||
    (e.target instanceof HTMLElement && e.target.isContentEditable)
  ) {
    return;
  }
  if (e.key === 'f' || e.key === 'F') {
    e.preventDefault();
    flip();
    return;
  }
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

const blackFirst = computed(() => rp.value.steps[0]?.fen.split(' ')[1] === 'b');
const firstNumber = computed(() => Number(rp.value.steps[0]?.fen.split(' ')[5] ?? 1));
const sans = computed(() => rp.value.steps.map((s) => s.san));

const gameEval = computed(() =>
  extractGameEval(rp.value.steps, props.game.headers.get('TimeControl')),
);
const activeEval = computed(() => (ply.value > 0 ? gameEval.value.points[ply.value - 1] : null));
const evalChipTone = computed(() => {
  const p = activeEval.value;
  if (!p) return 'tone-dim';
  if (p.mate !== undefined) return p.mate > 0 ? 'tone-good' : 'tone-bad';
  if (p.cp !== undefined) {
    if (p.cp >= 50) return 'tone-good';
    if (p.cp <= -50) return 'tone-bad';
  }
  return 'tone-dim';
});
const activeEvalText = computed(() => (activeEval.value ? formatEval(activeEval.value) : ''));

/** deepest ECO opening matched from positions, falling back to PGN ECO/Opening tags */
const opening = computed<{ eco: string; name: string } | null>(() => {
  const hit = findOpening(rp.value.steps.map((s) => s.fen));
  if (hit) return { eco: hit.eco, name: hit.name };
  const eco = props.game.headers.get('ECO') ?? '';
  const name = props.game.headers.get('Opening') ?? '';
  const cleanEco = eco && eco !== '?' ? eco : '';
  const cleanName = name && name !== '?' ? name : '';
  if (!cleanEco && !cleanName) return null;
  return { eco: cleanEco, name: cleanName };
});

/** the half-moves as numbered pairs, each with its place in the replay */
const rows = computed(() => {
  const steps = rp.value.steps;
  const out: { n: number; white: number | null; black: number | null }[] = [];
  let i = 1;
  if (blackFirst.value && steps.length > 1) {
    out.push({ n: firstNumber.value, white: null, black: 1 });
    i = 2;
  }
  for (; i < steps.length; i += 2) {
    out.push({
      n: firstNumber.value + out.length,
      white: i,
      black: i + 1 < steps.length ? i + 1 : null,
    });
  }
  return out;
});

function rowEvalText(w: number | null, b: number | null): string {
  const lastIdx = b ?? w;
  if (lastIdx === null) return '';
  const p = gameEval.value.points[lastIdx - 1];
  return p ? formatEval(p) : '';
}

const tag = (k: string) => props.game.headers.get(k) ?? '?';
const PRIMARY_TAGS = [
  'Event',
  'Site',
  'Date',
  'Round',
  'TimeControl',
  'Termination',
  'ECO',
  'Opening',
  'WhiteElo',
  'BlackElo',
  'FEN',
  'PlyCount',
];
const HEADER_SKIP = new Set(['White', 'Black', 'Result']);

const allTags = computed<[string, string][]>(() => {
  const entries: [string, string][] = [];
  const seen = new Set<string>(HEADER_SKIP);
  for (const k of PRIMARY_TAGS) {
    seen.add(k);
    const v = props.game.headers.get(k);
    if (v && v !== '?') entries.push([k, v]);
  }
  for (const [k, v] of props.game.headers) {
    if (seen.has(k) || !v || v === '?') continue;
    entries.push([k, v]);
  }
  return entries;
});
const tagsExpanded = ref(false);
watch(
  () => props.game,
  () => {
    tagsExpanded.value = false;
  },
);
const shownTags = computed(() => (tagsExpanded.value ? allTags.value : allTags.value.slice(0, 8)));

const copyNote = ref('');
let copyTimer: ReturnType<typeof setTimeout> | undefined;
function flashCopy(label: string): void {
  copyNote.value = label;
  clearTimeout(copyTimer);
  copyTimer = setTimeout(() => {
    copyNote.value = '';
  }, 1500);
}
onBeforeUnmount(() => clearTimeout(copyTimer));

const pgnText = () => (props.rawPgn.trim() ? props.rawPgn : makePgn(props.game));

async function copyPgn(): Promise<void> {
  try {
    await navigator.clipboard.writeText(pgnText());
    flashCopy('PGN copied');
  } catch {
    flashCopy('Copy denied');
  }
}

async function copyFen(): Promise<void> {
  const fen = step.value?.fen;
  if (!fen) return;
  try {
    await navigator.clipboard.writeText(fen);
    flashCopy('FEN copied');
  } catch {
    flashCopy('Copy denied');
  }
}

function downloadPgn(): void {
  const blob = new Blob([pgnText()], { type: 'application/x-chess-pgn' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const safe = `${tag('White')} vs ${tag('Black')}`.replaceAll(/[^\w .+-]/g, '_');
  a.href = url;
  a.download = `${safe}.pgn`;
  a.click();
  URL.revokeObjectURL(url);
}
</script>

<template>
  <div class="@container/viewer min-w-0">
    <div
      class="grid items-start gap-3.5 @[680px]/viewer:grid-cols-[minmax(300px,440px)_minmax(260px,1fr)] @[960px]/viewer:grid-cols-[minmax(380px,490px)_minmax(300px,440px)]"
    >
      <div class="min-w-0">
        <div class="mb-1.5 flex items-baseline justify-between gap-2 text-dense">
          <span class="truncate" :title="`${tag('White')} vs ${tag('Black')}`">
            <span class="font-semibold">{{ tag('White') }}</span>
            <span class="text-dim"> vs </span>
            <span class="font-semibold">{{ tag('Black') }}</span>
          </span>
          <span class="num shrink-0 font-semibold">{{ tag('Result') }}</span>
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

        <div class="mt-1.5 flex flex-wrap items-center justify-between gap-1.5">
          <div class="flex gap-1">
            <button class="btn px-2.5 py-1.5" :disabled="ply === 0" title="Home" @click="go(0)">
              <ChevronFirst :size="15" />
            </button>
            <button
              class="btn px-2.5 py-1.5"
              :disabled="ply === 0"
              title="Previous move (←)"
              @click="go(ply - 1)"
            >
              <ChevronLeft :size="15" />
            </button>
            <button
              class="btn px-2.5 py-1.5"
              :disabled="ply === last"
              title="Next move (→)"
              @click="go(ply + 1)"
            >
              <ChevronRight :size="15" />
            </button>
            <button
              class="btn px-2.5 py-1.5"
              :disabled="ply === last"
              title="End"
              @click="go(last)"
            >
              <ChevronLast :size="15" />
            </button>
            <button class="btn px-2.5 py-1.5" title="Flip board (F)" @click="flip">
              <FlipVertical2 :size="15" />
            </button>
          </div>
          <div class="flex flex-wrap items-center gap-1">
            <span v-if="copyNote" class="mr-1 text-small text-good">{{ copyNote }}</span>
            <button class="btn-sm" title="Copy game PGN" @click="copyPgn">
              <Copy :size="12" /><span>Copy PGN</span>
            </button>
            <button class="btn-sm" title="Download single game as PGN" @click="downloadPgn">
              <Download :size="12" /><span>Download</span>
            </button>
            <button class="btn-sm" title="Copy current position FEN" @click="copyFen">
              Copy FEN
            </button>
          </div>
        </div>

        <div
          class="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-md border border-line bg-panel px-2.5 py-1.5 text-small"
        >
          <template v-if="activeEval">
            <span v-if="activeEvalText" class="tag" :class="evalChipTone">
              {{ activeEvalText }}
            </span>
            <span v-if="activeEval.depth" class="num text-dim">depth {{ activeEval.depth }}</span>
            <span v-if="activeEval.book" class="num text-dim">book</span>
            <span v-else-if="activeEval.timeSec !== undefined" class="num text-dim">
              {{ formatMoveTime(activeEval.timeSec) }}
            </span>
            <span v-if="activeEval.clockSec !== undefined" class="num text-dim">
              clk {{ formatClock(activeEval.clockSec) }}
            </span>
            <span v-if="activeEval.note" class="text-text">{{ activeEval.note }}</span>
          </template>
          <span v-else class="text-dim">
            Start position
            <template v-if="step && step.comments.length > 0">
              · {{ step.comments.join(' ') }}
            </template>
          </span>
          <span class="num ml-auto text-faint">ply {{ ply }} / {{ last }}</span>
        </div>

        <div v-if="gameEval.hasEval || gameEval.hasTime" class="mt-3">
          <EvalGraph
            :game-eval="gameEval"
            :ply="ply"
            :sans="sans"
            :first-move="firstNumber"
            :black-first="blackFirst"
            @select="go"
          />
        </div>
      </div>

      <div class="min-w-0">
        <Panel title="Moves" :note="`${last} plies`">
          <div
            v-if="opening"
            class="flex items-baseline gap-2 border-b border-row bg-panel2 px-3 py-1.5 text-small"
          >
            <span v-if="opening.eco" class="tag tone-accent">{{ opening.eco }}</span>
            <span class="truncate text-text" :title="opening.name">{{ opening.name }}</span>
          </div>
          <div ref="movesBox" class="num max-h-80 overflow-auto px-3 py-2 text-dense">
            <div
              v-for="r in rows"
              :key="r.n"
              class="grid grid-cols-[2.3rem_5.2rem_5.2rem_1fr] items-baseline"
            >
              <span class="text-faint">{{ r.n }}.</span>
              <template v-for="i in [r.white, r.black]" :key="String(i)">
                <button
                  v-if="i !== null"
                  :data-ply="i"
                  class="w-fit rounded px-1 text-left hover:bg-active"
                  :class="i === ply ? 'bg-accent-line font-semibold text-text' : ''"
                  @click="go(i)"
                >
                  {{ rp.steps[i]?.san }}
                </button>
                <span v-else class="px-1 text-faint">…</span>
              </template>
              <span class="text-right text-label text-faint">
                {{ rowEvalText(r.white, r.black) }}
              </span>
            </div>
            <div v-if="rows.length === 0" class="text-faint">No moves</div>
            <div v-if="rp.error" class="mt-1 text-bad">{{ rp.error }}</div>
          </div>
        </Panel>

        <Panel v-if="allTags.length > 0" title="Tags">
          <template v-if="allTags.length > 8" #actions>
            <button class="btn-sm" @click="tagsExpanded = !tagsExpanded">
              {{ tagsExpanded ? 'Less' : `All ${allTags.length}` }}
            </button>
          </template>
          <div class="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 px-3 py-2 text-small">
            <template v-for="[k, v] in shownTags" :key="k">
              <span class="text-dim">{{ k }}</span>
              <span :class="k === 'FEN' ? 'mono truncate' : 'num truncate'" :title="v">{{
                v
              }}</span>
            </template>
          </div>
        </Panel>
      </div>
    </div>
  </div>
</template>
