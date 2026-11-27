<script setup lang="ts">
import { Trash2, Upload } from '@lucide/vue';
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import PageHeader from '../components/PageHeader.vue';
import Panel from '../components/Panel.vue';
import {
  cloneWasiReport,
  executeWasiCheck,
  loadEngineCache,
  saveEngineCache,
  type EngineProbe,
  type PersistedEngineData,
  type WasiCheckReport,
} from '../engine/cache.ts';
import type { ServedEngine } from '../engine/manifest.ts';
import { PROBE_SUITES, parseOptionsList, type ProbeSuite } from '../engine/options.ts';
import { UciEngine } from '../engine/uci.ts';
import { IN_BROWSER_SOURCE, useEngines } from '../stores/engines.ts';
import { useTournaments } from '../stores/tournaments.ts';
import { bytes, sentence, thousands } from '../ui/format.ts';
import EngineDetail from './engines/EngineDetail.vue';
import WasiChecker from './engines/WasiChecker.vue';

const UPLOAD_KEY = '__uploaded__';

const engines = useEngines();
const tournaments = useTournaments();

const query = ref('');
const selectedId = ref('');
const picker = ref<HTMLInputElement | null>(null);
const dragDepth = ref(0);
const dragOver = computed(() => dragDepth.value > 0);

const inspections = engines.inspections;
const probes = reactive(new Map<string, EngineProbe>());
const wasiReports = reactive(new Map<string, WasiCheckReport>());
const wasiLoading = reactive(new Set<string>());

/** temporary uploaded/dropped file checked in this session until added */
const uploadedBytes = ref<Uint8Array | null>(null);
const uploadedReport = ref<WasiCheckReport | undefined>(undefined);
const savingUpload = ref(false);
const saveUploadError = ref('');

const servedIds = computed(() => new Set(engines.served.map((e) => e.id)));
const userIds = computed(() => new Set(engines.user.map((e) => e.id)));
const userBytes = computed(() => engines.user.reduce((n, e) => n + e.bytes, 0));

const liveProbe = new Map<string, UciEngine>();
const liveWasi = new Map<string, AbortController>();

function persistServed(): void {
  const out: Record<string, PersistedEngineData> = {};
  for (const e of engines.list) {
    const insp = inspections.get(e.id);
    const probe = probes.get(e.id);
    const wasi = wasiReports.get(e.id);
    const entry: PersistedEngineData = { sha256: e.sha256 };
    let keep = false;
    if (insp?.state === 'done') {
      entry.inspection = insp;
      keep = true;
    }
    if (probe?.state === 'done') {
      entry.probe = probe;
      keep = true;
    }
    if (wasi && wasi.state !== 'running' && wasi.state !== 'cancelled') {
      entry.wasi = wasi;
      keep = true;
    }
    if (keep) out[e.id] = entry;
  }
  saveEngineCache(out);
}

function hydrateCache(list: readonly ServedEngine[]): void {
  const saved = loadEngineCache();
  for (const e of list) {
    const entry = saved[e.id];
    if (!entry || entry.sha256 !== e.sha256) continue;
    if (entry.inspection && !inspections.has(e.id)) {
      inspections.set(e.id, reactive(structuredClone(entry.inspection)));
    }
    if (entry.probe && !probes.has(e.id)) {
      probes.set(e.id, reactive(structuredClone(entry.probe)));
    }
    if (entry.wasi && !wasiReports.has(e.id)) {
      wasiReports.set(e.id, reactive(structuredClone(entry.wasi)));
    }
  }
}

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return engines.list;
  return engines.list.filter((e) => {
    if (
      e.id.toLowerCase().includes(q) ||
      e.name.toLowerCase().includes(q) ||
      e.source.toLowerCase().includes(q) ||
      (e.license?.toLowerCase().includes(q) ?? false)
    ) {
      return true;
    }
    const m = e.meta;
    if (!m) return false;
    return (
      String(m.year).includes(q) ||
      m.kind.includes(q) ||
      m.originalAuthors.some((a) => a.toLowerCase().includes(q)) ||
      m.features.some((f) => f.label.toLowerCase().includes(q) || f.key.toLowerCase().includes(q))
    );
  });
});

const filteredUser = computed(() => filtered.value.filter((e) => e.source === IN_BROWSER_SOURCE));
const filteredServed = computed(() => filtered.value.filter((e) => e.source !== IN_BROWSER_SOURCE));

