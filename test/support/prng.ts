/** Small seeded PRNG (mulberry32) so property tests are reproducible without a dependency. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function int(rand: () => number, min: number, max: number): number {
  return min + Math.floor(rand() * (max - min + 1));
}

export function pick<T>(rand: () => number, items: readonly T[]): T {
  return items[int(rand, 0, items.length - 1)] as T;
}

const POOL = ["a", "Z", "0", "_", " ", "\n", "\t", "\u001b", "\u0007", "\u0085", "\u202e", "\u200b", "é", "日", "😀", "\ud800", "`", "|", "[", "]", "(", ")", "<", ">", "\\", "\u0000"];

/** Random string rich in hostile characters. */
export function hostileString(rand: () => number, maxLength = 40): string {
  const n = int(rand, 0, maxLength);
  let out = "";
  for (let i = 0; i < n; i++) out += pick(rand, POOL);
  return out;
}
