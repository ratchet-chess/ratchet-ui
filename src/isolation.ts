/** what isolate() reads and does on the page; a test passes its own */
export interface Page {
  crossOriginIsolated: boolean;
  /** undefined where the browser offers no service worker, as on a page that is not secure */
  serviceWorker:
    | {
        register(url: string, options: { scope: string }): Promise<unknown>;
        ready: Promise<unknown>;
      }
    | undefined;
  session: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  reload: () => void;
}

/**
 * The session key that holds when a reload was last tried, so a page that stays unisolated
 * never loops. The mark expires instead of being cleared: Chrome can bring back an older
 * session value after a hard reload, which would otherwise block the next try.
 */
const TRIED = 'ratchet-ui.isolation-reload';

/** how long a tried reload blocks another: longer than a reload takes, shorter than a person's next one */
const RETRY_MS = 10_000;

/** how long a first visit waits for the service worker before the app starts without it */
const PATIENCE_MS = 3000;

function browserPage(): Page {
  return {
    crossOriginIsolated: globalThis.crossOriginIsolated,
    serviceWorker:
      window.isSecureContext && 'serviceWorker' in navigator ? navigator.serviceWorker : undefined,
    session: sessionStorage,
    reload: () => location.reload(),
  };
}

/** resolves after ms milliseconds */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Makes the page cross-origin isolated where the host sends no isolation headers, so an engine
 * can run threads. It registers `public/isolation-sw.js`, which adds the headers, and reloads
 * the page once so the next load carries them. A host that sends them, as Vite's dev server
 * does, never registers it. A hard reload bypasses the service worker, so it costs one more
 * reload.
 *
 * @param page the page to act on; by default this browser's
 * @param base the app's base path, where the service worker is served
 * @param patience milliseconds to wait for the service worker, and then for the reload
 * @returns a promise that resolves when the app should start on this page; it does not
 *   resolve before a reload that takes the page away
 *
 * @example
 * await isolate();
 * createApp(App).mount('#app');
 */
export async function isolate(
  page?: Page,
  base: string = import.meta.env.BASE_URL,
  patience: number = PATIENCE_MS,
): Promise<void> {
  try {
    // inside the try: reading sessionStorage throws where storage is refused
    const p = page ?? browserPage();
    if (p.crossOriginIsolated) {
      p.session.removeItem(TRIED);
      return;
    }
    const sw = p.serviceWorker;
    const tried = Number(p.session.getItem(TRIED) ?? 0);
    if (sw === undefined || Math.abs(Date.now() - tried) < RETRY_MS) return;
    await sw.register(`${base}isolation-sw.js`, { scope: base });
    const ready = await Promise.race([
      sw.ready.then(() => true),
      sleep(patience).then(() => false),
    ]);
    if (!ready) return;
    p.session.setItem(TRIED, String(Date.now()));
    p.reload();
    // a browser can drop the reload, as Chrome did after a second hard reload; the app then
    // starts on this page rather than leave it blank
    await sleep(patience);
  } catch {
    // storage or service workers refused, as in some private windows: run without isolation
  }
}
