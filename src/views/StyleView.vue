<script setup lang="ts">
/**
 * The app's look on one page: every color by its role, the type scale, and each shared class and
 * component as the pages use them. A piece added to style.css or src/components goes here too.
 */
import { ref } from 'vue';
import HelpTip from '../components/HelpTip.vue';
import NoticeList from '../components/NoticeList.vue';
import PageHeader from '../components/PageHeader.vue';
import Pager from '../components/Pager.vue';
import Panel from '../components/Panel.vue';
import ProgressBar from '../components/ProgressBar.vue';
import Segmented from '../components/Segmented.vue';
import StatCard from '../components/StatCard.vue';
import Tabs from '../components/Tabs.vue';
import { useSettings } from '../stores/settings.ts';
import { count, signed } from '../ui/format.ts';

const settings = useSettings();

const COLORS: { group: string; names: string[] }[] = [
  { group: 'surfaces', names: ['bg', 'bar', 'panel', 'panel2', 'popover'] },
  { group: 'lines', names: ['line', 'line-strong', 'row'] },
  { group: 'text', names: ['text', 'dim', 'faint', 'on-accent'] },
  { group: 'states', names: ['hover', 'active', 'selected', 'chosen'] },
  {
    group: 'tones',
    names: ['accent', 'accent-line', 'good', 'good-line', 'bad', 'bad-line', 'warn', 'warn-line'],
  },
  { group: 'bars', names: ['track', 'live'] },
];

/** literal class names, so Tailwind finds them */
const SIZES = [
  { cls: 'text-label', use: 'tags, card labels, the icon bar' },
  { cls: 'text-small', use: "a row's second line, notes, panel titles" },
  { cls: 'text-dense', use: 'tables, controls, buttons' },
  { cls: 'text-base', use: "the page's own text" },
  { cls: 'text-title', use: "a page's title" },
  { cls: 'text-stat', use: "a stat card's figure" },
  { cls: 'text-hero', use: 'the one figure a form sums up to' },
] as const;

const TONES = ['tone-dim', 'tone-accent', 'tone-good', 'tone-bad', 'tone-warn'] as const;

const tab = ref<'' | 'running' | 'finished'>('');
const page = ref(1);
const choice = ref<'a' | 'b' | 'c'>('a');
const selected = ref(1);
</script>

