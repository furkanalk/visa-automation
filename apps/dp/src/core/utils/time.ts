export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function jitteredDelay(minMs: number, maxMs: number, jitter: number): number {
  const base = minMs + Math.random() * (maxMs - minMs);
  const j = base * jitter * (Math.random() * 2 - 1); // +/- jitter
  return Math.max(0, Math.floor(base + j));
}