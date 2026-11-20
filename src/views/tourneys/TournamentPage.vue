<script setup lang="ts">
/** One match's or tournament's page: its statistics, standings, bracket and games. */
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import HelpTip from '../../components/HelpTip.vue';
import Pager from '../../components/Pager.vue';
import Panel from '../../components/Panel.vue';
import MatchCards from '../../components/MatchCards.vue';
import StatCard from '../../components/StatCard.vue';
import { bracket } from '../../match/director.ts';
import { BYE, gameNumber, gamesPerPair, plannedGames } from '../../match/format.ts';
import { matchText, score, standingsText, TIEBREAK_NAMES, tiebreaks } from '../../match/report.ts';
import { matchSeries } from '../../match/series.ts';
import { pointsOf, type GameRecord, type PairRecord } from '../../match/summary.ts';
import { useGames } from '../../stores/games.ts';
import { collectionOf, useTournaments, type Item } from '../../stores/tournaments.ts';
import MatchChart, { type ChartPoint } from './MatchChart.vue';
import { signed } from '../../ui/format.ts';
import { formatText, label, progress, roundName, statusClass, statusText } from './show.ts';

const props = defineProps<{ item: Item }>();
const tournaments = useTournaments();
const router = useRouter();

/** a knockout's bracket, round by round */
const bracketRounds = computed(() => {
  const i = props.item;
  if (i.config.format.kind !== 'knockout') return [];
  return bracket(i.config.entrants.length, i.config.format.pairs, i.state.pairs, i.state.games);
});
/** a tournament this tab may play on or delete: not done, and not played by a tab */
const idle = (i: Item) => !tournaments.running(i.config.id) && !i.elsewhere;

async function remove(i: Item): Promise<void> {
  if (!confirm(`Delete “${i.config.name}”? Its games stay in Games.`)) return;
  try {
    await tournaments.remove(i.config.id);
    await router.push('/tournaments');
  } catch (e) {
    i.state.error = `It could not be deleted: ${e instanceof Error ? e.message : String(e)}`;
  }
}

/** a game's number in its tournament, as its PGN Round tag ends */
/** games an opening gives in this tournament */
const per = computed(() => gamesPerPair(props.item.config.format, props.item.config.paired));
const number = (g: { pair: number; game: number }) => gameNumber(g.pair, g.game, per.value);
/** the last games to finish, by number, newest first */
const recent = computed(() =>
  props.item.state.games.slice(-12).toSorted((a, b) => number(b) - number(a)),
);
const pairOf = computed(() => new Map(props.item.state.pairs.map((p) => [p.pair, p])));
/** opens a finished game in Games, found there by its PGN Round tag */
function openGame(g: GameRecord): void {
  const round = (pairOf.value.get(g.pair)?.round ?? 0) + 1;
  void router.push({
    path: `/games/${collectionOf(props.item.config.id)}`,
    query: { round: `${round}.${number(g)}` },
  });
}

const games = useGames();
async function exportPgn(): Promise<void> {
  const id = collectionOf(props.item.config.id);
  await games.load();
  if (!games.list.some((c) => c.id === id && c.games > 0)) {
    tell('no PGN: its games were deleted from Games');
    return;
  }
  await games.download(id, props.item.config.name);
}

// ── statistics over the pairs ──────────────────────────────────────────────
const series = computed(() => {
  const f = props.item.config.format;
  return f.kind === 'match'
    ? matchSeries(props.item.state.games, f.sprt, 200, props.item.config.paired)
    : [];
});
const llrPoints = computed<ChartPoint[]>(() =>
  series.value.flatMap((p) => (p.llr === null ? [] : [{ pairs: p.pairs, value: p.llr }])),
);
const eloPoints = computed<ChartPoint[]>(() =>
  series.value.map((p) => ({
    pairs: p.pairs,
    value: p.elo.value,
    ci: p.elo.ci,
    note: `nElo ${signed(p.nelo.value)}`,
  })),
);

