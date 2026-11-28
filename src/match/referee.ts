import type { Color } from 'chessops/types';
import { opposite } from 'chessops/util';
import { Adjudicator, type Adjudication } from './adjudicate.ts';
import { Clock, type SideClock, type TimeControl } from '../chess/clock.ts';
import type { Game } from '../chess/game.ts';
import type { Info } from '../engine/info.ts';
import type { UciEngine } from '../engine/uci.ts';

/** the least an engine may take to answer a node budget or a depth before it loses, as no clock ends that search */
const NODES_WAIT_MS = 30_000;
/** how long past its clock an engine may stay silent before the referee stops waiting; the flag is judged at the move */
const SILENT_GRACE_MS = 5_000;

/** the UCI `position` command for a game as it stands */
function positionCommand(game: Game): string {
  const from = game.startFen.startsWith('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -')
    ? 'startpos'
    : `fen ${game.startFen}`;
  return game.uci.length > 0 ? `${from} moves ${game.uci.join(' ')}` : from;
}

/** the UCI `go` limits for the side to move */
export function goLimits(tc: TimeControl, clock: Clock | null, turn: Color): string {
  if (tc.kind === 'movetime') return `movetime ${tc.ms}`;
  if (tc.kind === 'depth') return `depth ${tc.depth}`;
  if (tc.kind === 'nodes' || !clock || !clock.hasClock(turn))
    return `nodes ${tc.kind === 'nodes' ? tc.nodes : 200_000}`;
  const own = Math.max(1, Math.round(clock.remaining(turn)));
  const w = clock.hasClock('white') ? Math.max(1, Math.round(clock.remaining('white'))) : own;
  const b = clock.hasClock('black') ? Math.max(1, Math.round(clock.remaining('black'))) : own;
  if (tc.kind === 'moves')
    return `wtime ${w} btime ${b} movestogo ${clock.movesToGo(turn) ?? tc.moves}`;
  const winc = clock.hasClock('white') ? clock.increment('white') : tc.incMs;
  const binc = clock.hasClock('black') ? clock.increment('black') : tc.incMs;
  return `wtime ${w} btime ${b} winc ${winc} binc ${binc}`;
}

function sideClockOf(tc: TimeControl | null): SideClock | null {
  if (!tc) return null;
  if (tc.kind === 'clock') return { baseMs: tc.baseMs, incMs: tc.incMs };
  if (tc.kind === 'moves') return { baseMs: tc.periodMs, moves: tc.moves };
  return null;
}

/** a clock for a control, or null for one with no clock: a node budget, a fixed time a move or a depth */
export function clockFor(tc: TimeControl): Clock | null {
  const s = sideClockOf(tc);
  return s ? new Clock(s) : null;
}

/** a clock for per-side controls, or null when neither side plays on a clock */
export function clockForSides(sides: Record<Color, TimeControl | null>): Clock | null {
  const white = sideClockOf(sides.white);
  const black = sideClockOf(sides.black);
  return white || black ? new Clock({ sides: { white, black } }) : null;
}

/** an engine's score as fastchess writes it in a PGN comment: `+0.35` or `+M3`, for the side that moved */
function scoreText(info: Info | null): string {
  if (info?.mate !== undefined) return `${info.mate > 0 ? '+' : '-'}M${Math.abs(info.mate)}`;
  const cp = info?.cp ?? 0;
  return `${cp >= 0 ? '+' : ''}${(cp / 100).toFixed(2)}`;
}

/**
 * the slowest search a node budget allows for, in nodes a millisecond: about a fortieth of
 * ratchet-0.3.14's speed in Chrome (835 kn/s, Play, 2026-11-18), for slow engines and busy hosts
 */
const SLOWEST_NODES_PER_MS = 20;
/** the depth up to which the plain wait holds; past it the wait doubles every two plies */
const QUICK_DEPTH = 10;

/**
 * how long an engine may stay silent on a move before the referee stops waiting: past its clock,
 * or for a search with no clock, long enough for the slowest honest search the setting asks for
 */
export function silenceLimit(tc: TimeControl, clock: Clock | null, turn: Color): number {
  if (tc.kind === 'nodes') return Math.max(NODES_WAIT_MS, tc.nodes / SLOWEST_NODES_PER_MS);
  // a search's time grows about as fast as this with its depth
  if (tc.kind === 'depth') return NODES_WAIT_MS * 2 ** (Math.max(0, tc.depth - QUICK_DEPTH) / 2);
  if (tc.kind === 'movetime') return tc.ms + SILENT_GRACE_MS;
  return (clock?.remaining(turn) ?? 0) + SILENT_GRACE_MS;
}

