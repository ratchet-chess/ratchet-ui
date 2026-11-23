import { describe, expect, it } from 'vitest';
import { isolate, type Page } from './isolation.ts';
import workerScript from '../public/isolation-sw.js?raw';

type Container = NonNullable<Page['serviceWorker']>;

/**
 * A page with a session store and a service worker container that record what isolate() did.
 * `worker` changes the container's parts; null takes the container away.
 */
function page(over: Partial<Page> = {}, worker: Partial<Container> | null = {}) {
  const done = { registered: [] as [string, string][], reloads: 0 };
  const store = new Map<string, string>();
  const container: Container = {
    register: (url, options) => {
      done.registered.push([url, options.scope]);
      return Promise.resolve({});
    },
    ready: Promise.resolve({}),
    ...worker,
  };
  const p: Page = {
    crossOriginIsolated: false,
    serviceWorker: worker === null ? undefined : container,
    session: {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => void store.set(k, v),
      removeItem: (k) => void store.delete(k),
    },
    reload: () => void done.reloads++,
    ...over,
  };
  return { p, done, store };
}

describe('isolate', () => {
  it('registers the service worker at the base and reloads once', async () => {
    const { p, done, store } = page();
    await isolate(p, '/ratchet-ui/', 5);
    expect(done.registered).toEqual([['/ratchet-ui/isolation-sw.js', '/ratchet-ui/']]);
    expect(done.reloads).toBe(1);
    // the reloaded page, still unisolated, does not try again
    await isolate(p, '/ratchet-ui/', 5);
    expect(done.reloads).toBe(1);
    expect(store.size).toBe(1);
  });

  it('does nothing on an isolated page, and clears the mark of a tried reload', async () => {
    const { p, done, store } = page({ crossOriginIsolated: true });
    store.set('ratchet-ui.isolation-reload', String(Date.now()));
    await isolate(p, '/', 5);
    expect(done.registered).toEqual([]);
    expect(store.has('ratchet-ui.isolation-reload')).toBe(false);
  });

  it('tries again once the mark of an earlier try is stale', async () => {
    // Chrome can bring back an old mark after a hard reload, which bypassed the worker
    const { p, done, store } = page();
    store.set('ratchet-ui.isolation-reload', String(Date.now() - 60_000));
    await isolate(p, '/', 5);
    expect(done.reloads).toBe(1);
  });

  it('starts the app without isolation where no service worker is offered', async () => {
    const { p, done } = page({}, null);
    await isolate(p, '/', 5);
    expect(done.reloads).toBe(0);
  });

  it('starts the app when registration fails or the worker is not ready in time', async () => {
    const refused = page({}, { register: () => Promise.reject(new Error('refused')) });
    await isolate(refused.p, '/', 5);
    expect(refused.done.reloads).toBe(0);
    const slow = page({}, { ready: new Promise(() => {}) });
    await isolate(slow.p, '/', 5);
    expect(slow.done.reloads).toBe(0);
  });
});

/** runs the service worker's script against a fake scope, and returns its fetch handler */
function fetchHandler(network: (r: Request) => Promise<Response>) {
  const listeners = new Map<string, (e: unknown) => void>();
  const scope = {
    location: new URL('https://example.github.io/ratchet-ui/isolation-sw.js'),
    addEventListener: (type: string, fn: (e: unknown) => void) => listeners.set(type, fn),
    skipWaiting: () => Promise.resolve(),
    clients: { claim: () => Promise.resolve() },
  };
  // oxlint-disable-next-line no-implied-eval -- public/ serves the script as written, so it cannot export its handlers; the test runs that very text
  Reflect.apply(new Function('self', 'fetch', workerScript), undefined, [scope, network]);
  return async (url: string, init?: RequestInit) => {
    let answer: Promise<Response> | undefined;
    listeners.get('fetch')?.({
      request: new Request(url, init),
      respondWith: (r: Promise<Response>) => (answer = r),
    });
    return answer;
  };
}

describe('isolation-sw.js', () => {
  const ok = () =>
    Promise.resolve(
      new Response('body', { status: 200, headers: { 'content-type': 'text/html' } }),
    );

  it("adds the isolation headers to the site's own responses", async () => {
    const res = await fetchHandler(ok)('https://example.github.io/ratchet-ui/');
    expect(res?.headers.get('cross-origin-opener-policy')).toBe('same-origin');
    expect(res?.headers.get('cross-origin-embedder-policy')).toBe('require-corp');
    expect(res?.headers.get('content-type')).toBe('text/html');
    expect(await res?.text()).toBe('body');
  });

  it("leaves another origin's requests to the browser", async () => {
    expect(await fetchHandler(ok)('https://raw.githubusercontent.com/a/b/c.zip')).toBeUndefined();
  });

  it('passes an opaque response through unchanged', async () => {
    const opaque = Response.error();
    expect(
      await fetchHandler(() => Promise.resolve(opaque))('https://example.github.io/ratchet-ui/x'),
    ).toBe(opaque);
  });
});
