<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Download, Trash2 } from '@lucide/vue';
import GameViewer from '../components/GameViewer.vue';
import PageHeader from '../components/PageHeader.vue';
import Panel from '../components/Panel.vue';
import { parseCollection, type Parsed } from '../games/pgn.ts';
import { PLAYED, useGames, type Collection } from '../stores/games.ts';
import { bytes } from '../ui/format.ts';

const games = useGames();
const route = useRoute();
const router = useRouter();

/** the open collection and game, from the route: /games/<collection>/<game> */
const openId = computed(() => (typeof route.params['id'] === 'string' ? route.params['id'] : ''));
const gameIndex = computed(() => {
  const g = route.params['game'];
  return typeof g === 'string' && /^\d+$/.test(g) ? Number(g) : null;
});

const parsed = shallowRef<Parsed | null>(null);
const busy = ref('');

async function openCollection(id: string): Promise<void> {
  parsed.value = null;
  if (!id) return;
  busy.value = 'Reading the collection…';
  // give the page a frame to show that before a large file's parse
  await new Promise<void>((r) => {
    requestAnimationFrame(() => r());
  });
  parsed.value = parseCollection(await games.read(id));
  busy.value = '';
  await openRound();
}

/**
 * /games/<collection>?round=<Round tag> opens the game a tournament's page names by its PGN Round
 * tag; the last such game, since a replayed game may be in the collection twice
 */
async function openRound(): Promise<void> {
  const round = route.query['round'];
  if (typeof round !== 'string' || !parsed.value) return;
  const found = parsed.value.summaries.findLast((g) => g.tags['Round'] === round);
  await router.replace(found ? `/games/${openId.value}/${found.index}` : `/games/${openId.value}`);
}

onMounted(async () => {
  await games.load();
  await openCollection(openId.value);
});
watch(openId, (id) => void openCollection(id));
watch(
  () => route.query['round'],
  () => void openRound(),
);

const open = computed(() => games.list.find((c) => c.id === openId.value));
const game = computed(() =>
  gameIndex.value === null ? undefined : parsed.value?.games[gameIndex.value],
);

/** newest first, with the games played here at the top */
const collections = computed(() =>
  games.list.toSorted((a, b) =>
    a.id === PLAYED ? -1 : b.id === PLAYED ? 1 : b.updated.localeCompare(a.updated),
  ),
);

const PAGE = 100;
const page = ref(0);
watch(openId, () => (page.value = 0));
const pages = computed(() => Math.max(1, Math.ceil((parsed.value?.summaries.length ?? 0) / PAGE)));
const shown = computed(
  () => parsed.value?.summaries.slice(page.value * PAGE, (page.value + 1) * PAGE) ?? [],
);

const fileInput = ref<HTMLInputElement | null>(null);
async function onFiles(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  let last = '';
  for (const f of Array.from(input.files ?? [])) {
    busy.value = `Keeping ${f.name}…`;
    last = await games.addFile(f.name.replace(/\.pgn$/i, ''), await f.text());
  }
  input.value = '';
  busy.value = '';
  if (last) await router.push(`/games/${last}`);
}

const download = (c: Collection) => games.download(c.id, c.name);

async function remove(c: Collection): Promise<void> {
  if (!confirm(`Delete ${c.name} and its ${c.games} games from this browser?`)) return;
  await games.remove(c.id);
  if (openId.value === c.id) await router.push('/games');
}

const day = (iso: string) => iso.slice(0, 10);
</script>

<template>
  <PageHeader title="Games" sub="PGN collections kept in this browser">
    <button class="btn" @click="fileInput?.click()">Open PGN files…</button>
    <input
      ref="fileInput"
      type="file"
      accept=".pgn,application/x-chess-pgn"
      multiple
      class="hidden"
      @change="onFiles"
    />
  </PageHeader>
  <div v-if="games.error" class="mb-3 text-bad">{{ games.error }}</div>
  <div v-if="busy" class="mb-3 text-dim">{{ busy }}</div>

  <div class="grid gap-3.5" :class="game ? 'wide:grid-cols-[minmax(340px,440px)_1fr]' : ''">
    <div :class="game ? 'hidden wide:block' : ''">
      <Panel title="Collections">
        <table class="w-full border-collapse text-dense">
          <tbody>
            <tr
              v-for="c in collections"
              :key="c.id"
              class="row"
              :class="c.id === openId ? 'bg-selected' : ''"
              @click="router.push(`/games/${c.id}`)"
            >
              <td class="w-full max-w-0 truncate px-2 py-1.5" :title="c.name">{{ c.name }}</td>
              <td class="num px-2 py-1.5 text-right">{{ c.games }}</td>
              <td class="num px-2 py-1.5 text-right whitespace-nowrap text-dim">
                {{ bytes(c.bytes) }}
              </td>
              <td class="num px-2 py-1.5 whitespace-nowrap text-dim">{{ day(c.updated) }}</td>
              <td class="px-2 py-1.5 text-right whitespace-nowrap" @click.stop>
                <button class="btn" title="Download as PGN" @click="download(c)">
                  <Download :size="13" />
                </button>
                <button class="btn ml-1" title="Delete" @click="remove(c)">
                  <Trash2 :size="13" />
                </button>
              </td>
            </tr>
            <tr v-if="collections.length === 0">
              <td class="px-3 py-3 text-dim">No games yet. Play one, or open a PGN file.</td>
            </tr>
          </tbody>
        </table>
      </Panel>

      <Panel v-if="open && parsed" :title="open.name" :note="`${parsed.summaries.length} games`">
        <div class="overflow-x-auto">
          <table class="w-full border-collapse text-dense">
            <thead>
              <tr class="text-left text-small text-dim">
                <th class="th">#</th>
                <th class="th">White</th>
                <th class="th">Black</th>
                <th class="th">result</th>
                <th class="th text-right">plies</th>
                <th class="th">date</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="s in shown"
                :key="s.index"
                class="row"
                :class="s.index === gameIndex ? 'bg-selected' : ''"
                @click="router.push(`/games/${openId}/${s.index}`)"
              >
                <td class="num px-2 py-1 text-faint">{{ s.index + 1 }}</td>
                <td class="px-2 py-1 whitespace-nowrap">{{ s.tags['White'] ?? '?' }}</td>
                <td class="px-2 py-1 whitespace-nowrap">{{ s.tags['Black'] ?? '?' }}</td>
                <td class="num px-2 py-1 whitespace-nowrap">{{ s.tags['Result'] ?? '*' }}</td>
                <td class="num px-2 py-1 text-right text-dim">{{ s.plies }}</td>
                <td class="num px-2 py-1 whitespace-nowrap text-dim">{{ s.tags['Date'] ?? '' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div
          v-if="pages > 1"
          class="flex items-center gap-2 border-t border-row px-3 py-1.5 text-dense text-dim"
        >
          <button class="btn" :disabled="page === 0" @click="page--">‹</button>
          page {{ page + 1 }} of {{ pages }}
          <button class="btn" :disabled="page + 1 >= pages" @click="page++">›</button>
        </div>
      </Panel>
    </div>

    <div v-if="game">
      <RouterLink
        :to="`/games/${openId}`"
        class="mb-2 inline-block text-dense text-accent wide:hidden"
        >‹ {{ open?.name }}</RouterLink
      >
      <GameViewer :game="game" />
    </div>
  </div>
</template>
