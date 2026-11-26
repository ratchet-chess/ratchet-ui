<script setup lang="ts">
/**
 * Tourneys when no tournament is selected: the tournaments by state, behind tabs with counts; the
 * notices that want a look; a card per run; the queue, in its order; the finished ones, then the
 * archive by month, folded.
 * The tab and the open month are in the route's query, so Back returns to them.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import NoticeList from '../../components/NoticeList.vue';
import OutcomeLine from '../../components/OutcomeLine.vue';
import Pager from '../../components/Pager.vue';
import Panel from '../../components/Panel.vue';
import ProgressBar from '../../components/ProgressBar.vue';
import Tabs from '../../components/Tabs.vue';
import FinishedRow from './FinishedRow.vue';
import { useServed } from './served.ts';
import { useBooks } from '../../stores/books.ts';
import { useEngines } from '../../stores/engines.ts';
import { lacking } from '../../stores/queue.ts';
import { useTournaments, type Item } from '../../stores/tournaments.ts';
import {
  ARCHIVE_DAYS,
  archived,
  archiveMonths,
  etaOf,
  etaText,
  groupOf,
  monthName,
  noticesOf,
  problemsLine,
  problemTotal,
  queueNote,
  standingText,
  threadBudget,
  type Group,
  type Served,
} from './overview.ts';
import { count } from '../../ui/format.ts';
import {
  formatShort,
  planned,
  plannedText,
  progressShort,
  statusClass,
  statusText,
} from './show.ts';

const tournaments = useTournaments();
const engines = useEngines();
const books = useBooks();
const route = useRoute();
const router = useRouter();

/** the clock the ETAs and the archive read, moved on every few seconds */
const now = ref(Date.now());
let ticker: ReturnType<typeof setInterval> | undefined;
onMounted(() => (ticker = setInterval(() => (now.value = Date.now()), 10_000)));
onBeforeUnmount(() => clearInterval(ticker));
/** the time now, read when a game finishes too; `now` makes a render follow the ticks */
const clock = () => Math.max(now.value, Date.now());

const query = (k: string) => (typeof route.query[k] === 'string' ? route.query[k] : '');
const TABS: { key: Group | ''; name: string }[] = [
  { key: '', name: 'All' },
  { key: 'running', name: 'Running' },
  { key: 'queued', name: 'Queued' },
  { key: 'stopped', name: 'Stopped' },
  { key: 'finished', name: 'Finished' },
];
const tab = computed({
  get: () => TABS.find((t) => t.key === query('show'))?.key ?? '',
  set: (key) => go({ show: key }),
});
const shows = (g: Group) => tab.value === '' || tab.value === g;
function go(q: Record<string, string>): void {
  const next = Object.fromEntries(Object.entries(q).filter(([, v]) => v !== ''));
  void router.replace({ query: next });
}

const items = computed(() => tournaments.items);
const byGroup = computed(() => {
  const out: Record<Group, Item[]> = {
    running: [],
    queued: [],
    stopped: [],
    finished: [],
  };
  for (const i of items.value) out[groupOf(i)].push(i);
  out.queued = tournaments.queue.filter((i) => groupOf(i) === 'queued');
  return out;
});
const tabs = computed(() =>
  TABS.map((t) => ({
    ...t,
    count: t.key === '' ? items.value.length : byGroup.value[t.key].length,
  })),
);

const served = useServed();
/** the notices of the tab's group; the browser's own on All */
const notices = computed(() => {
  const groups = new Map(items.value.map((i) => [i.config.id, groupOf(i)]));
  return noticesOf(items.value, served.value)
    .filter((n) => {
      const g = groups.get(n.id);
      return g ? shows(g) : tab.value === '';
    })
    .map((n) => ({ ...n, to: n.id ? `/tournaments/${n.id}` : undefined }));
});
const budget = computed(() => threadBudget(items.value, navigator.hardwareConcurrency || 1));

