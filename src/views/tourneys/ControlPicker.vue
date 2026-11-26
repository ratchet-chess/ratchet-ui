<script setup lang="ts">
/**
 * A time control picked from the built-in ones, device-scaled CCRL presets, and the user's own,
 * or typed: a typed one is read back in words before it is kept, and kept ones stay in this
 * browser's settings.
 */
import { computed, ref } from 'vue';
import { TIME_CONTROLS, describeControl, parseControl, resolveControl } from '../../chess/clock.ts';
import { ratioText, scaledPresets } from '../../engine/calibrate.ts';
import { useCalibration } from '../../stores/calibration.ts';
import { useSettings } from '../../stores/settings.ts';

const props = withDefaults(
  defineProps<{
    /** Tournament concurrency used to pick the matching device calibration sample. */
    concurrency?: number;
  }>(),
  { concurrency: 1 },
);

const value = defineModel<string>({ required: true });
const settings = useSettings();
const calibration = useCalibration();

const current = computed(() => resolveControl(value.value));
const typing = ref(false);
const text = ref('');
const typed = computed(() => (text.value.trim() ? parseControl(text.value) : null));

const picked = computed(() => calibration.forConcurrency(props.concurrency));
const scaled = computed(() => (picked.value ? scaledPresets(picked.value.sample.ratio) : []));
const settingsLink = computed(() =>
  props.concurrency > 1
    ? { path: '/settings', query: { concurrency: String(props.concurrency) } }
    : '/settings',
);

function keep(): void {
  const tc = typed.value;
  if (!tc) return;
  if (!TIME_CONTROLS.some((t) => t.label === tc.label) && !settings.controls.includes(tc.label))
    settings.controls = [...settings.controls, tc.label];
  value.value = tc.label;
  text.value = '';
  typing.value = false;
}
function forget(label: string): void {
  settings.controls = settings.controls.filter((c) => c !== label);
}

const chip =
  'num inline-flex items-center gap-1 rounded-md border px-2 py-[3px] text-dense cursor-pointer';
const chipClass = (label: string) =>
  label === value.value
    ? 'border-accent bg-chosen text-text'
    : 'border-line bg-panel2 text-dim hover:text-text';
</script>

<template>
  <div>
    <div class="flex flex-wrap gap-1.5">
      <button
        v-for="t in TIME_CONTROLS"
        :key="t.label"
        :class="[chip, chipClass(t.label)]"
        @click="value = t.label"
      >
        {{ t.label }}
      </button>
      <span
        v-for="c in settings.controls"
        :key="c"
        :class="[chip, chipClass(c), 'group border-dashed']"
        role="button"
        tabindex="0"
        @click="value = c"
        @keydown.enter="value = c"
      >
        {{ c }}
        <button
          class="hidden text-faint group-hover:inline hover:text-text"
          title="Remove saved control"
          @click.stop="forget(c)"
        >
          ✕
        </button>
      </span>
      <button
        :class="[chip, typing ? 'border-accent text-text' : 'border-line bg-panel2 text-dim']"
        @click="typing = !typing"
      >
        Custom…
      </button>
    </div>

    <div v-if="picked" class="mt-2 flex flex-wrap items-center gap-1.5">
      <span class="text-small text-dim">Scaled</span>
      <button
        v-for="p in scaled"
        :key="p.id"
        :class="[chip, chipClass(p.control)]"
        :title="`${p.name} (${p.base} on i7-4770K) scaled by ${ratioText(picked.sample.ratio)}`"
        @click="value = p.control"
      >
        <span class="text-dim">{{ p.name }}</span>
        <span>{{ p.control }}</span>
      </button>
      <span class="num text-small text-dim">
        {{ ratioText(picked.sample.ratio) }}
        <template v-if="picked.sample.concurrency > 1">
          at {{ picked.sample.concurrency }} concurrent
        </template>
        <template v-else-if="!picked.exact && props.concurrency > 1">
          idle ·
          <RouterLink :to="settingsLink" class="text-accent hover:underline">
            calibrate at {{ props.concurrency }}
          </RouterLink>
        </template>
        <template v-else>idle</template>
      </span>
      <span v-if="calibration.isStale(picked.sample)" class="tag tone-warn">stale</span>
    </div>

    <div class="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-dense text-dim">
      <span>{{ current ? describeControl(current) : `Invalid time control: ${value}` }}</span>
      <span v-if="!picked" class="text-small">
        Scaled CCRL presets:
        <RouterLink :to="settingsLink" class="text-accent hover:underline">
          calibrate in Settings
        </RouterLink>
      </span>
    </div>

    <div v-if="typing" class="mt-2 flex flex-wrap items-center gap-2">
      <input
        v-model="text"
        type="text"
        placeholder="5+0.05, 2m+1, 40/10, 1s/move, 500k nodes, depth 12"
        class="field num w-64 max-w-full"
        :class="text.trim() && !typed ? 'border-bad-line focus:border-bad-line' : ''"
        @keydown.enter="keep"
      />
      <button
        class="rounded-md border border-line bg-panel2 px-2.5 py-1 text-dense disabled:text-faint"
        :disabled="!typed"
        @click="keep"
      >
        Save
      </button>
      <span class="text-dense" :class="typed ? 'text-dim' : 'text-faint'">{{
        text.trim() ? (typed ? describeControl(typed) : 'Invalid time control') : ''
      }}</span>
    </div>
  </div>
</template>
