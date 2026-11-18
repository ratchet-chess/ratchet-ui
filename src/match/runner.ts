import { pgnTimeControl, type TimeControl } from '../chess/clock.ts';
import { Game } from '../chess/game.ts';
import type { Opening } from '../books/opening.ts';
import { UciEngine } from '../engine/uci.ts';
import { directorOf, type Director } from './director.ts';
import type { TournamentConfig } from './format.ts';
import { playOut, type Side } from './referee.ts';
import { summarize, type GameRecord, type PairRecord, type Summary } from './summary.ts';

/** One engine of a tournament. */
export interface Entrant {
  /** the engine's id; a field may hold one engine twice */
  id: string;
  /** unique within the tournament */
  name: string;
  workerUrl: string;
}

/** A game being played: who plays, and how far it has got. */
export interface LiveGame {
  pair: number;
  game: 0 | 1;
  white: number;
  black: number;
  plies: number;
  last: string;
}

/** The state a page shows; the runner changes it in place, so a reactive copy follows it. */
export interface RunState {
  status: 'running' | 'stopping' | 'done' | 'stopped';
  pairs: PairRecord[];
  games: GameRecord[];
  live: LiveGame[];
  summary: Summary;
  error: string;
}

/** What the runner needs from the app: openings, and where finished work goes. */
export interface RunDeps {
  /** the opening of a pair; undefined for the start position */
  opening: (pair: number) => Promise<Opening | undefined>;
  savePair: (pair: PairRecord) => Promise<void>;
  saveGame: (record: GameRecord, pgn: string) => Promise<void>;
  saveEnd: (status: RunState['status']) => Promise<void>;
}

/** the state of a tournament before any game, or as its saved records left it */
export function stateOf(
  config: TournamentConfig,
  pairs: PairRecord[],
  games: GameRecord[],
): RunState {
  return {
    status: 'stopped',
    pairs,
    games,
    live: [],
    summary: summarize(config.format, config.entrants.length, games),
    error: '',
  };
}

/** A game waiting for a free slot; a resumed pair's opening is fetched again when it starts. */
interface Waiting {
  pair: PairRecord;
  game: 0 | 1;
  opening: Opening | undefined;
  /** false for a resumed pair's game, whose opening is not fetched yet */
  fetched: boolean;
}

/**
 * Plays a tournament in this browser: the pairs its director issues, up to `concurrency` games at a
 * time, each game with two fresh engine Workers. A match with an SPRT issues no pair once the LLR
 * crosses a bound; the games in play finish and count. Started on saved records, it first plays
 * the games of issued pairs that have no result, then continues.
 */
export class Run {
  private readonly config: TournamentConfig;
  private readonly entrants: Entrant[];
  private readonly control: TimeControl;
  private readonly state: RunState;
  private readonly deps: RunDeps;
  private readonly director: Director;
  /** the games waiting for a free slot, both of a pair at once */
  private readonly waiting: Waiting[] = [];
  private running = 0;
  private filling = false;
  /** false once the run is stopped at once; games in play then end without a result */
  private alive = true;
  private readonly workers = new Set<UciEngine>();

  constructor(
    config: TournamentConfig,
    entrants: Entrant[],
    control: TimeControl,
    state: RunState,
    deps: RunDeps,
  ) {
    this.config = config;
    this.entrants = entrants;
    this.control = control;
    this.state = state;
    this.deps = deps;
    this.director = directorOf(config.format, entrants.length);
    const finished = new Set(state.games.map((g) => `${g.pair}:${g.game}`));
    for (const pair of state.pairs) {
      for (const game of [0, 1] as const) {
        if (!finished.has(`${pair.pair}:${game}`))
          this.waiting.push({ pair, game, opening: undefined, fetched: false });
      }
    }
  }

  start(): void {
    this.state.status = 'running';
    void this.fill();
  }

  /** issues no new games; with `now`, also ends the games in play, which then do not count */
  stop(now: boolean): void {
    if (this.state.status === 'running') this.state.status = 'stopping';
    if (now) {
      this.alive = false;
      for (const w of this.workers) w.terminate();
      this.workers.clear();
      this.state.live.splice(0);
      this.running = 0;
      void this.end('stopped');
    }
  }

  /** read through a call, since a stop between awaits changes `alive` out of the type checker's sight */
  private stopped(): boolean {
    return !this.alive;
  }

  private decided(): boolean {
    return this.state.summary.match?.verdict != null;
  }