const showingUpload = computed(
  () => selectedId.value === UPLOAD_KEY && uploadedReport.value !== undefined,
);

const selected = computed<ServedEngine | undefined>(() => {
  if (showingUpload.value) return undefined;
  return engines.list.find((e) => e.id === selectedId.value) ?? filtered.value[0];
});

watch(
  () => engines.list,
  (list) => {
    if (list.length > 0) hydrateCache(list);
    if (!selectedId.value && list[0]) selectedId.value = list[0].id;
  },
  { immediate: true },
);

async function inspectEngine(e: ServedEngine): Promise<void> {
  await engines.inspect(e, true);
}

async function runProbe(e: ServedEngine, suite: ProbeSuite, depth: number): Promise<void> {
  liveProbe.get(e.id)?.terminate();
  const positions = PROBE_SUITES[suite];
  const state: EngineProbe = reactive({
    state: 'starting',
    suite,
    depth,
    startMs: null,
    rows: positions.map((p) => ({
      label: p.label,
      state: 'pending',
      last: null,
      nodes: null,
      elapsedMs: null,
      best: '',
    })),
    error: '',
  });
  probes.set(e.id, state);
  const t0 = performance.now();
  const engine = new UciEngine(engines.workerUrl(e));
  liveProbe.set(e.id, engine);

  try {
    const id = await engine.identify();
    await engine.ready();
    const startMs = performance.now() - t0;
    state.startMs = startMs;
    if (!inspections.has(e.id) || inspections.get(e.id)?.state === 'failed') {
      engines.recordInspection(e, {
        state: 'done',
        idName: id.name,
        idAuthor: id.author,
        startMs,
        options: parseOptionsList(id.options),
        error: '',
      });
    }
    state.state = 'running';

    for (const [i, pos] of positions.entries()) {
      const row = state.rows[i];
      if (!row) continue;
      row.state = 'running';
      engine.send('ucinewgame');
      await engine.ready();
      const pt0 = performance.now();
      const best = await engine.go(pos.position, `depth ${depth}`, (info) => {
        if (info.depth !== undefined) row.last = info;
      });
      row.elapsedMs = performance.now() - pt0;
      row.nodes = row.last?.nodes ?? null;
      row.best = best.move;
      row.state = 'done';
    }
    state.state = 'done';
    persistServed();
  } catch (err) {
    if (state.state !== 'stopped') {
      state.error = err instanceof Error ? err.message : String(err);
      state.state = 'failed';
    }
  } finally {
    engine.terminate();
    liveProbe.delete(e.id);
  }
}

function stopProbe(e: ServedEngine): void {
  const p = probes.get(e.id);
  if (p) p.state = 'stopped';
  liveProbe.get(e.id)?.terminate();
  liveProbe.delete(e.id);
}

async function runServedWasi(e: ServedEngine): Promise<void> {
  liveWasi.get(e.id)?.abort();
  const ac = new AbortController();
  liveWasi.set(e.id, ac);
  wasiLoading.add(e.id);
  try {
    const res = await fetch(engines.wasmUrl(e), { signal: ac.signal });
    if (!res.ok) throw new Error(`${e.wasm}: ${res.status} ${res.statusText}`);
    const wasm = new Uint8Array(await res.arrayBuffer());
    wasiLoading.delete(e.id);
    const report: WasiCheckReport = reactive({
      fileName: e.wasm,
      size: wasm.length,
      state: 'running',
      info: null,
      identity: null,
      results: [],
      fatalError: '',
      staticNote: '',
    });
    wasiReports.set(e.id, report);
    await executeWasiCheck(wasm, report, ac.signal);
    if (!ac.signal.aborted) persistServed();
  } catch (err) {
    wasiLoading.delete(e.id);
    if (ac.signal.aborted) return;
    wasiReports.set(
      e.id,
      reactive({
        fileName: e.wasm,
        size: e.bytes ?? 0,
        state: 'invalid',
        info: null,
        identity: null,
        results: [],
        fatalError: err instanceof Error ? err.message : String(err),
        staticNote: '',
      }),
    );
  } finally {
    wasiLoading.delete(e.id);
    if (liveWasi.get(e.id) === ac) liveWasi.delete(e.id);
  }
}

