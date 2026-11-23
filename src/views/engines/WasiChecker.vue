<script setup lang="ts">
import { RotateCw, Square, Upload } from '@lucide/vue';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import Panel from '../../components/Panel.vue';
import { bytes } from '../../ui/format.ts';
import {
  inspectModule,
  runChecks,
  type CheckDriver,
  type CheckResult,
  type Inspection,
} from '../../../vendor/uci-over-wasi/check.ts';
import {
  browserDriver,
  canRunBrowserChecks,
  canSpawnBrowserThreads,
} from '../../../vendor/uci-over-wasi/check-browser.ts';

type State = 'idle' | 'running' | 'pass' | 'fail' | 'invalid' | 'static' | 'cancelled';

const picker = ref<HTMLInputElement | null>(null);
const dragDepth = ref(0);
const over = computed(() => dragDepth.value > 0);

const fileName = ref('');
const fileBytes = ref<Uint8Array | null>(null);
const state = ref<State>('idle');
const inspection = ref<Inspection | null>(null);
const identity = ref<{ name: string; author: string } | null>(null);
const results = ref<CheckResult[]>([]);
const fatalError = ref('');
const staticNote = ref('');

let controller: AbortController | null = null;
let runSeq = 0;

/** a file dropped beside the panel would make the browser open it and leave the app */
const keep = (e: DragEvent) => {
  if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
};

onMounted(() => {
  window.addEventListener('dragover', keep);
  window.addEventListener('drop', keep);
});

onUnmounted(() => {
  controller?.abort();
  controller = null;
  window.removeEventListener('dragover', keep);
  window.removeEventListener('drop', keep);
});

/** unused driver for static-only runs where only the `declaration` check executes */
const noLiveDriver: CheckDriver = () => {
  throw new Error('live checks are not available in this browser');
};

function createCheckWorker(): Worker {
  return new Worker(new URL('../../../vendor/uci-over-wasi/check-worker.ts', import.meta.url), {
    type: 'module',
  });
}

const featureList = computed(() => {
  const f = inspection.value?.features;
  if (!f) return [];
  const items: string[] = [];
  if (f.threadSpawn) items.push('thread-spawn');
  if (f.sharedMemory) items.push('shared memory');
  if (f.atomics) items.push('atomics');
  if (f.exceptionHandling) items.push('exception-handling');
  if (f.relaxed.size > 0) {
    let total = 0;
    for (const n of f.relaxed.values()) total += n;
    items.push(`relaxed-simd (${total} ops)`);
  }
  return items;
});

const relaxedTitle = computed(() => {
  const relaxed = inspection.value?.features.relaxed;
  if (!relaxed || relaxed.size === 0) return '';
  return [...relaxed].map(([op, n]) => `${op} ×${n}`).join(', ');
});

const counts = computed(() => {
  let pass = 0;
  let fail = 0;
  let skip = 0;
  for (const r of results.value) {
    if (r.status === 'pass') pass++;
    else if (r.status === 'fail') fail++;
    else skip++;
  }
  return { pass, fail, skip };
});

const verdict = computed(() => {
  switch (state.value) {
    case 'running':
      return { text: 'checking', tone: 'tone-accent' };
    case 'pass':
      return { text: 'passes', tone: 'tone-good' };
    case 'fail':
      return { text: 'fails', tone: 'tone-bad' };
    case 'invalid':
      return { text: 'invalid', tone: 'tone-bad' };
    case 'static':
      return { text: 'static only', tone: 'tone-warn' };
    case 'cancelled':
      return { text: 'cancelled', tone: 'tone-warn' };
    default:
      return null;
  }
});

function rowTone(status: CheckResult['status']): string {
  if (status === 'pass') return 'tone-good';
  if (status === 'fail') return 'tone-bad';
  return 'tone-dim';
}

function cancel(): void {
  controller?.abort();
  controller = null;
  if (state.value === 'running') state.value = 'cancelled';
}

async function run(): Promise<void> {
  const wasm = fileBytes.value;
  if (!wasm) return;

  controller?.abort();
  const ac = new AbortController();
  controller = ac;
  const seq = ++runSeq;

  state.value = 'running';
  inspection.value = null;
  identity.value = null;
  results.value = [];
  fatalError.value = '';
  staticNote.value = '';

  const isWasmHeader =
    wasm.length >= 8 && wasm[0] === 0 && wasm[1] === 0x61 && wasm[2] === 0x73 && wasm[3] === 0x6d;
  if (!isWasmHeader || !WebAssembly.validate(wasm.slice().buffer)) {
    fatalError.value = 'Invalid WebAssembly module.';
    state.value = 'invalid';
    return;
  }

  let insp: Inspection;
  try {
    insp = inspectModule(wasm, canSpawnBrowserThreads());
  } catch (err) {
    fatalError.value = err instanceof Error ? err.message : String(err);
    state.value = 'invalid';
    return;
  }
  inspection.value = insp;

  const liveBlocked = insp.refusal
    ? insp.refusal
    : !canRunBrowserChecks()
      ? 'Live checks require cross-origin isolation or JavaScript Promise Integration (JSPI).'
      : '';

  if (liveBlocked) {
    staticNote.value = liveBlocked;
    await runChecks(wasm, noLiveDriver, { only: 'declaration', signal: ac.signal }, (r) => {
      if (seq === runSeq) results.value.push(r);
    });
    if (seq !== runSeq) return;
    state.value = counts.value.fail > 0 ? 'fail' : 'static';
    return;
  }

  try {
    await runChecks(
      wasm,
      browserDriver(wasm, fileName.value, createCheckWorker),
      {
        signal: ac.signal,
        onIdentity: (id) => {
          if (seq === runSeq) identity.value = id;
        },
      },
      (r) => {
        if (seq === runSeq) results.value.push(r);
      },
    );
  } catch (err) {
    if (seq !== runSeq || ac.signal.aborted) return;
    fatalError.value = err instanceof Error ? err.message : String(err);
    state.value = 'fail';
    return;
  }

  if (seq !== runSeq) return;
  if (ac.signal.aborted) {
    state.value = 'cancelled';
  } else {
    state.value = counts.value.fail > 0 ? 'fail' : 'pass';
  }
}

