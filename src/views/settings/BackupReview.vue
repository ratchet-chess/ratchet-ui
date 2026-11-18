<script setup lang="ts">
/** A merge waiting on the user: each item that differs, how its copies stand, and a choice. */
import { computed, ref } from 'vue';
import Panel from '../../components/Panel.vue';
import Segmented from '../../components/Segmented.vue';
import { choiceOf, choicesOf, type Choice, type Relation, type Row } from '../../storage/backup.ts';
import { useBackup, type Review } from '../../stores/backup.ts';

const props = defineProps<{ review: Review }>();
const backup = useBackup();

const folder = computed(() => props.review.source === 'folder');
const there = computed(() => (folder.value ? 'folder' : 'archive'));
/** this browser holds nothing but its settings, so the merge is a restore */
const empty = computed(() =>
  [...props.review.here.items.values()].every((i) => i.kind === 'settings'),
);

const KIND: Record<Row['kind'], string> = {
  tournament: 'tournament',
  collection: 'games',
  book: 'book',
  settings: 'settings',
};

const relation = (r: Relation) =>
  ({
    new: `only in the ${there.value}`,
    'only here': 'only here',
    same: 'the same',
    ahead: 'more here',
    behind: `more in the ${there.value}`,
    diverged: 'both changed',
  })[r];

const busy = (row: Row) => row.kind === 'tournament' && props.review.busy.has(row.here?.id ?? '');

const LABEL: Record<Choice, (row: Row) => { label: string; title: string }> = {
  add: () => ({ label: 'add', title: 'Add it to this browser' }),
  skip: () =>
    folder.value
      ? { label: 'delete', title: 'Leave it out; the folder then deletes it' }
      : { label: 'skip', title: 'Leave it out' },
  keep: () => ({ label: 'keep', title: "Keep this browser's copy" }),
  replace: () => ({ label: 'replace', title: `Take the ${there.value}'s copy instead` }),
  both: (row) =>
    row.kind === 'settings'
      ? { label: 'join', title: "These values, with the other's time controls and templates added" }
      : { label: 'both', title: `Keep both: the ${there.value}'s under a new name` },
};

const optionsOf = (row: Row) =>
  choicesOf(row, busy(row)).map((c) => ({ value: c, ...LABEL[c](row) }));

/** items only the other side holds, which ask nothing but whether to take them */
const fresh = computed(() => props.review.rows.filter((r) => r.relation === 'new'));
/** items both sides hold, in copies that differ */
const conflicts = computed(() => props.review.rows.filter((r) => r.relation !== 'new'));
const freshOpen = ref(false);

/** the fresh items' count by kind, such as "3 tournaments, 1 book" */
const freshText = computed(() => {
  const n = new Map<Row['kind'], number>();
  for (const r of fresh.value) n.set(r.kind, (n.get(r.kind) ?? 0) + 1);
  const noun = {
    tournament: 'tournament',
    collection: 'collection',
    book: 'book',
    settings: 'settings',
  };
  return [...n]
    .map(([k, c]) => `${c} ${noun[k]}${c === 1 || k === 'settings' ? '' : 's'}`)
    .join(', ');
});

/** add or skip for every fresh item; mixed when they differ */
const freshChoice = computed<Choice | 'mixed'>(() => {
  const cs = new Set(fresh.value.map((r) => props.review.choices.get(r.key)));
  const [only] = cs;
  return cs.size === 1 && only ? only : 'mixed';
});
function chooseFresh(c: Choice | 'mixed'): void {
  if (c !== 'mixed') for (const r of fresh.value) props.review.choices.set(r.key, c);
}
const freshOptions = computed(() => [
  { value: 'add' as const, label: 'add all' },
  { value: 'skip' as const, label: folder.value ? 'delete all' : 'skip all' },
]);

function choose(row: Row, c: Choice): void {
  props.review.choices.set(row.key, c);
}

/** sets every row: theirs taken, this browser's kept, or the choice that loses nothing */
function all(how: 'theirs' | 'here' | 'safe'): void {
  for (const row of props.review.rows) {
    const opts = choicesOf(row, busy(row));
    const c =
      how === 'safe'
        ? choiceOf(row, busy(row))
        : how === 'theirs'
          ? (opts.find((o) => o === 'add' || o === 'replace') ?? 'keep')
          : (opts.find((o) => o === 'skip' || o === 'keep') ?? null);
    if (c) props.review.choices.set(row.key, c);
  }
}
</script>

