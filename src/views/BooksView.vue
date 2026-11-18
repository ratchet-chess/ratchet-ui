<script setup lang="ts">
import { ChevronDown, ChevronUp, Download, Trash2, Upload } from '@lucide/vue';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import PageHeader from '../components/PageHeader.vue';
import Panel from '../components/Panel.vue';
import { useBooks } from '../stores/books.ts';
import { bytes, count } from '../ui/format.ts';

const books = useBooks();

/** a file dropped beside the panel would make the browser open it and leave the app */
const keep = (e: DragEvent) => {
  if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
};
onMounted(() => {
  void books.load();
  window.addEventListener('dragover', keep);
  window.addEventListener('drop', keep);
});
onUnmounted(() => {
  window.removeEventListener('dragover', keep);
  window.removeEventListener('drop', keep);
});

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** how many listed books show while the rest are folded away */
const LISTED_SHOWN = 5;
const listedOpen = ref(false);
/** the listed books, those in this browser first, each group in the list's order */
const listed = computed(() => [
  ...books.list.filter((b) => books.pulled.has(b.id)),
  ...books.list.filter((b) => !books.pulled.has(b.id)),
]);
const listedRows = computed(() =>
  listedOpen.value ? listed.value : listed.value.slice(0, LISTED_SHOWN),
);

const picker = ref<HTMLInputElement | null>(null);
/** a file is dragged over the user's books */
const over = ref(false);

function added(files: FileList | null | undefined): void {
  const file = files?.[0];
  if (file) void books.add(file);
}

function picked(e: Event): void {
  const input = e.target as HTMLInputElement;
  added(input.files);
  input.value = '';
}

function dropped(e: DragEvent): void {
  over.value = false;
  added(e.dataTransfer?.files);
}
</script>

<template>
  <PageHeader
    title="Books"
    sub="pulled on demand from their repos, or added from your files; kept in this browser"
  />
  <div v-if="books.error" class="mb-3 text-bad">{{ books.error }}</div>

  <Panel title="Listed" note="the app's list, pinned by sha256">
    <div class="@container overflow-x-auto">
      <table class="w-full border-collapse text-dense">
        <thead>
          <tr class="text-left text-small text-dim">
            <th class="th">book</th>
            <th class="th text-right">openings</th>
            <th class="th text-right">download</th>
            <th class="th text-right">unpacked</th>
            <th class="th hidden @4xl:table-cell">source</th>
            <th class="th" />
          </tr>
        </thead>
        <tbody>
          <tr v-for="b in listedRows" :key="b.id" class="border-b border-row last:border-0">
            <td
              class="num px-2 py-1.5 whitespace-nowrap"
              :title="`${b.repo} @ ${b.commit.slice(0, 7)} · ${b.license}`"
            >
              {{ b.id }}
            </td>
            <td class="num px-2 py-1.5 text-right">{{ count(b.positions) }}</td>
            <td class="num px-2 py-1.5 text-right whitespace-nowrap text-dim">
              {{ bytes(b.zipBytes) }}
            </td>
            <td class="num px-2 py-1.5 text-right whitespace-nowrap text-dim">
              {{ bytes(b.bytes) }}
            </td>
            <td
              class="num hidden px-2 py-1.5 text-small whitespace-nowrap text-dim @4xl:table-cell"
              :title="`sha256 ${b.sha256}`"
            >
              {{ b.repo }} @ {{ b.commit.slice(0, 7) }} · {{ b.license }}
            </td>
            <td class="px-2 py-1.5 text-right whitespace-nowrap">
              <template v-if="books.progress.has(b.id)">
                <span class="num text-dense text-dim">
                  {{ Math.round((100 * (books.progress.get(b.id) ?? 0)) / b.zipBytes) }}%
                </span>
              </template>
              <template v-else-if="books.pulled.has(b.id)">
                <span class="mr-2 text-dense text-good">in this browser</span>
                <button class="btn-sm" title="Delete from this browser" @click="books.remove(b)">
                  <Trash2 :size="13" />
                </button>
              </template>
              <button v-else class="btn-sm" @click="books.pull(b)">
                <Download :size="13" /> Pull
              </button>
            </td>
          </tr>
          <tr v-if="listed.length > LISTED_SHOWN">
            <td colspan="6" class="px-2 py-1">
              <button
                class="inline-flex items-center gap-1 text-dense text-dim hover:text-text"
                @click="listedOpen = !listedOpen"
              >
                <template v-if="listedOpen"><ChevronUp :size="13" /> fewer</template>
                <template v-else>
                  <ChevronDown :size="13" /> {{ listed.length - LISTED_SHOWN }} more
                </template>
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </Panel>

  <Panel title="Yours" note=".pgn or .epd, plain or zipped">
    <div
      class="overflow-x-auto"
      :class="over ? 'outline-2 outline-offset-[-2px] outline-line outline-dashed' : ''"
      @dragover.prevent="over = true"
      @dragleave="over = false"
      @drop.prevent="dropped"
    >
      <table class="w-full border-collapse text-dense">
        <thead>
          <tr class="text-left text-small text-dim">
            <th class="th">book</th>
            <th class="th text-right">openings</th>
            <th class="th text-right">size</th>
            <th class="th">added</th>
            <th class="th text-right">
              <input
                ref="picker"
                type="file"
                accept=".pgn,.epd,.zip"
                class="hidden"
                @change="picked"
              />
              <button
                class="btn-sm"
                :disabled="books.adding !== null"
                title="Add a book from a file of yours; drop one here too"
                @click="picker?.click()"
              >
                <Upload :size="13" /> Add
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="b in books.user" :key="b.id" class="border-b border-row last:border-0">
            <td class="num px-2 py-1.5 whitespace-nowrap">{{ b.id }}</td>
            <td class="num px-2 py-1.5 text-right">{{ count(b.positions) }}</td>
            <td class="num px-2 py-1.5 text-right whitespace-nowrap text-dim">
              {{ bytes(b.bytes) }}
            </td>
            <td class="num px-2 py-1.5 text-dim">{{ day(b.added) }}</td>
            <td class="px-2 py-1.5 text-right whitespace-nowrap">
              <button
                class="btn-sm"
                title="Delete this browser's copy; your file is untouched"
                @click="books.removeUser(b.id)"
              >
                <Trash2 :size="13" />
              </button>
            </td>
          </tr>
          <tr v-if="books.adding" class="border-b border-row last:border-0">
            <td class="num px-2 py-1.5 whitespace-nowrap">{{ books.adding.name }}</td>
            <td colspan="4" class="num px-2 py-1.5 text-right text-dense text-dim">
              <template v-if="books.adding.total === 0">copying into this browser…</template>
              <template v-else>
                checking {{ count(books.adding.checked) }} of
                {{ count(books.adding.total) }} openings
              </template>
            </td>
          </tr>
          <tr v-if="books.user.length === 0 && !books.adding">
            <td colspan="5" class="px-2 py-3 text-center text-dense text-dim">
              No book of yours yet. Add one, or drop a file here.
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </Panel>

  <p class="text-dense text-faint">
    A pull checks the archive's sha256 against the app's list before it keeps the book. A book of
    yours is kept once every opening in it reads; the first that does not is named. Play and
    Tourneys draw openings from any book in this browser.
    <template v-if="books.storage">
      Storage: {{ bytes(books.storage.usage) }} of {{ bytes(books.storage.quota) }}.
    </template>
  </p>
</template>
