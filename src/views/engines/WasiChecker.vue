<script setup lang="ts">
import {
  ChevronDown,
  ChevronRight,
  Plus,
  RotateCw,
  ShieldCheck,
  Square,
  Upload,
} from '@lucide/vue';
import { computed, ref, watch } from 'vue';
import Panel from '../../components/Panel.vue';
import type { WasiCheckReport } from '../../engine/cache.ts';
import { defaultEngineId, isValidEngineId } from '../../stores/engines.ts';
import { bytes, sentence } from '../../ui/format.ts';
import type { CheckResult } from '../../../vendor/uci-over-wasi/check.ts';

const props = defineProps<{
  mode: 'served' | 'upload';
  targetKey?: string;
  title: string;
  note?: string;
  report: WasiCheckReport | undefined;
  loading?: boolean;
  /** served engine ids, which a visitor build cannot shadow */
  servedIds?: ReadonlySet<string>;
  /** existing in-browser engine ids, which a visitor build may replace */
  userIds?: ReadonlySet<string>;
  saving?: boolean;
  saveError?: string;
}>();

const emit = defineEmits<{
  run: [];
  cancel: [];
  upload: [];
  add: [id: string, replace: boolean];
}>();

const draftId = ref('');
watch(
  () => [props.mode, props.report?.fileName, props.report?.size] as const,
  ([mode, fileName]) => {
    if (mode === 'upload' && fileName) draftId.value = defaultEngineId(fileName);
  },
  { immediate: true },
);

const trimmedId = computed(() => draftId.value.trim());
const idValid = computed(() => isValidEngineId(trimmedId.value));
const isServedCollision = computed(() => Boolean(props.servedIds?.has(trimmedId.value)));
const isUserCollision = computed(() => Boolean(props.userIds?.has(trimmedId.value)));
const canAdd = computed(
  () =>
    props.mode === 'upload' &&
    props.report?.state === 'pass' &&
    idValid.value &&
    !isServedCollision.value &&
    !props.saving,
);

function submitAdd(): void {
  if (!canAdd.value) return;
  emit('add', trimmedId.value, isUserCollision.value);
}

/** Served reports open rolled up unless active, and stay open after a run finishes. */
const expanded = ref(props.mode === 'upload' || props.report?.state === 'running');

watch(
  () => [props.mode, props.targetKey, props.report?.fileName, props.report?.state] as const,
  ([mode, targetKey, fileName, state], prev) => {
    if (mode === 'upload') {
      if (!prev || prev[0] !== mode || prev[2] !== fileName || state === 'running') {
        expanded.value = true;
      }
      return;
    }
    if (!prev || prev[0] !== mode || prev[1] !== targetKey) {
      expanded.value = state === 'running';
      return;
    }
    if (state === 'running' || (prev[3] === undefined && state !== undefined && state !== 'pass')) {
      expanded.value = true;
    }
  },
  { immediate: true },
);

const featureList = computed(() => {
  const f = props.report?.info;
  if (!f) return [];
  const items: string[] = [];
  if (f.threadSpawn) items.push('thread-spawn');
  if (f.sharedMemory) items.push('shared memory');
  if (f.atomics) items.push('atomics');
  if (f.exceptionHandling) items.push('exception-handling');
  if (f.relaxed.length > 0) {
    let total = 0;
    for (const [, n] of f.relaxed) total += n;
    items.push(`relaxed-simd (${total} ops)`);
  }
  return items;
});

const relaxedTitle = computed(() => {
  const relaxed = props.report?.info?.relaxed;
  if (!relaxed || relaxed.length === 0) return '';
  return relaxed.map(([op, n]) => `${op} ×${n}`).join(', ');
});

const counts = computed(() => {
  let pass = 0;
  let fail = 0;
  let skip = 0;
  for (const r of props.report?.results ?? []) {
    if (r.status === 'pass') pass++;
    else if (r.status === 'fail') fail++;
    else skip++;
  }
  return { pass, fail, skip };
});

const verdict = computed(() => {
  switch (props.report?.state) {
    case 'running':
      return { text: 'Checking', tone: 'tone-accent' };
    case 'pass':
      return { text: 'Passes', tone: 'tone-good' };
    case 'fail':
      return { text: 'Fails', tone: 'tone-bad' };
    case 'invalid':
      return { text: 'Invalid', tone: 'tone-bad' };
    case 'static':
      return { text: 'Static only', tone: 'tone-warn' };
    case 'cancelled':
      return { text: 'Cancelled', tone: 'tone-warn' };
    default:
      return null;
  }
});

const hasDetails = computed(() => {
  const r = props.report;
  if (!r) return false;
  return r.results.length > 0 || r.state === 'running' || Boolean(r.fatalError || r.staticNote);
});

function rowTone(status: CheckResult['status']): string {
  if (status === 'pass') return 'tone-good';
  if (status === 'fail') return 'tone-bad';
  return 'tone-dim';
}
</script>