<template>
  <PageHeader title="Style" sub="the tokens and pieces every page is drawn from">
    <Segmented
      v-model="settings.theme"
      :options="[
        { value: 'system', label: 'system' },
        { value: 'light', label: 'light' },
        { value: 'dark', label: 'dark' },
      ]"
    />
  </PageHeader>

  <div class="@container">
    <div class="grid gap-x-3 @4xl:grid-cols-2">
      <Panel title="Colors" note="by role; style.css holds each theme's values">
        <div class="grid gap-3 px-3 py-2.5">
          <div v-for="g in COLORS" :key="g.group">
            <div class="caps mb-1 text-label">{{ g.group }}</div>
            <div class="flex flex-wrap gap-2">
              <div v-for="n in g.names" :key="n" class="w-24">
                <div
                  class="h-8 rounded border border-line"
                  :style="{ background: `var(--color-${n})` }"
                />
                <div class="num mt-0.5 truncate text-small text-dim">{{ n }}</div>
              </div>
            </div>
          </div>
        </div>
      </Panel>

      <Panel title="Type" note="the scale; nothing else sets a size">
        <div class="grid gap-1.5 px-3 py-2.5">
          <div v-for="s in SIZES" :key="s.cls" class="flex items-baseline gap-3">
            <span class="num w-20 shrink-0 text-small text-faint">{{ s.cls.slice(5) }}</span>
            <span :class="s.cls">Ratchet 0.3.14 +4.8</span>
            <span class="min-w-0 truncate text-small text-dim">{{ s.use }}</span>
          </div>
          <div class="flex items-baseline gap-3">
            <span class="num w-20 shrink-0 text-small text-faint">num</span>
            <span class="num">{{ count(52000) }} games · {{ signed(4.81, 2) }}</span>
            <span class="text-small text-dim">numbers line up; counts keep commas</span>
          </div>
          <div class="flex items-baseline gap-3">
            <span class="num w-20 shrink-0 text-small text-faint">caps</span>
            <span class="caps text-label">Over the pairs</span>
          </div>
        </div>
      </Panel>

      <Panel title="Controls">
        <div class="grid gap-3 px-3 py-2.5">
          <div class="flex flex-wrap items-center gap-2">
            <button class="btn">btn</button>
            <button class="btn" disabled>disabled</button>
            <button class="btn-sm">btn-sm</button>
            <button class="btn-primary">btn-primary</button>
            <a class="text-dense text-accent hover:underline">a link ›</a>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <input class="field w-48" placeholder="field" />
            <input class="field num no-spin w-20 text-right" type="number" value="500" />
            <select class="field-sm">
              <option>field-sm</option>
            </select>
            <label class="flex items-center gap-1.5 text-dense">
              <input type="checkbox" class="accent-accent" checked /> a switch
            </label>
          </div>
          <Segmented
            v-model="choice"
            :options="[
              { value: 'a', label: 'Segmented' },
              { value: 'b', label: 'one of' },
              { value: 'c', label: 'a few' },
            ]"
          />
          <Segmented
            v-model="choice"
            size="sm"
            :options="[
              { value: 'a', label: 'sm' },
              { value: 'b', label: 'in a' },
              { value: 'c', label: 'row' },
            ]"
          />
          <Tabs
            v-model="tab"
            :tabs="[
              { key: '', name: 'All', count: 41 },
              { key: 'running', name: 'Running', count: 2 },
              { key: 'finished', name: 'Finished', count: 38 },
            ]"
          />
          <Pager v-model="page" :pages="4" />
          <div class="flex items-center gap-2 text-dense">
            a note on a dense row
            <HelpTip>A HelpTip: the long explanation a dense page keeps out of its text.</HelpTip>
          </div>
        </div>
      </Panel>

      <Panel title="Tags and bars">
        <div class="grid gap-3 px-3 py-2.5">
          <div class="flex flex-wrap gap-2">
            <span v-for="t in TONES" :key="t" class="tag" :class="t">{{ t.slice(5) }}</span>
          </div>
          <div class="grid gap-1.5">
            <ProgressBar :parts="[{ share: 40, tone: 'accent' }]" />
            <ProgressBar
              size="thick"
              :parts="[
                { share: 52, tone: 'accent' },
                { share: 3, tone: 'bad' },
                { share: 8, tone: 'live' },
              ]"
            />
          </div>
          <div class="grid grid-cols-3 gap-2">
            <StatCard label="nElo">
              <template #help><HelpTip>A stat card's help.</HelpTip></template>
              +4.8
              <template #sub>± 3.9</template>
            </StatCard>
            <StatCard label="Elo">
              +3.3
              <template #sub>± 2.7</template>
            </StatCard>
            <StatCard label="W D L"><span class="text-title">812 2,904 788</span></StatCard>
          </div>
        </div>
      </Panel>
    </div>

    <Panel title="A list" note="th, row, selected">
      <table class="w-full border-collapse text-dense">
        <thead>
          <tr class="text-left text-dim">
            <th class="th">tournament</th>
            <th class="th text-right">games</th>
            <th class="th">state</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(r, k) in [
              ['SPRT accepted', 6000, 'H1', 'tone-good'],
              ['Swiss of 5', 16, 'running', 'tone-accent'],
              ['Interrupted match', 80, 'interrupted', 'tone-warn'],
            ]"
            :key="k"
            class="row"
            :class="k === selected ? 'bg-selected' : ''"
            @click="selected = k"
          >
            <td class="px-2 py-1">{{ r[0] }}</td>
            <td class="num px-2 py-1 text-right">{{ count(Number(r[1])) }}</td>
            <td class="px-2 py-1">
              <span class="tag" :class="r[3]">{{ r[2] }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </Panel>

    <Panel title="Notices" note="2">
      <NoticeList
        :notices="[
          { severity: 'bad', where: 'Interrupted match', to: '/style', text: '1 illegal move' },
          { severity: 'warn', where: 'storage', text: '93% of the browser\'s quota used' },
        ]"
      />
    </Panel>
  </div>
</template>
