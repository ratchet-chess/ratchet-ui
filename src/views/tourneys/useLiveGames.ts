/**
 * Polls on-demand live snapshots from the running tournament only while the Live view is open,
 * managing focus selection, auto-follow with a 1.5 s result hold, and Pin override.
 */
import { onBeforeUnmount, ref, watch } from 'vue';
import type { LiveSnapshot } from '../../match/runner.ts';
import { useTournaments } from '../../stores/tournaments.ts';
import { pickNextLiveKey } from './live.ts';

/** How often clocks, positions, and search telemetry refresh while Live is visible. */
const POLL_MS = 200;
/** How long a finished game stays on screen before auto-follow switches to the next live game. */
const AUTO_FOLLOW_HOLD_MS = 1500;

export function useLiveGames(tournamentId: () => string, enabled: () => boolean) {
  const tournaments = useTournaments();
  const active = ref<LiveSnapshot[]>([]);
  const focused = ref<LiveSnapshot | null>(null);
  const selectedKey = ref<string | null>(null);
  const pinned = ref(false);

  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let followTimer: ReturnType<typeof setTimeout> | undefined;
  let followForKey: string | null = null;

  function clearFollow(): void {
    clearTimeout(followTimer);
    followTimer = undefined;
    followForKey = null;
  }

  function scheduleFollow(finishedKey: string): void {
    if (followForKey === finishedKey) return;
    clearFollow();
    followForKey = finishedKey;
    followTimer = setTimeout(() => {
      followTimer = undefined;
      followForKey = null;
      if (pinned.value || selectedKey.value !== finishedKey) return;
      const next = pickNextLiveKey(active.value, finishedKey);
      if (next && next !== finishedKey) {
        selectedKey.value = next;
        poll();
      }
    }, AUTO_FOLLOW_HOLD_MS);
  }

  function poll(): void {
    const id = tournamentId();
    let res = tournaments.liveSnapshots(id, selectedKey.value);
    active.value = res.active;

    // Pick the first active game when nothing is selected yet
    if (!selectedKey.value && res.active.length > 0) {
      selectedKey.value = res.active[0]?.key ?? null;
      res = tournaments.liveSnapshots(id, selectedKey.value);
      active.value = res.active;
    }

    if (res.focused) {
      focused.value = res.focused;
    } else if (res.active.length > 0 && !pinned.value) {
      // Focused game fell out of the recent buffer; jump to an active game
      selectedKey.value = res.active[0]?.key ?? null;
      res = tournaments.liveSnapshots(id, selectedKey.value);
      active.value = res.active;
      focused.value = res.focused;
    } else if (!pinned.value) {
      focused.value = null;
    }

    const cur = focused.value;
    if (cur && cur.outcome !== null && !pinned.value && res.active.length > 0) {
      scheduleFollow(cur.key);
    } else {
      clearFollow();
    }
  }

  function stopPolling(): void {
    clearInterval(pollTimer);
    pollTimer = undefined;
    clearFollow();
  }

  function startPolling(): void {
    stopPolling();
    poll();
    pollTimer = setInterval(poll, POLL_MS);
  }

  watch(
    () => [tournamentId(), enabled()] as const,
    ([id, isOn], prev) => {
      if (prev !== undefined && prev[0] !== id) {
        selectedKey.value = null;
        focused.value = null;
        active.value = [];
        pinned.value = false;
      }
      if (isOn) startPolling();
      else stopPolling();
    },
    { immediate: true },
  );

  watch(pinned, (isPinned) => {
    if (isPinned) {
      clearFollow();
      return;
    }
    const cur = focused.value;
    if (cur?.outcome !== null && active.value.length > 0) {
      const next = pickNextLiveKey(active.value, cur?.key ?? null);
      if (next) {
        selectedKey.value = next;
        poll();
      }
    }
  });

  function select(key: string): void {
    clearFollow();
    selectedKey.value = key;
    if (enabled()) poll();
  }

  function nextLive(): void {
    clearFollow();
    const next = pickNextLiveKey(active.value, selectedKey.value);
    if (next) {
      selectedKey.value = next;
      if (enabled()) poll();
    }
  }

  function clearFinished(): void {
    clearFollow();
    pinned.value = false;
    focused.value = null;
    selectedKey.value = null;
  }

  onBeforeUnmount(stopPolling);

  return {
    active,
    focused,
    selectedKey,
    pinned,
    select,
    nextLive,
    clearFinished,
  };
}
