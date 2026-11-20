<script setup lang="ts">
/**
 * One job of the manager: its setup, its units, its match's statistics and their course over the
 * pairs, each host's part, and the units that failed. Every number is the manager's or the job's
 * own tool's; the page computes none.
 */
import { computed } from 'vue';
import HelpTip from '../../components/HelpTip.vue';
import MatchCards from '../../components/MatchCards.vue';
import Panel from '../../components/Panel.vue';
import ProgressBar from '../../components/ProgressBar.vue';
import StatCard from '../../components/StatCard.vue';
import type { JobDetail } from '../../manager/api.ts';
import {
  clockText,
  endsText,
  jobTitle,
  setupText,
  unitParts,
  unitsText,
  statusTag,
  unitTimeText,
  waitingText,
} from '../../manager/show.ts';
import { count, signed } from '../../ui/format.ts';
import MatchChart, { type ChartPoint } from '../tourneys/MatchChart.vue';

const props = defineProps<{ job: JobDetail; now: number }>();

const s = computed(() => props.job.summary);
const tag = computed(() => statusTag(props.job));
const llrPoints = computed<ChartPoint[]>(() =>
  props.job.series.flatMap((p) => (p.llr === null ? [] : [{ pairs: p.pairs, value: p.llr }])),
);
const eloPoints = computed<ChartPoint[]>(() =>
  props.job.series.map((p) => ({
    pairs: p.pairs,
    value: p.elo.value,
    ci: p.elo.ci,
    note: `nElo ${signed(p.nelo.value)}`,
  })),
);
/** the hosts that have a part in the job so far, or may get one */
const hosts = computed(() =>
  props.job.byHost.filter((h) => h.done + h.running + h.failed > 0 || (h.concurrency ?? 0) > 0),
);
</script>

<template>
  <div class="@container min-w-0">
    <RouterLink to="/jobs" class="mb-2 inline-block text-dense text-accent wide:hidden"
      >‹ Jobs</RouterLink
    >
    <div class="mb-2 flex flex-wrap items-baseline gap-2">
      <span class="num text-title text-dim">{{ job.id }}</span>
      <h2 class="min-w-0 text-title font-semibold break-words">{{ jobTitle(job) }}</h2>
      <span class="tag" :class="tag.tone">{{ tag.text }}</span>
      <span class="tag tone-dim">{{ job.kind }}</span>
      <span v-if="job.allocation" class="tag tone-dim">allocation</span>
      <span v-if="job.priority !== 0" class="tag tone-warn">priority {{ job.priority }}</span>
    </div>
    <div v-if="s && setupText(s)" class="num mb-1 text-dense text-dim">{{ setupText(s) }}</div>
    <div class="num mb-3 text-small text-faint">{{ job.name }}</div>

    <template v-if="!job.allocation">
      <ProgressBar class="mb-1.5" size="thick" :parts="unitParts(job)" />
      <div class="num mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-small text-dim">
        <span>{{ unitsText(job) }}</span>
        <span v-if="(job.units.running ?? 0) > 0">{{ count(job.units.running ?? 0) }} in play</span>
        <span v-if="(job.units.failed ?? 0) > 0" class="text-bad"
          >{{ count(job.units.failed ?? 0) }} failed</span
        >
        <span class="flex-1" />
        <span v-if="job.state === 'running'">{{ endsText(job, now) }}</span>
        <span v-else-if="job.ended !== null">ended {{ clockText(job.ended, now) }}</span>
      </div>
      <div v-if="waitingText(job)" class="mb-3 text-small text-dim">{{ waitingText(job) }}</div>
    </template>

    <template v-if="s">
      <MatchCards v-if="s.nelo" :llr="s.llr" :nelo="s.nelo" :elo="s.elo">
        <StatCard label="games · pairs">
          <template #help>
            <HelpTip side="left"
              >The games played; under them the pairs by the candidate's score, 0, ½, 1, 1½ and 2
              points (pentanomial).</HelpTip
            >
          </template>
          <span class="text-title">{{ count(s.games ?? 0) }}</span>
          <template v-if="s.ptnml" #sub>{{ s.ptnml.join(' ') }}</template>
        </StatCard>
      </MatchCards>
      <div v-if="s.line" class="num mb-3 text-dense break-words">{{ s.line }}</div>
      <div v-if="s.forfeits !== '' && s.forfeits !== '0'" class="num mb-3 text-dense text-bad">
        forfeits {{ s.forfeits }}
      </div>
    </template>

    <Panel v-if="eloPoints.length >= 2" title="Over the pairs" note="hover for the values">
      <div class="grid gap-4 px-3 py-2.5 @3xl:grid-cols-2">
        <MatchChart
          v-if="llrPoints.length >= 2 && s?.llr"
          title="LLR"
          unit="pairs"
          :points="llrPoints"
          :marks="[s.llr.lower, s.llr.upper]"
          :digits="2"
        />
        <MatchChart title="Elo, with its 95% interval" unit="pairs" :points="eloPoints" />
      </div>
    </Panel>

    <Panel v-if="hosts.length > 0" title="By host">
      <div class="overflow-x-auto">
        <table class="w-full text-left text-dense">
          <thead class="text-small text-dim">
            <tr>
              <th class="th pl-3">host</th>
              <th class="th text-right">done</th>
              <th class="th text-right">in play</th>
              <th class="th text-right">failed</th>
              <th class="th text-right">at once</th>
              <th class="th pr-3 text-right">mean unit</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="h in hosts" :key="h.host" class="border-b border-row last:border-b-0">
              <td class="num px-2 py-1 pl-3 whitespace-nowrap">{{ h.host }}</td>
              <td class="num px-2 py-1 text-right">{{ count(h.done) }}</td>
              <td class="num px-2 py-1 text-right" :class="h.running > 0 ? '' : 'text-dim'">
                {{ count(h.running) }}
              </td>
              <td class="num px-2 py-1 text-right" :class="h.failed > 0 ? 'text-bad' : 'text-dim'">
                {{ count(h.failed) }}
              </td>
              <td class="num px-2 py-1 text-right text-dim">{{ h.concurrency ?? '—' }}</td>
              <td class="num px-2 py-1 pr-3 text-right text-dim">{{ unitTimeText(h.unitMs) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </Panel>

    <Panel v-if="job.failed.length > 0" title="Failed units" :note="String(job.failed.length)">
      <div
        v-for="f in job.failed"
        :key="f.seq"
        class="num flex gap-3 border-b border-row px-3 py-1 text-dense last:border-b-0"
      >
        <span>unit {{ f.seq }}</span>
        <span class="text-bad">exit {{ f.exit ?? '—' }}</span>
        <span class="text-dim">{{ f.host ?? '' }}</span>
      </div>
    </Panel>

    <div v-if="job.summaryAt !== null" class="num text-small text-faint">
      its tool posted this summary at {{ clockText(job.summaryAt, now) }}
    </div>
  </div>
</template>
