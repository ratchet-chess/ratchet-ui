<script setup lang="ts">
import { Check, Copy, Play, RotateCw, Search, Square } from '@lucide/vue';
import { computed, ref, watch } from 'vue';
import Panel from '../../components/Panel.vue';
import type { EngineInspection, EngineProbe, WasiCheckReport } from '../../engine/cache.ts';
import type { Info } from '../../engine/info.ts';
import type { ServedEngine } from '../../engine/manifest.ts';
import { engineResults, type ProbeSuite } from '../../engine/options.ts';
import { inputMode } from '../../engine/uci.ts';
import { useTournaments } from '../../stores/tournaments.ts';
import { bytes, count, thousands } from '../../ui/format.ts';
import { formatShort } from '../tourneys/show.ts';
import { canSpawnBrowserThreads } from '../../../vendor/uci-over-wasi/check-browser.ts';
import WasiChecker from './WasiChecker.vue';

const props = defineProps<{
  engine: ServedEngine;
  inspection: EngineInspection | undefined;
  probe: EngineProbe | undefined;
  wasi: WasiCheckReport | undefined;
  wasiLoading: boolean;
}>();

const emit = defineEmits<{
  inspect: [engine: ServedEngine];
  probe: [engine: ServedEngine, suite: ProbeSuite, depth: number];
  stopProbe: [engine: ServedEngine];
  runWasi: [engine: ServedEngine];
  cancelWasi: [engine: ServedEngine];
}>();

const tournaments = useTournaments();
const mode = inputMode();
const threadsOk = canSpawnBrowserThreads();

const suite = ref<ProbeSuite>(props.probe?.suite ?? 'startpos');
const depth = ref(props.probe?.depth ?? 12);
const copied = ref(false);
let copyTimer: ReturnType<typeof setTimeout> | undefined;

watch(
  () => props.engine.id,
  () => {
    if (props.probe) {
      suite.value = props.probe.suite;
      depth.value = props.probe.depth;
    }
  },
);

async function copySha(): Promise<void> {
  try {
    await navigator.clipboard.writeText(props.engine.sha256);
    copied.value = true;
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => {
      copied.value = false;
    }, 1500);
  } catch {
    // clipboard unavailable in insecure context
  }
}

const results = computed(() => engineResults(props.engine.id, tournaments.items));

const probeBusy = computed(
  () => props.probe?.state === 'starting' || props.probe?.state === 'running',
);

const probeTotals = computed(() => {
  const p = props.probe;
  if (!p) return null;
  let nodes = 0;
  let ms = 0;
  let done = 0;
  for (const r of p.rows) {
    if (r.state === 'done' && r.nodes !== null && r.elapsedMs !== null) {
      nodes += r.nodes;
      ms += r.elapsedMs;
      done++;
    }
  }
  if (done === 0) return null;
  const nps = ms > 0 ? Math.round((nodes * 1000) / ms) : 0;
  return { nodes, ms, nps, done, total: p.rows.length };
});

const scoreText = (i: Info | null) =>
  i === null ? '—' : i.mate !== undefined ? `mate ${i.mate}` : `${((i.cp ?? 0) / 100).toFixed(2)}`;
const kn = (n: number | null | undefined) => (n === null || n === undefined ? '—' : thousands(n));
const pctText = (v: number | null) => (v === null ? '—' : `${v.toFixed(1)}%`);
</script>

