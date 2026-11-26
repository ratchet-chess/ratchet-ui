<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import ManagerGate from '../components/ManagerGate.vue';
import NoticeList from '../components/NoticeList.vue';
import OutcomeLine from '../components/OutcomeLine.vue';
import PageHeader from '../components/PageHeader.vue';
import Panel from '../components/Panel.vue';
import ProgressBar from '../components/ProgressBar.vue';
import type { Job } from '../manager/api.ts';
import JobPage from './jobs/JobPage.vue';
import {
  endText,
  finishingText,
  headline,
  jobTitle,
  notices,
  outcomeText,
  statusTag,
  testText,
  unitParts,
  unitsNote,
  unitsText,
  verdictLlr,
  verdictTag,
  waitingDetail,
  waitingText,
} from '../manager/show.ts';
import { useManager } from '../stores/manager.ts';
import { clockText, count } from '../ui/format.ts';

const manager = useManager();
const route = useRoute();
const router = useRouter();

/** the job whose page is open, from the address; null for the list alone */
const selected = computed(() => {
  const id = route.params['id'];
  return typeof id === 'string' && /^\d+$/.test(id) ? Number(id) : null;
});
watch(selected, (id) => manager.open(id), { immediate: true });
onBeforeUnmount(() => manager.open(null));
const open = (j: Job) => void router.push(`/jobs/${j.id}`);

/** the last read's time stands for now, so a row's text changes only with a read */
const now = computed(() => manager.readAt ?? 0);
const byState = (state: Job['state']) => manager.jobs.filter((j) => j.state === state);
const running = computed(() => byState('running'));
/** queued jobs in the queue's own order: by priority, then by age */
const queued = computed(() => byState('queued'));
const ended = computed(() =>
  manager.jobs
    .filter((j) => j.state === 'done' || j.state === 'cancelled')
    .toSorted((a, b) => (b.ended ?? 0) - (a.ended ?? 0)),
);
const notes = computed(() => notices(manager.hosts, manager.jobs));
const sub = computed(() =>
  manager.readAt === null
    ? 'manager · read only'
    : `${headline(manager.hosts, manager.jobs)} · read only`,
);

/** the list beside an open job: the same jobs, a row each */
const groups = computed(() => [
  { name: 'Running', jobs: running.value },
  { name: 'Queued', jobs: queued.value },
  { name: 'Done', jobs: ended.value },
]);

const line1 = 'flex items-baseline gap-2';
const line2 = 'num mt-1 flex items-baseline gap-2 text-small text-dim';
const hostsOf = (j: Job) => j.hosts.join(' ');
</script>

