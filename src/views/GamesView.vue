<script setup lang="ts">
/**
 * Games: in-browser PGN collections indexed by byte offset (cached in memory + IndexedDB),
 * searchable and filterable at 50,000+ games, paired with the GameViewer in Variant A layout.
 */
import type { Game as PgnGame, PgnNodeData } from 'chessops/pgn';
import { Check, ChevronDown, ChevronUp, Download, Pencil, Trash2, Upload, X } from '@lucide/vue';
import { computed, onMounted, ref, shallowRef, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import GameViewer from '../components/GameViewer.vue';
import PageHeader from '../components/PageHeader.vue';
import Pager from '../components/Pager.vue';
import Panel from '../components/Panel.vue';
import {
  EMPTY_FILTER,
  filterPgnIndex,
  findLastByRound,
  isFiltered,
  rowAt,
  type GameFilter,
  type IndexedGameRow,
  type PgnIndex,
} from '../games/index.ts';
import { parseSingleGame } from '../games/pgn.ts';
import { PLAYED, useGames, type Collection } from '../stores/games.ts';
import { bytes, count } from '../ui/format.ts';
import GamesFilterBar from './games/GamesFilterBar.vue';

const games = useGames();
const route = useRoute();
const router = useRouter();

/** the open collection and game, from the route: /games/<collection>/<game> */
const openId = computed(() => (typeof route.params['id'] === 'string' ? route.params['id'] : ''));
const gameIndex = computed(() => {
  const g = route.params['game'];
  return typeof g === 'string' && /^\d+$/.test(g) ? Number(g) : null;
});

const open = computed(() => games.list.find((c) => c.id === openId.value));

const index = shallowRef<PgnIndex | null>(null);
const openGame = shallowRef<PgnGame<PgnNodeData> | null>(null);
const openGameText = ref('');
const busy = ref('');
const notice = ref('');

let loadToken = 0;

async function openCollection(id: string): Promise<void> {
  const mine = ++loadToken;
  index.value = null;
  openGame.value = null;
  openGameText.value = '';
  notice.value = '';
  if (!id) return;
  const col = games.list.find((c) => c.id === id);
  if (!col) return;
  busy.value = 'Indexing collection…';
  try {
    const idx = await games.getIndex(col);
    if (mine !== loadToken) return;
    index.value = idx;
  } catch (e) {
    if (mine !== loadToken) return;
    notice.value = `Could not read collection: ${e instanceof Error ? e.message : String(e)}`;
    return;
  } finally {
    if (mine === loadToken) busy.value = '';
  }
  await openRound();
  await loadSelectedGame();
}

/**
 * /games/<collection>?round=<Round tag> opens the game a tournament's page names by its PGN Round
 * tag; the last such game, since a replayed game may be in the collection twice.
 */
async function openRound(): Promise<void> {
  const round = route.query['round'];
  if (typeof round !== 'string' || !index.value) return;
  const found = findLastByRound(index.value, round);
  await router.replace(found >= 0 ? `/games/${openId.value}/${found}` : `/games/${openId.value}`);
}

let gameToken = 0;
async function loadSelectedGame(): Promise<void> {
  const mine = ++gameToken;
  const gIdx = gameIndex.value;
  if (gIdx === null || !index.value || !openId.value) {
    openGame.value = null;
    openGameText.value = '';
    return;
  }
  const text = await games.readGameText(openId.value, index.value, gIdx);
  if (mine !== gameToken) return;
  openGameText.value = text;
  openGame.value = parseSingleGame(text);
}

onMounted(async () => {
  await games.load();
  await openCollection(openId.value);
});
watch(openId, (id) => {
  filter.value = { ...EMPTY_FILTER };
  page.value = 0;
  colsExpanded.value = false;
  void openCollection(id);
});
watch(
  () => route.query['round'],
  () => void openRound(),
);
watch(gameIndex, () => {
  void loadSelectedGame();
});

// ── collections list, search, and inline rename ─────────────────────────────
const colSearch = ref('');
const colsExpanded = ref(false);

/** newest first, with the games played here at the top */
const collections = computed(() =>
  games.list.toSorted((a, b) =>
    a.id === PLAYED ? -1 : b.id === PLAYED ? 1 : b.updated.localeCompare(a.updated),
  ),
);
const filteredCollections = computed(() => {
  const q = colSearch.value.trim().toLowerCase();
  return q ? collections.value.filter((c) => c.name.toLowerCase().includes(q)) : collections.value;
});
const totalBytes = computed(() => games.list.reduce((sum, c) => sum + c.bytes, 0));

const renamingId = ref('');
const renameDraft = ref('');
function startRename(c: Collection): void {
  renamingId.value = c.id;
  renameDraft.value = c.name;
}
async function commitRename(c: Collection): Promise<void> {
  const next = renameDraft.value.trim();
  renamingId.value = '';
  if (next && next !== c.name) await games.rename(c.id, next);
}
function cancelRename(): void {
  renamingId.value = '';
}

// ── game search, filter, paging, and prev/next navigation ───────────────────
const filter = ref<GameFilter>({ ...EMPTY_FILTER });
const filtered = computed<Int32Array>(() =>
  index.value ? filterPgnIndex(index.value, filter.value) : new Int32Array(0),
);
const hasFilter = computed(() => isFiltered(filter.value));

const PAGE = 100;
const page = ref(0);
watch(
  filter,
  () => {
    page.value = 0;
  },
  { deep: true },
);

const pages = computed(() => Math.max(1, Math.ceil(filtered.value.length / PAGE)));
watch(pages, (p) => {
  if (page.value >= p) page.value = Math.max(0, p - 1);
});

const shownRows = computed<IndexedGameRow[]>(() => {
  const idx = index.value;
  if (!idx) return [];
  const start = page.value * PAGE;
  const end = Math.min(filtered.value.length, start + PAGE);
  const out: IndexedGameRow[] = [];
  for (let k = start; k < end; k++) {
    const gIdx = filtered.value[k];
    if (gIdx !== undefined) out.push(rowAt(idx, gIdx));
  }
  return out;
});

/** position of the open game inside the current filtered list, or -1 if filtered out */
const filteredPos = computed(() => {
  const gIdx = gameIndex.value;
  if (gIdx === null) return -1;
  return filtered.value.indexOf(gIdx);
});

// Keep the rail page synced when navigating with Prev/Next or ?round=
watch(filteredPos, (pos) => {
  if (pos >= 0) {
    const targetPage = Math.floor(pos / PAGE);
    if (targetPage !== page.value) page.value = targetPage;
  }
});

const prevGameIdx = computed(() =>
  filteredPos.value > 0 ? (filtered.value[filteredPos.value - 1] ?? null) : null,
);
const nextGameIdx = computed(() =>
  filteredPos.value >= 0 && filteredPos.value + 1 < filtered.value.length
    ? (filtered.value[filteredPos.value + 1] ?? null)
    : null,
);

function selectCollection(id: string): void {
  colsExpanded.value = false;
  void router.push(`/games/${id}`);
}
function selectGame(idx: number): void {
  void router.push(`/games/${openId.value}/${idx}`);
}

// ── import (file picker + drag-and-drop for .pgn and .zip) ──────────────────
const fileInput = ref<HTMLInputElement | null>(null);
const draggingOver = ref(false);
let dragDepth = 0;

async function importFiles(files: File[]): Promise<void> {
  if (files.length === 0) return;
  notice.value = '';
  let last = '';
  try {
    for (const f of files) {
      busy.value = `Saving ${f.name}…`;
      const ids = await games.addUpload(f);
      if (ids.length > 0) last = ids.at(-1) ?? last;
    }
  } catch (e) {
    notice.value = `Import failed: ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    busy.value = '';
  }
  if (last) await router.push(`/games/${last}`);
}

async function onFiles(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = '';
  await importFiles(files);
}

function onDragEnter(e: DragEvent): void {
  if (!e.dataTransfer?.types.includes('Files')) return;
  dragDepth++;
  draggingOver.value = true;
}
function onDragLeave(): void {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) draggingOver.value = false;
}
function onDragOver(e: DragEvent): void {
  if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
}
async function onDrop(e: DragEvent): Promise<void> {
  e.preventDefault();
  dragDepth = 0;
  draggingOver.value = false;
  const files = Array.from(e.dataTransfer?.files ?? []).filter((f) => /\.(pgn|zip)$/i.test(f.name));
  if (files.length === 0) {
    notice.value = 'Drop a .pgn file or a .zip archive holding .pgn files.';
    return;
  }
  await importFiles(files);
}

const download = (c: Collection) => games.download(c.id, c.name);
async function downloadFiltered(): Promise<void> {
  if (!open.value || !index.value) return;
  if (!hasFilter.value) {
    await games.download(open.value.id, open.value.name);
    return;
  }
  await games.downloadFiltered(open.value.id, open.value.name, index.value, filtered.value);
}

async function remove(c: Collection): Promise<void> {
  if (!confirm(`Delete ${c.name} (${count(c.games)} games) from browser?`)) return;
  await games.remove(c.id);
  if (openId.value === c.id) await router.push('/games');
}

const day = (iso: string) => iso.slice(0, 10);
const rangeLabel = computed(() => {
  const total = filtered.value.length;
  if (total === 0) return 'No matching games';
  const from = page.value * PAGE + 1;
  const to = Math.min(total, (page.value + 1) * PAGE);
  return `Showing ${count(from)}–${count(to)} of ${count(total)}`;
});
</script>

<template>
  <div
    class="@container/page relative min-h-full"
    @dragenter="onDragEnter"
    @dragleave="onDragLeave"
    @dragover="onDragOver"
    @drop="onDrop"
  >
    <div
      v-if="draggingOver"
      class="pointer-events-none fixed inset-4 z-50 flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-accent bg-popover/90 text-title text-accent"
    >
      <Upload :size="28" />
      <span>Drop .pgn or .zip files to import</span>
    </div>

    <PageHeader title="Games" sub="PGN collections stored in browser">
      <button class="btn" @click="fileInput?.click()">Import PGN / ZIP…</button>
      <input
        ref="fileInput"
        type="file"
        accept=".pgn,.zip,application/x-chess-pgn,application/zip"
        multiple
        class="hidden"
        @change="onFiles"
      />
    </PageHeader>

    <div v-if="games.error" class="mb-3 text-dense text-bad">{{ games.error }}</div>
    <div v-if="notice" class="mb-3 text-dense text-warn">{{ notice }}</div>
    <div v-if="busy" class="mb-3 text-dense text-dim">{{ busy }}</div>

    <!-- ── Game open: Variant A (collapsible switcher + compact rail + viewer) ── -->
    <template v-if="openGame && open && index">
      <div
        class="mb-2.5 flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-panel px-2.5 py-1.5 text-dense"
      >
        <div class="flex min-w-0 items-center gap-2">
          <span class="caps text-label">Collection</span>
          <span class="truncate font-semibold" :title="open.name">{{ open.name }}</span>
          <span class="num whitespace-nowrap text-dim">
            · {{ count(index.count) }} games · {{ bytes(open.bytes) }}
          </span>
        </div>
        <div class="flex shrink-0 items-center gap-1.5">
          <button class="btn-sm" @click="colsExpanded = !colsExpanded">
            <span>{{ colsExpanded ? 'Hide collections' : 'Switch collection' }}</span>
            <ChevronUp v-if="colsExpanded" :size="12" />
            <ChevronDown v-else :size="12" />
          </button>
          <RouterLink :to="`/games/${openId}`" class="btn-sm">Full table</RouterLink>
        </div>
      </div>

      <!-- Expandable collection switcher panel -->
      <Panel
        v-if="colsExpanded"
        title="Collections"
        :note="`${count(collections.length)} · ${bytes(totalBytes)}`"
      >
        <template v-if="collections.length > 3" #actions>
          <input
            v-model="colSearch"
            type="search"
            placeholder="Filter collections…"
            class="field-sm h-6 w-44 text-small"
            aria-label="filter collections"
          />
        </template>
        <table class="w-full border-collapse text-dense">
          <tbody>
            <tr
              v-for="c in filteredCollections"
              :key="c.id"
              class="row"
              :class="c.id === openId ? 'bg-selected' : ''"
              @click="selectCollection(c.id)"
            >
              <td class="w-full max-w-0 truncate px-2 py-1.5" :title="c.name">{{ c.name }}</td>
              <td class="num px-2 py-1.5 text-right whitespace-nowrap">{{ count(c.games) }}</td>
              <td class="num px-2 py-1.5 text-right whitespace-nowrap text-dim">
                {{ bytes(c.bytes) }}
              </td>
              <td class="num px-2 py-1.5 whitespace-nowrap text-dim">{{ day(c.updated) }}</td>
            </tr>
          </tbody>
        </table>
      </Panel>

      <div class="grid items-start gap-3.5 @[1080px]/page:grid-cols-[330px_minmax(0,1fr)]">
        <!-- Compact 2-line games rail (wide containers) -->
        <div class="hidden min-w-0 @[1080px]/page:block">
          <Panel title="Games" :note="count(filtered.length)">
            <template #actions>
              <Pager v-model="page" :pages="pages" jump />
            </template>
            <GamesFilterBar
              v-model="filter"
              :total="index.count"
              :matched="filtered.length"
              compact
              @download="downloadFiltered"
            />
            <div class="max-h-[38rem] overflow-y-auto">
              <div
                v-for="r in shownRows"
                :key="r.index"
                class="row px-2.5 py-1.5 text-dense"
                :class="r.index === gameIndex ? 'bg-selected' : ''"
                @click="selectGame(r.index)"
              >
                <div class="flex items-baseline justify-between gap-2">
                  <span class="min-w-0 truncate font-medium" :title="`${r.white} vs ${r.black}`">
                    {{ r.white }} <span class="font-normal text-dim">vs</span> {{ r.black }}
                  </span>
                  <span class="num shrink-0 font-semibold">{{ r.result }}</span>
                </div>
                <div class="num mt-0.5 flex flex-wrap items-center gap-1.5 text-small text-dim">
                  <span class="text-faint">#{{ count(r.index + 1) }}</span>
                  <span v-if="r.eco" class="tag tone-dim">{{ r.eco }}</span>
                  <span>{{ r.plies }}p</span>
                  <span v-if="r.forfeit" class="tag tone-bad">{{ r.termination }}</span>
                  <span class="ml-auto">{{ r.date }}</span>
                </div>
              </div>
              <div v-if="shownRows.length === 0" class="px-3 py-4 text-center text-dense text-dim">
                No games match the filters.
              </div>
            </div>
            <div class="flex items-center justify-between gap-2 border-t border-line px-2.5 py-1.5">
              <button class="btn-sm" :disabled="filtered.length === 0" @click="downloadFiltered">
                <Download :size="12" />
                <span>{{ hasFilter ? 'Download filtered' : 'Download' }}</span>
              </button>
              <Pager v-model="page" :pages="pages" jump />
            </div>
          </Panel>
        </div>

        <!-- Viewer column -->
        <div class="min-w-0">
          <div
            class="mb-2.5 flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-panel px-2.5 py-1.5 text-dense"
          >
            <div class="flex min-w-0 items-center gap-2">
              <RouterLink :to="`/games/${openId}`" class="btn-sm @[1080px]/page:hidden">
                ‹ Back to list
              </RouterLink>
              <span class="num truncate text-dim">
                <template v-if="filteredPos >= 0">
                  Game {{ count(filteredPos + 1) }} of {{ count(filtered.length)
                  }}<template v-if="hasFilter"> filtered</template>
                </template>
                <template v-else>
                  Game #{{ count((gameIndex ?? 0) + 1) }} (outside current filter)
                </template>
              </span>
            </div>
            <div class="flex shrink-0 items-center gap-1.5">
              <button
                class="btn-sm"
                :disabled="prevGameIdx === null"
                @click="prevGameIdx !== null && selectGame(prevGameIdx)"
              >
                ‹ Prev game
              </button>
              <button
                class="btn-sm"
                :disabled="nextGameIdx === null"
                @click="nextGameIdx !== null && selectGame(nextGameIdx)"
              >
                Next game ›
              </button>
            </div>
          </div>

          <GameViewer :game="openGame" :raw-pgn="openGameText" />
        </div>
      </div>
    </template>

    <!-- ── Collection browsing view (no game open) ── -->
    <template v-else>
      <Panel
        title="Collections"
        :note="collections.length > 0 ? `${count(collections.length)} · ${bytes(totalBytes)}` : ''"
      >
        <template v-if="collections.length > 3" #actions>
          <input
            v-model="colSearch"
            type="search"
            placeholder="Filter collections…"
            class="field-sm h-6 w-44 text-small"
            aria-label="filter collections"
          />
        </template>
        <table class="w-full border-collapse text-dense">
          <tbody>
            <tr
              v-for="c in filteredCollections"
              :key="c.id"
              class="row"
              :class="c.id === openId ? 'bg-selected' : ''"
              @click="renamingId !== c.id && selectCollection(c.id)"
            >
              <td class="w-full max-w-0 px-2 py-1.5">
                <form
                  v-if="renamingId === c.id"
                  class="flex items-center gap-1.5"
                  @submit.prevent="commitRename(c)"
                  @click.stop
                >
                  <input
                    v-model="renameDraft"
                    type="text"
                    class="field-sm h-6 min-w-0 flex-1"
                    aria-label="collection name"
                    @keydown.escape.prevent="cancelRename"
                  />
                  <button type="submit" class="btn-sm" title="Save name">
                    <Check :size="12" />
                  </button>
                  <button type="button" class="btn-sm" title="Cancel" @click="cancelRename">
                    <X :size="12" />
                  </button>
                </form>
                <div v-else class="truncate" :title="c.name">{{ c.name }}</div>
              </td>
              <td class="num px-2 py-1.5 text-right whitespace-nowrap">{{ count(c.games) }}</td>
              <td class="num px-2 py-1.5 text-right whitespace-nowrap text-dim">
                {{ bytes(c.bytes) }}
              </td>
              <td class="num px-2 py-1.5 whitespace-nowrap text-dim">{{ day(c.updated) }}</td>
              <td class="px-2 py-1.5 text-right whitespace-nowrap" @click.stop>
                <button
                  v-if="c.id !== PLAYED"
                  class="btn-sm"
                  title="Rename collection"
                  @click="startRename(c)"
                >
                  <Pencil :size="12" />
                </button>
                <button class="btn-sm ml-1" title="Download as PGN" @click="download(c)">
                  <Download :size="12" />
                </button>
                <button class="btn-sm ml-1" title="Delete" @click="remove(c)">
                  <Trash2 :size="12" />
                </button>
              </td>
            </tr>
            <tr v-if="collections.length === 0">
              <td class="px-3 py-3 text-dim">
                No games yet. Play a game or drop a .pgn / .zip file here.
              </td>
            </tr>
            <tr v-else-if="filteredCollections.length === 0">
              <td class="px-3 py-3 text-dim">No collections match “{{ colSearch.trim() }}”.</td>
            </tr>
          </tbody>
        </table>
        <div
          class="flex flex-wrap items-center justify-between gap-2 border-t border-dashed border-line bg-panel2 px-3 py-1.5 text-small text-dim"
        >
          <span>Drop .pgn or .zip files anywhere on this page to import</span>
          <span class="num text-faint">Stored in browser</span>
        </div>
      </Panel>

      <template v-if="open && index">
        <GamesFilterBar
          v-model="filter"
          :total="index.count"
          :matched="filtered.length"
          @download="downloadFiltered"
        />

        <Panel
          :title="open.name"
          :note="
            hasFilter
              ? `${count(filtered.length)} of ${count(index.count)} games`
              : `${count(index.count)} games`
          "
        >
          <template #actions>
            <Pager v-model="page" :pages="pages" jump />
          </template>
          <div class="overflow-x-auto">
            <table class="w-full border-collapse text-dense">
              <thead>
                <tr class="text-left text-small text-dim">
                  <th class="th">#</th>
                  <th class="th">White</th>
                  <th class="th">Black</th>
                  <th class="th">result</th>
                  <th class="th">ECO</th>
                  <th class="th text-right">plies</th>
                  <th class="th">ending</th>
                  <th class="th">date</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="r in shownRows"
                  :key="r.index"
                  class="row"
                  :class="r.index === gameIndex ? 'bg-selected' : ''"
                  @click="selectGame(r.index)"
                >
                  <td class="num px-2 py-1 text-faint">{{ count(r.index + 1) }}</td>
                  <td class="max-w-56 truncate px-2 py-1" :title="r.white">{{ r.white }}</td>
                  <td class="max-w-56 truncate px-2 py-1" :title="r.black">{{ r.black }}</td>
                  <td class="num px-2 py-1 whitespace-nowrap">{{ r.result }}</td>
                  <td class="num px-2 py-1 whitespace-nowrap text-dim" :title="r.opening">
                    {{ r.eco }}
                  </td>
                  <td class="num px-2 py-1 text-right text-dim">{{ r.plies }}</td>
                  <td class="px-2 py-1 whitespace-nowrap text-dim">
                    <span v-if="r.forfeit" class="tag tone-bad">{{ r.termination }}</span>
                    <template v-else>{{ r.termination }}</template>
                  </td>
                  <td class="num px-2 py-1 whitespace-nowrap text-dim">{{ r.date }}</td>
                </tr>
                <tr v-if="shownRows.length === 0">
                  <td colspan="8" class="px-3 py-4 text-center text-dim">
                    <template v-if="index.count === 0">This collection holds no games.</template>
                    <template v-else>No games match the filters.</template>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div
            v-if="filtered.length > 0"
            class="flex flex-wrap items-center justify-between gap-2 border-t border-line px-3 py-1.5 text-small text-dim"
          >
            <span class="num">{{ rangeLabel }}</span>
            <Pager v-model="page" :pages="pages" jump />
          </div>
        </Panel>
      </template>
    </template>
  </div>
</template>