// ── finished and the archive ──────────────────────────────────────────────
const PAGE = 25;
const recent = computed(() =>
  byGroup.value.finished
    .filter((i) => !archived(i, now.value))
    .toSorted((a, b) => (b.endedAt ?? '').localeCompare(a.endedAt ?? '')),
);
const recentPage = ref(0);
const recentPages = computed(() => Math.max(1, Math.ceil(recent.value.length / PAGE)));
const recentRows = computed(() =>
  recent.value.slice(recentPage.value * PAGE, (recentPage.value + 1) * PAGE),
);
const months = computed(() => archiveMonths(items.value, now.value));
const archivedCount = computed(() => months.value.reduce((n, [, l]) => n + l.length, 0));
const openMonth = computed(() => query('month'));
const monthPage = computed({
  get: () => Math.max(0, Number(query('page')) - 1 || 0),
  set: (n) => go({ show: tab.value, month: openMonth.value, page: n > 0 ? String(n + 1) : '' }),
});
function toggleMonth(m: string): void {
  go({ show: tab.value, month: openMonth.value === m ? '' : m });
}

// ── a row's pieces ────────────────────────────────────────────────────────
const open = (i: Item) => void router.push(`/tournaments/${i.config.id}`);
/** a run's bar: games done cleanly, ended by a fault, and in play, as shares of those planned */
function bar(i: Item) {
  const total = Math.max(1, planned(i), i.state.games.length);
  const bad = problemTotal(i.state.games);
  const share = (n: number) => (100 * n) / total;
  return [
    { share: share(i.state.games.length - bad), tone: 'accent' },
    { share: share(bad), tone: 'bad' },
    { share: i.elsewhere ? 0 : share(i.state.live.length), tone: 'live' },
  ] as const;
}
/** a match's LLR with its bounds, for its row's line; null for a match with no SPRT */
const llrOf = (m: { llr: number | null; bounds: { lower: number; upper: number } | null }) =>
  m.llr !== null && m.bounds
    ? { value: m.llr, lower: m.bounds.lower, upper: m.bounds.upper }
    : null;
const blocked = (i: Item) => {
  const l = lacking(i.config, served.value);
  return l.engines.length > 0 || l.book !== '';
};
async function resume(i: Item): Promise<void> {
  await tournaments.resume(i.config.id);
}

const rowLine = 'num mt-0.5 flex gap-2 text-small text-dim';

// ── the queue ─────────────────────────────────────────────────────────────
const queuedPage = ref(0);
const queuedPages = computed(() => Math.max(1, Math.ceil(byGroup.value.queued.length / PAGE)));
const queuedRows = computed(() =>
  byGroup.value.queued.slice(queuedPage.value * PAGE, (queuedPage.value + 1) * PAGE),
);
/** a row's place in the whole queue, from its place on the page */
const placeOf = (k: number) => queuedPage.value * PAGE + k;
const dragging = ref<number | null>(null);
function drop(to: number): void {
  const from = dragging.value;
  dragging.value = null;
  const i = from === null ? undefined : byGroup.value.queued[from];
  if (i) void tournaments.move(i.config.id, to);
}
async function removeQueued(i: Item): Promise<void> {
  if (!confirm(`Remove “${i.config.name}” from the queue? It has no games.`)) return;
  try {
    await tournaments.remove(i.config.id);
  } catch (e) {
    i.state.error = `Remove failed: ${e instanceof Error ? e.message : String(e)}`;
  }
}
const pausedHere = computed(() => tournaments.paused.length > 0);
const icon = 'btn-sm w-[21px] px-0';
</script>

