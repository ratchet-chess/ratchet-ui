/** How every page writes numbers and times: counts, sizes, signed values, ends and spans. */

/** a count with thousands marked, as 5,120 */
export const count = (n: number): string => n.toLocaleString('en-US');

/** a size in bytes as a reader reads it: `808 KB`, `8.0 MB`, `10.7 GB` */
export const bytes = (b: number): string =>
  b >= 1e9
    ? `${(b / 1e9).toFixed(1)} GB`
    : b >= 1e6
      ? `${(b / 1e6).toFixed(1)} MB`
      : `${Math.max(1, Math.round(b / 1e3))} KB`;

/** a large count in thousands, as a search's nodes a second: `835 k` */
export const thousands = (n: number): string => `${count(Math.round(n / 1000))} k`;

/** a signed value; an unbounded one, as an all-or-nothing score gives, shows as ±∞ */
export const signed = (v: number, d = 1): string =>
  Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(d)}` : v > 0 ? '+∞' : '−∞';

const DAY = 86_400_000;

/** a past time as a reader places it: today's clock time, yesterday, or a date */
export function whenText(iso: string, now: number): string {
  const t = new Date(iso);
  const n = new Date(now);
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(n) - day(t)) / DAY);
  if (days === 0)
    return t.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  if (days === 1) return 'yesterday';
  return t.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(t.getFullYear() === n.getFullYear() ? {} : { year: 'numeric' }),
  });
}

/** a clock time, with its day when that is not today: `10:05`, `tomorrow 02:10`, `Nov 22 09:00` */
export function clockText(ms: number, now: number): string {
  const t = new Date(ms);
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(t) - day(new Date(now))) / DAY);
  const clock = t.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  if (days === 0) return clock;
  if (days === 1) return `tomorrow ${clock}`;
  if (days === -1) return `yesterday ${clock}`;
  return `${t.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${clock}`;
}

/** a span to come, as precise as it is worth: `8 min`, `3 h 10 min`, `14 h`, `4 d 14 h` */
export function spanText(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  if (min < 10 * 60)
    return min % 60 === 0 ? `${min / 60} h` : `${Math.floor(min / 60)} h ${min % 60} min`;
  if (h < 48) return `${h} h`;
  return h % 24 === 0 ? `${h / 24} d` : `${Math.floor(h / 24)} d ${h % 24} h`;
}
