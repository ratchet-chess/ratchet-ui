<script setup lang="ts">
import type { Key } from 'chessground/types';
import type { Color } from 'chessops/types';
import { opposite } from 'chessops/util';
import { computed, onMounted, ref, watch } from 'vue';
import Board from '../components/Board.vue';
import Panel from '../components/Panel.vue';
import { TIME_CONTROLS } from '../chess/clock.ts';
import { usePlay, type Player } from '../play/usePlay.ts';
import { useEngines } from '../stores/engines.ts';

const engines = useEngines();
const play = usePlay();
const { game, phase, names, thinking, times, error } = play;

onMounted(async () => {
  await engines.load();
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

/** the game's PGN, with today's date, the players and the time control */
function pgnText(): string {
  const d = new Date();
  const date = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  const tc = play.control.value;
  const timeControl =
    tc.kind === 'clock' ? `${tc.baseMs / 1000}+${tc.incMs / 1000}` : `1/${tc.ms / 1000}`;
  return game.value.pgn({
    Event: 'ratchet-ui game',
    Date: date,
    White: names.white,
    Black: names.black,
    TimeControl: timeControl,
  });
}

/** the copy button's label for a moment after a click */
const copyNote = ref('');
async function copyPgn(): Promise<void> {
  try {
    await navigator.clipboard.writeText(pgnText());
    copyNote.value = 'Copied';
  } catch {
    // a browser may deny the clipboard; Save PGN still works there
    copyNote.value = 'Copy denied';
  }
  setTimeout(() => (copyNote.value = ''), 1500);
}

function savePgn(): void {
  const url = URL.createObjectURL(new Blob([pgnText()], { type: 'application/x-chess-pgn' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${names.white} vs ${names.black}.pgn`.replaceAll(/[^\w .+-]/g, '_');
  a.click();
  URL.revokeObjectURL(url);
}

const kn = (n: number) => `${Math.round(n / 1000).toLocaleString('en-US')} k`;
const selectClass =
  'num rounded border border-line bg-panel2 px-1.5 py-0.5 text-[12.5px] text-text';
const buttonClass = 'rounded border border-line bg-panel2 px-2.5 py-1 text-xs disabled:text-faint';
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
                class="size-14 rounded bg-panel2 text-4xl hover:bg-[#2a3440]"
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
          <span class="num text-lg">{{ clockText(times[sides[where]]) }}</span>
        </div>
      </template>
    </div>

    <div>
      <Panel title="Game">
        <div
          class="grid grid-cols-[max-content_1fr] items-center gap-x-3 gap-y-1.5 px-3 py-2.5 text-[13px]"
        >
          <span class="text-dim">White</span>
          <select
            v-model="whiteChoice"
            :class="selectClass"
            :disabled="phase === 'playing' || phase === 'starting'"
          >
            <option value="person">You</option>
            <option v-for="e in engines.list" :key="e.id" :value="e.id">{{ e.id }}</option>
          </select>
          <span class="text-dim">Black</span>
          <select
            v-model="blackChoice"
            :class="selectClass"
            :disabled="phase === 'playing' || phase === 'starting'"
          >
            <option value="person">You</option>
            <option v-for="e in engines.list" :key="e.id" :value="e.id">{{ e.id }}</option>
          </select>
          <span class="text-dim">time</span>
          <select
            v-model="controlLabel"
            :class="selectClass"
            :disabled="phase === 'playing' || phase === 'starting'"
          >
            <option v-for="t in TIME_CONTROLS" :key="t.label" :value="t.label">
              {{ t.label }}
            </option>
          </select>
        </div>
        <div class="flex flex-wrap gap-1.5 border-t border-row px-3 py-2">
          <button :class="buttonClass" :disabled="phase === 'starting'" @click="play.start()">
            New game
          </button>
          <button :class="buttonClass" :disabled="phase !== 'playing'" @click="play.resign()">
            Resign
          </button>
          <button
            :class="buttonClass"
            :disabled="phase !== 'playing' && phase !== 'starting'"
            @click="play.abort()"
          >
            Abort
          </button>
          <button :class="buttonClass" @click="orientation = opposite(orientation)">Flip</button>
          <button :class="buttonClass" :disabled="game.san.length === 0" @click="copyPgn">
            {{ copyNote || 'Copy PGN' }}
          </button>
          <button :class="buttonClass" :disabled="game.san.length === 0" @click="savePgn">
            Save PGN
          </button>
        </div>
        <div v-if="error" class="border-t border-row px-3 py-2 text-bad">{{ error }}</div>
        <div v-else-if="phase === 'starting'" class="border-t border-row px-3 py-2 text-dim">
          Starting the engines…
        </div>
        <div v-else-if="phase === 'over'" class="border-t border-row px-3 py-2">
          <span class="num mr-2 font-semibold">{{ game.outcome?.result ?? '*' }}</span>
          <span class="text-dim">{{ game.outcome?.reason ?? 'aborted' }}</span>
        </div>
      </Panel>

      <Panel
        v-for="c in (['white', 'black'] as const).filter((x) => play.players[x].kind === 'engine')"
        :key="c"
        :title="names[c]"
        :note="c"
      >
        <div class="num px-3 py-2 text-[12px]">
          <template v-if="thinking[c]">
            <div>
              depth {{ thinking[c]?.depth }} ·
              <span class="text-text">{{ thinking[c]?.score }}</span> ·
              {{ kn(thinking[c]?.nodes ?? 0) }}n · {{ kn(thinking[c]?.nps ?? 0) }}n/s
            </div>
            <div class="mt-0.5 text-dim">{{ thinking[c]?.line.join(' ') }}</div>
          </template>
          <span v-else class="text-faint">not searched yet</span>
        </div>
      </Panel>

      <Panel title="Moves">
        <div class="num max-h-72 overflow-auto px-3 py-2 text-[12.5px]">
          <div v-for="r in moveRows" :key="r.n" class="grid grid-cols-[2.5rem_1fr_1fr]">
            <span class="text-faint">{{ r.n }}.</span><span>{{ r.white }}</span
            ><span>{{ r.black }}</span>
          </div>
          <span v-if="moveRows.length === 0" class="text-faint">no moves yet</span>
        </div>
      </Panel>
    </div>
  </div>
</template>