/** the end of the forfeit message for an engine silent under a control with no clock */
const UNCLOCKED: Partial<Record<TimeControl['kind'], string>> = {
  nodes: 'under a node budget; it may not take go nodes',
  movetime: 'at a fixed time a move; it may not take go movetime',
  depth: 'to a fixed depth; it may not take go depth',
};

/** The reasons a game ends against an engine for something other than its play. */
export const forfeitReason = {
  silent: (name: string, limitMs: number, kind: TimeControl['kind']) =>
    `${name} gave no move in ${limitMs / 1000} s ${UNCLOCKED[kind] ?? 'with no clock'}`,
  illegal: (name: string, move: string) => `${name} played an illegal move, ${move}`,
  failed: (name: string, why: string) => `${name} failed: ${why}`,
  /** an engine that does not start; the runner does not know which one */
  start: (why: string) => `an engine failed: ${why}`,
};

/** A game that ended for something other than the engines' play, as a reader counts it. */
export type Problem = 'time' | 'illegal' | 'no move' | 'failed';

/**
 * what made a game end abnormally, read from its recorded reason: a flag that fell, an illegal
 * move, no move given, or an engine that failed; null for a game that ended over the board or by
 * adjudication. Saved games keep only their reason, so this reads the words `forfeitReason` and
 * `Game.flag` write.
 */
export function problemOf(reason: string): Problem | null {
  if (/ ran out of time\b/.test(reason)) return 'time';
  if (reason.includes(' played an illegal move, ')) return 'illegal';
  if (reason.includes(' gave no move in ')) return 'no move';
  if (/(^| )failed: /.test(reason)) return 'failed';
  return null;
}

export interface Turn {
  game: Game;
  color: Color;
  engine: Pick<UciEngine, 'go' | 'stop'>;
  name: string;
  control: TimeControl;
  clock: Clock | null;
  /** false once the game has ended elsewhere, as by an abort; the turn then changes nothing */
  live: () => boolean;
  onInfo?: (info: Info) => void;
  /** called after a legal move with the search's final reported node count and wall time in ms */
  onStats?: (nodes: number, ms: number) => void;
}

/** the largest delay `setTimeout` takes; a longer one fires at once */
const MAX_TIMEOUT_MS = 2_147_483_647;

/**
 * One engine move, judged: the engine searches the game as it stands, and its move is played, or
 * the game ends against it for a fallen flag, an illegal move, silence or a failure. The move's
 * PGN comment is its score, depth and time, as fastchess writes them.
 */
export async function engineTurn(t: Turn): Promise<Info | null> {
  const { game, color, engine, name, control, clock } = t;
  const timed =
    clock !== null &&
    clock.hasClock(color) &&
    (control.kind === 'clock' || control.kind === 'moves');
  const started = performance.now();
  /** the search's last report with a depth and a score; a holder, as the callback sets it */
  const seen: { last: Info | null; nodes: number } = { last: null, nodes: 0 };
  const limit = silenceLimit(control, clock, color);
  const waitMs = Number.isFinite(limit)
    ? Math.min(MAX_TIMEOUT_MS, Math.max(0, limit))
    : MAX_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const silent = new Promise<'silent'>((resolve) => {
    timer = setTimeout(() => resolve('silent'), waitMs);
  });
  try {
    const answer = await Promise.race([
      engine.go(positionCommand(game), goLimits(control, clock, color), (info) => {
        if (info.nodes !== undefined && info.nodes > 0) seen.nodes = info.nodes;
        if (info.depth !== undefined && (info.cp !== undefined || info.mate !== undefined))
          seen.last = info;
        t.onInfo?.(info);
      }),
      silent,
    ]);
    if (!t.live()) return null;
    if (answer === 'silent') {
      engine.stop();
      if (timed) game.flag(color);
      else {
        game.forfeit(color, forfeitReason.silent(name, limit, control.kind), 'rules infraction');
      }
      return null;
    }
    if (timed && clock.remaining(color) < 0) {
      game.flag(color);
      return null;
    }
    if (!game.play(answer.move)) {
      game.forfeit(color, forfeitReason.illegal(name, answer.move), 'rules infraction');
      return null;
    }
    const elapsedMs = performance.now() - started;
    const seconds = (elapsedMs / 1000).toFixed(3);
    const info = seen.last;
    game.annotate(`${scoreText(info)}/${info?.depth ?? 0} ${seconds}s`);
    if (seen.nodes > 0 && elapsedMs > 0) t.onStats?.(seen.nodes, elapsedMs);
    clock?.press();
    return info;
  } catch (e) {
    if (!t.live()) return null;
    game.forfeit(
      color,
      forfeitReason.failed(name, e instanceof Error ? e.message : String(e)),
      'rules infraction',
    );
  } finally {
    clearTimeout(timer);
  }
  return null;
}

