import { indexPgnBlob } from './index.ts';

/** Indexes a large PGN Blob off the main thread and transfers its typed arrays back. */
self.onmessage = async (e: MessageEvent<{ id: number; blob: Blob }>) => {
  const { id, blob } = e.data;
  try {
    const index = await indexPgnBlob(blob);
    const transfer: Transferable[] = [
      index.offsets.buffer,
      index.lengths.buffer,
      index.white.buffer,
      index.black.buffer,
      index.event.buffer,
      index.site.buffer,
      index.date.buffer,
      index.round.buffer,
      index.result.buffer,
      index.eco.buffer,
      index.opening.buffer,
      index.termination.buffer,
      index.plies.buffer,
    ];
    self.postMessage({ id, index }, { transfer });
  } catch (err) {
    self.postMessage({
      id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
