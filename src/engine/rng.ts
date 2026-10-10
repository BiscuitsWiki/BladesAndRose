/** 可序列化的伪随机数发生器（mulberry32），保证整局可复现 */

export interface RngCarrier {
  rngSeed: number;
}

export function nextRandom(state: RngCarrier): number {
  state.rngSeed = (state.rngSeed + 0x6d2b79f5) | 0;
  let t = state.rngSeed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function nextInt(state: RngCarrier, maxExclusive: number): number {
  return Math.floor(nextRandom(state) * maxExclusive);
}

/** Fisher-Yates，原地打乱并返回同一数组 */
export function shuffleInPlace<T>(state: RngCarrier, items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = nextInt(state, i + 1);
    const tmp = items[i]!;
    items[i] = items[j]!;
    items[j] = tmp;
  }
  return items;
}

export function pickRandom<T>(state: RngCarrier, items: T[]): T {
  return items[nextInt(state, items.length)]!;
}