// ── standings and crosstable ───────────────────────────────────────────────
const breaks = computed(() => tiebreaks(props.item.config.format));
const TIEBREAK_HELP = {
  buchholz:
    'Buchholz: the points of the opponents met, once per game. It breaks a tie on points first in a Swiss.',
  sb: 'Sonneborn-Berger: for each opponent, the points scored against it times its points. It breaks a tie on points.',
} as const;
const isSwiss = computed(() => props.item.config.format.kind === 'swiss');
/** the crosstable's rows and columns, in standings order, so its numbers are the standings' */
const crossOrder = computed(() => props.item.state.summary.standings.map((r) => r.entrant));

// ── the schedule ───────────────────────────────────────────────────────────
const SCHEDULE_PAGE = 40;
const scheduleOpen = ref(false);
const schedulePage = ref(0);
/** the issued pairs, newest first */
const issued = computed(() => props.item.state.pairs.toReversed());
const schedulePages = computed(() => Math.max(1, Math.ceil(issued.value.length / SCHEDULE_PAGE)));
const scheduleRows = computed(() =>
  issued.value.slice(schedulePage.value * SCHEDULE_PAGE, (schedulePage.value + 1) * SCHEDULE_PAGE),
);
/** pairs a fixed schedule has yet to issue; null where the director pairs from results */
const unissued = computed(() => {
  const f = props.item.config.format;
  if (f.kind === 'swiss' || f.kind === 'knockout') return null;
  const total =
    plannedGames(f, props.item.config.entrants.length, props.item.config.paired) / per.value;
  return Math.max(0, total - props.item.state.pairs.length);
});
const gamesByPair = computed(() => {
  const m = new Map<number, GameRecord[]>();
  for (const g of props.item.state.games) m.set(g.pair, [...(m.get(g.pair) ?? []), g]);
  return m;
});
/** points as a reader writes them: ½ for a half */
const halves = (p: number) => `${Math.floor(p) || (p % 1 ? '' : '0')}${p % 1 ? '½' : ''}`;
/** what became of a pair: its score in the order it is listed, and whether it plays or waits */
function pairState(p: PairRecord): string {
  if (p.b === BYE) return 'bye';
  const done = gamesByPair.value.get(p.pair) ?? [];
  const playing = props.item.state.live.some((g) => g.pair === p.pair);
  if (done.length === 0) return playing ? 'playing' : 'waiting';
  const a = done.reduce((t, g) => t + pointsOf(g.result, g.white === p.a), 0);
  const result = `${halves(a)}–${halves(done.length - a)}`;
  return playing ? `${result}, playing` : result;
}
/** a match gives every pair its own round, so only the other formats group by round */
const byRound = computed(() => props.item.config.format.kind !== 'match');

// ── copy as text ───────────────────────────────────────────────────────────
/** what Copy or PGN did, shown for a moment beside the buttons */
const notice = ref('');
function tell(text: string): void {
  notice.value = text;
  setTimeout(() => (notice.value = ''), 4000);
}
async function copy(): Promise<void> {
  const i = props.item;
  const setup = `${formatText(i.config.format, i.config.paired)} · ${i.config.control} · ${i.config.book || 'start position'}`;
  const names = i.config.entrants.map((_, n) => label(i, n));
  const text = i.state.summary.match
    ? matchText(i.config.name, setup, i.state.summary.match)
    : standingsText(
        `${i.config.name}: ${setup}`,
        i.config.format,
        i.state.summary.standings,
        names,
        `${progress(i)} games`,
      );
  try {
    await navigator.clipboard.writeText(text);
    tell('copied');
  } catch (e) {
    tell(`not copied: ${e instanceof Error ? e.message : String(e)}`);
  }
}
</script>