function cancelServedWasi(e: ServedEngine): void {
  liveWasi.get(e.id)?.abort();
  liveWasi.delete(e.id);
  const r = wasiReports.get(e.id);
  if (r?.state === 'running') r.state = 'cancelled';
}

async function runUploadWasi(): Promise<void> {
  const wasm = uploadedBytes.value;
  const current = uploadedReport.value;
  if (!wasm || !current) return;
  liveWasi.get(UPLOAD_KEY)?.abort();
  const ac = new AbortController();
  liveWasi.set(UPLOAD_KEY, ac);
  const report: WasiCheckReport = reactive({
    fileName: current.fileName,
    size: wasm.length,
    state: 'running',
    info: null,
    identity: null,
    results: [],
    fatalError: '',
    staticNote: '',
  });
  uploadedReport.value = report;
  try {
    await executeWasiCheck(wasm, report, ac.signal);
  } finally {
    if (liveWasi.get(UPLOAD_KEY) === ac) liveWasi.delete(UPLOAD_KEY);
  }
}

function cancelUploadWasi(): void {
  liveWasi.get(UPLOAD_KEY)?.abort();
  liveWasi.delete(UPLOAD_KEY);
  if (uploadedReport.value?.state === 'running') uploadedReport.value.state = 'cancelled';
}

async function checkUploadedFile(file: File): Promise<void> {
  const wasm = new Uint8Array(await file.arrayBuffer());
  uploadedBytes.value = wasm;
  saveUploadError.value = '';
  const report: WasiCheckReport = reactive({
    fileName: file.name,
    size: wasm.length,
    state: 'running',
    info: null,
    identity: null,
    results: [],
    fatalError: '',
    staticNote: '',
  });
  uploadedReport.value = report;
  selectedId.value = UPLOAD_KEY;
  await runUploadWasi();
}

async function addUploadedEngine(id: string, replace: boolean): Promise<void> {
  const wasm = uploadedBytes.value;
  const report = uploadedReport.value;
  if (!wasm || !report || report.state !== 'pass' || savingUpload.value) return;
  savingUpload.value = true;
  saveUploadError.value = '';
  try {
    const added = await engines.addUser({
      id,
      name: report.identity?.name || id,
      bytes: wasm,
      wasi: report,
      replace,
    });
    if (replace) {
      liveProbe.get(added.id)?.terminate();
      liveProbe.delete(added.id);
      probes.delete(added.id);
    }
    wasiReports.set(
      added.id,
      reactive({
        ...cloneWasiReport(report),
        fileName: added.wasm,
        size: added.bytes ?? wasm.byteLength,
      }),
    );
    uploadedBytes.value = null;
    uploadedReport.value = undefined;
    selectedId.value = added.id;
  } catch (e) {
    saveUploadError.value = e instanceof Error ? e.message : String(e);
  } finally {
    savingUpload.value = false;
  }
}

async function removeUserEngine(e: ServedEngine): Promise<void> {
  liveProbe.get(e.id)?.terminate();
  liveProbe.delete(e.id);
  liveWasi.get(e.id)?.abort();
  liveWasi.delete(e.id);
  probes.delete(e.id);
  wasiReports.delete(e.id);
  await engines.removeUser(e.id);
  if (selectedId.value === e.id) {
    selectedId.value = engines.list[0]?.id ?? '';
  }
}

function picked(e: Event): void {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (file) void checkUploadedFile(file);
}

function uploadVerdict(state: WasiCheckReport['state']): { text: string; tone: string } {
  switch (state) {
    case 'running':
      return { text: 'Checking', tone: 'tone-accent' };
    case 'pass':
      return { text: 'Passes', tone: 'tone-good' };
    case 'fail':
      return { text: 'Fails', tone: 'tone-bad' };
    case 'invalid':
      return { text: 'Invalid', tone: 'tone-bad' };
    default:
      return { text: sentence(state), tone: 'tone-warn' };
  }
}

function listHint(id: string): string {
  const p = probes.get(id);
  if (p?.state === 'done') {
    let nodes = 0;
    let ms = 0;
    for (const r of p.rows) {
      if (r.nodes !== null && r.elapsedMs !== null) {
        nodes += r.nodes;
        ms += r.elapsedMs;
      }
    }
    if (ms > 0) return `${thousands(Math.round((nodes * 1000) / ms))} nps`;
  }
  const w = wasiReports.get(id);
  if (w?.state === 'pass') return 'WASI ok';
  if (inspections.get(id)?.state === 'done') return 'inspected';
  return '';
}

