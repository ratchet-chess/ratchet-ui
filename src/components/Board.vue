<script setup lang="ts">
import { Chessground } from 'chessground';
import type { Api } from 'chessground/api';
import type { Config } from 'chessground/config';
import type { Color, Key } from 'chessground/types';
import 'chessground/assets/chessground.base.css';
import 'chessground/assets/chessground.brown.css';
import 'chessground/assets/chessground.cburnett.css';
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

/** A chessground board. The parent owns the game; the board shows it and reports a person's moves. */
const props = defineProps<{
  fen: string;
  orientation: Color;
  turn: Color;
  /** the legal moves for the side a person may move; empty when no person is to move */
  dests: Map<Key, Key[]>;
  /** which side a person may move, or none */
  movable: Color | 'both' | undefined;
  lastMove?: [Key, Key] | undefined;
  check: boolean;
}>();
const emit = defineEmits<{ move: [orig: Key, dest: Key] }>();

const el = ref<HTMLElement | null>(null);
let api: Api | undefined;

const config = (): Config => ({
  fen: props.fen,
  orientation: props.orientation,
  turnColor: props.turn,
  check: props.check,
  lastMove: props.lastMove,
  movable: { free: false, color: props.movable, dests: props.dests, showDests: true },
});

onMounted(() => {
  if (!el.value) return;
  api = Chessground(el.value, {
    ...config(),
    premovable: { enabled: false },
    movable: {
      ...config().movable,
      events: { after: (orig, dest) => emit('move', orig, dest) },
    },
  });
});

watch(
  () => [
    props.fen,
    props.orientation,
    props.turn,
    props.dests,
    props.movable,
    props.lastMove,
    props.check,
  ],
  () => api?.set(config()),
);

onBeforeUnmount(() => api?.destroy());
</script>

<template>
  <div class="aspect-square w-full"><div ref="el" class="size-full" /></div>
</template>