<template>
  <div class="min-w-0">
    <Panel title="Engine" :note="engine.id">
      <div class="flex flex-wrap items-center gap-2 border-b border-row px-3 py-2">
        <span class="text-title font-semibold text-text">
          {{ engine.version ? `${engine.name} ${engine.version}` : engine.name }}
        </span>
        <span class="tag tone-dim">{{ engine.source }}</span>
        <span v-if="engine.license" class="tag tone-dim">{{ engine.license }}</span>
        <span v-if="engine.bytes !== null" class="num text-small text-dim">
          {{ bytes(engine.bytes) }}
        </span>
        <div class="ml-auto flex items-center gap-1.5">
          <RouterLink to="/play" class="btn-sm">Play</RouterLink>
        </div>
      </div>

      <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 px-3 py-2 text-dense">
        <dt class="text-dim">File</dt>
        <dd class="num text-text">
          {{ engine.wasm }}
          <span v-if="engine.bytes !== null" class="text-dim">
            ({{ count(engine.bytes) }} bytes)
          </span>
        </dd>
        <dt class="text-dim">Source</dt>
        <dd class="num text-text">{{ engine.source }}</dd>
        <dt class="text-dim">License</dt>
        <dd class="num text-text">{{ engine.license ?? '—' }}</dd>
        <dt class="text-dim">SHA-256</dt>
        <dd class="flex min-w-0 items-center gap-2">
          <span class="num truncate text-small text-dim" :title="engine.sha256">
            {{ engine.sha256 }}
          </span>
          <button class="btn-sm shrink-0" title="Copy SHA-256" @click="copySha">
            <Check v-if="copied" :size="12" />
            <Copy v-else :size="12" />
            {{ copied ? 'Copied' : 'Copy' }}
          </button>
        </dd>
        <dt class="text-dim">Browser</dt>
        <dd class="num text-small text-dim">
          input <span class="text-text">{{ mode }}</span> · threads
          <span class="text-text">{{ threadsOk ? 'available' : 'unavailable' }}</span>
        </dd>
      </dl>
    </Panel>

    <Panel title="UCI" note="on demand">
      <div
        v-if="!inspection"
        class="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-dense text-dim"
      >
        <span>Start this engine once to read its identity and UCI options.</span>
        <button class="btn-sm" @click="emit('inspect', engine)">
          <Search :size="12" /> Inspect
        </button>
      </div>
      <div v-else-if="inspection.state === 'loading'" class="px-3 py-2.5 text-dense text-dim">
        Loading Worker and reading UCI handshake…
      </div>
      <div
        v-else-if="inspection.state === 'failed'"
        class="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-dense text-bad"
      >
        <span>{{ inspection.error }}</span>
        <button class="btn-sm" @click="emit('inspect', engine)">Retry</button>
      </div>
      <template v-else>
        <div
          class="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-row px-3 py-1.5 text-dense"
        >
          <span>
            <span class="text-dim">Name:</span>
            <span class="num ml-1 text-text">{{ inspection.idName || '—' }}</span>
          </span>
          <span>
            <span class="text-dim">Author:</span>
            <span class="num ml-1 text-text">{{ inspection.idAuthor || '—' }}</span>
          </span>
          <span v-if="inspection.startMs !== null" class="num text-small text-dim">
            ready in {{ Math.round(inspection.startMs) }} ms
          </span>
          <button class="btn-sm ml-auto" @click="emit('inspect', engine)">
            <RotateCw :size="12" /> Re-inspect
          </button>
        </div>

        <div v-if="inspection.options.length === 0" class="px-3 py-2.5 text-dense text-dim">
          No UCI options declared.
        </div>
        <div v-else class="overflow-x-auto">
          <table class="w-full border-collapse text-dense">
            <thead>
              <tr class="text-left text-small text-dim">
                <th class="th">option</th>
                <th class="th">type</th>
                <th class="th">default</th>
                <th class="th">range</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="opt in inspection.options"
                :key="opt.name"
                class="border-b border-row last:border-0"
              >
                <td class="num px-2 py-1 whitespace-nowrap text-text">{{ opt.name }}</td>
                <td class="num px-2 py-1 whitespace-nowrap text-dim">{{ opt.type }}</td>
                <td class="num px-2 py-1 whitespace-nowrap text-text">
                  {{ opt.defaultValue || '—' }}
                </td>
                <td class="num px-2 py-1 text-dim">{{ opt.range || '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </Panel>

    <Panel title="Speed probe">
      <div
        class="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-row px-3 py-2 text-dense"
      >
        <div class="inline-flex overflow-hidden rounded border border-line bg-panel2">
          <button
            class="px-2 py-0.5 text-small"
            :class="suite === 'startpos' ? 'bg-active text-text' : 'text-dim hover:text-text'"
            :disabled="probeBusy"
            @click="suite = 'startpos'"
          >
            Startpos
          </button>
          <button
            class="border-l border-line px-2 py-0.5 text-small"
            :class="suite === 'three' ? 'bg-active text-text' : 'text-dim hover:text-text'"
            :disabled="probeBusy"
            @click="suite = 'three'"
          >
            3 positions
          </button>
        </div>

        <label class="text-dim">
          Depth
          <select v-model.number="depth" class="field-sm num ml-1" :disabled="probeBusy">
            <option v-for="d in [8, 10, 12, 14, 16]" :key="d" :value="d">{{ d }}</option>
          </select>
        </label>

        <div class="ml-auto flex items-center gap-1.5">
          <button v-if="probeBusy" class="btn-sm" @click="emit('stopProbe', engine)">
            <Square :size="12" /> Stop
          </button>
          <button v-else class="btn-sm" @click="emit('probe', engine, suite, depth)">
            <Play :size="12" /> Run
          </button>
        </div>
      </div>

      <div v-if="!probe" class="px-3 py-2.5 text-dense text-dim">
        Run a fixed-depth search in browser to measure speed on this device.
      </div>
      <template v-else>
        <div
          v-if="probe.state === 'failed'"
          class="border-b border-row px-3 py-2 text-dense text-bad last:border-0"
        >
          {{ probe.error }}
        </div>
        <div
          v-if="probeTotals || probe.startMs !== null || probe.state === 'stopped'"
          class="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-row px-3 py-1.5 text-small text-dim"
        >
          <span v-if="probe.state === 'starting'">Starting Worker…</span>
          <span v-if="probe.startMs !== null" class="num">
            ready in {{ Math.round(probe.startMs) }} ms
          </span>
          <span v-if="probeTotals" class="num">
            total <span class="text-text">{{ count(probeTotals.nodes) }}</span> nodes ·
            <span class="text-text">{{ kn(probeTotals.nps) }} nps</span> ·
            {{ Math.round(probeTotals.ms) }} ms
          </span>
          <span v-if="probe.state === 'stopped'" class="tag tone-warn ml-auto">stopped</span>
        </div>

        <div v-if="probe.rows.length > 0" class="overflow-x-auto">
          <table class="w-full border-collapse text-dense">
            <thead>
              <tr class="text-left text-small text-dim">
                <th class="th">position</th>
                <th class="th text-right">depth</th>
                <th class="th text-right">score</th>
                <th class="th text-right">nodes</th>
                <th class="th text-right">nps</th>
                <th class="th text-right">bestmove</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in probe.rows" :key="r.label" class="border-b border-row last:border-0">
                <td class="px-2 py-1.5 whitespace-nowrap text-text">{{ r.label }}</td>
                <td class="num px-2 py-1.5 text-right text-dim">
                  {{ r.last?.depth ?? (r.state === 'running' ? '…' : '—') }}
                </td>
                <td class="num px-2 py-1.5 text-right text-dim">{{ scoreText(r.last) }}</td>
                <td class="num px-2 py-1.5 text-right text-dim">
                  {{ kn(r.nodes ?? r.last?.nodes) }}
                </td>
                <td class="num px-2 py-1.5 text-right text-dim">
                  {{
                    r.state === 'done' && r.nodes !== null && r.elapsedMs
                      ? kn(Math.round((r.nodes * 1000) / r.elapsedMs))
                      : kn(r.last?.nps)
                  }}
                </td>
                <td
                  class="num px-2 py-1.5 text-right whitespace-nowrap"
                  :class="r.best ? 'text-good' : 'text-dim'"
                >
                  {{ r.best || (r.state === 'running' ? 'searching…' : '—') }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </Panel>

    <WasiChecker
      mode="served"
      :target-key="engine.id"
      title="WASI check"
      note="on demand"
      :report="wasi"
      :loading="wasiLoading"
      @run="emit('runWasi', engine)"
      @cancel="emit('cancelWasi', engine)"
    />

    <Panel title="Local tournaments" note="in browser">
      <div v-if="results.tournaments.length === 0" class="px-3 py-2.5 text-dense text-dim">
        No local tournaments played with this engine yet.
      </div>
      <template v-else>
        <div
          class="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-row px-3 py-1.5 text-small text-dim"
        >
          <span class="num"> <span class="text-text">{{ count(results.games) }}</span> games </span>
          <span class="num">
            <span class="text-good">+{{ results.wins }}</span>
            <span class="mx-1">={{ results.draws }}</span>
            <span class="text-bad">−{{ results.losses }}</span>
          </span>
          <span class="num text-text">{{ pctText(results.scorePct) }}</span>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full border-collapse text-dense">
            <thead>
              <tr class="text-left text-small text-dim">
                <th class="th">tournament</th>
                <th class="th">format</th>
                <th class="th text-right">W-D-L</th>
                <th class="th text-right">score</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="t in results.tournaments"
                :key="t.id"
                class="border-b border-row last:border-0"
              >
                <td class="px-2 py-1.5">
                  <RouterLink :to="`/tournaments/${t.id}`" class="text-accent hover:underline">
                    {{ t.name }}
                  </RouterLink>
                </td>
                <td class="num px-2 py-1.5 whitespace-nowrap text-dim">
                  {{ formatShort(t.format) }}
                </td>
                <td class="num px-2 py-1.5 text-right whitespace-nowrap text-dim">
                  {{ t.wins }}-{{ t.draws }}-{{ t.losses }}
                </td>
                <td class="num px-2 py-1.5 text-right whitespace-nowrap text-text">
                  {{ pctText(t.scorePct) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </Panel>
  </div>
</template>