/** whether a game has ended; a call, so a check after an await is not narrowed away */
const isOver = (g: Game) => g.outcome !== null;

/** one side of an engine game */
export interface Side {
  engine: Pick<UciEngine, 'go' | 'stop'>;
  name: string;
}

/** Passive per-side average nodes/s observed across timed moves of a played game. */
export interface GameSpeed {
  wnps?: number;
  bnps?: number;
}

/** Per-move search summary reported to a live observer after each played move. */
export interface MoveReport {
  color: Color;
  depth?: number;
  nodes?: number;
}

/** Minimum per-move nodes and wall ms to include in passive game NPS (filters trivial moves). */
const MIN_SPEED_NODES = 1000;
const MIN_SPEED_MS = 20;

/**
 * Plays an engine game to its end: each side's moves through `engineTurn`, on a clock started for
 * the side to move, with the engines' scores adjudicated if `adjudication` is given.
 * Returns passive per-side average nodes/s observed over non-trivial moves.
 */
export async function playOut(o: {
  game: Game;
  sides: Record<Color, Side>;
  control: TimeControl;
  adjudication: Adjudication | null;
  live: () => boolean;
  onClock?: (clock: Clock | null) => void;
  onInfo?: (color: Color, info: Info) => void;
  onMove?: (report: MoveReport) => void;
}): Promise<GameSpeed> {
  const { game, sides, control } = o;
  const clock = clockFor(control);
  clock?.start(game.turn);
  o.onClock?.(clock);
  const judge = o.adjudication ? new Adjudicator(o.adjudication) : null;
  const totals: Record<Color, { nodes: number; ms: number }> = {
    white: { nodes: 0, ms: 0 },
    black: { nodes: 0, ms: 0 },
  };
  while (!isOver(game) && o.live()) {
    const color = game.turn;
    const side = sides[color];
    const pliesBefore = game.san.length;
    let turnNodes: number | undefined;
    const info = await engineTurn({
      game,
      color,
      engine: side.engine,
      name: side.name,
      control,
      clock,
      live: o.live,
      onInfo: (line) => {
        if (line.nodes !== undefined && line.nodes > 0) turnNodes = line.nodes;
        o.onInfo?.(color, line);
      },
      onStats: (nodes, ms) => {
        if (nodes >= MIN_SPEED_NODES && ms >= MIN_SPEED_MS) {
          totals[color].nodes += nodes;
          totals[color].ms += ms;
        }
      },
    });
    if (!o.live()) break;
    const moved = game.san.length > pliesBefore;
    if (!isOver(game)) {
      // the number of the move just played: a move by Black has already advanced the count
      const fullmove = game.pos.fullmoves - (color === 'black' ? 1 : 0);
      const verdict = judge?.move(color, fullmove, info?.cp ?? null, info?.mate) ?? null;
      if (verdict === 'draw') game.adjudicate('draw', 'draw by adjudication');
      else if (verdict)
        game.adjudicate(verdict, `${sides[opposite(verdict)].name} lost by adjudication`);
    }
    if (moved) {
      o.onMove?.({
        color,
        ...(info?.depth !== undefined ? { depth: info.depth } : {}),
        ...(turnNodes !== undefined ? { nodes: turnNodes } : {}),
      });
    }
    if (isOver(game)) break;
  }
  clock?.stop();
  const wnps =
    totals.white.ms > 0 ? Math.round((totals.white.nodes * 1000) / totals.white.ms) : undefined;
  const bnps =
    totals.black.ms > 0 ? Math.round((totals.black.nodes * 1000) / totals.black.ms) : undefined;
  return {
    ...(wnps !== undefined ? { wnps } : {}),
    ...(bnps !== undefined ? { bnps } : {}),
  };
}
