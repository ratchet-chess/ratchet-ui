<script setup lang="ts">
/**
 * Tourneys when no tournament is selected: the tournaments by state, behind tabs with counts; the
 * notices that want a look; a card per run; the finished ones, then the archive by month, folded.
 * The tab and the open month are in the route's query, so Back returns to them.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import Panel from '../../components/Panel.vue';
import FinishedRow from './FinishedRow.vue';
import { useBooks } from '../../stores/books.ts';
import { useEngines } from '../../stores/engines.ts';
import { useTournaments, type Item } from '../../stores/tournaments.ts';
import {
  ARCHIVE_DAYS,
  archived,
  archiveMonths,
  etaOf,
  etaText,
  groupOf,
  lacking,
  monthName,
  noticesOf,
  problemsLine,
  problemTotal,
  standingText,
  threadBudget,
  type Group,
  type Served,
} from './overview.ts';
import {
  buttonClass,
  count,
  formatShort,
  planned,
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
  { key: 'stopped', name: 'Stopped' },
  { key: 'finished', name: 'Finished' },
];
const tab = computed(() => TABS.find((t) => t.key === query('show'))?.key ?? '');
const shows = (g: Group) => tab.value === '' || tab.value === g;
function go(q: Record<string, string>): void {
  const next = Object.fromEntries(Object.entries(q).filter(([, v]) => v !== ''));
  void router.replace({ query: next });
}

const items = computed(() => tournaments.items);
const byGroup = computed(() => {
  const out: Record<Group, Item[]> = { running: [], stopped: [], finished: [] };
  for (const i of items.value) out[groupOf(i)].push(i);
  return out;
});
const counts = computed<Record<Group | '', number>>(() => ({
  '': items.value.length,
  running: byGroup.value.running.length,
  stopped: byGroup.value.stopped.length,
  finished: byGroup.value.finished.length,
}));

const served = computed<Served>(() => ({
  engines: new Set(engines.list.map((e) => e.id)),
  books: new Set(books.usable.map((b) => b.id)),
  storage: books.storage,
}));
/** the notices of the tab's group; the browser's own on All */
const notices = computed(() => {
  const groups = new Map(items.value.map((i) => [i.config.id, groupOf(i)]));
  return noticesOf(items.value, served.value).filter((n) => {
    const g = groups.get(n.id);
    return g ? shows(g) : tab.value === '';
  });
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
const monthPage = computed(() => Math.max(0, Number(query('page')) - 1 || 0));
function toggleMonth(m: string): void {
  go({ show: tab.value, month: openMonth.value === m ? '' : m });
}

// ── a row's pieces ────────────────────────────────────────────────────────
const open = (i: Item) => void router.push(`/tournaments/${i.config.id}`);
/** a run's bar: games done cleanly, ended by a fault, and in play, as shares of those planned */
function bar(i: Item): { done: number; bad: number; live: number } {
  const total = Math.max(1, planned(i), i.state.games.length);
  const bad = problemTotal(i.state.games);
  const share = (n: number) => Math.min(100, (100 * n) / total);
  return {
    done: share(i.state.games.length - bad),
    bad: share(bad),
    live: i.elsewhere ? 0 : share(i.state.live.length),
  };
}
const llrAt = (v: number, lo: number, hi: number) =>
  (100 * (Math.min(hi, Math.max(lo, v)) - lo)) / (hi - lo);
const PTNML = ['LL', 'LD', 'DD', 'WD', 'WW'];
/** a pentanomial's bars' heights in pixels, of 14 */
const ptnmlBars = (p: readonly number[]) => {
  const top = Math.max(1, ...p);
  return p.map((x) => Math.max(x > 0 ? 2 : 1, Math.round((14 * x) / top)));
};
const blocked = (i: Item) => {
  const l = lacking(i, served.value);
  return l.engines.length > 0 || l.book !== '';
};
async function resume(i: Item): Promise<void> {
  await tournaments.resume(i.config.id);
}

const tag = 'num rounded border px-1.5 text-[10.5px] whitespace-nowrap';
const rowLine = 'num mt-0.5 flex gap-2 text-[11.5px] text-dim';
const pager = 'rounded border border-line bg-panel2 px-2 py-0.5 text-[11.5px] disabled:text-faint';
</script>

<template>
  <div
    class="@container"
    style="--finished-cols: minmax(0, 1.3fr) minmax(0, 0.9fr) minmax(0, 1.3fr) 4.5rem 3.5rem 4.5rem"
  >
    <div class="mb-2.5 flex flex-wrap items-baseline gap-0.5">
      <button
        v-for="t in TABS"
        :key="t.key"
        class="rounded px-2.5 py-0.5 text-[12.5px]"
        :class="tab === t.key ? 'bg-[#232b35] text-text' : 'text-dim hover:text-text'"
        @click="go({ show: t.key })"
      >
        {{ t.name }}<span class="num ml-1 text-[11px] text-faint">{{ counts[t.key] }}</span>
      </button>
    </div>

    <Panel v-if="items.length === 0">
      <div class="px-3 py-3 text-dim">None yet. New… sets up a match or a tournament.</div>
    </Panel>

    <Panel v-if="notices.length > 0" title="Notices" :note="String(notices.length)">
      <div class="px-3 py-1">
        <div
          v-for="(n, k) in notices"
          :key="k"
          class="flex items-baseline gap-2 border-b border-row py-1 text-[12.5px] last:border-0"
        >
          <span
            class="size-[7px] shrink-0 -translate-y-px rounded-full"
            :class="n.severity === 'bad' ? 'bg-bad' : 'bg-warn'"
          />
          <RouterLink
            v-if="n.id"
            :to="`/tournaments/${n.id}`"
            class="max-w-[40%] shrink-0 truncate text-dim hover:text-text"
            >{{ n.where }}</RouterLink
          >
          <span v-else class="shrink-0 text-dim">{{ n.where }}</span>
          <span class="min-w-0">{{ n.text }}</span>
        </div>
      </div>
    </Panel>

    <!-- ── running ─────────────────────────────────────────────────────── -->
    <Panel
      v-if="shows('running') && (byGroup.running.length > 0 || tab === 'running')"
      title="Running"
      :note="
        byGroup.running.length > 0
          ? `${budget.games} at once · ${budget.hardware} threads`
          : undefined
      "
    >
      <div
        v-if="budget.games > budget.hardware"
        class="border-b border-row px-3 py-1.5 text-[12px] text-warn"
      >
        More games at once than threads: each plays slower than its time control assumes.
      </div>
      <div class="grid gap-2 p-2 @3xl:grid-cols-2">
        <div
          v-for="i in byGroup.running"
          :key="i.config.id"
          class="cursor-pointer rounded-md border border-line bg-panel2 px-2.5 py-2 hover:border-[#3a4553]"
          @click="open(i)"
        >
          <div class="flex items-baseline gap-2">
            <span class="min-w-0 flex-1 truncate font-medium">{{ i.config.name }}</span>
            <span v-if="statusText(i) !== 'running'" :class="[tag, statusClass(statusText(i))]">{{
              statusText(i)
            }}</span>
            <span v-if="etaOf(i, clock())" class="num shrink-0 text-[11.5px] text-dim">{{
              etaText(etaOf(i, clock())!)
            }}</span>
          </div>
          <div class="relative mt-1.5 h-1.5 overflow-hidden rounded bg-[#262c35]">
            <div
              class="absolute inset-y-0 left-0 bg-accent"
              :style="{ width: `${bar(i).done}%` }"
            />
            <div
              class="absolute inset-y-0 bg-bad"
              :style="{ left: `${bar(i).done}%`, width: `${bar(i).bad}%` }"
            />
            <div
              class="absolute inset-y-0 bg-[#3a6f99]"
              :style="{ left: `${bar(i).done + bar(i).bad}%`, width: `${bar(i).live}%` }"
            />
          </div>
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
          <div
            v-if="i.state.summary.match && i.state.games.length > 0"
            class="num mt-1.5 flex items-center gap-2.5 text-[11.5px] text-dim"
          >
            <template v-if="i.state.summary.match.llr !== null && i.state.summary.match.bounds">
              <span
                class="relative h-2.5 w-24 shrink-0"
                :title="`LLR between its bounds ${i.state.summary.match.bounds.lower.toFixed(2)} and ${i.state.summary.match.bounds.upper.toFixed(2)}`"
              >
                <span class="absolute inset-x-0 top-1 h-0.5 bg-[#333b46]" />
                <span class="absolute top-px left-1/2 h-2 w-px bg-faint" />
                <span
                  class="absolute top-0 h-2.5 w-1 -translate-x-1/2 rounded-sm bg-accent"
                  :style="{
                    left: `${llrAt(i.state.summary.match.llr, i.state.summary.match.bounds.lower, i.state.summary.match.bounds.upper)}%`,
                  }"
                />
              </span>
              <span class="shrink-0 text-text">LLR {{ i.state.summary.match.llr.toFixed(2) }}</span>
            </template>
            <span class="min-w-0 truncate">{{ standingText(i) }}</span>
            <span class="flex-1" />
            <span
              v-if="i.state.summary.match.model === 'pentanomial'"
              class="inline-flex h-3.5 shrink-0 items-end gap-px"
              :title="
                PTNML.map((k, n) => `${k} ${count(i.state.summary.match!.ptnml[n] ?? 0)}`).join(
                  ' · ',
                )
              "
            >
              <span
                v-for="(h, n) in ptnmlBars(i.state.summary.match.ptnml)"
                :key="n"
                class="w-1.5 rounded-[1px] bg-dim"
                :style="{ height: `${h}px` }"
              />
            </span>
            <span v-else class="shrink-0">W D L {{ i.state.summary.match.wdl.join(' ') }}</span>
          </div>
          <div v-else-if="standingText(i)" class="num mt-1.5 truncate text-[11.5px] text-dim">
            {{ standingText(i) }}
          </div>
        </div>
        <div v-if="byGroup.running.length === 0" class="px-1 py-1 text-dim">None running.</div>
      </div>
    </Panel>

    <!-- ── stopped ─────────────────────────────────────────────────────── -->
    <Panel
      v-if="shows('stopped') && (byGroup.stopped.length > 0 || tab === 'stopped')"
      title="Stopped"
    >
      <div
        v-for="i in byGroup.stopped"
        :key="i.config.id"
        class="cursor-pointer border-b border-row px-3 py-2 last:border-0 hover:bg-[#1c2128]"
        @click="open(i)"
      >
        <div class="flex items-baseline gap-2">
          <span class="min-w-0 flex-1 truncate">{{ i.config.name }}</span>
          <span :class="[tag, statusClass(statusText(i))]">{{ statusText(i) }}</span>
          <button
            :class="buttonClass"
            class="py-0!"
            :disabled="blocked(i)"
            :title="
              blocked(i)
                ? 'An engine or the book it needs is not here; see Notices'
                : 'Plays the unfinished games of its pairs, then the rest'
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
        class="hidden grid-cols-(--finished-cols) gap-3 border-b border-line px-3 py-1 text-[11.5px] text-dim @4xl:grid"
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
      <div v-if="recentPages > 1" class="flex items-center gap-2 border-t border-line px-3 py-1.5">
        <button :class="pager" :disabled="recentPage === 0" @click="recentPage--">‹</button>
        <span class="num text-[11.5px] text-dim">{{ recentPage + 1 }} of {{ recentPages }}</span>
        <button :class="pager" :disabled="recentPage >= recentPages - 1" @click="recentPage++">
          ›
        </button>
      </div>
    </Panel>

    <!-- ── the archive ─────────────────────────────────────────────────── -->
    <Panel
      v-if="shows('finished') && months.length > 0"
      title="Archive"
      :note="`${count(archivedCount)} finished over ${ARCHIVE_DAYS} days ago`"
    >
      <div v-for="[m, list] in months" :key="m" class="border-b border-row last:border-0">
        <button
          class="flex w-full items-baseline gap-2 px-3 py-1.5 text-left hover:bg-[#1c2128]"
          :aria-expanded="openMonth === m"
          @click="toggleMonth(m)"
        >
          <span class="w-3 text-faint">{{ openMonth === m ? '▾' : '▸' }}</span>
          <span>{{ monthName(m) }}</span>
          <span class="num text-[11.5px] text-faint">{{ list.length }}</span>
        </button>
        <template v-if="openMonth === m">
          <FinishedRow
            v-for="i in list.slice(monthPage * PAGE, (monthPage + 1) * PAGE)"
            :key="i.config.id"
            :item="i"
            :now="now"
            class="border-t border-row px-3 py-1.5"
          />
          <div
            v-if="list.length > PAGE"
            class="flex items-center gap-2 border-t border-row px-3 py-1.5"
          >
            <button
              :class="pager"
              :disabled="monthPage === 0"
              @click="go({ show: tab, month: m, page: String(monthPage) })"
            >
              ‹
            </button>
            <span class="num text-[11.5px] text-dim"
              >{{ monthPage + 1 }} of {{ Math.ceil(list.length / PAGE) }}</span
            >
            <button
              :class="pager"
              :disabled="(monthPage + 1) * PAGE >= list.length"
              @click="go({ show: tab, month: m, page: String(monthPage + 2) })"
            >
              ›
            </button>
          </div>
        </template>
      </div>
    </Panel>
  </div>
</template>