/** a .wasm dropped anywhere on the page triggers Upload and check instead of browser navigation */
const onWindowDragEnter = (e: DragEvent) => {
  if (e.dataTransfer?.types.includes('Files')) {
    e.preventDefault();
    dragDepth.value++;
  }
};
const onWindowDragOver = (e: DragEvent) => {
  if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
};
const onWindowDragLeave = () => {
  dragDepth.value = Math.max(0, dragDepth.value - 1);
};
const onWindowDrop = (e: DragEvent) => {
  if (!e.dataTransfer?.types.includes('Files')) return;
  e.preventDefault();
  dragDepth.value = 0;
  const file = e.dataTransfer.files?.[0];
  if (file) void checkUploadedFile(file);
};

onMounted(() => {
  void Promise.all([engines.load(), tournaments.load()]);
  window.addEventListener('dragenter', onWindowDragEnter);
  window.addEventListener('dragover', onWindowDragOver);
  window.addEventListener('dragleave', onWindowDragLeave);
  window.addEventListener('drop', onWindowDrop);
});

onUnmounted(() => {
  for (const e of liveProbe.values()) e.terminate();
  for (const ac of liveWasi.values()) ac.abort();
  window.removeEventListener('dragenter', onWindowDragEnter);
  window.removeEventListener('dragover', onWindowDragOver);
  window.removeEventListener('dragleave', onWindowDragLeave);
  window.removeEventListener('drop', onWindowDrop);
});
</script>

