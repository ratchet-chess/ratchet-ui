<script setup lang="ts">
import PageHeader from '../components/PageHeader.vue';
import Panel from '../components/Panel.vue';
import { type Credit, followed, libraries } from '../credits.ts';
import fastchessLicense from '../match/fastchess-LICENSE.txt?raw';

const groups: { title: string; note: string; rows: Credit[] }[] = [
  { title: 'Follows', note: 'design and code', rows: followed },
  { title: 'Libraries', note: 'in the built app', rows: libraries },
];
</script>

<template>
  <PageHeader title="About" sub="Ratchet Chess · chess engines in the browser · GPL-3.0-or-later" />

  <Panel title="Source and license" note="free software · corresponding source">
    <div class="space-y-1.5 px-3 py-2.5 text-dense text-dim">
      <p>
        This web application is free software under the
        <a
          href="https://github.com/ratchet-chess/ratchet-ui/blob/main/LICENSE"
          target="_blank"
          rel="noopener"
          class="text-accent hover:underline"
          >GNU General Public License, version 3 or later</a
        >. Corresponding source code is published at
        <a
          href="https://github.com/ratchet-chess/ratchet-ui"
          target="_blank"
          rel="noopener"
          class="text-accent hover:underline"
          >github.com/ratchet-chess/ratchet-ui</a
        >.
      </p>
      <p>
        Companion repositories:
        <a
          href="https://github.com/ratchet-chess/ratchet-hce"
          target="_blank"
          rel="noopener"
          class="text-accent hover:underline"
          >ratchet-hce</a
        >
        (hand-written engine) and
        <a
          href="https://github.com/ratchet-chess/uci-over-wasi"
          target="_blank"
          rel="noopener"
          class="text-accent hover:underline"
          >uci-over-wasi</a
        >
        (WASI spec, host and adapted engines).
      </p>
    </div>
  </Panel>

  <Panel v-for="g in groups" :key="g.title" :title="g.title" :note="g.note">
    <table class="w-full text-left text-dense">
      <tbody>
        <tr v-for="c in g.rows" :key="c.name" class="border-b border-row last:border-b-0">
          <td class="w-36 px-2 py-1.5 pl-3 align-top whitespace-nowrap">
            <a v-if="c.url" :href="c.url" target="_blank" rel="noopener" class="text-accent">{{
              c.name
            }}</a>
            <span v-else>{{ c.name }}</span>
          </td>
          <td class="px-2 py-1.5 align-top text-dim">{{ c.use }}</td>
          <td class="num px-2 py-1.5 pr-3 text-right align-top whitespace-nowrap text-dim">
            {{ c.license }}
          </td>
        </tr>
      </tbody>
    </table>
  </Panel>

  <Panel title="fastchess license" note="covers the ported SPRT and Elo code">
    <pre class="mono overflow-x-auto px-3 py-2 text-small whitespace-pre-wrap text-dim">{{
      fastchessLicense
    }}</pre>
  </Panel>

  <p class="text-small text-dim">
    Each engine and each book is under its own license, in its own repo.
  </p>
</template>
