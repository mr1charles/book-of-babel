// Exact-match smiley hunt. Attempt n of a run is a pure function of (seed, n): N×N random bits.
// A hunt succeeds only when EVERY cell equals the target picture (no free/grey cells) — a true 1-to-1 match.
// Generator v3 (fast): each attempt's 3 words are sums of two independent murmur3-finalizer hashes of the
// attempt number, keyed from the run seed (seed itself comes from the OS secure RNG). Pseudo-random, counter-based,
// so any attempt can be recomputed — and not a per-block permutation (sums of two bijections are not bijective).
const K1 = 0x85ebca6b | 0, K2 = 0xc2b2ae35 | 0;
const fm = (h) => { h ^= h >>> 16; h = Math.imul(h, K1); h ^= h >>> 13; h = Math.imul(h, K2); h ^= h >>> 16; return h >>> 0; };
export function keys(seed, hi) { const b = fm((seed ^ Math.imul(hi + 1, 0x9e3779b1)) >>> 0); const k = []; for (let i = 0; i < 6; i++) k.push(fm((b + Math.imul(i + 1, 0x7feb352d)) >>> 0)); return k; }
const rot = (x, r) => (x << r) | (x >>> (32 - r));
export const word = (lo, k, a, b, r) => (fm((lo ^ k[a]) >>> 0) + fm((rot(lo, r) ^ k[b]) >>> 0)) >>> 0;
export const PRESETS = {
  5: ['.#.#.', '.....', '#...#', '.###.', '.....'],
  6: ['......', '.#..#.', '......', '#....#', '.####.', '......'],
};
export function makeHunt(rows) {
  const N = rows.length, care = [];
  rows.forEach((row, r) => [...row].forEach((ch, c) => { if (ch !== '.' && ch !== '#' ) throw new Error('bad cell'); care.push([r * N + c, ch === '#' ? 1 : 0]); }));
  // every cell is specified ('.' = white, '#' = black): a full 1-to-1 picture
  const MASK = [0, 0, 0], VAL = [0, 0, 0];
  for (const [i, b] of care) { MASK[i >> 5] |= 1 << (i & 31); if (b) VAL[i >> 5] |= 1 << (i & 31); }
  for (let k = 0; k < 3; k++) { MASK[k] >>>= 0; VAL[k] >>>= 0; }
  const words = (seed, n) => { const lo = n >>> 0, k = keys(seed, Math.floor(n / 4294967296)); return [word(lo, k, 0, 1, 13), word(lo, k, 2, 3, 7), word(lo, k, 4, 5, 21) & 0x1ffff]; };
  const cell = (w, i) => (w[i >> 5] >>> (i & 31)) & 1; // 1 = black
  return {
    N, rows, CARE: care.length, probability: 2 ** -care.length, expectedTries: 2 ** care.length, words, cell,
    isMatch: (w) => ((w[0] & MASK[0]) >>> 0) === VAL[0] && ((w[1] & MASK[1]) >>> 0) === VAL[1] && ((w[2] & MASK[2]) >>> 0) === VAL[2],
    score: (w) => { let s = 0; for (const [i, b] of care) if (cell(w, i) === b) s++; return s; },
    target: (i) => (rows[(i / N) | 0][i % N] === '#' ? 1 : 0),
    // first matching attempt index in [from, to), or -1
    searchRange(seed, from, to) {
      const m0 = MASK[0], v0 = VAL[0], m1 = MASK[1], v1 = VAL[1], m2 = MASK[2], v2 = VAL[2];
      for (let hi = Math.floor(from / 4294967296); hi * 4294967296 < to; hi++) {
        const k = keys(seed, hi), k0 = k[0], k1 = k[1], base = hi * 4294967296;
        const lo0 = Math.max(from, base) - base, lo1 = Math.min(to, base + 4294967296) - base;
        for (let lo = lo0; lo < lo1; lo++) {
          const x = lo | 0; if ((((fm((x ^ k0) >>> 0) + fm((((x << 13) | (x >>> 19)) ^ k1) >>> 0)) & m0) >>> 0) !== v0) continue;
          if (((word(x, k, 2, 3, 7) & m1) >>> 0) !== v1) continue;
          if (((word(x, k, 4, 5, 21) & 0x1ffff & m2) >>> 0) === v2) return base + lo;
        }
      }
      return -1;
    },
  };
}
