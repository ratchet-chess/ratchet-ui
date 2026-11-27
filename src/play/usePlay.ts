import type { Color } from 'chessops/types';
import { opposite } from 'chessops/util';
import { computed, onBeforeUnmount, reactive, ref, shallowRef, triggerRef } from 'vue';
import { pgnTimeControl, resolveControl, type Clock, type TimeControl } from '../chess/clock.ts';
import { Game } from '../chess/game.ts';
import { findOpening } from '../chess/openings.ts';
import type { Opening } from '../books/opening.ts';
import type { Info } from '../engine/info.ts';
import type { ServedEngine } from '../engine/manifest.ts';
import {
  formatSetOption,
  isDefaultOptionValue,
  isHiddenPlayOption,
  optionBounds,
  parseOptionsList,
  type OptionValues,
  type UciOption,
} from '../engine/options.ts';
import { UciEngine } from '../engine/uci.ts';
import { clockForSides, engineTurn } from '../match/referee.ts';
import { useEngines } from '../stores/engines.ts';
import { useGames } from '../stores/games.ts';
import { useSettings } from '../stores/settings.ts';
import { canSpawnBrowserThreads } from '../../vendor/uci-over-wasi/check-browser.ts';

/** who plays one side: a person at this board, or an engine by its id */
export type Player = { kind: 'person' } | { kind: 'engine'; id: string };

/** per-side UCI overrides and optional search limit for a Play game */
export interface SideConfig {
  options: OptionValues;
  /** control label overriding Play's game time for this side; empty to match game time */
  limit: string;
}

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
/** fallback move search when Play's Time is No clock and an engine has no per-side limit */
const UNCLOCKED_ENGINE_FALLBACK: TimeControl = {
  kind: 'movetime',
  label: '1s/move',
  ms: 1_000,
};

