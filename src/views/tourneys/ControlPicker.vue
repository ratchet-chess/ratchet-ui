<script setup lang="ts">
/**
 * A time control picked from the built-in ones and the user's own, or typed: a typed one is read
 * back in words before it is kept, and kept ones stay in this browser's settings.
 */
import { computed, ref } from 'vue';
import { TIME_CONTROLS, describeControl, parseControl, resolveControl } from '../../chess/clock.ts';
import { useSettings } from '../../stores/settings.ts';

const value = defineModel<string>({ required: true });
const settings = useSettings();

const current = computed(() => resolveControl(value.value));
const typing = ref(false);
const text = ref('');
const typed = computed(() => (text.value.trim() ? parseControl(text.value) : null));

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
  'num inline-flex items-center gap-1 rounded-md border px-2 py-[3px] text-[12.5px] cursor-pointer';
const chipClass = (label: string) =>
  label === value.value
    ? 'border-accent bg-[#22303d] text-text'
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
          title="Forget this control"
          @click.stop="forget(c)"
        >
          ✕
        </button>
      </span>
      <button
        :class="[chip, typing ? 'border-accent text-text' : 'border-line bg-panel2 text-dim']"
        @click="typing = !typing"
      >
        custom…
      </button>
    </div>
    <div class="mt-1 text-xs text-dim">
      {{ current ? describeControl(current) : `${value} is not a control this app reads` }}
    </div>
    <div v-if="typing" class="mt-2 flex flex-wrap items-center gap-2">
      <input
        v-model="text"
        type="text"
        placeholder="5+0.05, 2m+1, 40/10, 1s/move, 500k nodes, depth 12"
        class="num h-[30px] w-64 max-w-full rounded-md border bg-panel2 px-2 text-[12.5px] placeholder:text-faint placeholder:italic"
        :class="text.trim() && !typed ? 'border-[#7a3a30]' : 'border-line'"
        @keydown.enter="keep"
      />
      <button
        class="rounded-md border border-line bg-panel2 px-2.5 py-1 text-xs disabled:text-faint"
        :disabled="!typed"
        @click="keep"
      >
        Keep
      </button>
      <span class="text-xs" :class="typed ? 'text-dim' : 'text-faint'">{{
        text.trim() ? (typed ? describeControl(typed) : 'not a control this app reads') : ''
      }}</span>
    </div>
  </div>
</template>
