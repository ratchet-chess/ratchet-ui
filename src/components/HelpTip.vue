<script setup lang="ts">
/**
 * A ? that opens a short note on hover, keyboard focus or a tap, for what a dense page cannot say
 * in a few words. The note is the default slot. It is drawn over the page, placed from the ?, so a
 * scrolling table or a panel never clips it; Escape or a tap elsewhere closes a tapped one.
 */
import { onBeforeUnmount, ref, useId } from 'vue';

const props = defineProps<{
  /** which side of the ? the note opens to; right by default */
  side?: 'left' | 'right';
}>();

const id = useId();
const WIDTH = 288;
const button = ref<HTMLElement | null>(null);
const note = ref<HTMLElement | null>(null);
/** open on hover or focus */
const shown = ref(false);
/** open on a tap, until Escape or a tap elsewhere */
const pinned = ref(false);
const at = ref({ left: 0, top: 0 });

function place(): void {
  const r = button.value?.getBoundingClientRect();
  if (!r) return;
  const left = props.side === 'left' ? r.left - WIDTH - 7 : r.right + 7;
  at.value = {
    left: Math.max(8, Math.min(window.innerWidth - WIDTH - 8, left)),
    top: Math.max(8, r.top - 6),
  };
}
function show(): void {
  place();
  shown.value = true;
}

function away(e: Event): void {
  const t = e.target as Node;
  if (!button.value?.contains(t) && !note.value?.contains(t)) close();
}
function key(e: KeyboardEvent): void {
  if (e.key === 'Escape') close();
}
function close(): void {
  pinned.value = false;
  shown.value = false;
  document.removeEventListener('pointerdown', away);
  document.removeEventListener('keydown', key);
  window.removeEventListener('scroll', close, true);
}
function toggle(): void {
  if (pinned.value) return close();
  show();
  pinned.value = true;
  document.addEventListener('pointerdown', away);
  document.addEventListener('keydown', key);
  window.addEventListener('scroll', close, true);
}
onBeforeUnmount(close);
</script>

<template>
  <button
    ref="button"
    type="button"
    class="inline-flex size-[15px] shrink-0 cursor-help items-center justify-center rounded-full border align-middle text-label leading-none font-semibold normal-case focus-visible:outline-none"
    :class="
      shown || pinned
        ? 'border-accent text-accent'
        : 'border-faint text-dim hover:border-accent hover:text-accent'
    "
    aria-label="help"
    :aria-describedby="id"
    @click.stop="toggle"
    @mouseenter="show"
    @mouseleave="!pinned && (shown = false)"
    @focus="show"
    @blur="!pinned && (shown = false)"
  >
    ?
  </button>
  <Teleport to="body">
    <span
      v-show="shown || pinned"
      :id="id"
      ref="note"
      role="tooltip"
      class="fixed z-50 rounded-md border border-line bg-popover px-3 py-2 text-left text-dense leading-normal font-normal tracking-normal whitespace-normal text-text normal-case shadow-lg"
      :style="{ left: `${at.left}px`, top: `${at.top}px`, width: `${WIDTH}px` }"
    >
      <slot />
    </span>
  </Teleport>
</template>