/** White's view of a score that an engine gave for the side it moves */
function scoreFor(info: Info, mover: Color): string | null {
  const sign = mover === 'white' ? 1 : -1;
  if (info.mate !== undefined) return `#${sign * info.mate}`;
  if (info.cp === undefined) return null;
  const v = (sign * info.cp) / 100;
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}`;
}

/**
 * Builds the UCI `setoption` commands to send for `declared` options given `values`.
 * Clamps `Threads` to `threadsCap` and skips hidden, undeclared, or default-valued options.
 */
export function buildSetOptions(
  declared: readonly UciOption[],
  values: OptionValues,
  threadsCap: number,
): string[] {
  const cmds: string[] = [];
  for (const opt of declared) {
    if (isHiddenPlayOption(opt)) continue;
    let val = values[opt.name];
    if (val === undefined) continue;
    if (opt.type === 'spin' && typeof val === 'number') {
      const { min, max } = optionBounds(opt);
      if (min !== undefined) val = Math.max(min, val);
      if (max !== undefined) val = Math.min(max, val);
      if (opt.name.toLowerCase() === 'threads') {
        val = Math.max(1, Math.min(Math.floor(val), Math.max(1, threadsCap)));
      }
    }
    if (isDefaultOptionValue(opt, val)) continue;
    cmds.push(formatSetOption(opt.name, val));
  }
  return cmds;
}

/**
 * Resolves the effective control for one side: per-side limit first, then game control,
 * falling back to `1s/move` for an engine when neither sets a control.
 */
export function resolveSideControl(
  player: Player,
  sideLimit: string,
  gameControlLabel: string,
): TimeControl | null {
  const side = sideLimit.trim() ? resolveControl(sideLimit.trim()) : null;
  if (side) return side;
  const shared = gameControlLabel.trim() ? resolveControl(gameControlLabel.trim()) : null;
  if (shared) return shared;
  return player.kind === 'engine' ? UNCLOCKED_ENGINE_FALLBACK : null;
}

/**
 * How many plies a Takeback removes in an active game, or 0 when takeback is unavailable.
 * Against an engine: 2 plies on the person's turn (undoing the engine's reply and the person's
 * move), or 1 ply while the engine thinks (stopping its search and undoing the person's move).
 * Between two people: 1 ply. Between two engines: 0.
 */
export function takebackPlies(
  players: Record<Color, Player>,
  turn: Color,
  playedPlies: number,
): number {
  const whitePerson = players.white.kind === 'person';
  const blackPerson = players.black.kind === 'person';
  if (!whitePerson && !blackPerson) return 0;
  if (whitePerson && blackPerson) return playedPlies >= 1 ? 1 : 0;
  if (players[turn].kind === 'engine') return playedPlies >= 1 ? 1 : 0;
  return playedPlies >= 2 ? 2 : 0;
}

/**
 * One board's play: a person against an engine, two engines, or two people. Each engine runs in
 * its own Worker, made fresh for each game, so the two sides never share a table.
 */
export function usePlay() {
  const engines = useEngines();
  const games = useGames();
  const settings = useSettings();

  const players = reactive<Record<Color, Player>>({
    white: { kind: 'person' },
    black: { kind: 'person' },
  });
  const sideConfig = reactive<Record<Color, SideConfig>>({
    white: { options: {}, limit: '' },
    black: { options: {}, limit: '' },
  });
  /** game time control label (`2m+1`, `10+0.1`, etc.); empty string means No clock */
  const controlLabel = ref('2m+1');
  const game = shallowRef(new Game());
  const phase = ref<Phase>('setup');
  /** UCI `id name` resolved when a game starts; empty until that side runs in a game */
  const liveNames = reactive<Record<Color, string>>({ white: '', black: '' });
  /** player names shown on board bars and search panels, staying in sync with setup selects */
  const names = computed<Record<Color, string>>(() => ({
    white:
      players.white.kind === 'person'
        ? 'You'
        : phase.value === 'setup'
          ? players.white.id
          : liveNames.white || players.white.id,
    black:
      players.black.kind === 'person'
        ? 'You'
        : phase.value === 'setup'
          ? players.black.id
          : liveNames.black || players.black.id,
  }));
  const canResign = computed(
    () =>
      phase.value === 'playing' &&
      (players.white.kind === 'person' || players.black.kind === 'person'),
  );
  const thinking = reactive<Record<Color, Thinking | null>>({ white: null, black: null });
  /** milliseconds left to each side, refreshed while a clock runs; null without a clock */
  const times = reactive<Record<Color, number | null>>({ white: null, black: null });
  const error = ref('');
  /** whether this game is in Games: a finished game goes there by itself, an aborted one on request */
  const saved = ref(false);
  /** the opening this game started from, as a reader sees it; empty for chess's start */
  const openingLabel = ref('');
  /** half-moves played from the opening book at start, which Takeback does not undo past */
  const bookPlies = ref(0);
  /** deepest ECO opening recognized along the game's positions */
  const opening = computed(() => findOpening(game.value.fens));
  const canTakeback = computed(
    () =>
      phase.value === 'playing' &&
      takebackPlies(players, game.value.turn, game.value.san.length - bookPlies.value) > 0,
  );
  /** ply shown on the board when reviewing earlier moves; null follows the live position */
  const viewPly = ref<number | null>(null);
  const currentPly = computed(() =>
    viewPly.value === null ? game.value.san.length : Math.min(viewPly.value, game.value.san.length),
  );
  const viewingLive = computed(() => currentPly.value === game.value.san.length);

  let clock: Clock | null = null;
  let activeControls: Record<Color, TimeControl | null> = { white: null, black: null };
  let workers: Partial<Record<Color, UciEngine>> = {};
  /** active `engineTurn` per side, so a search started right after `stop` waits for its `bestmove` */
  let inFlight: Partial<Record<Color, Promise<unknown>>> = {};
  /** bumped by every new game and every end, so a search from an older one is dropped */
  let token = 0;
  let ticker: ReturnType<typeof setInterval> | undefined;

  const entryOf = (p: Player): ServedEngine | undefined =>
    p.kind === 'engine' ? engines.list.find((e) => e.id === p.id) : undefined;

  /** Sets one side's player and seeds its in-game options from saved per-engine defaults. */
  function setPlayer(color: Color, player: Player): void {
    players[color] = player;
    liveNames[color] = '';
    if (player.kind === 'person') {
      sideConfig[color] = { options: {}, limit: '' };
      return;
    }
    const preset = settings.engineOptions[player.id];
    sideConfig[color] = {
      options: preset ? { ...preset.options } : {},
      limit: preset?.limit ?? '',
    };
  }

  /** Saves one side's current overrides as that engine's defaults in browser settings. */
  function saveSideAsDefault(color: Color): void {
    const p = players[color];
    if (p.kind !== 'engine') return;
    const cfg = sideConfig[color];
    settings.saveEngineOptions(p.id, {
      options: { ...cfg.options },
      limit: cfg.limit.trim() || undefined,
    });
  }

  /** Resets one side's in-game overrides and per-side search limit to defaults. */
  function resetSideConfig(color: Color): void {
    sideConfig[color] = { options: {}, limit: '' };
  }

  /** Steps the board preview to `ply`; jumping to the end returns to live play. */
  function goTo(ply: number): void {
    const last = game.value.san.length;
    const clamped = Math.max(0, Math.min(ply, last));
    viewPly.value = clamped === last ? null : clamped;
  }

  /** which side a person may move now (viewing live in play, or dragging move 1 from setup) */
  function personToMove(): Color | undefined {
    if (!viewingLive.value) return undefined;
    if (phase.value !== 'playing' && phase.value !== 'setup') return undefined;
    const turn = game.value.turn;
    return players[turn].kind === 'person' ? turn : undefined;
  }

  function changed(): void {
    triggerRef(game);
  }

  function tick(): void {
    if (!clock) return;
    for (const c of COLORS) {
      times[c] = clock.hasClock(c) ? Math.max(0, clock.remaining(c)) : null;
    }
    const side = clock.side;
    if (side !== null && clock.remaining(side) <= 0) {
      game.value.flag(side);
      finish();
    }
  }

  function shutDown(): void {
    for (const w of Object.values(workers)) w.terminate();
    workers = {};
    inFlight = {};
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
    const shared = controlLabel.value.trim() ? resolveControl(controlLabel.value) : null;
    const asymmetric = sideConfig.white.limit.trim() || sideConfig.black.limit.trim();
    const hit = opening.value;
    return game.value.pgn({
      Event: 'ratchet-ui game',
      Date: date,
      White: names.value.white,
      Black: names.value.black,
      ...(hit ? { ECO: hit.eco, Opening: hit.name } : {}),
      TimeControl: !asymmetric && shared ? pgnTimeControl(shared) : '-',
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
    const isLive = () => mine === token;
    const prev = inFlight[color];
    const run = (async () => {
      if (prev) {
        await prev.catch(() => undefined);
        if (!isLive()) return;
        await w.ready().catch(() => undefined);
        if (!isLive()) return;
      }
      const control = activeControls[color] ?? UNCLOCKED_ENGINE_FALLBACK;
      await engineTurn({
        game: game.value,
        color,
        engine: w,
        name: names.value[color],
        control,
        clock,
        live: isLive,
        onInfo: (info) => {
          if (!isLive() || info.depth === undefined) return;
          const score = scoreFor(info, color);
          if (score === null) return;
          thinking[color] = {
            depth: info.depth,
            score,
            nodes: info.nodes ?? 0,
            nps: info.nps ?? 0,
            line: game.value.lineSan(info.pv ?? [], 8),
          };
        },
      });
    })();
    inFlight[color] = run;
    await run;
    if (inFlight[color] === run) delete inFlight[color];
    if (!isLive()) return;
    next();
  }

  /** starts a new game with the chosen players, options, limits, and warm-up before move 1 */
  async function start(bookOpening?: Opening, initialMove?: string): Promise<void> {
    token++;
    const mine = token;
    const isLive = () => mine === token;
    shutDown();
    clock = null;
    error.value = '';
    saved.value = false;
    viewPly.value = null;
    game.value = new Game(bookOpening?.fen);
    for (const m of bookOpening?.moves ?? []) {
      if (game.value.play(m)) game.value.annotate('book');
    }
    bookPlies.value = game.value.san.length;
    openingLabel.value = bookOpening?.label ?? '';
    if (initialMove) game.value.play(initialMove);
    thinking.white = thinking.black = null;
    times.white = times.black = null;
    phase.value = 'starting';
    changed();

    activeControls = {
      white: resolveSideControl(players.white, sideConfig.white.limit, controlLabel.value),
      black: resolveSideControl(players.black, sideConfig.black.limit, controlLabel.value),
    };

    const hw = Math.max(1, navigator.hardwareConcurrency);
    const threadsCap = canSpawnBrowserThreads() ? hw : 1;

    try {
      for (const c of COLORS) {
        const player = players[c];
        if (player.kind === 'person') {
          liveNames[c] = 'You';
          continue;
        }
        const entry = entryOf(player);
        if (!entry) throw new Error(`Engine "${player.id}" is not available`);
        const t0 = performance.now();
        const w = new UciEngine(engines.workerUrl(entry));
        workers[c] = w;
        const id = await w.identify();
        if (!isLive()) return;
        const declared = parseOptionsList(id.options);
        if (engines.inspections.get(entry.id)?.state !== 'done') {
          engines.recordInspection(entry, {
            state: 'done',
            idName: id.name,
            idAuthor: id.author,
            startMs: performance.now() - t0,
            options: declared,
            error: '',
          });
        }
        for (const cmd of buildSetOptions(declared, sideConfig[c].options, threadsCap)) {
          w.send(cmd);
        }
        await w.ready();
        if (!isLive()) return;
        // Warm-up before move 1 removes cold WASM/JIT startup lag from the game clock
        await w.go('startpos', 'depth 1');
        if (!isLive()) return;
        w.send('ucinewgame');
        await w.ready();
        if (!isLive()) return;
        liveNames[c] = id.name || entry.id;
      }
    } catch (e) {
      if (!isLive()) return;
      error.value = e instanceof Error ? e.message : String(e);
      shutDown();
      game.value = new Game();
      bookPlies.value = 0;
      openingLabel.value = '';
      changed();
      phase.value = 'setup';
      return;
    }
    if (!isLive()) return;
    clock = clockForSides(activeControls);
    if (clock) {
      clock.start(game.value.turn);
      ticker = setInterval(tick, 100);
      tick();
    }
    phase.value = 'playing';
    next();
  }

  /** a person's move on the board; dragging in setup auto-starts the game with that move */
  function move(orig: string, dest: string, promotion = ''): void {
    if (personToMove() === undefined) return;
    const uci = orig + dest + promotion;
    if (phase.value === 'setup') {
      const check = new Game(game.value.fen);
      if (!check.play(uci)) {
        changed();
        return;
      }
      void start(undefined, uci);
      return;
    }
    if (!game.value.play(uci)) {
      changed();
      return;
    }
    clock?.press();
    next();
  }

  /** undoes the last turn in a game with a person, stopping any active engine search first */
  function takeback(): void {
    if (phase.value !== 'playing') return;
    const plies = takebackPlies(players, game.value.turn, game.value.san.length - bookPlies.value);
    if (plies === 0) return;
    const turn = game.value.turn;
    if (players[turn].kind === 'engine') {
      token++;
      workers[turn]?.stop();
      thinking[turn] = null;
    }
    game.value.undo(plies);
    viewPly.value = null;
    if (clock) {
      clock.stop();
      clock.start(game.value.turn);
      tick();
    }
    changed();
  }

  /** the side a person plays resigns; with two people, the side to move */
  function resign(): void {
    if (!canResign.value) return;
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
    sideConfig,
    controlLabel,
    game,
    phase,
    names,
    canResign,
    canTakeback,
    thinking,
    times,
    error,
    saved,
    opening,
    openingLabel,
    viewPly,
    currentPly,
    viewingLive,
    setPlayer,
    saveSideAsDefault,
    resetSideConfig,
    goTo,
    pgn,
    save,
    personToMove,
    start,
    move,
    takeback,
    resign,
    abort,
    /** redraws the board from the game, as after a move the person took back */
    redraw: changed,
  };
}