<template>
  <Panel :title="title" :note="note">
    <div v-if="loading && !report" class="px-3 py-2.5 text-dense text-dim">
      Loading .wasm module…
    </div>

    <div
      v-else-if="!report"
      class="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-dense text-dim"
    >
      <span>
        Run the
        <a
          href="https://github.com/ratchet-chess/uci-over-wasi/blob/main/docs/uci-over-wasi.md"
          target="_blank"
          rel="noopener"
          class="text-accent hover:underline"
          >UCI over WASI</a
        >
        compliance checks in browser (<a
          href="https://github.com/ratchet-chess/uci-over-wasi/blob/main/helper/README.md"
          target="_blank"
          rel="noopener"
          class="text-accent hover:underline"
          >adaptation guide</a
        >).
      </span>
      <button class="btn-sm" :disabled="loading" @click="emit('run')">
        <ShieldCheck :size="12" /> Check WASI
      </button>
    </div>

    <template v-else>
      <div
        class="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 border-b border-row px-3 py-2 text-dense last:border-0"
      >
        <button
          v-if="hasDetails"
          class="-ml-1 inline-flex items-center text-dim hover:text-text"
          :title="expanded ? 'Collapse check rows' : 'Expand check rows'"
          :aria-expanded="expanded"
          @click="expanded = !expanded"
        >
          <ChevronDown v-if="expanded" :size="14" />
          <ChevronRight v-else :size="14" />
        </button>
        <span v-if="verdict" class="tag" :class="verdict.tone">{{ verdict.text }}</span>
        <span class="mono text-text">{{ report.fileName }}</span>
        <span class="num text-small text-dim">{{ bytes(report.size) }}</span>
        <span
          v-if="report.identity?.name"
          class="num text-small text-dim"
          :title="report.identity.author ? `author: ${report.identity.author}` : ''"
          >· {{ report.identity.name }}</span
        >
        <div class="ml-auto flex items-center gap-1.5">
          <button v-if="report.state === 'running'" class="btn-sm" @click="emit('cancel')">
            <Square :size="12" /> Cancel
          </button>
          <button v-else class="btn-sm" :disabled="loading" @click="emit('run')">
            <RotateCw :size="12" /> Re-run
          </button>
          <button v-if="mode === 'upload'" class="btn-sm" @click="emit('upload')">
            <Upload :size="12" /> Choose file
          </button>
        </div>
      </div>

      <div
        v-if="report.info"
        class="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-1.5 text-small text-dim"
        :class="expanded && hasDetails ? 'border-b border-row' : ''"
        @click="hasDetails && (expanded = !expanded)"
      >
        <span> Profile: <span class="num text-text">{{ report.info.profile }}</span> </span>
        <span>
          Requires:
          <span class="num text-text">{{ report.info.requires.join(', ') || 'none' }}</span>
        </span>
        <span :title="relaxedTitle">
          Features:
          <span class="num text-text">{{ featureList.join(', ') || 'floor only' }}</span>
        </span>
        <span v-if="report.results.length > 0" class="num ml-auto">
          <span class="text-good">{{ counts.pass }} passed</span>
          <template v-if="counts.fail > 0">
            · <span class="text-bad">{{ counts.fail }} failed</span>
          </template>
          <template v-if="counts.skip > 0"> · {{ counts.skip }} skipped </template>
        </span>
      </div>

      <div
        v-if="mode === 'upload' && report.state === 'pass'"
        class="flex flex-wrap items-center gap-2 border-b border-row bg-panel2 px-3 py-2 text-dense last:border-0"
      >
        <label class="flex items-center gap-1.5 text-small text-dim">
          ID
          <input
            v-model="draftId"
            type="text"
            class="field-sm num w-44"
            :class="!idValid || isServedCollision ? 'border-bad-line focus:border-bad-line' : ''"
            :disabled="saving"
            aria-label="Engine ID"
            @keydown.enter="submitAdd"
          />
        </label>
        <button class="btn-primary btn-sm" :disabled="!canAdd" @click="submitAdd">
          <Plus :size="12" />
          {{ saving ? 'Saving…' : isUserCollision ? 'Replace in Engines' : 'Add to Engines' }}
        </button>
        <span v-if="saveError" class="text-small text-bad">{{ saveError }}</span>
        <span v-else-if="!idValid" class="text-small text-bad">Invalid engine ID</span>
        <span v-else-if="isServedCollision" class="text-small text-bad">
          Matches a served engine — choose another ID
        </span>
        <span v-else-if="isUserCollision" class="text-small text-warn">
          Replaces existing in-browser build
        </span>
        <span v-else class="text-small text-dim">Stored in browser for Play and Tourneys</span>
      </div>

      <template v-if="expanded">
        <div
          v-if="report.fatalError"
          class="border-b border-row px-3 py-2 text-dense text-bad last:border-0"
        >
          {{ report.fatalError }}
        </div>
        <div
          v-else-if="report.staticNote"
          class="border-b border-row px-3 py-2 text-dense text-warn last:border-0"
        >
          {{ report.staticNote }}
        </div>

        <div v-if="report.results.length > 0 || report.state === 'running'" class="overflow-x-auto">
          <table class="w-full border-collapse text-dense">
            <thead>
              <tr class="text-left text-small text-dim">
                <th class="th w-16">status</th>
                <th class="th">check</th>
                <th class="th">detail</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="r in report.results"
                :key="r.name"
                class="border-b border-row last:border-0"
              >
                <td class="px-2 py-1.5 whitespace-nowrap">
                  <span class="tag" :class="rowTone(r.status)">{{ sentence(r.status) }}</span>
                </td>
                <td class="num px-2 py-1.5 whitespace-nowrap text-text">{{ r.name }}</td>
                <td class="px-2 py-1.5" :class="r.status === 'fail' ? 'text-bad' : 'text-dim'">
                  {{ r.detail }}
                </td>
              </tr>
              <tr v-if="report.state === 'running'">
                <td class="px-2 py-1.5 whitespace-nowrap">
                  <span class="tag tone-accent">…</span>
                </td>
                <td colspan="2" class="px-2 py-1.5 text-dim">Running checks…</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </template>
  </Panel>
</template>
