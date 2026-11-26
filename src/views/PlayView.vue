<script setup lang="ts">
import {
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
  SlidersHorizontal,
} from '@lucide/vue';
import type { Key } from 'chessground/types';
import type { Color } from 'chessops/types';
import { opposite } from 'chessops/util';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import Board from '../components/Board.vue';
import OpeningSelect from '../components/OpeningSelect.vue';
import Panel from '../components/Panel.vue';
import { TIME_CONTROLS, describeControl, parseControl } from '../chess/clock.ts';
import { summarizeOverrides, type OptionValue } from '../engine/options.ts';
import { usePlay, type Player } from '../play/usePlay.ts';
import { useBooks } from '../stores/books.ts';
import { useEngines } from '../stores/engines.ts';
import { PLAYED } from '../stores/games.ts';
import { useSettings } from '../stores/settings.ts';
import { thousands } from '../ui/format.ts';
import EngineOptionsPanel from './play/EngineOptionsPanel.vue';
import PlaySidePicker from './play/PlaySidePicker.vue';

const CUSTOM_VALUE = '__custom__';

const route = useRoute();
const engines = useEngines();
const books = useBooks();
const settings = useSettings();
/** the book a new game draws its opening from; empty for chess's start */
const book = ref('');
const play = usePlay();
const {
  game,
  phase,
  names,
  canResign,
  thinking,
  times,
  error,
  saved,
  openingLabel,
  currentPly,
  viewingLive,
} = play;

/** which side's engine options panel is open, if any */
const editingSide = ref<Color | null>(null);
const addingControl = ref(false);
const customControlText = ref('');
const customControlParsed = computed(() =>
  customControlText.value.trim() ? parseControl(customControlText.value) : null,
);

const engineIds = computed(() => engines.list.map((e) => e.id));
const locked = computed(() => phase.value === 'playing' || phase.value === 'starting');

function applyRouteQuery(): boolean {
  if (locked.value) return false;
  const qWhite = typeof route.query['white'] === 'string' ? route.query['white'] : '';
  const qBlack =
    typeof route.query['black'] === 'string'
      ? route.query['black']
      : typeof route.query['engine'] === 'string'
        ? route.query['engine']
        : '';
  const findId = (id: string) => engines.list.find((e) => e.id === id)?.id;
  const whiteId = findId(qWhite);
  const blackId = findId(qBlack);
  if (whiteId) play.setPlayer('white', { kind: 'engine', id: whiteId });
  if (blackId) play.setPlayer('black', { kind: 'engine', id: blackId });
  return Boolean(whiteId || blackId);
}

onMounted(async () => {
  await Promise.all([engines.load(), books.load()]);
  if (!applyRouteQuery()) {
    // a first visit offers a game against the newest engine, with the person as White
    const newest = engines.list.at(-1);
    if (newest) play.setPlayer('black', { kind: 'engine', id: newest.id });
  }
});

watch(
  () => [route.query['white'], route.query['black'], route.query['engine']],
  () => {
    if (engines.loaded) applyRouteQuery();
  },
);

/** a player as the side's picker holds it: `person`, or an engine's id */
const sideChoice = (c: Color): string =>
  play.players[c].kind === 'person' ? 'person' : play.players[c].id;

function setSideChoice(c: Color, v: string): void {
  const next: Player = v === 'person' ? { kind: 'person' } : { kind: 'engine', id: v };
  play.setPlayer(c, next);
  if (next.kind === 'person' && editingSide.value === c) editingSide.value = null;
}

const timeSelectValue = computed({
  get: () => (addingControl.value ? CUSTOM_VALUE : play.controlLabel.value),
  set: (v: string) => {
    if (v === CUSTOM_VALUE) {
      addingControl.value = true;
      customControlText.value = '';
      return;
    }
    addingControl.value = false;
    play.controlLabel.value = v;
  },
});

function keepCustomControl(): void {
  const tc = customControlParsed.value;
  if (!tc) return;
  if (!TIME_CONTROLS.some((t) => t.label === tc.label) && !settings.controls.includes(tc.label)) {
    settings.controls = [...settings.controls, tc.label];
  }
  play.controlLabel.value = tc.label;
  customControlText.value = '';
  addingControl.value = false;
}

const editingEngine = computed(() => {
  const c = editingSide.value;
  if (!c) return undefined;
  const p = play.players[c];
  return p.kind === 'engine' ? engines.list.find((e) => e.id === p.id) : undefined;
});

function toggleEdit(c: Color): void {
  if (play.players[c].kind !== 'engine') return;
  editingSide.value = editingSide.value === c ? null : c;
}

