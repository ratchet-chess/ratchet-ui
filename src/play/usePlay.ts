import type { Color } from 'chessops/types';
import { opposite } from 'chessops/util';
import { onBeforeUnmount, reactive, ref, shallowRef, triggerRef } from 'vue';
import { Clock, TIME_CONTROLS, pgnTimeControl, type TimeControl } from '../chess/clock.ts';
import { Game } from '../chess/game.ts';
import type { ServedEngine } from '../engine/manifest.ts';
import type { Info } from '../engine/info.ts';
import { UciEngine } from '../engine/uci.ts';
import { useEngines } from '../stores/engines.ts';
import { useGames } from '../stores/games.ts';

/** who plays one side: a person at this board, or an engine by its id */
export type Player = { kind: 'person' } | { kind: 'engine'; id: string };

/** the latest search report of one side's engine, from White's point of view */
export interface Thinking {
  depth: number;
  /** "+0.35", "-1.20", "#3" or "#-2", for White */
  score: string;
  nodes: number;
  nps: number;
  line: string[];
}

type Phase = 'setup' | 'starting' | 'playing' | 'over';

const COLORS: Color[] = ['white', 'black'];

/** how long an engine may take to answer a node budget before it loses */
const NODES_WAIT_MS = 30_000;

/** White's view of a score that an engine gave for the side it moves */
function scoreFor(info: Info, mover: Color): string | null {
  const sign = mover === 'white' ? 1 : -1;
  if (info.mate !== undefined) return `#${sign * info.mate}`;
  if (info.cp === undefined) return null;
  const v = (sign * info.cp) / 100;
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}`;
}

/**
 * One board's play: a person against an engine, two engines, or two people. Each engine runs in
 * its own Worker, made fresh for each game, so the two sides never share a table.
 */
export function usePlay() {
  const engines = useEngines();
  const games = useGames();

  const players = reactive<Record<Color, Player>>({
    white: { kind: 'person' },
    black: { kind: 'person' },
  });
  const control = ref<TimeControl>(
    TIME_CONTROLS[2] ?? { kind: 'clock', label: '2+1', baseMs: 120_000, incMs: 1_000 },
  );
  const game = shallowRef(new Game());
  const phase = ref<Phase>('setup');
  const names = reactive<Record<Color, string>>({ white: 'You', black: 'You' });
  const thinking = reactive<Record<Color, Thinking | null>>({ white: null, black: null });
  /** milliseconds left to each side, refreshed while a clock runs; null without a clock */
  const times = reactive<Record<Color, number | null>>({ white: null, black: null });
  const error = ref('');
  /** whether this game is in Games: a finished game goes there by itself, an aborted one on request */
  const saved = ref(false);

  let clock: Clock | null = null;
  let workers: Partial<Record<Color, UciEngine>> = {};
  /** bumped by every new game and every end, so a search from an older one is dropped */
  let token = 0;
  let ticker: ReturnType<typeof setInterval> | undefined;

  const entryOf = (p: Player): ServedEngine | undefined =>
    p.kind === 'engine' ? engines.list.find((e) => e.id === p.id) : undefined;

  /** which side a person may move now */
  function personToMove(): Color | undefined {
    if (phase.value !== 'playing') return undefined;
    const turn = game.value.turn;
    return players[turn].kind === 'person' ? turn : undefined;
  }

  function changed(): void {
    triggerRef(game);
  }

  function tick(): void {
    if (!clock) return;
    for (const c of COLORS) times[c] = Math.max(0, clock.remaining(c));
    const side = clock.side;
    if (side !== null && clock.remaining(side) <= 0) {
      game.value.flag(side);
      finish();
    }
  }

  function shutDown(): void {
    for (const w of Object.values(workers)) w.terminate();
    workers = {};
    if (ticker !== undefined) clearInterval(ticker);
    ticker = undefined;
  }

  function finish(): void {
    token++;
    clock?.stop();
    tick();
    shutDown();
    phase.value = 'over';
    changed();
    if (game.value.outcome) void save();
  }

  /** the game in PGN, with today's date, the players and the time control */
  function pgn(): string {
    const d = new Date();
    const date = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
    return game.value.pgn({
      Event: 'ratchet-ui game',
      Date: date,
      White: names.white,
      Black: names.black,
      TimeControl: pgnTimeControl(control.value),
    });
  }

  /** adds the game to Games' collection of games played here, once */
  async function save(): Promise<void> {
    if (saved.value || game.value.san.length === 0) return;
    saved.value = true;
    try {
      await games.savePlayed(pgn());
    } catch (e) {
      saved.value = false;
      error.value = `The game was not saved: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  function positionCommand(): string {
    const g = game.value;
    const from = g.startFen === new Game().startFen ? 'startpos' : `fen ${g.startFen}`;
    return g.uci.length > 0 ? `${from} moves ${g.uci.join(' ')}` : from;
  }

  function limits(): string {
    const tc = control.value;
    if (tc.kind === 'nodes' || !clock) return `nodes ${tc.kind === 'nodes' ? tc.nodes : 200_000}`;
    const w = Math.max(1, Math.round(clock.remaining('white')));
    const b = Math.max(1, Math.round(clock.remaining('black')));
    if (tc.kind === 'moves') {
      return `wtime ${w} btime ${b} movestogo ${clock.movesToGo(game.value.turn) ?? tc.moves}`;
    }
    return `wtime ${w} btime ${b} winc ${tc.incMs} binc ${tc.incMs}`;
  }

  /** after each move: end the game, or let the side to move play */
  function next(): void {
    changed();
    if (game.value.outcome) {
      finish();
      return;
    }
    const turn = game.value.turn;
    const w = workers[turn];
    if (w) void think(turn, w);
  }

  async function think(color: Color, w: UciEngine): Promise<void> {
    const mine = token;
    // No clock ends a search under a node budget, and an engine that does not take `go nodes`
    // (Ratchet before 0.3.14) never answers it, so the game would wait forever.
    const watchdog =
      control.value.kind === 'nodes'
        ? setTimeout(() => {
            if (mine !== token) return;
            game.value.forfeit(
              color,
              `${names[color]} gave no move in ${NODES_WAIT_MS / 1000} s under a node budget; it may not take go nodes`,
              'rules infraction',
            );
            finish();
          }, NODES_WAIT_MS)
        : undefined;
    try {
      const best = await w.go(positionCommand(), limits(), (info) => {
        if (mine !== token || info.depth === undefined) return;
        const score = scoreFor(info, color);
        if (score === null) return;
        thinking[color] = {
          depth: info.depth,
          score,
          nodes: info.nodes ?? 0,
          nps: info.nps ?? 0,
          line: game.value.lineSan(info.pv ?? [], 8),
        };
      });
      if (mine !== token) return;
      if (!game.value.play(best.move)) {
        game.value.forfeit(
          color,
          `${names[color]} played an illegal move, ${best.move}`,
          'rules infraction',
        );
      } else clock?.press();
      next();
    } catch (e) {
      if (mine !== token) return;
      game.value.forfeit(
        color,
        `${names[color]} failed: ${e instanceof Error ? e.message : String(e)}`,
        'rules infraction',
      );
      finish();
    } finally {
      clearTimeout(watchdog);
    }
  }

  /** starts a new game with the chosen players and time control */
  async function start(): Promise<void> {
    token++;
    const mine = token;
    shutDown();
    clock = null;
    error.value = '';
    saved.value = false;
    game.value = new Game();
    thinking.white = thinking.black = null;
    times.white = times.black = null;
    phase.value = 'starting';
    try {
      for (const c of COLORS) {
        const entry = entryOf(players[c]);
        if (!entry) {
          names[c] = 'You';
          continue;
        }
        const w = new UciEngine(engines.workerUrl(entry));
        workers[c] = w;
        const id = await w.identify();
        w.send('ucinewgame');
        await w.ready();
        names[c] = id.name || entry.id;
      }
    } catch (e) {
      if (mine !== token) return;
      error.value = e instanceof Error ? e.message : String(e);
      shutDown();
      phase.value = 'setup';
      return;
    }
    if (mine !== token) return;
    const tc = control.value;
    if (tc.kind !== 'nodes') {
      clock =
        tc.kind === 'clock'
          ? new Clock({ baseMs: tc.baseMs, incMs: tc.incMs })
          : new Clock({ baseMs: tc.periodMs, moves: tc.moves });
      clock.start('white');
      ticker = setInterval(tick, 100);
      tick();
    }
    phase.value = 'playing';
    next();
  }

  /** a person's move on the board; a pawn reaching the last rank needs its piece */
  function move(orig: string, dest: string, promotion = ''): void {
    if (personToMove() === undefined) return;
    if (!game.value.play(orig + dest + promotion)) {
      changed();
      return;
    }
    clock?.press();
    next();
  }

  /** the side a person plays resigns; with two people, the side to move */
  function resign(): void {
    if (phase.value !== 'playing') return;
    const person = COLORS.find(
      (c) =>
        players[c].kind === 'person' &&
        (players[opposite(c)].kind !== 'person' || c === game.value.turn),
    );
    if (person === undefined) return;
    game.value.forfeit(person, `${person} resigned`);
    finish();
  }

  /** ends the game without a result */
  function abort(): void {
    if (phase.value !== 'playing' && phase.value !== 'starting') return;
    token++;
    clock?.stop();
    shutDown();
    phase.value = 'over';
    changed();
  }

  onBeforeUnmount(() => {
    token++;
    shutDown();
  });

  return {
    players,
    control,
    game,
    phase,
    names,
    thinking,
    times,
    error,
    saved,
    pgn,
    save,
    personToMove,
    start,
    move,
    resign,
    abort,
    /** redraws the board from the game, as after a move the person took back */
    redraw: changed,
  };
}
