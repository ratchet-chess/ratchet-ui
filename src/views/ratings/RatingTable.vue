<script setup lang="ts">
/**
 * The rating list: one row per engine, by pool, then by rating. Under a narrow page the counts
 * that the score already sums (W, D, L, draw %) and the opponents' average fold away.
 */
import HelpTip from '../../components/HelpTip.vue';
import type { RatingList, Row } from '../../ratings/list.ts';
import { boundMark, losText, POOL_NOTE } from '../../ratings/report.ts';
import { count, signed } from '../../ui/format.ts';

const props = defineProps<{ list: RatingList; rows: readonly Row[] }>();

/** a pool's first row, after the first pool: a divider goes above it */
const opensPool = (k: number) => k > 0 && props.rows[k]?.pool !== props.rows[k - 1]?.pool;
/** a row's place in its pool, from 1 */
const place = (k: number) => {
  let n = 1;
  for (let i = k - 1; i >= 0 && props.rows[i]?.pool === props.rows[k]?.pool; i--) n++;
  return n;
};
/** on the anchor's scale in its pool, else signed about the pool's average */
const rating = (r: Row, elo: number) =>
  props.list.anchored && r.pool === 0 ? count(Math.round(elo)) : signed(elo, 0);
/** a share of forfeits worth a tag beside the name */
const forfeitShare = (r: Row) =>
  r.games && r.forfeits / r.games > 0.02 ? r.forfeits / r.games : 0;
const pct = (x: number) => (100 * x).toFixed(1);
</script>

<template>
  <div class="overflow-x-auto @container">
    <table class="w-full border-collapse text-dense">
      <thead>
        <tr class="text-right text-small text-dim">
          <th class="th">#</th>
          <th class="th w-[32%] text-left">engine</th>
          <th class="th">Elo</th>
          <th class="th">
            <span class="inline-flex items-center gap-1"
              >±
              <HelpTip side="left"
                >Half the 95% interval of the rating, against the anchor in its pool, else against
                the pool's average: not of the gap between two engines. LOS, and the ± in Head to
                head, read that gap. The interval comes from the spread of results over
                color-swapped pairs; under ten pairs, or with no spread, the model's stands where it
                is wider, in warning color. An engine that won or lost every game shows the floor
                (&gt;) or ceiling (&lt;) one draw would give.</HelpTip
              ></span
            >
          </th>
          <th class="th">games</th>
          <th class="th">score %</th>
          <th class="th hidden @3xl:table-cell">W</th>
          <th class="th hidden @3xl:table-cell">D</th>
          <th class="th hidden @3xl:table-cell">L</th>
          <th class="th hidden @3xl:table-cell">draw %</th>
          <th class="th hidden @3xl:table-cell">
            <span class="inline-flex items-center gap-1"
              >opp
              <HelpTip side="left"
                >The average rating of the opponents met, each weighed by the games played against
                it.</HelpTip
              ></span
            >
          </th>
          <th class="th">
            <span class="inline-flex items-center gap-1"
              >LOS
              <HelpTip side="left"
                >Likelihood of superiority over the next engine in the list, in percent: the chance
                that its rating is truly higher, from the covariance of the two ratings. Blank for
                the last engine of a pool and where an interval is the model's.</HelpTip
              ></span
            >
          </th>
        </tr>
      </thead>
      <tbody>
        <template v-for="(r, k) in rows" :key="r.name">
          <tr v-if="opensPool(k)">
            <td colspan="12" class="border-y border-line bg-panel2 px-2 py-1 text-small text-dim">
              {{ POOL_NOTE }}
            </td>
          </tr>
          <tr
            class="border-b border-row last:border-b-0 hover:bg-hover"
            :class="r.anchor && 'bg-selected'"
          >
            <td class="num px-2 py-1 text-right text-faint">{{ place(k) }}</td>
            <td class="num max-w-0 px-2 py-1">
              <span class="flex items-center gap-1.5">
                <span class="truncate" :title="r.name">{{ r.name }}</span>
                <span v-if="r.anchor" class="tag tone-accent">anchor</span>
                <span
                  v-if="forfeitShare(r)"
                  class="tag tone-warn"
                  :title="`${count(r.forfeits)} of its ${count(r.games)} games lost by a forfeit`"
                  >{{ Math.round(100 * forfeitShare(r)) }}% forfeits</span
                >
              </span>
            </td>
            <td class="num px-2 py-1 text-right">{{ boundMark(r) }}{{ rating(r, r.elo) }}</td>
            <td
              class="num px-2 py-1 text-right"
              :class="r.model ? 'text-warn' : 'text-dim'"
              :title="
                r.bound
                  ? `${r.bound === 'floor' ? 'Won' : 'Lost'} every game: no finite rating. Shown is the ${r.bound === 'floor' ? 'floor' : 'ceiling'} one draw would give`
                  : r.model
                    ? 'Too few pairs, or no spread in them: the interval is the model\'s'
                    : undefined
              "
            >
              {{ r.anchor || r.bound ? '—' : `±${count(Math.round(r.error))}` }}
            </td>
            <td
              class="num px-2 py-1 text-right"
              :title="`W ${count(r.wins)} · D ${count(r.draws)} · L ${count(r.losses)}`"
            >
              {{ count(r.games) }}
            </td>
            <td class="num px-2 py-1 text-right">{{ pct(r.score) }}</td>
            <td class="num hidden px-2 py-1 text-right text-good @3xl:table-cell">
              {{ count(r.wins) }}
            </td>
            <td class="num hidden px-2 py-1 text-right text-dim @3xl:table-cell">
              {{ count(r.draws) }}
            </td>
            <td class="num hidden px-2 py-1 text-right text-bad @3xl:table-cell">
              {{ count(r.losses) }}
            </td>
            <td class="num hidden px-2 py-1 text-right @3xl:table-cell">
              {{ pct(r.draws / r.games) }}
            </td>
            <td class="num hidden px-2 py-1 text-right text-dim @3xl:table-cell">
              {{ rating(r, r.opponents) }}
            </td>
            <td class="num px-2 py-1 text-right">{{ losText(r.los) }}</td>
          </tr>
        </template>
      </tbody>
    </table>
  </div>
</template>
