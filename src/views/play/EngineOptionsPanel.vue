<script setup lang="ts">
/**
 * Detail panel for one side's engine in Play: per-side search limit plus every declared UCI
 * option from the shared inspection cache (inspecting on demand when uncached).
 */
import { X } from '@lucide/vue';
import type { Color } from 'chessops/types';
import { computed, ref, watch } from 'vue';
import { describeControl, parseControl } from '../../chess/clock.ts';
import type { ServedEngine } from '../../engine/manifest.ts';
import {
  groupPlayOptions,
  isDefaultOptionValue,
  optionBounds,
  optionDefaultValue,
  type OptionValue,
  type UciOption,
} from '../../engine/options.ts';
import type { SideConfig } from '../../play/usePlay.ts';
import { useEngines } from '../../stores/engines.ts';
import { canSpawnBrowserThreads } from '../../../vendor/uci-over-wasi/check-browser.ts';

const props = defineProps<{
  engine: ServedEngine;
  color: Color;
  config: SideConfig;
  gameControl: string;
  locked: boolean;
}>();

const emit = defineEmits<{
  close: [];
  updateOption: [name: string, value: OptionValue | undefined];
  updateLimit: [limit: string];
  reset: [];
  saveDefault: [];
}>();

const engines = useEngines();
const threadsOk = canSpawnBrowserThreads();
const hardwareThreads = Math.max(1, navigator.hardwareConcurrency || 1);
const threadsCap = threadsOk ? hardwareThreads : 1;

const LIMIT_PRESETS = [
  { val: '', label: 'Game time' },
  { val: 'depth 4', label: 'depth 4' },
  { val: 'depth 8', label: 'depth 8' },
  { val: 'depth 12', label: 'depth 12' },
  { val: '50k nodes', label: '50k nodes' },
  { val: '200k nodes', label: '200k nodes' },
  { val: '0.5s/move', label: '0.5s/move' },
  { val: '2s/move', label: '2s/move' },
] as const;

const limitDraft = ref(props.config.limit);
watch(
  () => [props.engine.id, props.color, props.config.limit],
  () => {
    limitDraft.value = props.config.limit;
  },
);

const parsedLimit = computed(() => {
  const t = limitDraft.value.trim();
  return t ? parseControl(t) : null;
});
const limitInvalid = computed(() => limitDraft.value.trim() !== '' && parsedLimit.value === null);

function onLimitInput(v: string): void {
  limitDraft.value = v;
  const trimmed = v.trim();
  if (!trimmed) emit('updateLimit', '');
  else if (parseControl(trimmed)) emit('updateLimit', trimmed);
}

function pickLimitPreset(val: string): void {
  limitDraft.value = val;
  emit('updateLimit', val);
}

const inspection = computed(() => engines.inspections.get(props.engine.id));

watch(
  () => props.engine.id,
  () => {
    const cur = engines.inspections.get(props.engine.id);
    if (!cur) void engines.inspect(props.engine);
  },
  { immediate: true },
);

const grouped = computed(() => groupPlayOptions(inspection.value?.options ?? []));
const hasEditableOptions = computed(
  () =>
    grouped.value.strength.length > 0 ||
    grouped.value.core.length > 0 ||
    grouped.value.other.length > 0,
);

function currentValue(opt: UciOption): OptionValue {
  const v = props.config.options[opt.name];
  if (v !== undefined) return v;
  return optionDefaultValue(opt);
}

function isModified(opt: UciOption): boolean {
  return !isDefaultOptionValue(opt, props.config.options[opt.name]);
}

const otherModifiedCount = computed(() => grouped.value.other.filter((o) => isModified(o)).length);

const hasAnyOverride = computed(() => {
  if (props.config.limit.trim() !== '') return true;
  const opts = inspection.value?.options ?? [];
  if (opts.length > 0) return opts.some((o) => isModified(o));
  return Object.keys(props.config.options).length > 0;
});

function spinMax(opt: UciOption): number | undefined {
  const { max } = optionBounds(opt);
  if (opt.name.toLowerCase() === 'threads') {
    return max === undefined ? threadsCap : Math.min(max, threadsCap);
  }
  return max;
}

function spinMin(opt: UciOption): number | undefined {
  return optionBounds(opt).min;
}

function isThreadsLocked(opt: UciOption): boolean {
  return opt.name.toLowerCase() === 'threads' && !threadsOk;
}

function setOption(opt: UciOption, raw: OptionValue): void {
  let val = raw;
  if (opt.type === 'spin') {
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    const min = spinMin(opt);
    const max = spinMax(opt);
    val = Math.round(n);
    if (min !== undefined) val = Math.max(min, val);
    if (max !== undefined) val = Math.min(max, val);
  }
  emit('updateOption', opt.name, isDefaultOptionValue(opt, val) ? undefined : val);
}

const limitStrengthOff = computed(() => {
  const ls = grouped.value.strength.find((o) => o.name.toLowerCase() === 'uci_limitstrength');
  return ls ? currentValue(ls) !== true : false;
});