<template>
  <div class="@container">
    <RouterLink to="/tournaments" class="mb-2 inline-block text-dense text-accent wide:hidden"
      >‹ Tourneys</RouterLink
    >
    <div class="mb-2 flex flex-wrap items-baseline gap-2">
      <h2 class="text-title font-semibold">{{ item.config.name }}</h2>
      <span class="tag" :class="statusClass(statusText(item))">{{ statusText(item) }}</span>
      <span class="flex-1" />
      <span v-if="notice" class="text-dense text-dim">{{ notice }}</span>
      <template v-if="tournaments.running(item.config.id)">
        <button
          class="btn"
          :disabled="item.state.status !== 'running'"
          @click="tournaments.stop(item.config.id, false)"
        >
          Stop after these games
        </button>
        <button class="btn" @click="tournaments.stop(item.config.id, true)">Stop now</button>
      </template>
      <template v-else-if="idle(item)">
        <button
          v-if="item.ended !== 'done'"
          class="btn"
          title="Plays the unfinished games of its pairs, then the rest"
          @click="tournaments.resume(item.config.id)"
        >
          Resume
        </button>
        <button class="btn" @click="remove(item)">Delete</button>
      </template>
      <RouterLink :to="`/games/${collectionOf(item.config.id)}`" class="btn">Games</RouterLink>
      <RouterLink
        :to="{ path: '/tournaments/new', query: { from: item.config.id } }"
        class="btn"
        title="A new setup with this one's settings"
        >Clone</RouterLink
      >
      <button
        class="btn"
        title="Download the games played so far as one PGN file"
        :disabled="item.state.games.length === 0"
        @click="exportPgn"
      >
        PGN
      </button>
      <button
        class="btn"
        :title="
          item.state.summary.match
            ? 'Copy the statistics as text, as OpenBench writes them'
            : 'Copy the standings as text'
        "
        @click="copy"
      >
        Copy
      </button>
    </div>
    <div class="num mb-3 text-dense text-dim">
      {{ formatText(item.config.format, item.config.paired) }} · {{ item.config.control }} ·
      {{ item.config.book || 'start position' }} ·
      {{
        item.config.adjudication
          ? item.config.adjudication.resign
            ? 'draw and resign adjudication'
            : 'draw adjudication'
          : 'no adjudication'
      }}
      · {{ item.config.concurrency }} at once · {{ progress(item) }} games
    </div>
    <div v-if="item.state.error" class="mb-3 text-bad">{{ item.state.error }}</div>

    <template v-if="item.state.summary.match">
      <MatchCards
        :llr="
          item.state.summary.match.llr !== null && item.state.summary.match.bounds
            ? {
                value: item.state.summary.match.llr,
                lower: item.state.summary.match.bounds.lower,
                upper: item.state.summary.match.bounds.upper,
              }
            : null
        "
        :nelo="item.state.summary.match.nelo"
        :elo="item.state.summary.match.elo"
      >
        <StatCard :label="per === 2 ? 'W D L · pairs' : 'W D L'">
          <template v-if="per === 2" #help>
            <HelpTip side="left"
              >The tested engine's wins, draws and losses; under them the pairs by their score from
              its side, 0, ½, 1, 1½ and 2 points (pentanomial).</HelpTip
            >
          </template>
          <span class="text-title">{{ item.state.summary.match.wdl.join(' ') }}</span>
          <template v-if="item.state.summary.match.model === 'pentanomial'" #sub>{{
            item.state.summary.match.ptnml.join(' ')
          }}</template>
        </StatCard>
      </MatchCards>
      <Panel
        v-if="eloPoints.length >= 2"
        :title="per === 2 ? 'Over the pairs' : 'Over the games'"
        note="hover for the values"
      >
        <div class="grid gap-4 px-3 py-2.5 @3xl:grid-cols-2">
          <MatchChart
            v-if="llrPoints.length >= 2 && item.state.summary.match.bounds"
            title="LLR"
            :unit="per === 2 ? 'pairs' : 'games'"
            :points="llrPoints"
            :marks="[item.state.summary.match.bounds.lower, item.state.summary.match.bounds.upper]"
            :digits="2"
          />
          <MatchChart
            title="Elo, with its 95% interval"
            :unit="per === 2 ? 'pairs' : 'games'"
            :points="eloPoints"
          />
        </div>
      </Panel>
    </template>

    <Panel v-else title="Standings">
      <div class="overflow-x-auto">
        <table class="w-full border-collapse text-dense">
          <thead>
            <tr class="text-left text-small text-dim">
              <th class="th">#</th>
              <th class="th">engine</th>
              <th class="th text-right">games</th>
              <th class="th text-right">W</th>
              <th class="th text-right">D</th>
              <th class="th text-right">L</th>
              <th class="th text-right">points</th>
              <th class="th text-right">score</th>
              <th v-if="isSwiss" class="th text-right">byes</th>
              <th v-for="t in breaks" :key="t" class="th text-right">
                <span class="inline-flex items-center gap-1">
                  {{ TIEBREAK_NAMES[t] }}
                  <HelpTip side="left">{{ TIEBREAK_HELP[t] }}</HelpTip>
                </span>
              </th>
              <th class="th text-right">Elo vs field</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(r, n) in item.state.summary.standings"
              :key="r.entrant"
              class="border-b border-row last:border-0"
            >
              <td class="num px-2 py-1 text-faint">{{ n + 1 }}</td>
              <td class="num px-2 py-1 whitespace-nowrap">{{ label(item, r.entrant) }}</td>
              <td class="num px-2 py-1 text-right">{{ r.games }}</td>
              <td class="num px-2 py-1 text-right">{{ r.wins }}</td>
              <td class="num px-2 py-1 text-right">{{ r.draws }}</td>
              <td class="num px-2 py-1 text-right">{{ r.losses }}</td>
              <td class="num px-2 py-1 text-right">{{ r.points }}</td>
              <td class="num px-2 py-1 text-right">
                {{ score(r) === null ? '—' : `${(100 * (score(r) ?? 0)).toFixed(1)}%` }}
              </td>
              <td v-if="isSwiss" class="num px-2 py-1 text-right">{{ r.byes }}</td>
              <td v-for="t in breaks" :key="t" class="num px-2 py-1 text-right">
                {{ Number(r[t].toFixed(2)) }}
              </td>
              <td class="num px-2 py-1 text-right">
                {{ r.elo === null ? '—' : signed(r.elo, 0) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </Panel>

    <Panel v-if="bracketRounds.length > 0" title="Bracket" note="points over finished pairs">
      <div class="grid gap-3 px-3 py-2 text-dense @3xl:grid-flow-col">
        <div v-for="(round, r) in bracketRounds" :key="r">
          <div class="caps mb-1 text-label">
            {{ roundName(r, bracketRounds.length) }}
          </div>
          <div
            v-for="(t, k) in round"
            :key="k"
            class="num mb-1.5 rounded border border-line bg-panel2 px-2 py-1"
          >
            <div
              v-for="(side, s) in [t.a, t.b]"
              :key="s"
              class="flex gap-2"
              :class="t.winner !== null && side === t.winner ? 'text-text' : 'text-dim'"
            >
              <span class="flex-1 truncate">{{
                side === null ? (t.by === 'bye' ? 'bye' : '…') : label(item, side)
              }}</span>
              <span v-if="t.pairs.length > 0">{{ t.points[s] }}</span>
            </div>
            <div v-if="t.by === 'seed'" class="text-small text-faint">
              tied after {{ t.done }} pairs: the higher seed goes through
            </div>
          </div>
        </div>
      </div>
    </Panel>

    <Panel
      v-if="
        (item.config.format.kind === 'roundrobin' || item.config.format.kind === 'swiss') &&
        item.config.entrants.length <= 12
      "
      title="Crosstable"
      note="points of the row's engine against the column's, over games played; in standings order"
    >
      <div class="overflow-x-auto">
        <table class="border-collapse text-dense">
          <thead>
            <tr class="text-small text-dim">
              <th class="px-2 py-0.5 font-medium" />
              <th class="px-2 py-0.5" />
              <th v-for="(_, k) in crossOrder" :key="k" class="num px-2 py-0.5 font-medium">
                {{ k + 1 }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(i, n) in crossOrder" :key="i">
              <td class="num px-2 py-0.5 text-right text-faint">{{ n + 1 }}</td>
              <td class="num px-2 py-0.5 whitespace-nowrap text-dim">{{ label(item, i) }}</td>
              <td
                v-for="j in crossOrder"
                :key="j"
                class="num px-2 py-0.5 text-center"
                :class="i === j ? 'text-faint' : ''"
              >
                {{
                  i === j
                    ? '·'
                    : (item.state.summary.games[i]?.[j] ?? 0)
                      ? `${item.state.summary.points[i]?.[j] ?? 0}/${item.state.summary.games[i]?.[j]}`
                      : ''
                }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </Panel>

    <Panel
      title="Schedule"
      :note="`${item.state.pairs.length} ${per === 2 ? 'pairs' : 'games'} issued${unissued === null ? '; the next are paired from results' : unissued > 0 ? `, ${unissued} to come` : ''}`"
    >
      <div class="px-3 py-1.5 text-dense">
        <button class="text-dense text-dim hover:text-text" @click="scheduleOpen = !scheduleOpen">
          {{
            scheduleOpen
              ? `▾ hide the ${per === 2 ? 'pairs' : 'games'}`
              : `▸ show the ${per === 2 ? 'pairs' : 'games'}, newest first`
          }}
        </button>
        <template v-if="scheduleOpen">
          <div
            v-for="(p, k) in scheduleRows"
            :key="p.pair"
            class="num grid grid-cols-[3rem_minmax(0,1.3fr)_minmax(0,1fr)_7rem] gap-2 py-0.5"
          >
            <div
              v-if="byRound && (k === 0 || scheduleRows[k - 1]?.round !== p.round)"
              class="caps col-span-4 mt-1.5 text-label"
            >
              {{
                item.config.format.kind === 'knockout'
                  ? roundName(p.round, bracketRounds.length)
                  : `round ${p.round + 1}`
              }}
            </div>
            <span class="text-faint">{{ p.pair + 1 }}</span>
            <span class="truncate"
              >{{ label(item, p.a) }}
              <template v-if="p.b !== BYE">
                <span class="text-dim">–</span> {{ label(item, p.b) }}</template
              ></span
            >
            <span class="truncate text-dim" :title="p.opening">{{
              p.b === BYE ? '' : p.opening || 'start position'
            }}</span>
            <span class="text-right text-dim">{{ pairState(p) }}</span>
          </div>
          <Pager v-model="schedulePage" :pages="schedulePages" class="mt-1.5" />
        </template>
      </div>
    </Panel>

    <Panel
      v-if="item.state.live.length > 0"
      title="Playing"
      :note="`${item.state.live.length} game${item.state.live.length === 1 ? '' : 's'}`"
    >
      <div class="num max-h-60 overflow-auto px-3 py-1.5 text-dense">
        <div v-for="g in item.state.live" :key="`${g.pair}.${g.game}`" class="flex gap-2 py-0.5">
          <span class="w-14 text-faint">{{ number(g) }}</span>
          <span class="flex-1 truncate"
            >{{ label(item, g.white) }} <span class="text-dim">vs</span>
            {{ label(item, g.black) }}</span
          >
          <span class="text-dim">{{ g.plies }} plies {{ g.last }}</span>
        </div>
      </div>
    </Panel>

    <Panel title="Last games" note="by number, highest first; a click opens the game">
      <div class="num px-1.5 py-1 text-dense">
        <button
          v-for="g in recent"
          :key="`${g.pair}.${g.game}`"
          class="grid w-full grid-cols-[3rem_minmax(0,1.2fr)_4.5rem_minmax(0,1fr)] gap-2 rounded px-1.5 py-0.5 text-left hover:bg-hover"
          @click="openGame(g)"
        >
          <span class="text-faint">{{ number(g) }}</span>
          <span class="truncate"
            >{{ label(item, g.white) }} <span class="text-dim">vs</span>
            {{ label(item, g.black) }}</span
          >
          <span class="text-right">{{ g.result }}</span>
          <span class="truncate text-dim" :title="g.reason">{{ g.reason }}</span>
        </button>
        <div v-if="recent.length === 0" class="text-faint">none yet</div>
      </div>
    </Panel>
  </div>
</template>
