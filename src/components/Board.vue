<script setup lang="ts">
import { Chessground } from 'chessground';
import type { Api } from 'chessground/api';
import type { Config } from 'chessground/config';
import type { DrawShape } from 'chessground/draw';
import type { Color, Key } from 'chessground/types';
import 'chessground/assets/chessground.base.css';
import 'chessground/assets/chessground.brown.css';
import 'chessground/assets/chessground.cburnett.css';
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

/** A chessground board. The parent owns the game; the board shows it and reports a person's moves. */
const props = withDefaults(
  defineProps<{
    fen: string;
    orientation: Color;
    turn: Color;
    /** the legal moves for the side a person may move; empty when no person is to move */
    dests?: Map<Key, Key[]>;
    /** which side a person may move, or none */
    movable?: Color | 'both' | undefined;
    lastMove?: [Key, Key] | undefined;
    check: boolean;
    /** disables pointer interaction for lightweight live mosaic and focused read-only boards */
    viewOnly?: boolean;
    /** show rank and file labels */
    coordinates?: boolean;
    /** animate piece transitions; disable for rapid blitz mosaic boards */
    animated?: boolean;
    /** overlay arrows/circles (such as live PV arrows) */
    shapes?: readonly DrawShape[];
  }>(),
  {
    dests: () => new Map<Key, Key[]>(),
    movable: undefined,
    lastMove: undefined,
    viewOnly: false,
    coordinates: true,
    animated: true,
    shapes: undefined,
  },
);
const emit = defineEmits<{ move: [orig: Key, dest: Key] }>();

const el = ref<HTMLElement | null>(null);
let api: Api | undefined;

const config = (): Config => ({
  fen: props.fen,
  orientation: props.orientation,
  turnColor: props.turn,
  check: props.check,
  lastMove: props.lastMove,
  viewOnly: props.viewOnly,
  coordinates: props.coordinates,
  animation: { enabled: props.animated },
  movable: props.viewOnly
    ? { free: false, color: undefined, showDests: false }
    : { free: false, color: props.movable, dests: props.dests, showDests: true },
  drawable: props.shapes
    ? { visible: true, enabled: !props.viewOnly, autoShapes: [...props.shapes] }
    : props.viewOnly
      ? { visible: false, enabled: false }
      : { visible: true, enabled: true, autoShapes: [] },
});

onMounted(() => {
  if (!el.value) return;
  api = Chessground(el.value, {
    ...config(),
    premovable: { enabled: false },
    movable: props.viewOnly
      ? { free: false, color: undefined, showDests: false }
      : {
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
    props.lastMove ? `${props.lastMove[0]}${props.lastMove[1]}` : '',
    props.check,
    props.viewOnly,
    props.coordinates,
    props.animated,
    props.shapes
      ? props.shapes.map((s) => `${s.orig}:${s.dest ?? ''}:${s.brush ?? ''}`).join('|')
      : '',
  ],
  () => api?.set(config()),
);

onBeforeUnmount(() => api?.destroy());
</script>

<template>
  <div class="aspect-square w-full"><div ref="el" class="size-full" /></div>
</template>