<template>
  <Panel
    :title="folder ? `Mirror folder ${review.name}` : `Merge ${review.name}`"
    :note="
      [
        conflicts.length > 0 ? `${conflicts.length} differ` : '',
        fresh.length > 0 ? `${fresh.length} new` : '',
        review.settled > 0 ? `${review.settled} unchanged` : '',
      ]
        .filter(Boolean)
        .join(' · ')
    "
  >
    <p class="px-3 pt-2.5 text-dense">
      <template v-if="folder && empty">
        This browser holds no data; the folder does. Restore it, then the folder follows each
        change.
      </template>
      <template v-else-if="folder">
        The folder differs from this browser. Choose for each; the folder then holds what this
        browser holds.
      </template>
      <template v-else-if="conflicts.length > 0">
        Both hold these items, in copies that differ. Choose for each; the rest of this browser
        stays as it is.
      </template>
      <template v-else>The rest of this browser stays as it is.</template>
    </p>
    <div v-if="conflicts.length > 1" class="flex flex-wrap items-center gap-3 px-3 pt-2 text-dense">
      <span class="text-dim">all</span>
      <button class="text-accent hover:underline" @click="all('safe')">lose nothing</button>
      <button class="text-accent hover:underline" @click="all('theirs')">
        take the {{ there }}'s
      </button>
      <button class="text-accent hover:underline" @click="all('here')">keep this browser's</button>
    </div>
    <div class="overflow-x-auto px-1 pt-1">
      <table class="w-full border-collapse text-dense">
        <thead v-if="conflicts.length > 0 || freshOpen">
          <tr class="text-left text-small text-dim">
            <th class="th">item</th>
            <th class="th">here</th>
            <th class="th">{{ there }}</th>
            <th class="th" />
          </tr>
        </thead>
        <tbody>
          <tr v-if="fresh.length > 0" class="border-b border-row">
            <td class="px-2 py-1" colspan="3">
              {{ fresh.length }} only in the {{ there }}
              <span class="text-dim">· {{ freshText }}</span>
              <button class="ml-2 text-accent hover:underline" @click="freshOpen = !freshOpen">
                {{ freshOpen ? 'hide' : 'show' }}
              </button>
            </td>
            <td class="px-2 py-1 text-right">
              <Segmented
                size="sm"
                :model-value="freshChoice"
                :options="freshOptions"
                @update:model-value="chooseFresh"
              />
            </td>
          </tr>
          <tr
            v-for="row in freshOpen ? review.rows : conflicts"
            :key="row.key"
            class="border-b border-row last:border-0"
          >
            <td class="px-2 py-1">
              <span v-if="row.kind !== 'settings'" class="caps mr-1.5 text-label text-faint">
                {{ KIND[row.kind] }}
              </span>
              {{ row.name }}
              <div
                class="text-small"
                :class="row.relation === 'diverged' ? 'text-warn' : 'text-dim'"
              >
                {{ relation(row.relation) }}<template v-if="busy(row)"> · running</template>
              </div>
            </td>
            <td class="num px-2 py-1 whitespace-nowrap text-dim">{{ row.here?.facts ?? '—' }}</td>
            <td class="num px-2 py-1 whitespace-nowrap text-dim">{{ row.there?.facts ?? '—' }}</td>
            <td class="px-2 py-1 text-right">
              <Segmented
                size="sm"
                :model-value="review.choices.get(row.key) ?? 'keep'"
                :options="optionsOf(row)"
                @update:model-value="(c: Choice) => choose(row, c)"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-if="review.skipped.length > 0" class="px-3 pt-1 text-small text-warn">
      Not used: {{ review.skipped.join('; ') }}
    </p>
    <div class="flex items-center gap-2 px-3 py-2.5">
      <button class="btn-primary" :disabled="backup.busy !== ''" @click="backup.applyReview()">
        {{ folder && empty ? 'Restore' : 'Merge' }}
      </button>
      <button class="btn" :disabled="backup.busy !== ''" @click="backup.cancelReview()">
        {{ folder ? 'Not now' : 'Cancel' }}
      </button>
      <span v-if="backup.busy" class="text-dense text-dim">{{ backup.busy }}</span>
    </div>
  </Panel>
</template>
