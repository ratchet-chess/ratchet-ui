<script setup lang="ts">
import type { Key } from 'chessground/types';
import type { Color } from 'chessops/types';
import { opposite } from 'chessops/util';
import { computed, onMounted, ref, watch } from 'vue';
import Board from '../components/Board.vue';
import Panel from '../components/Panel.vue';
import { TIME_CONTROLS } from '../chess/clock.ts';
import { usePlay, type Player } from '../play/usePlay.ts';
import { useBooks } from '../stores/books.ts';
import { useEngines } from '../stores/engines.ts';
import { PLAYED } from '../stores/games.ts';
import { thousands } from '../ui/format.ts';

const engines = useEngines();
const books = useBooks();
/** the book a new game draws its opening from; empty for chess's start */
const book = ref('');
const play = usePlay();
const { game, phase, names, thinking, times, error, saved, openingLabel } = play;

onMounted(async () => {
  await Promise.all([engines.load(), books.load()]);
  // a first visit offers a game against the newest engine, with the person as White
  const newest = engines.list.at(-1);
  if (newest) play.players.black = { kind: 'engine', id: newest.id };
});

/** a player as the side's select holds it: `person`, or an engine's id */
const choice = (c: Color) =>
  computed({
    get: () => (play.players[c].kind === 'person' ? 'person' : play.players[c].id),
    set: (v: string) => {
      play.players[c] =
        v === 'person' ? { kind: 'person' } : ({ kind: 'engine', id: v } satisfies Player);
    },
  });
const whiteChoice = choice('white');
const blackChoice = choice('black');

const controlLabel = computed({
  get: () => play.control.value.label,
  set: (label: string) => {
    play.control.value = TIME_CONTROLS.find((t) => t.label === label) ?? play.control.value;
  },
});

/** the board's bottom side: a person's side when one plays, else White */
const orientation = ref<Color>('white');
watch(
  () => [play.players.white.kind, play.players.black.kind],
  () => {
    orientation.value =
      play.players.white.kind !== 'person' && play.players.black.kind === 'person'
        ? 'black'
        : 'white';
  },
);

const board = computed(() => {
  const g = game.value;
  const mover = play.personToMove();
  return {
    fen: g.fen,
    turn: g.turn,
    dests: mover ? g.dests() : new Map<Key, Key[]>(),
    movable: mover,
    lastMove: g.lastMove(),
    check: g.pos.isCheck(),
  };
});

/** a pawn move to the last rank, waiting for the person to pick its piece */
const promoting = ref<{ orig: string; dest: string } | null>(null);
const PROMOTIONS = [
  { role: 'q', glyph: '♛' },
  { role: 'r', glyph: '♜' },
  { role: 'b', glyph: '♝' },
  { role: 'n', glyph: '♞' },
];

function onMove(orig: Key, dest: Key): void {
  if (game.value.isPromotion(orig, dest)) promoting.value = { orig, dest };
  else play.move(orig, dest);
}

function promote(role: string): void {
  const p = promoting.value;
  promoting.value = null;
  if (p) play.move(p.orig, p.dest, role);
}

function cancelPromotion(): void {
  promoting.value = null;
  // the board moved the pawn already; redrawing from the game puts it back
  play.redraw();
}

/** the moves as numbered pairs */
const moveRows = computed(() => {
  const san = game.value.san;
  const rows: { n: number; white: string; black: string }[] = [];
  for (let i = 0; i < san.length; i += 2)
    rows.push({ n: i / 2 + 1, white: san[i] ?? '', black: san[i + 1] ?? '' });
  return rows;
});

function clockText(ms: number | null): string {
  if (ms === null) return '';
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}`;
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const sides = computed(() => {
  const bottom = orientation.value;
  return { top: opposite(bottom), bottom };
});

/** starts a game, from a random opening of the chosen book */
async function newGame(): Promise<void> {
  if (!book.value) {
    await play.start();
    return;
  }
  try {
    await play.start(await books.randomOpening(book.value));
  } catch (e) {
    error.value = `No opening from ${book.value}: ${e instanceof Error ? e.message : String(e)}`;
  }
}

/** the copy button's label for a moment after a click */
const copyNote = ref('');
async function copyPgn(): Promise<void> {
  try {
    await navigator.clipboard.writeText(play.pgn());
    copyNote.value = 'Copied';
  } catch {
    // a browser may deny the clipboard; Download PGN still works there
    copyNote.value = 'Copy denied';
  }
  setTimeout(() => (copyNote.value = ''), 1500);
}

function savePgn(): void {
  const url = URL.createObjectURL(new Blob([play.pgn()], { type: 'application/x-chess-pgn' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${names.white} vs ${names.black}.pgn`.replaceAll(/[^\w .+-]/g, '_');
  a.click();
  URL.revokeObjectURL(url);
}
</script>

