import type { Color } from 'chessops/types';
import { Clock, type TimeControl } from '../chess/clock.ts';
import type { Game } from '../chess/game.ts';
import type { Info } from '../engine/info.ts';
import type { UciEngine } from '../engine/uci.ts';

/** how long an engine may take to answer a node budget before it loses, as no clock ends that search */
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
function goLimits(tc: TimeControl, clock: Clock | null, turn: Color): string {
  if (tc.kind === 'nodes' || !clock) return `nodes ${tc.kind === 'nodes' ? tc.nodes : 200_000}`;
  const w = Math.max(1, Math.round(clock.remaining('white')));
  const b = Math.max(1, Math.round(clock.remaining('black')));
  if (tc.kind === 'moves')
    return `wtime ${w} btime ${b} movestogo ${clock.movesToGo(turn) ?? tc.moves}`;
  return `wtime ${w} btime ${b} winc ${tc.incMs} binc ${tc.incMs}`;
}

/** a clock for a control, or null for a node budget */
export function clockFor(tc: TimeControl): Clock | null {
  if (tc.kind === 'clock') return new Clock({ baseMs: tc.baseMs, incMs: tc.incMs });
  if (tc.kind === 'moves') return new Clock({ baseMs: tc.periodMs, moves: tc.moves });
  return null;
}

/** an engine's score as fastchess writes it in a PGN comment: `+0.35` or `+M3`, for the side that moved */
function scoreText(info: Info | null): string {
  if (info?.mate !== undefined) return `${info.mate > 0 ? '+' : '-'}M${Math.abs(info.mate)}`;
  const cp = info?.cp ?? 0;
  return `${cp >= 0 ? '+' : ''}${(cp / 100).toFixed(2)}`;
}

export interface Turn {
  game: Game;
  color: Color;
  engine: UciEngine;
  name: string;
  control: TimeControl;
  clock: Clock | null;
  /** false once the game has ended elsewhere, as by an abort; the turn then changes nothing */
  live: () => boolean;
  onInfo?: (info: Info) => void;
}

/**
 * One engine move, judged: the engine searches the game as it stands, and its move is played, or
 * the game ends against it for a fallen flag, an illegal move, silence or a failure. The move's
 * PGN comment is its score, depth and time, as fastchess writes them.
 */
export async function engineTurn(t: Turn): Promise<void> {
  const { game, color, engine, name, control, clock } = t;
  const started = performance.now();
  /** the search's last report with a depth and a score; a holder, as the callback sets it */
  const seen: { last: Info | null } = { last: null };
  const limit =
    control.kind === 'nodes' ? NODES_WAIT_MS : (clock?.remaining(color) ?? 0) + SILENT_GRACE_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const silent = new Promise<'silent'>((resolve) => {
    timer = setTimeout(() => resolve('silent'), Math.max(0, limit));
  });
  try {
    const answer = await Promise.race([
      engine.go(positionCommand(game), goLimits(control, clock, color), (info) => {
        if (info.depth !== undefined && (info.cp !== undefined || info.mate !== undefined))
          seen.last = info;
        t.onInfo?.(info);
      }),
      silent,
    ]);
    if (!t.live()) return;
    if (answer === 'silent') {
      engine.stop();
      if (clock) game.flag(color);
      else {
        game.forfeit(
          color,
          `${name} gave no move in ${NODES_WAIT_MS / 1000} s under a node budget; it may not take go nodes`,
          'rules infraction',
        );
      }
      return;
    }
    if (clock && clock.remaining(color) < 0) {
      game.flag(color);
      return;
    }
    if (!game.play(answer.move)) {
      game.forfeit(color, `${name} played an illegal move, ${answer.move}`, 'rules infraction');
      return;
    }
    const seconds = ((performance.now() - started) / 1000).toFixed(3);
    const info = seen.last;
    game.annotate(`${scoreText(info)}/${info?.depth ?? 0} ${seconds}s`);
    clock?.press();
  } catch (e) {
    if (!t.live()) return;
    game.forfeit(
      color,
      `${name} failed: ${e instanceof Error ? e.message : String(e)}`,
      'rules infraction',
    );
  } finally {
    clearTimeout(timer);
  }
}