  private async fill(): Promise<void> {
    if (this.filling) return;
    this.filling = true;
    try {
      while (
        this.alive &&
        this.state.status === 'running' &&
        this.running < this.config.concurrency
      ) {
        let next = this.waiting.shift();
        if (!next) {
          if (this.decided()) break;
          const m = this.director.next(this.state.pairs, this.state.games);
          if (m === 'wait' || m === 'done') break;
          const index = this.state.pairs.length;
          const opening = await this.deps.opening(index);
          if (this.stopped()) return;
          const pair: PairRecord = {
            pair: index,
            a: m.a,
            b: m.b,
            round: m.round,
            opening: opening?.label ?? '',
          };
          this.state.pairs.push(pair);
          await this.deps.savePair(pair);
          if (this.stopped()) return;
          this.waiting.push(
            { pair, game: 0, opening, fetched: true },
            { pair, game: 1, opening, fetched: true },
          );
          next = this.waiting.shift();
          if (!next) break;
        }
        if (!next.fetched) {
          const opening = await this.deps.opening(next.pair.pair);
          if (this.stopped()) return;
          if ((opening?.label ?? '') !== next.pair.opening) {
            throw new Error(
              `pair ${next.pair.pair + 1} cannot be replayed: its opening is no longer in the book`,
            );
          }
          for (const w of [next, ...this.waiting]) {
            if (w.pair === next.pair) Object.assign(w, { opening, fetched: true });
          }
        }
        this.running++;
        void this.play(next.pair, next.game, next.opening);
      }
    } catch (e) {
      this.state.error = e instanceof Error ? e.message : String(e);
      this.stop(true);
    } finally {
      this.filling = false;
    }
    if (!this.alive || this.running > 0) return;
    if (this.state.status === 'stopping') void this.end('stopped');
    else if (this.state.status !== 'running' || this.waiting.length > 0) return;
    else if (this.decided()) void this.end('done');
    else {
      const next = this.director.next(this.state.pairs, this.state.games);
      if (next === 'done') void this.end('done');
      else {
        // nothing in play and nothing to issue: the director would wait for ever
        this.state.error = 'the tournament has no pair to play and no game in play';
        void this.end('stopped');
      }
    }
  }

  private async end(status: 'done' | 'stopped'): Promise<void> {
    if (this.state.status === 'done' || (this.state.status === 'stopped' && status === 'stopped'))
      return;
    this.state.status = status;
    await this.deps.saveEnd(status);
  }

  private async play(pair: PairRecord, n: 0 | 1, opening: Opening | undefined): Promise<void> {
    const white = n === 0 ? pair.a : pair.b;
    const black = n === 0 ? pair.b : pair.a;
    const live: LiveGame = { pair: pair.pair, game: n, white, black, plies: 0, last: '' };
    this.state.live.push(live);
    const game = new Game(opening?.fen);
    for (const m of opening?.moves ?? []) game.play(m);
    const book = game.san.length;
    const engines: UciEngine[] = [];
    /** the side whose engine is starting, which loses the game if it does not start */
    let starting: 'white' | 'black' | null = null;
    try {
      const side = async (i: number): Promise<Side> => {
        const e = this.entrants[i];
        if (!e) throw new Error(`no entrant ${i}`);
        const engine = new UciEngine(e.workerUrl);
        engines.push(engine);
        this.workers.add(engine);
        await engine.identify();
        engine.send('ucinewgame');
        await engine.ready();
        return { engine, name: e.name };
      };
      starting = 'white';
      const whiteSide = await side(white);
      starting = 'black';
      const blackSide = await side(black);
      starting = null;
      const sides = { white: whiteSide, black: blackSide };
      await playOut({
        game,
        sides,
        control: this.control,
        adjudication: this.config.adjudication,
        live: () => this.alive,
        onMove: () => {
          live.plies = game.san.length - book;
          live.last = game.san.at(-1) ?? '';
        },
      });
    } catch (e) {
      // an engine that does not start loses the game it was to play
      const failed = starting ?? game.turn;
      if (this.alive)
        game.forfeit(
          failed,
          `an engine failed: ${e instanceof Error ? e.message : String(e)}`,
          'rules infraction',
        );
    } finally {
      for (const e of engines) {
        e.terminate();
        this.workers.delete(e);
      }
    }
    if (this.stopped()) return;
    const i = this.state.live.indexOf(live);
    if (i >= 0) this.state.live.splice(i, 1);
    const outcome = game.outcome;
    if (outcome) {
      const record: GameRecord = {
        pair: pair.pair,
        game: n,
        white,
        black,
        result: outcome.result,
        reason: outcome.reason,
        plies: game.san.length - book,
      };
      this.state.games.push(record);
      this.state.summary = summarize(this.config.format, this.entrants.length, this.state.games);
      await this.deps.saveGame(record, this.pgn(game, pair, n, white, black));
      if (this.stopped()) return;
    }
    this.running--;
    void this.fill();
  }

  private pgn(game: Game, pair: PairRecord, n: 0 | 1, white: number, black: number): string {
    const d = new Date();
    const date = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
    return game.pgn({
      Event: this.config.name,
      Site: 'ratchet-ui',
      Date: date,
      Round: `${pair.round + 1}.${pair.pair * 2 + n + 1}`,
      White: this.entrants[white]?.name ?? '?',
      Black: this.entrants[black]?.name ?? '?',
      TimeControl: pgnTimeControl(this.control),
    });
  }
}