<template>
  <PageHeader title="Jobs" :sub="sub" />
  <ManagerGate />

  <template v-if="manager.readAt !== null && selected === null">
    <Panel v-if="notes.length > 0" title="Notices" :note="String(notes.length)">
      <NoticeList :notices="notes" />
    </Panel>

    <Panel title="Running" :note="String(running.length)">
      <div v-if="running.length === 0" class="px-3 py-2 text-dense text-dim">No running jobs.</div>
      <div v-for="j in running" :key="j.id" class="row px-3 py-2" @click="open(j)">
        <div :class="line1">
          <span class="num shrink-0 text-dim">{{ j.id }}</span>
          <span class="min-w-0 flex-1 truncate font-medium" :title="j.name">{{ jobTitle(j) }}</span>
          <span v-if="j.allocation" class="tag tone-dim">allocation</span>
          <span v-if="j.priority !== 0" class="tag tone-warn">priority {{ j.priority }}</span>
          <span class="num shrink-0 text-small text-dim">{{ endText(j, now) }}</span>
        </div>
        <ProgressBar v-if="!j.allocation" class="mt-1.5" :parts="unitParts(j)" />
        <div :class="line2">
          <span class="min-w-0 truncate">{{ testText(j) || `${j.kind} · ${hostsOf(j)}` }}</span>
          <span class="flex-1" />
          <span v-if="(j.units.failed ?? 0) > 0" class="shrink-0 text-bad"
            >{{ count(j.units.failed ?? 0) }} failed</span
          >
          <span v-if="(j.units.running ?? 0) > 0" class="shrink-0"
            >{{ count(j.units.running ?? 0) }} in play</span
          >
          <span v-if="!j.allocation" class="shrink-0">{{ unitsText(j) }}</span>
        </div>
        <OutcomeLine
          v-if="j.summary && outcomeText(j)"
          :llr="verdictLlr(j.summary)"
          :text="outcomeText(j)"
          :ptnml="j.summary.line === '' ? j.summary.ptnml : null"
        />
        <div
          v-if="unitsNote(j)"
          class="mt-0.5 truncate text-small text-dim"
          :title="finishingText(j) || waitingDetail(j)"
        >
          {{ unitsNote(j) }}
        </div>
      </div>
    </Panel>

    <Panel v-if="queued.length > 0" title="Queued" :note="String(queued.length)">
      <div v-for="j in queued" :key="j.id" class="row px-3 py-2" @click="open(j)">
        <div :class="line1">
          <span class="num shrink-0 text-dim">{{ j.id }}</span>
          <span class="min-w-0 flex-1 truncate font-medium" :title="j.name">{{ jobTitle(j) }}</span>
          <span v-if="j.priority !== 0" class="tag tone-warn">priority {{ j.priority }}</span>
          <span class="tag tone-dim">{{ j.kind }}</span>
        </div>
        <div :class="line2">
          <span class="shrink-0">{{ hostsOf(j) }}</span>
          <span class="flex-1" />
          <span class="min-w-0 truncate" :title="waitingDetail(j)">{{ waitingText(j) }}</span>
        </div>
      </div>
    </Panel>

    <Panel title="Done" note="last 24 h">
      <div v-if="ended.length === 0" class="px-3 py-2 text-dense text-dim">
        No jobs finished in the last 24 h.
      </div>
      <div v-for="j in ended" :key="j.id" class="row px-3 py-1.5" @click="open(j)">
        <div :class="line1">
          <span class="num shrink-0 text-dim">{{ j.id }}</span>
          <span class="min-w-0 flex-1 truncate" :title="j.name">{{ jobTitle(j) }}</span>
          <span v-if="(j.units.failed ?? 0) > 0" class="tag tone-bad"
            >{{ count(j.units.failed ?? 0) }} failed</span
          >
          <span v-if="verdictTag(j)" class="tag" :class="verdictTag(j)?.tone">{{
            verdictTag(j)?.text
          }}</span>
          <span
            v-else
            class="tag tone-dim"
            :title="
              j.state === 'cancelled' ? 'Stopped early (stop rule or manual cancel)' : undefined
            "
            >{{ j.state === 'cancelled' ? 'stopped' : j.state }}</span
          >
          <span class="num w-28 shrink-0 text-right text-small text-dim">{{
            j.ended === null ? '' : clockText(j.ended, now)
          }}</span>
        </div>
        <div
          v-if="outcomeText(j)"
          class="num mt-0.5 truncate text-small text-dim"
          :title="outcomeText(j)"
        >
          {{ [testText(j), outcomeText(j)].filter((t) => t !== '').join(' · ') }}
        </div>
      </div>
    </Panel>
  </template>

  <div
    v-else-if="manager.readAt !== null"
    class="grid gap-3.5 wide:grid-cols-[minmax(300px,380px)_1fr]"
  >
    <div class="hidden wide:block">
      <Panel>
        <template v-for="g in groups" :key="g.name">
          <div
            v-if="g.jobs.length > 0"
            class="border-b border-line bg-panel2 px-3 py-1 text-label tracking-widest text-dim uppercase"
          >
            {{ g.name }}
            <span class="tracking-normal text-faint">{{ g.jobs.length }}</span>
          </div>
          <div
            v-for="j in g.jobs"
            :key="j.id"
            class="row px-3 py-2"
            :class="j.id === selected ? 'bg-selected' : ''"
            @click="open(j)"
          >
            <div class="flex items-baseline gap-2">
              <span class="num shrink-0 text-dim">{{ j.id }}</span>
              <span class="min-w-0 flex-1 truncate" :title="j.name">{{ jobTitle(j) }}</span>
              <span class="tag" :class="statusTag(j).tone">{{ statusTag(j).text }}</span>
            </div>
            <div class="num mt-0.5 flex gap-2 text-small text-dim">
              <span class="min-w-0 flex-1 truncate">{{ testText(j) || j.kind }}</span>
              <span v-if="!j.allocation" class="shrink-0">{{ unitsText(j) }}</span>
            </div>
            <ProgressBar
              v-if="j.state === 'running' && !j.allocation"
              class="mt-1"
              :parts="unitParts(j)"
            />
          </div>
        </template>
        <div v-if="manager.jobs.length === 0" class="px-3 py-3 text-dim">No jobs.</div>
      </Panel>
    </div>

    <JobPage v-if="manager.job" :key="manager.job.id" :job="manager.job" :now="now" />
    <div v-else>
      <RouterLink to="/jobs" class="mb-2 inline-block text-dense text-accent wide:hidden"
        >‹ Jobs</RouterLink
      >
      <div class="text-dense text-dim">
        {{ manager.jobMissing ? `Job ${selected} not found.` : `Loading job ${selected}…` }}
      </div>
    </div>
  </div>
</template>