<template>
  <PageHeader title="Engines" sub="WASI builds running in browser Workers" />
  <input ref="picker" type="file" accept=".wasm" class="hidden" @change="picked" />

  <Panel v-if="engines.error" title="Engines">
    <div class="px-3 py-2.5 text-bad">{{ engines.error }}</div>
  </Panel>

  <div v-else class="grid gap-3.5 wide:grid-cols-[minmax(280px,340px)_1fr]">
    <div class="min-w-0">
      <Panel title="Engines" :note="`${filtered.length} of ${engines.list.length}`">
        <div class="border-b border-row px-2.5 py-2">
          <input
            v-model="query"
            type="search"
            class="field w-full"
            placeholder="Filter engines…"
            aria-label="Filter engines"
          />
        </div>
        <div class="max-h-[540px] overflow-y-auto">
          <template v-if="filteredUser.length > 0">
            <div
              class="subhead flex items-center justify-between border-b border-line bg-panel2 px-3 py-1"
            >
              <span>In browser</span>
              <span class="num font-normal text-faint">
                {{ filteredUser.length }} · {{ bytes(userBytes) }}
              </span>
            </div>
            <div
              v-for="e in filteredUser"
              :key="e.id"
              class="row px-3 py-2"
              :class="selected?.id === e.id ? 'bg-selected' : ''"
              @click="selectedId = e.id"
            >
              <div class="flex items-baseline gap-2">
                <span class="min-w-0 flex-1 truncate text-dense font-medium text-text">{{
                  e.id
                }}</span>
                <span v-if="listHint(e.id)" class="num shrink-0 text-label text-good">
                  {{ listHint(e.id) }}
                </span>
              </div>
              <div class="mt-0.5 flex items-center gap-2 text-label text-dim">
                <span class="truncate">{{ e.name !== e.id ? e.name : 'in browser' }}</span>
                <span v-if="e.bytes !== null" class="num ml-auto shrink-0">
                  {{ bytes(e.bytes) }}
                </span>
                <button
                  class="shrink-0 rounded p-0.5 text-faint hover:bg-hover hover:text-text"
                  title="Remove from browser"
                  :aria-label="`Remove ${e.id}`"
                  @click.stop="removeUserEngine(e)"
                >
                  <Trash2 :size="12" />
                </button>
              </div>
            </div>
          </template>

          <div
            v-if="filteredUser.length > 0 && filteredServed.length > 0"
            class="subhead border-y border-line bg-panel2 px-3 py-1"
          >
            Served
          </div>
          <div
            v-for="e in filteredServed"
            :key="e.id"
            class="row px-3 py-2"
            :class="selected?.id === e.id ? 'bg-selected' : ''"
            @click="selectedId = e.id"
          >
            <div class="flex items-baseline gap-2">
              <span class="min-w-0 flex-1 truncate text-dense font-medium text-text">{{
                e.id
              }}</span>
              <span v-if="listHint(e.id)" class="num shrink-0 text-label text-good">
                {{ listHint(e.id) }}
              </span>
            </div>
            <div class="mt-0.5 flex items-center gap-2 text-label text-dim">
              <span class="truncate">{{ e.source }}</span>
              <span
                v-if="e.meta"
                class="tag shrink-0"
                :class="e.meta.kind === 'release' ? 'tone-accent' : 'tone-dim'"
              >
                {{ e.meta.year }} · {{ sentence(e.meta.kind) }}
              </span>
              <span v-if="e.bytes !== null" class="num ml-auto shrink-0">
                {{ bytes(e.bytes) }}
              </span>
            </div>
          </div>

          <div
            v-if="engines.loaded && engines.list.length === 0"
            class="px-3 py-3 text-dense text-dim"
          >
            No engines available yet. Upload a <span class="mono">.wasm</span> build to check and
            play.
          </div>
          <div
            v-else-if="engines.loaded && filtered.length === 0"
            class="px-3 py-3 text-dense text-dim"
          >
            No matching engines.
          </div>
        </div>

        <template v-if="uploadedReport">
          <div class="subhead border-y border-line bg-panel2 px-3 py-1">Checked file</div>
          <div
            class="row px-3 py-2"
            :class="showingUpload ? 'bg-selected' : ''"
            @click="selectedId = UPLOAD_KEY"
          >
            <div class="flex items-center gap-2">
              <span class="mono min-w-0 flex-1 truncate text-dense text-text">
                {{ uploadedReport.fileName }}
              </span>
              <span class="tag shrink-0" :class="uploadVerdict(uploadedReport.state).tone">
                {{ uploadVerdict(uploadedReport.state).text }}
              </span>
            </div>
            <div class="mt-0.5 flex items-center gap-2 text-label text-dim">
              <span class="truncate">{{
                uploadedReport.identity?.name ||
                (uploadedReport.state === 'pass' ? 'ready to add' : 'not saved')
              }}</span>
              <span class="num ml-auto shrink-0">{{ bytes(uploadedReport.size) }}</span>
            </div>
          </div>
        </template>

        <div
          class="flex items-center justify-between gap-2 border-t border-line px-3 py-2"
          :class="
            dragOver
              ? 'bg-selected outline-2 outline-offset-[-2px] outline-line outline-dashed'
              : ''
          "
        >
          <button
            class="btn-sm"
            title="Check a local .wasm file against UCI over WASI (or drag and drop anywhere)"
            @click="picker?.click()"
          >
            <Upload :size="12" /> Upload and check
          </button>
          <span class="text-label text-faint">.wasm · check to add</span>
        </div>
      </Panel>

      <p v-if="engines.storage" class="num text-small text-faint">
        Storage: {{ bytes(engines.storage.usage) }} of {{ bytes(engines.storage.quota) }}.
      </p>
    </div>

    <WasiChecker
      v-if="showingUpload && uploadedReport"
      mode="upload"
      title="Check a WASI build"
      note=".wasm · passes check to add"
      :report="uploadedReport"
      :served-ids="servedIds"
      :user-ids="userIds"
      :saving="savingUpload"
      :save-error="saveUploadError"
      @run="runUploadWasi"
      @cancel="cancelUploadWasi"
      @upload="picker?.click()"
      @add="addUploadedEngine"
    />

    <EngineDetail
      v-else-if="selected"
      :engine="selected"
      :inspection="inspections.get(selected.id)"
      :probe="probes.get(selected.id)"
      :wasi="wasiReports.get(selected.id)"
      :wasi-loading="wasiLoading.has(selected.id)"
      @inspect="inspectEngine"
      @probe="runProbe"
      @stop-probe="stopProbe"
      @run-wasi="runServedWasi"
      @cancel-wasi="cancelServedWasi"
      @remove="removeUserEngine"
    />

    <Panel v-else>
      <div class="px-3 py-4 text-dense text-dim">Select an engine to view its details.</div>
    </Panel>
  </div>
</template>
