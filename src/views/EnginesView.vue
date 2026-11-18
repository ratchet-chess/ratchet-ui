<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';
import Panel from '../components/Panel.vue';
import type { ServedEngine } from '../engine/manifest.ts';
import type { Info } from '../engine/info.ts';
import { UciEngine, inputMode } from '../engine/uci.ts';
import { useEngines } from '../stores/engines.ts';

const engines = useEngines();
const mode = inputMode();
const depth = ref(12);

/** One trial run of an engine: its start, its identity, and one search from the start position. */
interface Trial {
  state: 'starting' | 'searching' | 'done' | 'failed';
  idName: string;
  /** milliseconds from creating the Worker to its `readyok` */
  startMs: number | null;
  last: Info | null;
  best: string;
  error: string;
}
const trials = reactive(new Map<string, Trial>());
const live = new Map<string, UciEngine>();

async function tryEngine(e: ServedEngine): Promise<void> {
  live.get(e.id)?.terminate();
  const t: Trial = reactive({
    state: 'starting',
    idName: '',
    startMs: null,
    last: null,
    best: '',
    error: '',
  });
  trials.set(e.id, t);
  const t0 = performance.now();
  const engine = new UciEngine(engines.workerUrl(e));
  live.set(e.id, engine);
  try {
    t.idName = (await engine.identify()).name;
    await engine.ready();
    t.startMs = performance.now() - t0;
    t.state = 'searching';
    const best = await engine.go('startpos', `depth ${depth.value}`, (info) => {
      if (info.depth !== undefined) t.last = info;
    });
    t.best = best.move;
    t.state = 'done';
  } catch (err) {
    t.error = err instanceof Error ? err.message : String(err);
    t.state = 'failed';
  } finally {
    engine.terminate();
    live.delete(e.id);
  }
}

const rows = computed(() => engines.list.map((e) => ({ e, t: trials.get(e.id) })));

const score = (i: Info) =>
  i.mate !== undefined ? `mate ${i.mate}` : `${((i.cp ?? 0) / 100).toFixed(2)}`;
const kn = (n: number | undefined) =>
  n === undefined ? '—' : `${Math.round(n / 1000).toLocaleString('en-US')} k`;

onMounted(() => void engines.load());
onUnmounted(() => {
  for (const e of live.values()) e.terminate();
});
</script>

<template>
  <h1 class="mb-2.5 flex items-baseline gap-2.5 text-[15px] font-semibold">
    Engines
    <span class="text-xs font-normal text-dim">run in this browser, each in its own Worker</span>
  </h1>

  <Panel>
    <div class="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-[12.5px] text-dim">
      <span>input during a search: <span class="num text-text">{{ mode }}</span></span>
      <label>
        trial search depth
        <select
          v-model.number="depth"
          class="num ml-1 rounded border border-line bg-panel2 px-1 text-text"
        >
          <option v-for="d in [8, 10, 12, 14, 16]" :key="d" :value="d">{{ d }}</option>
        </select>
      </label>
    </div>
  </Panel>

  <Panel v-if="engines.error" title="engines.json">
    <div class="px-3 py-2.5 text-bad">
      {{ engines.error }} · run <span class="num">bun run engines</span>
    </div>
  </Panel>

  <Panel v-else>
    <div class="overflow-x-auto">
      <table class="w-full border-collapse text-[13px]">
        <thead>
          <tr class="text-left text-[11.5px] text-dim">
            <th class="border-b border-line px-2 py-1 font-medium">engine</th>
            <th class="border-b border-line px-2 py-1 font-medium">source</th>
            <th class="border-b border-line px-2 py-1 font-medium">wasm sha256</th>
            <th class="border-b border-line px-2 py-1 font-medium">trial</th>
            <th class="border-b border-line px-2 py-1" />
          </tr>
        </thead>
        <tbody>
          <tr v-for="{ e, t } in rows" :key="e.id" class="border-b border-row last:border-0">
            <td class="num px-2 py-1.5 whitespace-nowrap">{{ e.id }}</td>
            <td class="px-2 py-1.5">
              <span
                class="num rounded border border-line px-1.5 text-[10.5px] whitespace-nowrap text-dim"
                :title="e.license ?? ''"
                >{{ e.source }}</span
              >
            </td>
            <td class="num px-2 py-1.5 text-[11.5px] text-dim">{{ e.sha256.slice(0, 12) }}…</td>
            <td class="num px-2 py-1.5 text-[12px]">
              <template v-if="t">
                <span v-if="t.state === 'failed'" class="text-bad"
                  >{{ t.error }} · is it copied in? run bun run engines</span
                >
                <template v-else>
                  <span class="text-text">{{ t.idName }}</span>
                  <span v-if="t.startMs !== null" class="text-dim">
                    · ready in {{ Math.round(t.startMs) }} ms</span
                  >
                  <span v-if="t.last" class="text-dim">
                    · depth {{ t.last.depth }} · {{ score(t.last) }} · {{ kn(t.last.nodes) }}n ·
                    {{ kn(t.last.nps) }}n/s</span
                  >
                  <span v-if="t.best" class="text-good"> · bestmove {{ t.best }}</span>
                  <span v-else-if="t.state === 'starting'" class="text-dim"> starting…</span>
                </template>
              </template>
            </td>
            <td class="px-2 py-1.5 text-right">
              <button
                class="rounded border border-line bg-panel2 px-2.5 py-0.5 text-xs disabled:text-faint"
                :disabled="t?.state === 'starting' || t?.state === 'searching'"
                @click="tryEngine(e)"
              >
                Try
              </button>
            </td>
          </tr>
          <tr v-if="engines.loaded && engines.list.length === 0">
            <td colspan="5" class="px-3 py-3 text-dim">
              No engines yet. Add a package with
              <span class="num">bun run engines ratchet-&lt;version&gt;</span>.
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </Panel>
</template>
