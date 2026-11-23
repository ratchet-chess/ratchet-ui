<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import PageHeader from '../components/PageHeader.vue';
import Panel from '../components/Panel.vue';
import ProgressBar from '../components/ProgressBar.vue';
import { useBooks } from '../stores/books.ts';
import { useTournaments, type Item } from '../stores/tournaments.ts';
import { archived, groupOf, type Group } from './tourneys/overview.ts';
import TournamentOverview from './tourneys/TournamentOverview.vue';
import TournamentPage from './tourneys/TournamentPage.vue';
import TournamentSetup from './tourneys/TournamentSetup.vue';
import { formatShort, pct, progressShort, statusClass, statusText } from './tourneys/show.ts';

const tournaments = useTournaments();
const books = useBooks();
const route = useRoute();
const router = useRouter();

onMounted(() => Promise.all([tournaments.load(), books.load()]));

const selected = computed(() => (typeof route.params['id'] === 'string' ? route.params['id'] : ''));
const creating = computed(() => selected.value === 'new');
/** a New pressed while the setup is open starts it over */
const fresh = ref(0);
const setupKey = computed(
  () => `${fresh.value}.${typeof route.query['from'] === 'string' ? route.query['from'] : ''}`,
);
const item = computed<Item | undefined>(() =>
  tournaments.items.find((i) => i.config.id === selected.value),
);

/** the list beside a tournament: by state, the archive left to the overview */
const GROUPS: [Group, string][] = [
  ['running', 'Running'],
  ['stopped', 'Stopped'],
  ['finished', 'Finished'],
];
const listed = computed(() => {
  const now = Date.now();
  const shown = tournaments.items.filter(
    (i) => !archived(i, now) || i.config.id === selected.value,
  );
  return {
    groups: GROUPS.map(([g, name]) => ({ g, name, items: shown.filter((i) => groupOf(i) === g) })),
    archived: tournaments.items.length - shown.length,
  };
});
</script>

<template>
  <PageHeader title="Tourneys" sub="matches and tournaments in browser">
    <RouterLink to="/tournaments/new" class="btn" @click="fresh++">New…</RouterLink>
  </PageHeader>
  <div v-if="tournaments.error" class="mb-3 text-bad">{{ tournaments.error }}</div>

  <TournamentOverview v-if="!selected" />
  <div v-else class="grid gap-3.5 wide:grid-cols-[minmax(300px,380px)_1fr]">
    <div class="hidden wide:block">
      <Panel>
        <template v-for="group in listed.groups" :key="group.g">
          <div
            v-if="group.items.length > 0"
            class="border-b border-line bg-panel2 px-3 py-1 text-label tracking-widest text-dim uppercase"
          >
            {{ group.name }}
            <span class="tracking-normal text-faint">{{ group.items.length }}</span>
          </div>
          <div
            v-for="i in group.items"
            :key="i.config.id"
            class="row px-3 py-2"
            :class="i.config.id === selected ? 'bg-selected' : ''"
            @click="router.push(`/tournaments/${i.config.id}`)"
          >
            <div class="flex items-baseline gap-2">
              <span class="flex-1 truncate">{{ i.config.name }}</span>
              <span class="tag" :class="statusClass(statusText(i))">{{ statusText(i) }}</span>
            </div>
            <div class="num mt-0.5 flex gap-2 text-small text-dim">
              <span class="min-w-0 flex-1 truncate"
                >{{ formatShort(i.config.format) }} · {{ i.config.control }}</span
              >
              <span class="shrink-0">{{ progressShort(i) }}</span>
            </div>
            <ProgressBar class="mt-1" :parts="[{ share: pct(i), tone: 'accent' }]" />
          </div>
        </template>
        <RouterLink
          v-if="listed.archived > 0"
          :to="{ path: '/tournaments', query: { show: 'finished' } }"
          class="block px-3 py-2 text-dense text-dim hover:text-text"
          >Archive · {{ listed.archived }} ›</RouterLink
        >
        <div v-if="tournaments.items.length === 0" class="px-3 py-3 text-dim">None yet.</div>
      </Panel>
    </div>

    <TournamentSetup v-if="creating" :key="setupKey" />
    <TournamentPage v-else-if="item" :key="item.config.id" :item="item" />
  </div>
</template>
