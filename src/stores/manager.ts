import { defineStore } from 'pinia';
import { computed, ref, shallowRef, watch } from 'vue';
import { managerBase, readManager, type Host, type Job } from '../manager/api.ts';
import { unreachableText } from '../manager/show.ts';
import { useSettings } from './settings.ts';

/** how often the manager view reads the manager */
export const RELOAD_MS = 10_000;

/** none: no address is set; reading: the first read is out; connected; unreachable: the last read failed */
export type Link = 'none' | 'reading' | 'connected' | 'unreachable';

/**
 * The manager view's data: the hosts and the jobs of the manager whose address Settings keeps, read again every
 * RELOAD_MS while the page is visible. It only reads. A failed read keeps the last rows and says why it failed.
 */
export const useManager = defineStore('manager', () => {
  const settings = useSettings();
  const url = computed(() => managerBase(settings.managerUrl));
  const link = ref<Link>('none');
  const hosts = shallowRef<Host[]>([]);
  const jobs = shallowRef<Job[]>([]);
  /** this browser's clock at the last good read, in ms */
  const readAt = ref<number | null>(null);
  /** why the last read failed; empty after a good one */
  const problem = ref('');

  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: AbortController | undefined;

  async function read(): Promise<void> {
    clearTimeout(timer);
    abort?.abort();
    const at = url.value;
    if (!at) return;
    const mine = (abort = new AbortController());
    try {
      const s = await readManager(at, mine.signal);
      if (mine.signal.aborted) return;
      hosts.value = s.hosts;
      jobs.value = s.jobs;
      readAt.value = Date.now();
      problem.value = '';
      link.value = 'connected';
    } catch (e) {
      if (mine.signal.aborted) return;
      problem.value = unreachableText(
        at,
        location.protocol,
        e instanceof Error ? e.message : String(e),
      );
      link.value = 'unreachable';
    }
    if (!document.hidden) timer = setTimeout(() => void read(), RELOAD_MS);
  }

  watch(
    url,
    (at) => {
      clearTimeout(timer);
      abort?.abort();
      hosts.value = [];
      jobs.value = [];
      readAt.value = null;
      problem.value = '';
      link.value = at ? 'reading' : 'none';
      if (at) void read();
    },
    { immediate: true },
  );

  // a hidden page reads nothing; it reads at once when it shows again
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && url.value) void read();
  });

  return { url, link, hosts, jobs, readAt, problem, read };
});
