import { parseInfo, type Info } from './info.ts';

/** What an engine says about itself in answer to `uci`. */
export interface Identity {
  name: string;
  author: string;
  /** each `option` line, as the engine sent it */
  options: string[];
}

export interface BestMove {
  move: string;
  ponder?: string;
}

/**
 * A UCI engine that runs in a Worker with stockfish.js's interface: one UCI line per message, in
 * each direction. The app's host (vendor/uci-over-wasi/) is such a Worker for any WASI build.
 */
export class UciEngine {
  private readonly worker: Worker;
  private readonly listeners = new Set<(line: string) => void>();
  /** the rejections of the requests still waiting, so a Worker that fails ends them */
  private readonly pending = new Set<(e: Error) => void>();
  /** set once the Worker has failed; every later request rejects with it */
  private failure: Error | null = null;

  constructor(workerUrl: string) {
    this.worker = new Worker(workerUrl);
    this.worker.onmessage = (e: MessageEvent<string>) => {
      // the host's report that the build did not load or run; the Worker closes after it
      if (e.data.startsWith('info string error:')) {
        this.fail(new Error(e.data.slice('info string error:'.length).trim()));
        return;
      }
      for (const listen of this.listeners) listen(e.data);
    };
    // A script that is missing or does not load raises an error event and no message,
    // so without this a request waits forever.
    this.worker.onerror = (e: ErrorEvent) => {
      e.preventDefault();
      const file = workerUrl.slice(workerUrl.lastIndexOf('/') + 1);
      this.fail(new Error(`${file} failed: ${e.message || 'it did not load'}`));
    };
  }

  private fail(error: Error): void {
    this.failure ??= error;
    for (const reject of this.pending) reject(error);
    this.pending.clear();
  }

  /** calls `listen` with every line the engine writes; returns the call that stops it */
  onLine(listen: (line: string) => void): () => void {
    this.listeners.add(listen);
    return () => this.listeners.delete(listen);
  }

  send(line: string): void {
    this.worker.postMessage(line);
  }

  /** sends `line` and waits for the first line `done` accepts; `each` sees every line before it */
  request(line: string, done: (l: string) => boolean, each?: (l: string) => void): Promise<string> {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      const settle = () => {
        stopListening();
        this.pending.delete(fail);
      };
      const fail = (error: Error) => {
        settle();
        reject(error);
      };
      const stopListening = this.onLine((l) => {
        if (done(l)) {
          settle();
          resolve(l);
        } else each?.(l);
      });
      this.pending.add(fail);
      this.send(line);
    });
  }

  async identify(): Promise<Identity> {
    const id: Identity = { name: '', author: '', options: [] };
    await this.request(
      'uci',
      (l) => l === 'uciok',
      (l) => {
        if (l.startsWith('id name ')) id.name = l.slice(8);
        else if (l.startsWith('id author ')) id.author = l.slice(10);
        else if (l.startsWith('option ')) id.options.push(l);
      },
    );
    return id;
  }

  async ready(): Promise<void> {
    await this.request('isready', (l) => l === 'readyok');
  }

  /**
   * Searches a position and resolves with the engine's move.
   * @param position the text after `position`, such as `startpos moves e2e4`
   * @param limits the text after `go`, such as `depth 12` or `wtime 60000 btime 60000`
   * @param onInfo called with each `info` line of the search
   */
  async go(position: string, limits: string, onInfo?: (info: Info) => void): Promise<BestMove> {
    this.send(`position ${position}`);
    const line = await this.request(
      `go ${limits}`,
      (l) => l.startsWith('bestmove'),
      (l) => {
        const info = parseInfo(l);
        if (info) onInfo?.(info);
      },
    );
    const [, move = '0000', , ponder] = line.split(/\s+/);
    return ponder === undefined ? { move } : { move, ponder };
  }

  stop(): void {
    this.send('stop');
  }

  terminate(): void {
    this.worker.terminate();
    this.fail(new Error('the engine was stopped'));
    this.listeners.clear();
  }
}

/**
 * How a Worker will hear input during a search on this page, in the order it tries them:
 * shared memory needs cross-origin isolation; suspending needs JavaScript Promise Integration;
 * otherwise each `go` runs a fresh instance, and `stop` waits for the search to end.
 */
export function inputMode(): 'shared memory' | 'suspending' | 'fresh instance per go' {
  if (globalThis.crossOriginIsolated) return 'shared memory';
  // the Worker's own test (canSuspend in vendor/uci-over-wasi/wasi.ts)
  if (
    typeof Reflect.get(WebAssembly, 'Suspending') === 'function' &&
    typeof Reflect.get(WebAssembly, 'promising') === 'function'
  ) {
    return 'suspending';
  }
  return 'fresh instance per go';
}