function sideSummary(c: Color, includeLimit = true): string[] {
  const p = play.players[c];
  if (p.kind !== 'engine') return [];
  const opts = engines.inspections.get(p.id)?.options ?? [];
  return summarizeOverrides(
    opts,
    play.sideConfig[c].options,
    includeLimit ? play.sideConfig[c].limit : '',
  );
}

function updateSideOption(name: string, value: OptionValue | undefined): void {
  const c = editingSide.value;
  if (!c) return;
  const next = { ...play.sideConfig[c].options };
  if (value === undefined) delete next[name];
  else next[name] = value;
  play.sideConfig[c].options = next;
}

function updateSideLimit(limit: string): void {
  const c = editingSide.value;
  if (!c) return;
  play.sideConfig[c].limit = limit;
}

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
  const snap = g.positionAt(currentPly.value);
  const mover = play.personToMove();
  return {
    fen: snap.fen,
    turn: snap.turn,
    dests: mover ? g.dests() : new Map<Key, Key[]>(),
    movable: mover,
    lastMove: snap.lastMove,
    check: snap.check,
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

/** the moves as numbered pairs, each storing its 1-based ply index for board navigation */
const moveRows = computed(() => {
  const san = game.value.san;
  const rows: { n: number; wPly: number; white: string; bPly: number | null; black: string }[] = [];
  for (let i = 0; i < san.length; i += 2) {
    rows.push({
      n: i / 2 + 1,
      wPly: i + 1,
      white: san[i] ?? '',
      bPly: i + 1 < san.length ? i + 2 : null,
      black: san[i + 1] ?? '',
    });
  }
  return rows;
});

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape' && editingSide.value !== null) {
    editingSide.value = null;
    return;
  }
  if (
    e.target instanceof HTMLInputElement ||
    e.target instanceof HTMLSelectElement ||
    e.target instanceof HTMLTextAreaElement
  ) {
    return;
  }
  const last = game.value.san.length;
  if (last === 0) return;
  const to: Record<string, number> = {
    ArrowLeft: currentPly.value - 1,
    ArrowRight: currentPly.value + 1,
    Home: 0,
    End: last,
  };
  const nextPly = to[e.key];
  if (nextPly === undefined) return;
  e.preventDefault();
  play.goTo(nextPly);
}
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));

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
  a.download = `${names.value.white} vs ${names.value.black}.pgn`.replaceAll(/[^\w .+-]/g, '_');
  a.click();
  URL.revokeObjectURL(url);
}
</script>