async function checkFile(file: File): Promise<void> {
  fileName.value = file.name;
  fileBytes.value = new Uint8Array(await file.arrayBuffer());
  await run();
}

function picked(e: Event): void {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (file) void checkFile(file);
}

function dragEnter(e: DragEvent): void {
  if (e.dataTransfer?.types.includes('Files')) dragDepth.value++;
}

function dragLeave(): void {
  dragDepth.value = Math.max(0, dragDepth.value - 1);
}

function dropped(e: DragEvent): void {
  dragDepth.value = 0;
  const file = e.dataTransfer?.files?.[0];
  if (file) void checkFile(file);
}
</script>

<template>
  <Panel title="Check a WASI build" note=".wasm · report only">
    <input ref="picker" type="file" accept=".wasm" class="hidden" @change="picked" />

    <div
      :class="over ? 'outline-2 outline-offset-[-2px] outline-line outline-dashed' : ''"
      @dragenter.prevent="dragEnter"
      @dragover.prevent
      @dragleave="dragLeave"
      @drop.prevent="dropped"
    >
      <div
        v-if="state === 'idle'"
        class="flex flex-wrap items-center justify-between gap-2 px-3 py-3 text-dense text-dim"
      >
        <span
          >Drop a <span class="num text-text">.wasm</span> file to check UCI over WASI compliance in
          browser. Nothing is saved.</span
        >
        <button class="btn-sm" @click="picker?.click()"><Upload :size="13" /> Choose file</button>
      </div>

      <template v-else>
        <div
          class="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 border-b border-row px-3 py-2 text-dense"
        >
          <span v-if="verdict" class="tag" :class="verdict.tone">{{ verdict.text }}</span>
          <span class="num text-text">{{ fileName }}</span>
          <span v-if="fileBytes" class="num text-small text-dim">{{
            bytes(fileBytes.length)
          }}</span>
          <span
            v-if="identity?.name"
            class="num text-small text-dim"
            :title="identity.author ? `author: ${identity.author}` : ''"
            >· {{ identity.name }}</span
          >
          <div class="ml-auto flex items-center gap-1.5">
            <button v-if="state === 'running'" class="btn-sm" @click="cancel">
              <Square :size="12" /> Cancel
            </button>
            <button v-else class="btn-sm" @click="run"><RotateCw :size="12" /> Re-run</button>
            <button class="btn-sm" @click="picker?.click()">
              <Upload :size="12" /> Choose file
            </button>
          </div>
        </div>

        <div
          v-if="inspection"
          class="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-row px-3 py-1.5 text-small text-dim"
        >
          <span>
            Profile: <span class="num text-text">{{ inspection.declaration.profile }}</span>
          </span>
          <span>
            Requires:
            <span class="num text-text">{{
              inspection.declaration.requires.join(', ') || 'none'
            }}</span>
          </span>
          <span :title="relaxedTitle">
            Features:
            <span class="num text-text">{{ featureList.join(', ') || 'floor only' }}</span>
          </span>
          <span v-if="results.length > 0" class="num ml-auto">
            <span class="text-good">{{ counts.pass }} passed</span>
            <template v-if="counts.fail > 0">
              · <span class="text-bad">{{ counts.fail }} failed</span>
            </template>
            <template v-if="counts.skip > 0"> · {{ counts.skip }} skipped </template>
          </span>
        </div>

        <div
          v-if="fatalError"
          class="border-b border-row px-3 py-2 text-dense text-bad last:border-0"
        >
          {{ fatalError }}
        </div>
        <div
          v-else-if="staticNote"
          class="border-b border-row px-3 py-2 text-dense text-warn last:border-0"
        >
          {{ staticNote }}
        </div>

        <div v-if="results.length > 0 || state === 'running'" class="overflow-x-auto">
          <table class="w-full border-collapse text-dense">
            <thead>
              <tr class="text-left text-small text-dim">
                <th class="th w-16">status</th>
                <th class="th">check</th>
                <th class="th">detail</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in results" :key="r.name" class="border-b border-row last:border-0">
                <td class="px-2 py-1.5 whitespace-nowrap">
                  <span class="tag" :class="rowTone(r.status)">{{ r.status }}</span>
                </td>
                <td class="num px-2 py-1.5 whitespace-nowrap text-text">{{ r.name }}</td>
                <td
                  class="px-2 py-1.5"
                  :class="
                    r.status === 'fail' ? 'text-bad' : r.status === 'skip' ? 'text-dim' : 'text-dim'
                  "
                >
                  {{ r.detail }}
                </td>
              </tr>
              <tr v-if="state === 'running'">
                <td class="px-2 py-1.5 whitespace-nowrap">
                  <span class="tag tone-accent">…</span>
                </td>
                <td colspan="2" class="px-2 py-1.5 text-dim">Running checks…</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </div>
  </Panel>
</template>
