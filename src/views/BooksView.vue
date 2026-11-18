<script setup lang="ts">
import { Download, Trash2 } from '@lucide/vue';
import { onMounted } from 'vue';
import Panel from '../components/Panel.vue';
import { useBooks } from '../stores/books.ts';

const books = useBooks();
onMounted(() => void books.load());

const size = (b: number) =>
  b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`;
const count = (n: number) => n.toLocaleString('en-US');
const th = 'border-b border-line px-2 py-1 font-medium whitespace-nowrap';
const buttonClass =
  'rounded border border-line bg-panel2 px-2 py-0.5 text-xs inline-flex items-center gap-1';
</script>

<template>
  <h1 class="mb-2.5 flex items-baseline gap-2.5 text-[15px] font-semibold">
    Books
    <span class="text-xs font-normal text-dim"
      >pulled on demand from their repos, kept in this browser</span
    >
  </h1>
  <div v-if="books.error" class="mb-3 text-bad">{{ books.error }}</div>

  <Panel>
    <div class="overflow-x-auto">
      <table class="w-full border-collapse text-[13px]">
        <thead>
          <tr class="text-left text-[11.5px] text-dim">
            <th :class="th">book</th>
            <th :class="th" class="text-right">openings</th>
            <th :class="th" class="text-right">download</th>
            <th :class="th" class="text-right">unpacked</th>
            <th :class="th">source</th>
            <th :class="th" />
          </tr>
        </thead>
        <tbody>
          <tr v-for="b in books.list" :key="b.id" class="border-b border-row last:border-0">
            <td class="num px-2 py-1.5 whitespace-nowrap">{{ b.id }}</td>
            <td class="num px-2 py-1.5 text-right">{{ count(b.positions) }}</td>
            <td class="num px-2 py-1.5 text-right text-dim">{{ size(b.zipBytes) }}</td>
            <td class="num px-2 py-1.5 text-right text-dim">{{ size(b.bytes) }}</td>
            <td
              class="num px-2 py-1.5 text-[11.5px] whitespace-nowrap text-dim"
              :title="`sha256 ${b.sha256}`"
            >
              {{ b.repo }} @ {{ b.commit.slice(0, 7) }} · {{ b.license }}
            </td>
            <td class="px-2 py-1.5 text-right whitespace-nowrap">
              <template v-if="books.progress.has(b.id)">
                <span class="num text-xs text-dim">
                  {{ Math.round((100 * (books.progress.get(b.id) ?? 0)) / b.zipBytes) }}%
                </span>
              </template>
              <template v-else-if="books.pulled.has(b.id)">
                <span class="mr-2 text-xs text-good">in this browser</span>
                <button
                  :class="buttonClass"
                  title="Delete from this browser"
                  @click="books.remove(b)"
                >
                  <Trash2 :size="13" />
                </button>
              </template>
              <button v-else :class="buttonClass" @click="books.pull(b)">
                <Download :size="13" /> Pull
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </Panel>
  <p class="text-[12px] text-faint">
    A pull checks the archive's sha256 against the app's list before it keeps the book. Play starts
    a game from a random opening of a pulled book.
  </p>
</template>