<template>
  <div class="@container relative">
    <div
      class="grid items-start gap-3.5 @[700px]:grid-cols-[minmax(320px,440px)_minmax(270px,1fr)]"
      :class="
        editingSide && editingEngine
          ? '@[1120px]:grid-cols-[minmax(0,540px)_minmax(300px,380px)_minmax(300px,400px)]'
          : '@[1120px]:grid-cols-[minmax(0,560px)_minmax(320px,440px)]'
      "
    >
      <!-- ── Board column ──────────────────────────────────────────────── -->
      <div class="min-w-0">
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
            class="my-1.5 flex items-center justify-between gap-2 rounded-md border bg-panel2 px-2.5 py-1.5 first:mt-0"
            :class="
              phase === 'playing' && game.turn === sides[where] ? 'border-accent' : 'border-line'
            "
          >
            <span class="flex min-w-0 items-center gap-1.5">
              <span
                class="inline-block size-2.5 shrink-0 rounded-full border border-dim"
                :class="sides[where] === 'white' ? 'bg-white' : 'bg-black'"
              />
              <span class="truncate">{{ names[sides[where]] }}</span>
              <span
                v-if="
                  sideSummary(
                    sides[where],
                    times[sides[where]] !== null || !play.sideConfig[sides[where]].limit,
                  ).length > 0
                "
                class="num truncate text-small text-dim"
              >
                {{
                  sideSummary(
                    sides[where],
                    times[sides[where]] !== null || !play.sideConfig[sides[where]].limit,
                  )
                    .slice(0, 2)
                    .join(' · ')
                }}
              </span>
            </span>
            <span v-if="times[sides[where]] !== null" class="num shrink-0 text-stat">
              {{ clockText(times[sides[where]]) }}
            </span>
            <span v-else-if="play.sideConfig[sides[where]].limit" class="tag tone-dim shrink-0">
              {{ play.sideConfig[sides[where]].limit }}
            </span>
          </div>
        </template>
      </div>

      <!-- ── Controls, Thinking, Moves column ──────────────────────────── -->
      <div class="min-w-0">
        <Panel title="Game">
          <div
            class="grid grid-cols-[max-content_minmax(0,1fr)] items-start gap-x-3 gap-y-1.5 px-3 py-2.5 text-dense"
          >
            <template
              v-for="row in [
                { color: 'white' as const, label: 'White' },
                { color: 'black' as const, label: 'Black' },
              ]"
              :key="row.color"
            >
              <span class="flex h-7 items-center text-dim">{{ row.label }}</span>
              <div class="min-w-0">
                <div class="flex items-center gap-1.5">
                  <PlaySidePicker
                    :model-value="sideChoice(row.color)"
                    :engines="engineIds"
                    :disabled="locked"
                    :label="row.label"
                    @update:model-value="setSideChoice(row.color, $event)"
                  />
                  <button
                    v-if="play.players[row.color].kind === 'engine'"
                    type="button"
                    class="btn-sm h-7 shrink-0"
                    :class="
                      editingSide === row.color
                        ? 'border-accent bg-chosen text-text'
                        : sideSummary(row.color).length > 0
                          ? 'border-accent-line text-accent'
                          : ''
                    "
                    :title="`Edit ${row.label} UCI options and search limit`"
                    @click="toggleEdit(row.color)"
                  >
                    <SlidersHorizontal :size="12" />
                    Edit
                    <span
                      v-if="sideSummary(row.color).length > 0"
                      class="num rounded bg-chosen px-1 text-label text-accent"
                    >
                      {{ sideSummary(row.color).length }}
                    </span>
                  </button>
                </div>
                <div
                  v-if="sideSummary(row.color).length > 0"
                  class="num mt-0.5 truncate text-small text-dim"
                >
                  {{ sideSummary(row.color).join(' · ') }}
                </div>
              </div>
            </template>

            <span class="flex h-7 items-center text-dim">Opening</span>
            <OpeningSelect v-model="book" size="sm" :disabled="locked" />

            <span class="flex h-7 items-center text-dim">Time</span>
            <div class="min-w-0">
              <select
                v-model="timeSelectValue"
                class="field-sm num w-full"
                aria-label="Time"
                :disabled="locked"
              >
                <option value="">No clock</option>
                <option v-for="t in TIME_CONTROLS" :key="t.label" :value="t.label">
                  {{ t.label }}
                </option>
                <option v-for="c in settings.controls" :key="c" :value="c">{{ c }}</option>
                <option :value="CUSTOM_VALUE">Custom…</option>
              </select>
              <div v-if="addingControl" class="mt-1.5 flex flex-wrap items-center gap-1.5">
                <input
                  v-model="customControlText"
                  type="text"
                  placeholder="5+0.05, 5m+3, 1s/move, depth 12"
                  class="field-sm num min-w-0 flex-1"
                  :class="
                    customControlText.trim() && !customControlParsed
                      ? 'border-bad-line focus:border-bad-line'
                      : ''
                  "
                  @keydown.enter="keepCustomControl"
                />
                <button
                  type="button"
                  class="btn-sm h-7"
                  :disabled="!customControlParsed"
                  @click="keepCustomControl"
                >
                  Save
                </button>
                <button type="button" class="btn-sm h-7" @click="addingControl = false">
                  Cancel
                </button>
                <div
                  v-if="customControlText.trim()"
                  class="w-full text-small"
                  :class="customControlParsed ? 'text-dim' : 'text-bad'"
                >
                  {{
                    customControlParsed
                      ? describeControl(customControlParsed)
                      : 'Invalid time control'
                  }}
                </div>
              </div>
            </div>
          </div>

          <div class="flex flex-wrap gap-1.5 border-t border-row px-3 py-2">
            <button class="btn" :disabled="phase === 'starting'" @click="newGame">New game</button>
            <button class="btn" :disabled="!canResign" @click="play.resign()">Resign</button>
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
            Starting and warming up engines…
          </div>
          <div v-else-if="phase === 'over'" class="border-t border-row px-3 py-2">
            <span class="num mr-2 font-semibold">{{ game.outcome?.result ?? '*' }}</span>
            <span class="text-dim">{{ game.outcome?.reason ?? 'aborted' }}</span>
            <RouterLink v-if="saved" :to="`/games/${PLAYED}`" class="ml-2 text-dense text-accent">
              Open in Games
            </RouterLink>
            <button v-else-if="game.san.length > 0" class="btn ml-2" @click="play.save()">
              Save to Games
            </button>
          </div>
        </Panel>

        <Panel
          v-for="c in (['white', 'black'] as const).filter(
            (x) => play.players[x].kind === 'engine',
          )"
          :key="c"
          :title="names[c]"
          :note="play.sideConfig[c].limit ? `${c} · ${play.sideConfig[c].limit}` : c"
        >
          <div class="num px-3 py-2 text-dense">
            <template v-if="thinking[c]">
              <div>
                depth {{ thinking[c]?.depth }} ·
                <span class="text-text">{{ thinking[c]?.score }}</span> ·
                {{ thousands(thinking[c]?.nodes ?? 0) }}n ·
                {{ thousands(thinking[c]?.nps ?? 0) }}n/s
              </div>
              <div class="mt-0.5 truncate text-dim">{{ thinking[c]?.line.join(' ') }}</div>
            </template>
            <span v-else class="text-faint">Waiting for search</span>
          </div>
        </Panel>

        <section class="mb-3 rounded-md border border-line bg-panel">
          <div
            class="flex items-center justify-between gap-2 rounded-t-md border-b border-line bg-panel2 px-3 py-1.5"
          >
            <h2 class="subhead flex items-baseline gap-2">
              Moves
              <span v-if="!viewingLive" class="text-small font-normal text-warn">
                ply {{ currentPly }} of {{ game.san.length }}
              </span>
            </h2>
            <div v-if="game.san.length > 0" class="flex items-center gap-1">
              <button
                type="button"
                class="btn-sm h-6 px-1.5"
                :disabled="currentPly === 0"
                title="Start (Home)"
                aria-label="Start"
                @click="play.goTo(0)"
              >
                <ChevronFirst :size="13" />
              </button>
              <button
                type="button"
                class="btn-sm h-6 px-1.5"
                :disabled="currentPly === 0"
                title="Previous (←)"
                aria-label="Previous move"
                @click="play.goTo(currentPly - 1)"
              >
                <ChevronLeft :size="13" />
              </button>
              <button
                type="button"
                class="btn-sm h-6 px-1.5"
                :disabled="viewingLive"
                title="Next (→)"
                aria-label="Next move"
                @click="play.goTo(currentPly + 1)"
              >
                <ChevronRight :size="13" />
              </button>
              <button
                type="button"
                class="btn-sm h-6 px-1.5"
                :disabled="viewingLive"
                title="Live (End)"
                aria-label="Live position"
                @click="play.goTo(game.san.length)"
              >
                <ChevronLast :size="13" />
              </button>
            </div>
          </div>
          <div class="num max-h-60 overflow-auto px-3 py-2 text-dense">
            <div
              v-for="r in moveRows"
              :key="r.n"
              class="grid grid-cols-[2.2rem_5.5rem_5.5rem] items-center"
            >
              <span class="text-faint">{{ r.n }}.</span>
              <button
                type="button"
                class="w-fit rounded px-1 text-left hover:bg-active"
                :class="r.wPly === currentPly ? 'bg-accent-line text-text' : ''"
                @click="play.goTo(r.wPly)"
              >
                {{ r.white }}
              </button>
              <button
                v-if="r.bPly !== null"
                type="button"
                class="w-fit rounded px-1 text-left hover:bg-active"
                :class="r.bPly === currentPly ? 'bg-accent-line text-text' : ''"
                @click="play.goTo(r.bPly)"
              >
                {{ r.black }}
              </button>
              <span v-else />
            </div>
            <span v-if="moveRows.length === 0" class="text-faint">No moves</span>
          </div>
        </section>
      </div>

      <!-- ── 3rd column Edit panel on wide viewports ───────────────────── -->
      <div v-if="editingSide && editingEngine" class="hidden min-w-0 @[1120px]:block">
        <EngineOptionsPanel
          class="max-h-[calc(100dvh-2rem)]"
          :engine="editingEngine"
          :color="editingSide"
          :config="play.sideConfig[editingSide]"
          :game-control="play.controlLabel.value"
          :locked="locked"
          @close="editingSide = null"
          @update-option="updateSideOption"
          @update-limit="updateSideLimit"
          @reset="play.resetSideConfig(editingSide)"
          @save-default="play.saveSideAsDefault(editingSide)"
        />
      </div>
    </div>

    <!-- ── Slide-over drawer on narrow viewports (< 1120px) ──────────── -->
    <div
      v-if="editingSide && editingEngine"
      class="fixed inset-0 z-40 flex justify-end bg-black/50 @[1120px]:hidden"
      @click.self="editingSide = null"
    >
      <EngineOptionsPanel
        class="h-full w-[360px] max-w-[92vw] rounded-none border-y-0 border-r-0"
        :engine="editingEngine"
        :color="editingSide"
        :config="play.sideConfig[editingSide]"
        :game-control="play.controlLabel.value"
        :locked="locked"
        @close="editingSide = null"
        @update-option="updateSideOption"
        @update-limit="updateSideLimit"
        @reset="play.resetSideConfig(editingSide)"
        @save-default="play.saveSideAsDefault(editingSide)"
      />
    </div>
  </div>
</template>
