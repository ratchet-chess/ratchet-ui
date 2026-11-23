<script setup lang="ts">
/**
 * A tournament's field picked from the served engines, for lists of a hundred or more: a search
 * and program filters over the engines, ticked into the field; the field in seeding order, moved by
 * dragging or arrows, an engine entered twice through its +.
 */
import { computed, ref, watch } from 'vue';

const props = defineProps<{
  engines: string[];
  /** how many at the top of the field are seeds, tagged as such */
  seeds: number;
}>();
const model = defineModel<string[]>({ required: true });
/**
 * the field as edited here: each edit reads this, not the prop, which the parent updates a render
 * later, so two edits in one task both count
 */
const field = ref<string[]>([...model.value]);
watch(model, (m) => {
  if (m.join('\n') !== field.value.join('\n')) field.value = [...m];
});
watch(field, (f) => (model.value = [...f]));

/** the program an engine is a release of: its id without the version at its end, as `ratchet` for `ratchet-0.3.14` */
const programOf = (id: string) => id.replace(/[-_ ]v?\d[\w.]*$/, '') || id;
const programs = computed(() => {
  const counts = new Map<string, number>();
  for (const e of props.engines) counts.set(programOf(e), (counts.get(programOf(e)) ?? 0) + 1);
  return [...counts].toSorted((a, b) => a[0].localeCompare(b[0]));
});

const query = ref('');
const program = ref('');
const shown = computed(() => {
  const q = query.value.trim().toLowerCase();
  return props.engines.filter(
    (e) => (!program.value || programOf(e) === program.value) && e.toLowerCase().includes(q),
  );
});
const inField = computed(() => new Set(field.value));
const addable = computed(() => shown.value.filter((e) => !inField.value.has(e)));

function tick(e: string, on: boolean): void {
  field.value = on ? [...field.value, e] : field.value.filter((x) => x !== e);
}
const addShown = () => (field.value = [...field.value, ...addable.value]);
const sortField = () =>
  (field.value = field.value.toSorted((a, b) => a.localeCompare(b, 'en', { numeric: true })));
function move(from: number, to: number): void {
  if (to < 0 || to >= field.value.length || from === to) return;
  const next = [...field.value];
  const [x] = next.splice(from, 1);
  if (x !== undefined) next.splice(to, 0, x);
  field.value = next;
}
function again(i: number): void {
  const next = [...field.value];
  const x = next[i];
  if (x !== undefined) next.splice(i + 1, 0, x);
  field.value = next;
}
const remove = (i: number) => (field.value = field.value.filter((_, k) => k !== i));

const dragging = ref<number | null>(null);
function drop(to: number): void {
  if (dragging.value !== null) move(dragging.value, to);
  dragging.value = null;
}

const head =
  'flex min-h-10 items-center gap-1.5 border-b border-row px-2 py-1.5 text-dense text-dim';
const icon = 'px-0.5 text-dense text-faint hover:text-text';
</script>

<template>
  <div class="@container">
    <div
      class="grid overflow-hidden rounded-md border border-line bg-panel2 @2xl:grid-cols-2 @2xl:divide-x @2xl:divide-line"
    >
      <div class="flex min-w-0 flex-col max-@2xl:border-b max-@2xl:border-line">
        <div :class="head">
          <input
            v-model="query"
            type="search"
            :placeholder="`Search ${engines.length} engines`"
            class="field-sm num min-w-0 flex-1 placeholder:text-faint placeholder:italic"
          />
          <button
            class="btn-sm"
            :disabled="addable.length === 0"
            title="Add all matching engines"
            @click="addShown"
          >
            + {{ addable.length }}
          </button>
        </div>
        <div
          v-if="programs.length > 1"
          class="flex flex-wrap gap-1 border-b border-row px-2 py-1.5"
        >
          <button
            v-for="[f, n] in [['', engines.length] as const, ...programs]"
            :key="f"
            class="rounded-full border px-2 text-small"
            :class="program === f ? 'border-accent-line text-accent' : 'border-line text-dim'"
            @click="program = f"
          >
            {{ f || 'All' }} <span class="text-faint">{{ n }}</span>
          </button>
        </div>
        <div class="max-h-56 min-h-16 overflow-auto py-0.5">
          <label
            v-for="e in shown"
            :key="e"
            class="num grid cursor-pointer grid-cols-[18px_minmax(0,1fr)] items-center gap-1.5 px-2 py-0.5 text-dense hover:bg-hover"
          >
            <input
              type="checkbox"
              class="accent-accent"
              :checked="inField.has(e)"
              @change="tick(e, ($event.target as HTMLInputElement).checked)"
            />
            <span class="truncate">{{ e }}</span>
          </label>
          <div v-if="shown.length === 0" class="px-2 py-3 text-dense text-faint">
            No matching engines.
          </div>
        </div>
      </div>

      <div class="flex min-w-0 flex-col">
        <div :class="head">
          <b class="font-semibold text-text">{{ field.length }}</b> selected
          <span class="flex-1" />
          <button class="btn-sm" :disabled="field.length < 2" @click="sortField">Sort A–Z</button>
          <button class="btn-sm" :disabled="field.length === 0" @click="field = []">Clear</button>
        </div>
        <div class="max-h-56 min-h-16 overflow-auto @2xl:max-h-[17.5rem]">
          <div
            v-for="(e, i) in field"
            :key="`${i}.${e}`"
            draggable="true"
            class="num grid cursor-grab grid-cols-[2rem_minmax(0,1fr)_auto_auto] items-center gap-1.5 border-b border-row px-2 py-0.5 text-dense"
            :class="dragging === i ? 'opacity-40' : ''"
            @dragstart="dragging = i"
            @dragover.prevent
            @drop.prevent="drop(i)"
            @dragend="dragging = null"
          >
            <span class="text-faint">{{ i + 1 }}</span>
            <span class="truncate"
              >{{ e }}
              <span
                v-if="i < seeds"
                class="rounded border border-accent-line px-1 font-sans text-label text-accent"
                >seed</span
              ></span
            >
            <span class="whitespace-nowrap">
              <button :class="icon" title="Up" @click="move(i, i - 1)">↑</button>
              <button :class="icon" title="Down" @click="move(i, i + 1)">↓</button>
              <button :class="icon" title="Add duplicate" @click="again(i)">+</button>
            </span>
            <button :class="icon" title="Remove" @click="remove(i)">✕</button>
          </div>
          <div v-if="field.length === 0" class="px-2 py-3 text-dense text-faint">
            Select engines to add.
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
