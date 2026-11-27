import { defineStore } from 'pinia';
import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue';
import {
  managerBase,
  readJob,
  readManager,
  type Host,
  type Job,
  type JobDetail,
} from '../manager/api.ts';
import { unreachableText } from '../manager/show.ts';
import { useSettings } from './settings.ts';

/** how often the manager view reads the manager */
export const RELOAD_MS = 10_000;
/** upper bound for a single manager HTTP request so a dead LAN host fails promptly */
const FETCH_TIMEOUT_MS = 8_000;

/** none: no address is set; reading: the first read is out; connected; unreachable: the last read failed */
export type Link = 'none' | 'reading' | 'connected' | 'unreachable';

/**
 * The manager view's data: the hosts and the jobs of the manager whose address Settings keeps, read again every
 * RELOAD_MS while the page is visible, and with them the one job whose page is open. It only reads. A failed read
 * keeps the last rows and says why it failed.
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
  /** the job whose page is open, as its last read gave it; null before that read, and with no page open */
  const opened = ref<number | null>(null);
  const job = shallowRef<JobDetail | null>(null);
  /** the manager has no job of the opened id */
  const jobMissing = ref(false);

  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: AbortController | undefined;

  async function read(): Promise<void> {
    clearTimeout(timer);
    abort?.abort();
    const at = url.value;
    if (!at) return;
    const mine = (abort = new AbortController());
    const signal =
      typeof AbortSignal.timeout === 'function' && typeof AbortSignal.any === 'function'
        ? AbortSignal.any([mine.signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)])
        : mine.signal;
    try {
      const want = opened.value;
      const [s, one] = await Promise.all([
        readManager(at, signal),
        want === null ? null : readJob(at, want, signal),
      ]);
      // an answer for a page the reader has left since is dropped: open() started a read of its own
      if (mine.signal.aborted) return;
      hosts.value = s.hosts;
      jobs.value = s.jobs;
      job.value = one;
      jobMissing.value = want !== null && one === null;
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
      job.value = null;
      jobMissing.value = false;
      readAt.value = null;
      problem.value = '';
      link.value = at ? 'reading' : 'none';
      if (at) void read();
    },
    { immediate: true },
  );

  // a hidden page reads nothing; it reads at once when it shows again
  const onVisibility = () => {
    if (document.hidden) clearTimeout(timer);
    else if (url.value) void read();
  };
  document.addEventListener('visibilitychange', onVisibility);
  onScopeDispose(() => {
    clearTimeout(timer);
    abort?.abort();
    document.removeEventListener('visibilitychange', onVisibility);
  });

  /** opens a job's page, or closes it with null: the job is read at once, and then with every read */
  function open(id: number | null): void {
    if (id === opened.value) return;
    opened.value = id;
    job.value = null;
    jobMissing.value = false;
    if (url.value) void read();
  }

  return { url, link, hosts, jobs, readAt, problem, read, opened, job, jobMissing, open };
});
