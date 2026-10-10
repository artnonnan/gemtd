/** Small deterministic PRNG (mulberry32). Both versus players share a seed so they roll the same gems. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const randomSeed = () => Math.floor(Math.random() * 2 ** 31);

/** Seed for the combat stream, derived so it never matches the gem stream. */
export const combatSeed = (seed: number) => (seed ^ 0x9e3779b9) >>> 0;