<template>
  <div
    class="@container"
    style="--finished-cols: minmax(0, 1.3fr) minmax(0, 0.9fr) minmax(0, 1.3fr) 4.5rem 3.5rem 4.5rem"
  >
    <Tabs v-model="tab" :tabs="tabs" />

    <Panel v-if="items.length === 0">
      <div class="px-3 py-3 text-dim">No tournaments yet. Click New… to start one.</div>
    </Panel>

    <Panel v-if="notices.length > 0" title="Notices" :note="String(notices.length)">
      <NoticeList :notices="notices" />
    </Panel>

    <!-- ── running ─────────────────────────────────────────────────────── -->
    <Panel
      v-if="shows('running') && (byGroup.running.length > 0 || tab === 'running')"
      title="Running"
      :note="
        byGroup.running.length > 0
          ? `${budget.games} concurrent · ${budget.hardware} threads`
          : undefined
      "
    >
      <div
        v-if="budget.games > budget.hardware"
        class="border-b border-row px-3 py-1.5 text-dense text-warn"
      >
        Concurrent games exceed hardware threads; clocks may run slow.
      </div>
      <div class="grid gap-2 p-2 @3xl:grid-cols-2">
        <div
          v-for="i in byGroup.running"
          :key="i.config.id"
          class="cursor-pointer rounded-md border border-line bg-panel2 px-2.5 py-2 hover:border-line-strong"
          @click="open(i)"
        >
          <div class="flex items-baseline gap-2">
            <span class="min-w-0 flex-1 truncate font-medium">{{ i.config.name }}</span>
            <span
              v-if="statusText(i) !== 'Running'"
              class="tag"
              :class="statusClass(statusText(i))"
              >{{ statusText(i) }}</span
            >
            <span v-if="etaOf(i, clock())" class="num shrink-0 text-small text-dim">{{
              etaText(etaOf(i, clock())!)
            }}</span>
          </div>
          <ProgressBar class="mt-1.5" size="thick" :parts="bar(i)" />
          <div :class="rowLine">
            <span class="min-w-0 truncate"
              >{{ formatShort(i.config.format) }} · {{ i.config.control }}</span
            >
            <span class="flex-1" />
            <span v-if="problemTotal(i.state.games) > 0" class="shrink-0 text-bad">{{
              problemsLine(i.state.games)
            }}</span>
            <span v-if="!i.elsewhere && i.state.live.length > 0" class="shrink-0"
              >{{ i.state.live.length }} in play</span
            >
            <span class="shrink-0">{{ progressShort(i) }}</span>
          </div>
          <OutcomeLine
            v-if="i.state.summary.match && i.state.games.length > 0"
            :llr="llrOf(i.state.summary.match)"
            :text="standingText(i)"
            :ptnml="
              i.state.summary.match.model === 'pentanomial' ? i.state.summary.match.ptnml : null
            "
            :tail="`W D L ${i.state.summary.match.wdl.map(count).join(' ')}`"
          />
          <div v-else-if="standingText(i)" class="num mt-1.5 truncate text-small text-dim">
            {{ standingText(i) }}
          </div>
        </div>
        <div v-if="byGroup.running.length === 0" class="px-1 py-1 text-dim">None running.</div>
      </div>
    </Panel>

    <!-- ── queued ──────────────────────────────────────────────────────── -->
    <Panel
      v-if="shows('queued') && (byGroup.queued.length > 0 || tab === 'queued')"
      title="Queued"
      :note="
        byGroup.queued.length > 0
          ? `${byGroup.queued.length} · ${queueNote(items, pausedHere)}`
          : undefined
      "
    >
      <div
        v-for="(i, k) in queuedRows"
        :key="i.config.id"
        draggable="true"
        class="row px-3 py-2"
        :class="dragging === placeOf(k) ? 'opacity-40' : ''"
        @click="open(i)"
        @dragstart="dragging = placeOf(k)"
        @dragover.prevent
        @drop.prevent="drop(placeOf(k))"
        @dragend="dragging = null"
      >
        <div class="flex items-baseline gap-2">
          <span class="cursor-grab text-small text-faint" title="Drag to reorder">⠿</span>
          <span class="num w-5 shrink-0 text-right text-small text-faint">{{
            placeOf(k) + 1
          }}</span>
          <span class="min-w-0 flex-1 truncate">{{ i.config.name }}</span>
          <span v-if="blocked(i)" class="tag tone-bad" title="Missing engine or book (see Notices)"
            >Cannot start</span
          >
          <span class="flex shrink-0 gap-0.5" @click.stop>
            <button
              :class="icon"
              title="Move to the top"
              :disabled="placeOf(k) === 0"
              @click="tournaments.move(i.config.id, 0)"
            >
              ⤒
            </button>
            <button
              :class="icon"
              title="Move up"
              :disabled="placeOf(k) === 0"
              @click="tournaments.move(i.config.id, placeOf(k) - 1)"
            >
              ↑
            </button>
            <button
              :class="icon"
              title="Move down"
              :disabled="placeOf(k) === byGroup.queued.length - 1"
              @click="tournaments.move(i.config.id, placeOf(k) + 1)"
            >
              ↓
            </button>
            <button
              class="btn-sm"
              :disabled="blocked(i)"
              :title="
                blocked(i) ? 'Missing engine or book (see Notices)' : 'Start now, beside what runs'
              "
              @click="tournaments.startNow(i.config.id)"
            >
              Start now
            </button>
            <button :class="icon" title="Remove from the queue" @click="removeQueued(i)">✕</button>
          </span>
        </div>
        <div :class="rowLine" class="pl-10">
          <span class="min-w-0 truncate"
            >{{ formatShort(i.config.format) }} · {{ i.config.control }} ·
            {{ i.config.entrants.length }} engines · {{ i.config.concurrency }} concurrent</span
          >
          <span class="flex-1" />
          <span class="shrink-0">{{ plannedText(i) }} games</span>
        </div>
      </div>
      <div v-if="byGroup.queued.length === 0" class="px-3 py-2 text-dim">None queued.</div>
      <Pager
        v-if="queuedPages > 1"
        v-model="queuedPage"
        :pages="queuedPages"
        class="border-t border-line px-3 py-1.5"
      />
    </Panel>

    <!-- ── stopped ─────────────────────────────────────────────────────── -->
    <Panel
      v-if="shows('stopped') && (byGroup.stopped.length > 0 || tab === 'stopped')"
      title="Stopped"
    >
      <div v-for="i in byGroup.stopped" :key="i.config.id" class="row px-3 py-2" @click="open(i)">
        <div class="flex items-baseline gap-2">
          <span class="min-w-0 flex-1 truncate">{{ i.config.name }}</span>
          <span class="tag" :class="statusClass(statusText(i))">{{ statusText(i) }}</span>
          <button
            class="btn-sm"
            :disabled="blocked(i)"
            :title="
              blocked(i)
                ? 'Missing engine or book (see Notices)'
                : 'Resume unfinished pairs, then remaining games'
            "
            @click.stop="resume(i)"
          >
            Resume
          </button>
        </div>
        <div :class="rowLine">
          <span class="min-w-0 truncate"
            >{{ formatShort(i.config.format) }} · {{ i.config.control }}</span
          >
          <span v-if="standingText(i)" class="min-w-0 truncate">· {{ standingText(i) }}</span>
          <span class="flex-1" />
          <span v-if="problemTotal(i.state.games) > 0" class="shrink-0 text-bad">{{
            problemsLine(i.state.games)
          }}</span>
          <span class="shrink-0">{{ progressShort(i) }}</span>
        </div>
      </div>
      <div v-if="byGroup.stopped.length === 0" class="px-3 py-2 text-dim">None stopped.</div>
    </Panel>

    <!-- ── finished ────────────────────────────────────────────────────── -->
    <Panel
      v-if="shows('finished') && (recent.length > 0 || tab === 'finished')"
      title="Finished"
      :note="`the last ${ARCHIVE_DAYS} days`"
    >
      <div
        class="hidden grid-cols-(--finished-cols) gap-3 border-b border-line px-3 py-1 text-small text-dim @4xl:grid"
      >
        <span>tournament</span><span>format</span><span>outcome</span
        ><span class="text-right">games</span><span /><span class="text-right">ended</span>
      </div>
      <FinishedRow
        v-for="i in recentRows"
        :key="i.config.id"
        :item="i"
        :now="now"
        class="border-b border-row px-3 py-1.5 last:border-0"
      />
      <div v-if="recent.length === 0" class="px-3 py-2 text-dim">
        None in the last {{ ARCHIVE_DAYS }} days.
      </div>
      <Pager
        v-if="recentPages > 1"
        v-model="recentPage"
        :pages="recentPages"
        class="border-t border-line px-3 py-1.5"
      />
    </Panel>

    <!-- ── the archive ─────────────────────────────────────────────────── -->
    <Panel
      v-if="shows('finished') && months.length > 0"
      title="Archive"
      :note="`${count(archivedCount)} finished over ${ARCHIVE_DAYS} days ago`"
    >
      <div v-for="[m, list] in months" :key="m" class="border-b border-row last:border-0">
        <button
          class="flex w-full items-baseline gap-2 px-3 py-1.5 text-left hover:bg-hover"
          :aria-expanded="openMonth === m"
          @click="toggleMonth(m)"
        >
          <span class="w-3 text-faint">{{ openMonth === m ? '▾' : '▸' }}</span>
          <span>{{ monthName(m) }}</span>
          <span class="num text-small text-faint">{{ list.length }}</span>
        </button>
        <template v-if="openMonth === m">
          <FinishedRow
            v-for="i in list.slice(monthPage * PAGE, (monthPage + 1) * PAGE)"
            :key="i.config.id"
            :item="i"
            :now="now"
            class="border-t border-row px-3 py-1.5"
          />
          <Pager
            v-if="list.length > PAGE"
            v-model="monthPage"
            :pages="Math.ceil(list.length / PAGE)"
            class="border-t border-row px-3 py-1.5"
          />
        </template>
      </div>
    </Panel>
  </div>
</template>
