import { formatAxisTime, zoneOffsetMs } from "../api/format";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const STEPS = [5 * MINUTE, 10 * MINUTE, 15 * MINUTE, 30 * MINUTE, HOUR, 2 * HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR, DAY, 2 * DAY, 7 * DAY];

/**
 * Round-numbered time ticks between two instants (epoch ms), at most
 * about `target` of them, aligned in the configured display time zone --
 * hourly ticks fall on :00 local, daily ticks on local midnight -- and
 * labelled through api/format.ts like every other time on screen.
 */
export function timeTicks(minMs: number, maxMs: number, target = 6): { ms: number; label: string }[] {
  const span = maxMs - minMs;
  if (!(span > 0)) return [];
  const step = STEPS.find((s) => span / s <= target) ?? STEPS[STEPS.length - 1];
  const offset = zoneOffsetMs((minMs + maxMs) / 2);
  const ticks: { ms: number; label: string }[] = [];
  for (let t = Math.ceil((minMs + offset) / step) * step - offset; t <= maxMs; t += step) {
    ticks.push({ ms: t, label: formatAxisTime(t, step >= DAY) });
  }
  return ticks;
}

/**
 * At most one min and one max point per horizontal bucket, in time
 * order. A month of 30-second samples is ~86k points per series -- far
 * more than a few hundred pixels can show, and heavy to draw on a Pi --
 * but averaging would erase exactly the spikes a monitoring chart is for.
 */
export function downsample<T extends { ts: number; value: number }>(points: T[], buckets: number): T[] {
  if (points.length <= buckets * 2 || buckets < 1) return points;
  const first = points[0].ts;
  const span = points[points.length - 1].ts - first || 1;
  const out: T[] = [];
  let bucket = -1;
  let lo: T | null = null;
  let hi: T | null = null;
  const flush = () => {
    if (!lo || !hi) return;
    if (lo === hi) out.push(lo);
    else out.push(...(lo.ts <= hi.ts ? [lo, hi] : [hi, lo]));
  };
  for (const p of points) {
    const b = Math.min(buckets - 1, Math.floor(((p.ts - first) / span) * buckets));
    if (b !== bucket) {
      flush();
      bucket = b;
      lo = hi = p;
    } else {
      if (p.value < lo!.value) lo = p;
      if (p.value > hi!.value) hi = p;
    }
  }
  flush();
  return out;
}

/** The smallest "round" number >= `value` whose quarters are round too
 * (the value axes have ticks at 0, 25, 50, 75, 100%): 137 -> 200,
 * 45 -> 80, 100 -> 100. */
export function niceMax(value: number): number {
  if (!(value > 0)) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 4, 8, 10].find((m) => m * magnitude >= value) ?? 10;
  return step * magnitude;
}
