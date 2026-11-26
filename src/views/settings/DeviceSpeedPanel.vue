<script setup lang="ts">
/**
 * Settings panel for measuring browser device speed with Stockfish 10 at idle (1 worker) and at
 * user-chosen tournament concurrency, relative to CCRL's Intel i7-4770K baseline.
 */
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import HelpTip from '../../components/HelpTip.vue';
import Panel from '../../components/Panel.vue';
import {
  defaultClockConcurrency,
  ratioText,
  scaledPresets,
  type CalibrationSample,
} from '../../engine/calibrate.ts';
import { ANCHOR_NAME } from '../../ratings/list.ts';
import { useCalibration } from '../../stores/calibration.ts';
import { useEngines } from '../../stores/engines.ts';
import { thousands, whenText } from '../../ui/format.ts';

const route = useRoute();
const engines = useEngines();
const calibration = useCalibration();

const threads = navigator.hardwareConcurrency || 1;
const maxConcurrent = Math.max(2, threads);

function initialConcurrency(): number {
  const q = Number(route.query['concurrency']);
  if (Number.isInteger(q) && q >= 2 && q <= maxConcurrent) return q;
  return Math.max(2, Math.min(maxConcurrent, defaultClockConcurrency(threads)));
}

const targetConcurrency = ref(initialConcurrency());
watch(
  () => route.query['concurrency'],
  (v) => {
    const n = Number(v);
    if (Number.isInteger(n) && n >= 2 && n <= maxConcurrent) targetConcurrency.value = n;
  },
);

const idle = computed(() => calibration.data.idle);
const concurrentEntries = computed<CalibrationSample[]>(() =>
  Object.values(calibration.data.concurrent).toSorted((a, b) => a.concurrency - b.concurrency),
);
const hasAny = computed(() => idle.value !== null || concurrentEntries.value.length > 0);
const busy = computed(() => calibration.progress !== null);

const previewSource = computed(() => calibration.forConcurrency(targetConcurrency.value));
const previewPresets = computed(() =>
  previewSource.value ? scaledPresets(previewSource.value.sample.ratio) : [],
);

const progressText = computed(() => {
  const p = calibration.progress;
  if (!p) return '';
  const mode = p.concurrency === 1 ? 'idle' : `${p.concurrency} concurrent`;
  if (p.phase === 'starting') return `Starting ${ANCHOR_NAME} (${mode})…`;
  if (p.phase === 'warmup') return `Warming up (${mode})…`;
  return `Measuring (${mode}, ${p.done}/${p.total})…`;
});

const when = (iso: string) => whenText(iso, Date.now());

function runConcurrent(): void {
  const n = Math.max(2, Math.min(maxConcurrent, Math.round(targetConcurrency.value || 2)));
  targetConcurrency.value = n;
  void calibration.run(n);
}

onMounted(() => {
  void engines.load();
});
</script>

<template>
  <Panel title="Device speed" note="Stockfish 10 vs CCRL i7-4770K · in browser only">
    <div
      class="grid grid-cols-[max-content_1fr] items-center gap-x-3.5 gap-y-2 px-3 py-2.5 text-dense"
    >
      <span class="flex items-center justify-between gap-2 text-dim">
        Idle (1)
        <HelpTip>
          Runs one Stockfish 10 worker over 3 positions at depth 13 (Hash 16 MB, 1 thread) after a
          warm-up search, compared against CCRL's Intel i7-4770K baseline (~1,280 k nps). Kept in
          browser storage only and excluded from backups.
        </HelpTip>
      </span>
      <span class="flex flex-wrap items-center gap-2">
        <button class="btn-sm" :disabled="!calibration.anchor || busy" @click="calibration.run(1)">
          {{ idle ? 'Re-calibrate' : 'Calibrate' }}
        </button>
        <template v-if="idle">
          <span class="num font-medium text-text">{{ ratioText(idle.ratio) }}</span>
          <span class="num text-dim">
            · {{ thousands(idle.nps) }} nps · {{ when(idle.measuredAt) }}
          </span>
          <span v-if="calibration.isStale(idle)" class="tag tone-warn">build changed</span>
        </template>
        <span v-else class="text-dim">Not calibrated</span>
      </span>

      <span class="flex items-center justify-between gap-2 text-dim">
        At concurrency
        <HelpTip>
          Runs multiple Stockfish 10 workers simultaneously to measure cache and thermal scaling at
          your tournament concurrency. Tourneys uses an exact concurrency reading first, falling
          back to idle.
        </HelpTip>
      </span>
      <span class="flex flex-wrap items-center gap-2">
        <input
          v-model.number="targetConcurrency"
          type="number"
          min="2"
          :max="maxConcurrent"
          class="field-sm num no-spin w-16 text-right"
          aria-label="Tournament concurrency to calibrate"
          :disabled="busy || threads < 2"
        />
        <button
          class="btn-sm"
          :disabled="!calibration.anchor || busy || threads < 2"
          @click="runConcurrent"
        >
          Calibrate at {{ targetConcurrency }}
        </button>
        <span class="num text-dim">of {{ threads }} threads</span>
      </span>

      <template v-if="concurrentEntries.length > 0">
        <span class="self-start pt-1 text-dim">Saved</span>
        <div class="flex flex-col gap-1">
          <div
            v-for="s in concurrentEntries"
            :key="s.concurrency"
            class="num flex flex-wrap items-center gap-2"
          >
            <span class="text-text">{{ s.concurrency }} concurrent</span>
            <span class="font-medium text-text">{{ ratioText(s.ratio) }}</span>
            <span class="text-dim">· {{ thousands(s.nps) }} nps · {{ when(s.measuredAt) }}</span>
            <span v-if="calibration.isStale(s)" class="tag tone-warn">build changed</span>
            <button
              class="btn-sm"
              title="Remove saved concurrency calibration"
              :disabled="busy"
              @click="calibration.removeConcurrent(s.concurrency)"
            >
              ✕
            </button>
          </div>
        </div>
      </template>

      <template v-if="previewSource">
        <span class="text-dim">Scaled controls</span>
        <span class="num flex flex-wrap items-center gap-x-3 gap-y-1">
          <span v-for="p in previewPresets" :key="p.id">
            <span class="text-dim">{{ p.name }}</span>
            <span class="ml-1 text-text">{{ p.control }}</span>
          </span>
          <span class="text-small text-faint">
            {{
              previewSource.sample.concurrency > 1
                ? `from ${previewSource.sample.concurrency} concurrent`
                : 'from idle'
            }}
          </span>
        </span>
      </template>
    </div>

    <div
      v-if="(engines.loaded && !calibration.anchor) || busy || calibration.error || hasAny"
      class="flex flex-wrap items-center gap-2 border-t border-row px-3 py-1.5 text-dense"
    >
      <template v-if="busy">
        <span class="num text-dim">{{ progressText }}</span>
        <button class="btn-sm ml-auto" @click="calibration.stop()">Stop</button>
      </template>
      <span v-else-if="calibration.error" class="text-bad">{{ calibration.error }}</span>
      <span v-else-if="engines.loaded && !calibration.anchor" class="text-dim">
        Requires <span class="mono">{{ ANCHOR_NAME }}</span> in Engines to calibrate against CCRL's
        Intel i7-4770K baseline.
      </span>
      <span v-else class="text-small text-dim">
        Available as scaled presets in Tourneys setup.
      </span>
      <button v-if="hasAny && !busy" class="btn-sm ml-auto" @click="calibration.clear()">
        Clear
      </button>
    </div>
  </Panel>
</template>