const savedNote = ref(false);
let savedTimer: ReturnType<typeof setTimeout> | undefined;
function saveDefault(): void {
  emit('saveDefault');
  savedNote.value = true;
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => {
    savedNote.value = false;
  }, 1500);
}
</script>

<template>
  <section class="flex flex-col overflow-hidden rounded-md border border-accent-line bg-panel">
    <header class="flex items-center justify-between gap-2 border-b border-line px-3 py-1.5">
      <div class="flex min-w-0 items-baseline gap-2">
        <span class="caps truncate text-small">{{ engine.id }}</span>
        <span class="shrink-0 text-small text-faint">{{ color }} options</span>
        <span v-if="locked" class="tag tone-warn">read-only</span>
      </div>
      <button
        type="button"
        class="btn-sm h-6 px-1.5"
        title="Close options"
        aria-label="Close options"
        @click="emit('close')"
      >
        <X :size="13" />
      </button>
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto">
      <!-- ── Search limit ────────────────────────────────────────────── -->
      <div class="border-b border-row px-3 py-2.5">
        <div class="mb-1.5 flex items-center justify-between gap-2">
          <span class="caps text-label font-semibold">Search limit</span>
          <span v-if="parsedLimit" class="tag tone-good">{{ parsedLimit.label }}</span>
        </div>
        <input
          :value="limitDraft"
          type="text"
          :disabled="locked"
          placeholder="Match game time (e.g. depth 8, 200k nodes, 1s/move)"
          class="field-sm num w-full disabled:cursor-not-allowed disabled:opacity-65"
          :class="limitInvalid ? 'border-bad-line focus:border-bad-line' : ''"
          @input="onLimitInput(($event.target as HTMLInputElement).value)"
        />
        <div class="mt-1.5 flex flex-wrap gap-1">
          <button
            v-for="p in LIMIT_PRESETS"
            :key="p.label"
            type="button"
            :disabled="locked"
            class="num rounded border px-1.5 py-0.5 text-small disabled:cursor-not-allowed disabled:opacity-50"
            :class="
              config.limit === p.val
                ? 'border-accent bg-chosen text-text'
                : 'border-line bg-panel2 text-dim hover:text-text'
            "
            @click="pickLimitPreset(p.val)"
          >
            {{ p.label }}
          </button>
        </div>
        <div v-if="limitInvalid" class="mt-1 text-small text-bad">Invalid time control</div>
        <div v-else-if="parsedLimit" class="mt-1 text-small text-dim">
          {{ describeControl(parsedLimit)
          }}{{
            parsedLimit.kind !== 'clock' && parsedLimit.kind !== 'moves' && gameControl
              ? ` · overrides game clock for ${color}`
              : ''
          }}
        </div>
        <div v-else class="mt-1 text-small text-dim">
          {{
            gameControl
              ? `Uses game time (${gameControl}).`
              : 'No clock — engine defaults to 1s/move.'
          }}
        </div>
      </div>

      <!-- ── UCI options ─────────────────────────────────────────────── -->
      <div
        v-if="!inspection || inspection.state === 'loading'"
        class="px-3 py-3 text-dense text-dim"
      >
        Loading…
      </div>
      <div
        v-else-if="inspection.state === 'failed'"
        class="flex items-center justify-between gap-2 px-3 py-3 text-dense text-bad"
      >
        <span class="min-w-0 truncate">{{ inspection.error }}</span>
        <button type="button" class="btn-sm shrink-0" @click="engines.inspect(engine, true)">
          Retry
        </button>
      </div>
      <template v-else>
        <div v-if="!hasEditableOptions" class="px-3 py-3 text-dense text-dim">
          No editable UCI options declared.
        </div>

        <!-- Strength -->
        <div v-if="grouped.strength.length > 0" class="border-b border-row px-3 py-2.5">
          <div class="caps mb-1.5 text-label font-semibold">Strength</div>
          <div v-for="opt in grouped.strength" :key="opt.name" class="py-1">
            <div class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 text-dense">
              <span class="flex min-w-0 items-center gap-1.5">
                <span
                  v-if="isModified(opt)"
                  class="size-1.5 shrink-0 rounded-full bg-accent"
                  title="Changed from default"
                />
                <span class="num truncate">{{ opt.name }}</span>
              </span>
              <span class="flex items-center gap-1.5">
                <input
                  v-if="opt.type === 'check'"
                  type="checkbox"
                  class="accent-accent"
                  :disabled="locked"
                  :checked="currentValue(opt) === true"
                  @change="setOption(opt, ($event.target as HTMLInputElement).checked)"
                />
                <template v-else-if="opt.type === 'spin'">
                  <input
                    v-if="spinMin(opt) !== undefined && spinMax(opt) !== undefined"
                    type="range"
                    class="w-20 accent-accent"
                    :disabled="locked"
                    :min="spinMin(opt)"
                    :max="spinMax(opt)"
                    :value="Number(currentValue(opt))"
                    @input="setOption(opt, Number(($event.target as HTMLInputElement).value))"
                  />
                  <input
                    type="number"
                    class="field-sm num no-spin w-[70px] text-right"
                    :disabled="locked"
                    :min="spinMin(opt)"
                    :max="spinMax(opt)"
                    :value="Number(currentValue(opt))"
                    @change="setOption(opt, Number(($event.target as HTMLInputElement).value))"
                  />
                </template>
              </span>
            </div>
            <div
              v-if="opt.name.toLowerCase() === 'uci_elo' && limitStrengthOff"
              class="mt-0.5 text-small text-dim"
            >
              Takes effect when UCI_LimitStrength is on.
            </div>
          </div>
        </div>

        <!-- Resources (Hash & Threads) -->
        <div v-if="grouped.core.length > 0" class="border-b border-row px-3 py-2.5">
          <div class="caps mb-1.5 text-label font-semibold">Resources</div>
          <div v-for="opt in grouped.core" :key="opt.name" class="py-1">
            <div class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 text-dense">
              <span class="flex min-w-0 items-center gap-1.5">
                <span
                  v-if="isModified(opt)"
                  class="size-1.5 shrink-0 rounded-full bg-accent"
                  title="Changed from default"
                />
                <span class="num truncate">{{ opt.name }}</span>
              </span>
              <input
                type="number"
                class="field-sm num no-spin w-[76px] text-right"
                :disabled="locked || isThreadsLocked(opt)"
                :min="spinMin(opt)"
                :max="spinMax(opt)"
                :value="isThreadsLocked(opt) ? 1 : Number(currentValue(opt))"
                @change="setOption(opt, Number(($event.target as HTMLInputElement).value))"
              />
            </div>
            <div v-if="opt.name.toLowerCase() === 'threads'" class="mt-0.5 text-small text-dim">
              {{
                threadsOk
                  ? `Capped at ${hardwareThreads} hardware threads.`
                  : 'Locked to 1 (browser threads unavailable).'
              }}
            </div>
          </div>
        </div>

        <!-- All other UCI options -->
        <div v-if="grouped.other.length > 0" class="px-3 py-2.5">
          <details>
            <summary class="cursor-pointer text-small text-dim select-none hover:text-text">
              All UCI options ({{ grouped.other.length }})
              <span v-if="otherModifiedCount > 0" class="ml-1 text-accent">
                · {{ otherModifiedCount }} changed
              </span>
            </summary>
            <div class="mt-2 space-y-1">
              <div
                v-for="opt in grouped.other"
                :key="opt.name"
                class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 py-0.5 text-dense"
              >
                <span class="flex min-w-0 items-center gap-1.5">
                  <span
                    v-if="isModified(opt)"
                    class="size-1.5 shrink-0 rounded-full bg-accent"
                    title="Changed from default"
                  />
                  <span class="num truncate" :title="opt.name">{{ opt.name }}</span>
                </span>
                <input
                  v-if="opt.type === 'check'"
                  type="checkbox"
                  class="accent-accent"
                  :disabled="locked"
                  :checked="currentValue(opt) === true"
                  @change="setOption(opt, ($event.target as HTMLInputElement).checked)"
                />
                <select
                  v-else-if="opt.type === 'combo'"
                  class="field-sm num max-w-36"
                  :disabled="locked"
                  :value="String(currentValue(opt))"
                  @change="setOption(opt, ($event.target as HTMLSelectElement).value)"
                >
                  <option v-for="v in optionBounds(opt).vars" :key="v" :value="v">{{ v }}</option>
                </select>
                <input
                  v-else-if="opt.type === 'spin'"
                  type="number"
                  class="field-sm num no-spin w-[76px] text-right"
                  :disabled="locked"
                  :min="spinMin(opt)"
                  :max="spinMax(opt)"
                  :value="Number(currentValue(opt))"
                  @change="setOption(opt, Number(($event.target as HTMLInputElement).value))"
                />
                <input
                  v-else
                  type="text"
                  class="field-sm num w-32"
                  :disabled="locked"
                  :value="String(currentValue(opt))"
                  @change="setOption(opt, ($event.target as HTMLInputElement).value)"
                />
              </div>
            </div>
          </details>
        </div>
      </template>
    </div>

    <footer class="flex items-center justify-between gap-2 border-t border-line bg-panel px-3 py-2">
      <div class="flex items-center gap-1.5">
        <button
          type="button"
          class="btn-sm"
          :disabled="locked || !hasAnyOverride"
          @click="emit('reset')"
        >
          Reset
        </button>
        <button type="button" class="btn-sm" :disabled="locked" @click="saveDefault">
          {{ savedNote ? 'Saved' : 'Save as default' }}
        </button>
      </div>
      <button type="button" class="btn-primary py-1" @click="emit('close')">Done</button>
    </footer>
  </section>
</template>