<template>
  <div class="grid gap-3.5 wide:grid-cols-[minmax(0,560px)_minmax(280px,1fr)]">
    <div class="max-w-[560px]">
      <template v-for="where in ['top', 'bottom'] as const" :key="where">
        <div v-if="where === 'bottom'" class="relative">
          <Board
            :fen="board.fen"
            :orientation="orientation"
            :turn="board.turn"
            :dests="board.dests"
            :movable="board.movable"
            :last-move="board.lastMove"
            :check="board.check"
            @move="onMove"
          />
          <div
            v-if="promoting"
            class="absolute inset-0 z-10 flex items-center justify-center bg-black/50"
            @click.self="cancelPromotion"
          >
            <div class="flex gap-1 rounded-md border border-line bg-panel p-2">
              <button
                v-for="p in PROMOTIONS"
                :key="p.role"
                class="size-14 rounded bg-panel2 text-glyph hover:bg-active"
                @click="promote(p.role)"
              >
                {{ p.glyph }}
              </button>
            </div>
          </div>
        </div>
        <div
          class="my-1.5 flex items-center justify-between rounded-md border bg-panel2 px-2.5 py-1.5"
          :class="
            phase === 'playing' && game.turn === sides[where] ? 'border-accent' : 'border-line'
          "
        >
          <span class="truncate">
            <span
              class="mr-1.5 inline-block size-2.5 rounded-full border border-dim"
              :class="sides[where] === 'white' ? 'bg-white' : 'bg-black'"
            />
            {{ names[sides[where]] }}
          </span>
          <span class="num text-stat">{{ clockText(times[sides[where]]) }}</span>
        </div>
      </template>
    </div>

    <div>
      <Panel title="Game">
        <div
          class="grid grid-cols-[max-content_1fr] items-center gap-x-3 gap-y-1.5 px-3 py-2.5 text-dense"
        >
          <span class="text-dim">White</span>
          <select
            v-model="whiteChoice"
            class="field-sm num"
            :disabled="phase === 'playing' || phase === 'starting'"
          >
            <option value="person">You</option>
            <option v-for="e in engines.list" :key="e.id" :value="e.id">{{ e.id }}</option>
          </select>
          <span class="text-dim">Black</span>
          <select
            v-model="blackChoice"
            class="field-sm num"
            :disabled="phase === 'playing' || phase === 'starting'"
          >
            <option value="person">You</option>
            <option v-for="e in engines.list" :key="e.id" :value="e.id">{{ e.id }}</option>
          </select>
          <span class="text-dim">Opening</span>
          <select
            v-model="book"
            class="field-sm num"
            :disabled="phase === 'playing' || phase === 'starting'"
          >
            <option value="">Start position</option>
            <option v-for="b in books.usable" :key="b.id" :value="b.id">
              {{ b.id }}
            </option>
          </select>
          <span class="text-dim">Time</span>
          <select
            v-model="controlLabel"
            class="field-sm num"
            :disabled="phase === 'playing' || phase === 'starting'"
          >
            <option v-for="t in TIME_CONTROLS" :key="t.label" :value="t.label">
              {{ t.label }}
            </option>
          </select>
        </div>
        <div class="flex flex-wrap gap-1.5 border-t border-row px-3 py-2">
          <button class="btn" :disabled="phase === 'starting'" @click="newGame">New game</button>
          <button class="btn" :disabled="phase !== 'playing'" @click="play.resign()">Resign</button>
          <button
            class="btn"
            :disabled="phase !== 'playing' && phase !== 'starting'"
            @click="play.abort()"
          >
            Abort
          </button>
          <button class="btn" @click="orientation = opposite(orientation)">Flip</button>
          <button class="btn" :disabled="game.san.length === 0" @click="copyPgn">
            {{ copyNote || 'Copy PGN' }}
          </button>
          <button class="btn" :disabled="game.san.length === 0" @click="savePgn">
            Download PGN
          </button>
        </div>
        <div
          v-if="openingLabel && phase !== 'setup'"
          class="num border-t border-row px-3 py-1.5 text-dense text-dim"
        >
          from {{ openingLabel }}
        </div>
        <div v-if="error" class="border-t border-row px-3 py-2 text-bad">{{ error }}</div>
        <div v-else-if="phase === 'starting'" class="border-t border-row px-3 py-2 text-dim">
          Starting engines…
        </div>
        <div v-else-if="phase === 'over'" class="border-t border-row px-3 py-2">
          <span class="num mr-2 font-semibold">{{ game.outcome?.result ?? '*' }}</span>
          <span class="text-dim">{{ game.outcome?.reason ?? 'aborted' }}</span>
          <RouterLink v-if="saved" :to="`/games/${PLAYED}`" class="ml-2 text-dense text-accent"
            >Open in Games</RouterLink
          >
          <button v-else-if="game.san.length > 0" class="btn ml-2" @click="play.save()">
            Save to Games
          </button>
        </div>
      </Panel>

      <Panel
        v-for="c in (['white', 'black'] as const).filter((x) => play.players[x].kind === 'engine')"
        :key="c"
        :title="names[c]"
        :note="c"
      >
        <div class="num px-3 py-2 text-dense">
          <template v-if="thinking[c]">
            <div>
              depth {{ thinking[c]?.depth }} ·
              <span class="text-text">{{ thinking[c]?.score }}</span> ·
              {{ thousands(thinking[c]?.nodes ?? 0) }}n · {{ thousands(thinking[c]?.nps ?? 0) }}n/s
            </div>
            <div class="mt-0.5 text-dim">{{ thinking[c]?.line.join(' ') }}</div>
          </template>
          <span v-else class="text-faint">Waiting for search</span>
        </div>
      </Panel>

      <Panel title="Moves">
        <div class="num max-h-72 overflow-auto px-3 py-2 text-dense">
          <div v-for="r in moveRows" :key="r.n" class="grid grid-cols-[2.5rem_1fr_1fr]">
            <span class="text-faint">{{ r.n }}.</span><span>{{ r.white }}</span
            ><span>{{ r.black }}</span>
          </div>
          <span v-if="moveRows.length === 0" class="text-faint">No moves</span>
        </div>
      </Panel>
    </div>
  </div>
</template>
