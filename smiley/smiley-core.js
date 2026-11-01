// Exact-match smiley hunt. Attempt n of a run is a pure function of (seed, n): N×N random bits.
// A hunt succeeds only when EVERY cell equals the target picture (no free/grey cells) — a true 1-to-1 match.
import { mix, mix2 } from '../app/core.js';
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
  const words = (seed, n) => { const a = mix2(seed, n); return [a, mix(a, 1), mix(a, 2) & 0x1ffff]; };
  const cell = (w, i) => (w[i >> 5] >>> (i & 31)) & 1; // 1 = black
  return {
    N, rows, CARE: care.length, probability: 2 ** -care.length, expectedTries: 2 ** care.length, words, cell,
    isMatch: (w) => ((w[0] & MASK[0]) >>> 0) === VAL[0] && ((w[1] & MASK[1]) >>> 0) === VAL[1] && ((w[2] & MASK[2]) >>> 0) === VAL[2],
    score: (w) => { let s = 0; for (const [i, b] of care) if (cell(w, i) === b) s++; return s; },
    target: (i) => (rows[(i / N) | 0][i % N] === '#' ? 1 : 0),
    // first matching attempt index in [from, to), or -1
    searchRange(seed, from, to) {
      const m0 = MASK[0], v0 = VAL[0], m1 = MASK[1], v1 = VAL[1], m2 = MASK[2], v2 = VAL[2];
      for (let n = from; n < to; n++) { const a = mix2(seed, n); if (((a & m0) >>> 0) !== v0) continue; if ((((mix(a, 1)) & m1) >>> 0) !== v1) continue; if (((mix(a, 2) & 0x1ffff & m2) >>> 0) === v2) return n; }
      return -1;
    },
  };
}
