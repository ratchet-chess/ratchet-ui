<script setup lang="ts">
/**
 * Ratings: every engine rated from the games in Games, a tournament's or a PGN file's, with no
 * manager. Filters in one bar; the rating list, or head-to-head records, below.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import HelpTip from '../components/HelpTip.vue';
import PageHeader from '../components/PageHeader.vue';
import Panel from '../components/Panel.vue';
import Tabs from '../components/Tabs.vue';
import { ANCHOR_NAME, ANCHOR_RATING, controlLabel, controlsOf, rate } from '../ratings/list.ts';
import { ratingMarkdown, ratingText } from '../ratings/report.ts';
import { useRatings } from '../stores/ratings.ts';
import { useSettings } from '../stores/settings.ts';
import { count } from '../ui/format.ts';
import AnchorPicker from './ratings/AnchorPicker.vue';
import CollectionPicker from './ratings/CollectionPicker.vue';
import HeadToHeadTable from './ratings/HeadToHeadTable.vue';
import RatingTable from './ratings/RatingTable.vue';

const ratings = useRatings();
const settings = useSettings();
const route = useRoute();
const router = useRouter();
onMounted(() => void ratings.load());

type Tab = 'list' | 'h2h';
const tab = computed<Tab>({
  get: () => (route.query['show'] === 'h2h' ? 'h2h' : 'list'),
  set: (t) => void router.replace({ query: t === 'list' ? {} : { show: t } }),
});

// ── what counts ──────────────────────────────────────────────────────────────
const counted = computed(() => ratings.collections.filter((c) => ratings.counted(c)));
const picked = computed(() => new Set(counted.value.map((c) => c.id)));
const controls = computed(() => [...controlsOf(counted.value)].toSorted((a, b) => b[1] - a[1]));
// a control no counted collection has any more stops filtering
watch(controls, (cs) => {
  if (ratings.control !== null && !cs.some(([key]) => key === ratings.control))
    ratings.control = null;
});
const anchor = computed(() =>
  settings.anchorName !== null && settings.anchorRating !== null
    ? { name: settings.anchorName, rating: settings.anchorRating }
    : null,
);
const list = computed(() =>
  rate(
    counted.value,
    { collections: picked.value, control: ratings.control, forfeits: ratings.forfeits },
    anchor.value,
  ),
);
const anchorPresent = computed(
  () => settings.anchorName !== null && list.value.rows.some((r) => r.name === settings.anchorName),
);

// ── what shows ───────────────────────────────────────────────────────────────
const query = computed(() => ratings.search.trim().toLowerCase());
const rows = computed(() =>
  list.value.rows.filter(
    (r) =>
      r.games >= ratings.minGames && (!query.value || r.name.toLowerCase().includes(query.value)),
  ),
);
const unlisted = computed(() => list.value.rows.filter((r) => r.games < ratings.minGames).length);
const records = computed(() =>
  query.value
    ? list.value.records.filter(
        (m) => m.a.toLowerCase().includes(query.value) || m.b.toLowerCase().includes(query.value),
      )
    : list.value.records,
);
const sub = computed(() =>
  list.value.rows.length
    ? `${count(list.value.rows.length)} engines · ${count(list.value.games)} games · ${count(picked.value.size)} collections`
    : '',
);

function setMinGames(e: Event): void {
  const n = Number((e.target as HTMLInputElement).value);
  ratings.minGames = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

// ── copy as text ─────────────────────────────────────────────────────────────
const notice = ref('');
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
function tell(text: string): void {
  notice.value = text;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => (notice.value = ''), 4000);
}
onBeforeUnmount(() => clearTimeout(noticeTimer));
function heading(): string[] {
  const l = list.value;
  return [
    `Ratings: ${l.rows.length} engines, ${l.games} games, ${picked.value.size} collections`,
    `Control: ${ratings.control === null ? 'every' : controlLabel(ratings.control)} · Forfeits: ${ratings.forfeits ? 'counted' : 'left out'}`,
    l.anchored
      ? `Anchor: ${settings.anchorName} at ${settings.anchorRating}`
      : 'Anchor: none; ratings average 0',
    `ratchet-ui, ${new Date().toISOString().slice(0, 10)}`,
  ];
}
async function copy(markdown: boolean): Promise<void> {
  const text = markdown ? ratingMarkdown(list.value, heading()) : ratingText(list.value, heading());
  try {
    await navigator.clipboard.writeText(text);
    tell(markdown ? 'Markdown copied' : 'Copied');
  } catch (e) {
    tell(`Not copied: ${e instanceof Error ? e.message : String(e)}`);
  }
}
</script>

<template>
  <PageHeader title="Ratings" :sub="sub">
    <span v-if="notice" class="text-dense text-dim">{{ notice }}</span>
    <input
      v-model="ratings.search"
      type="search"
      placeholder="Search engines"
      class="field-sm w-44"
    />
    <button class="btn" :disabled="!list.rows.length" @click="copy(false)">Copy</button>
    <button class="btn" :disabled="!list.rows.length" @click="copy(true)">Markdown</button>
  </PageHeader>

  <div
    class="mb-2.5 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-line bg-panel px-2.5 py-2"
  >
    <CollectionPicker
      :collections="ratings.collections"
      :picked="picked"
      @set="(ids, on) => ratings.choose(ids, on)"
    />
    <select v-model="ratings.control" class="field-sm" aria-label="time control">
      <option :value="null">Every control</option>
      <option v-for="[key, n] in controls" :key="key" :value="key">
        {{ key ? controlLabel(key) : 'Unknown control' }} · {{ count(n) }}
      </option>
    </select>
    <label class="flex items-center gap-1.5 text-dense text-dim">
      Min games
      <input
        :value="ratings.minGames || ''"
        type="number"
        min="0"
        placeholder="0"
        class="field-sm no-spin num w-16 text-right"
        @input="setMinGames"
      />
    </label>
    <span class="flex items-center gap-1.5">
      <label class="flex items-center gap-1.5 text-dense">
        <input v-model="ratings.forfeits" type="checkbox" class="accent-accent" />
        Forfeits
      </label>
      <HelpTip
        >A game lost by a forfeit (on time, by an illegal move, a crash, or an engine that went
        silent) counts as a loss. Clear it to leave those games out.</HelpTip
      >
    </span>
    <span
      class="flex flex-1 items-center justify-end gap-1.5 text-dense whitespace-nowrap text-dim"
    >
      Anchor
      <AnchorPicker
        v-model:anchor-name="settings.anchorName"
        v-model:anchor-rating="settings.anchorRating"
        :list="list"
        :present="anchorPresent"
      />
      <HelpTip side="left"
        >The anchor engine's rating fixes the scale of the engines linked to it through games. The
        default is {{ ANCHOR_NAME }} at {{ count(ANCHOR_RATING) }} (CCRL Blitz). Pick None, clear
        the rating, or filter out the anchor to average ratings at 0.</HelpTip
      >
    </span>
  </div>

  <div v-if="ratings.error" class="mb-2.5 text-dense text-bad">{{ ratings.error }}</div>
  <Panel v-if="ratings.loading && !ratings.collections.length">
    <div class="px-3 py-4 text-dense text-dim">Loading…</div>
  </Panel>
  <Panel v-else-if="!list.rows.length">
    <div class="px-3 py-6 text-center text-dense text-dim">
      <p v-if="!ratings.collections.length">
        No games to rate. Ratings reads the games in
        <RouterLink to="/games" class="text-accent">Games</RouterLink>: a tournament's, or a PGN
        file opened there.
      </p>
      <p v-else>No games match the filters.</p>
    </div>
  </Panel>
  <template v-else>
    <Tabs
      v-model="tab"
      :tabs="[
        { key: 'list', name: 'Rating list', count: list.rows.length },
        { key: 'h2h', name: 'Head to head', count: list.records.length },
      ]"
    />
    <Panel>
      <template v-if="tab === 'list'">
        <RatingTable :list="list" :rows="rows" />
        <div class="flex flex-wrap gap-x-3 border-t border-line px-2.5 py-1.5 text-small text-dim">
          <span v-if="query">{{ count(rows.length) }} match “{{ ratings.search.trim() }}”</span>
          <span v-if="unlisted"
            >{{ count(unlisted) }} with fewer than {{ count(ratings.minGames) }} games not listed;
            their games still count</span
          >
          <span class="flex-1" />
          <span>{{
            list.anchored
              ? `${settings.anchorName} held at ${count(settings.anchorRating ?? 0)}`
              : settings.anchorName !== null && !anchorPresent
                ? `${settings.anchorName} not in these games · ratings average 0`
                : 'Ratings average 0'
          }}</span>
        </div>
      </template>
      <HeadToHeadTable v-else :records="records" />
    </Panel>
  </template>
</template>
