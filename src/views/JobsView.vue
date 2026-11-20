<script setup lang="ts">
import { computed } from 'vue';
import ManagerGate from '../components/ManagerGate.vue';
import NoticeList from '../components/NoticeList.vue';
import PageHeader from '../components/PageHeader.vue';
import Panel from '../components/Panel.vue';
import ProgressBar from '../components/ProgressBar.vue';
import type { Job } from '../manager/api.ts';
import {
  clockText,
  endText,
  headline,
  notices,
  unitParts,
  unitsText,
  waitingText,
} from '../manager/show.ts';
import { useManager } from '../stores/manager.ts';
import { count } from '../ui/format.ts';

const manager = useManager();

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
    ? 'on the manager · read only'
    : `${headline(manager.hosts, manager.jobs)} · read only`,
);

const line1 = 'flex items-baseline gap-2';
const line2 = 'num mt-1 flex items-baseline gap-2 text-small text-dim';
const hostsOf = (j: Job) => j.hosts.join(' ');
</script>

<template>
  <PageHeader title="Jobs" :sub="sub" />
  <ManagerGate />

  <template v-if="manager.readAt !== null">
    <Panel v-if="notes.length > 0" title="Notices" :note="String(notes.length)">
      <NoticeList :notices="notes" />
    </Panel>

    <Panel title="Running" :note="String(running.length)">
      <div v-if="running.length === 0" class="px-3 py-2 text-dense text-dim">
        Nothing is running.
      </div>
      <div v-for="j in running" :key="j.id" class="border-b border-row px-3 py-2 last:border-b-0">
        <div :class="line1">
          <span class="num shrink-0 text-dim">{{ j.id }}</span>
          <span class="min-w-0 flex-1 truncate font-medium">{{ j.name }}</span>
          <span v-if="j.allocation" class="tag tone-dim">allocation</span>
          <span v-if="j.priority !== 0" class="tag tone-warn">priority {{ j.priority }}</span>
          <span class="num shrink-0 text-small text-dim">{{ endText(j, now) }}</span>
        </div>
        <ProgressBar v-if="!j.allocation" class="mt-1.5" :parts="unitParts(j)" />
        <div :class="line2">
          <span class="min-w-0 truncate">{{ j.kind }} · {{ hostsOf(j) }}</span>
          <span class="flex-1" />
          <span v-if="(j.units.failed ?? 0) > 0" class="shrink-0 text-bad"
            >{{ count(j.units.failed ?? 0) }} failed</span
          >
          <span v-if="(j.units.running ?? 0) > 0" class="shrink-0"
            >{{ count(j.units.running ?? 0) }} in play</span
          >
          <span v-if="!j.allocation" class="shrink-0">{{ unitsText(j) }}</span>
        </div>
        <div
          v-if="waitingText(j)"
          class="mt-0.5 truncate text-small text-dim"
          :title="waitingText(j)"
        >
          {{ waitingText(j) }}
        </div>
      </div>
    </Panel>

    <Panel v-if="queued.length > 0" title="Queued" :note="String(queued.length)">
      <div v-for="j in queued" :key="j.id" class="border-b border-row px-3 py-2 last:border-b-0">
        <div :class="line1">
          <span class="num shrink-0 text-dim">{{ j.id }}</span>
          <span class="min-w-0 flex-1 truncate font-medium">{{ j.name }}</span>
          <span v-if="j.priority !== 0" class="tag tone-warn">priority {{ j.priority }}</span>
          <span class="tag tone-dim">{{ j.kind }}</span>
        </div>
        <div :class="line2">
          <span class="shrink-0">{{ hostsOf(j) }}</span>
          <span class="flex-1" />
          <span class="min-w-0 truncate" :title="waitingText(j)">{{ waitingText(j) }}</span>
        </div>
      </div>
    </Panel>

    <Panel title="Done" note="the last day">
      <div v-if="ended.length === 0" class="px-3 py-2 text-dense text-dim">
        Nothing ended in the last day.
      </div>
      <div v-for="j in ended" :key="j.id" class="border-b border-row px-3 py-1.5 last:border-b-0">
        <div :class="line1">
          <span class="num shrink-0 text-dim">{{ j.id }}</span>
          <span class="min-w-0 flex-1 truncate">{{ j.name }}</span>
          <span v-if="(j.units.failed ?? 0) > 0" class="tag tone-bad"
            >{{ count(j.units.failed ?? 0) }} failed</span
          >
          <span
            class="tag tone-dim"
            :title="
              j.state === 'cancelled'
                ? 'Its queued units were dropped: by its own stop rule, or by a cancel'
                : undefined
            "
            >{{ j.state === 'cancelled' ? 'stopped' : j.state }}</span
          >
          <span class="num w-28 shrink-0 text-right text-small text-dim">{{
            j.ended === null ? '' : clockText(j.ended, now)
          }}</span>
        </div>
      </div>
    </Panel>
  </template>
</template>
