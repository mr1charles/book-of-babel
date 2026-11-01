// 9×9 black-and-white smiley hunt. Attempt n of a run is a pure function of (seed, n): 81 random bits.
import { mix, mix2 } from '../app/core.js';
export const N = 9;
// '#' = must be black, 'o' = must be white, '.' = free (any value)
export const TEMPLATE = [
  '.........',
  '.........',
  '.o#o.o#o.',
  '..ooooo..',
  '..ooooo..',
  '.#ooooo#.',
  '..#ooo#..',
  '..o###o..',
  '.........',
];
const care = []; // [cellIndex, wantBlack]
TEMPLATE.forEach((row, r) => [...row].forEach((ch, c) => { if (ch !== '.') care.push([r * N + c, ch === '#' ? 1 : 0]); }));
export const CARE = care.length;                        // constrained cells
export const BLACK_CELLS = care.filter((c) => c[1]).length;
export const PROBABILITY = 2 ** -CARE;                  // chance one random 9×9 attempt is a smiley
export const MASK = [0, 0, 0], VAL = [0, 0, 0];
for (const [i, b] of care) { MASK[i >> 5] |= 1 << (i & 31); if (b) VAL[i >> 5] |= 1 << (i & 31); }
for (let k = 0; k < 3; k++) { MASK[k] >>>= 0; VAL[k] >>>= 0; }
export const words = (seed, n) => { const a = mix2(seed, n); return [a, mix(a, 1), mix(a, 2) & 0x1ffff]; };
export const isSmiley = (w) => ((w[0] & MASK[0]) >>> 0) === VAL[0] && ((w[1] & MASK[1]) >>> 0) === VAL[1] && ((w[2] & MASK[2]) >>> 0) === VAL[2];
export const cell = (w, i) => (w[i >> 5] >>> (i & 31)) & 1; // 1 = black
export const score = (w) => { let s = 0; for (const [i, b] of care) if (cell(w, i) === b) s++; return s; };
export function search(seed, { start = 0, max = Infinity, checkpointEvery = 1_000_000, onCheckpoint } = {}) {
  let n = start; const t0 = performance.now();
  while (n < max) {
    const end = Math.min(max, n + checkpointEvery);
    for (; n < end; n++) { const a = mix2(seed, n); if (((a & MASK[0]) >>> 0) === VAL[0]) { const b = mix(a, 1); if (((b & MASK[1]) >>> 0) === VAL[1] && (((mix(a, 2) & 0x1ffff) & MASK[2]) >>> 0) === VAL[2]) return { found: true, attempt: n, attempts: n + 1, ms: performance.now() - t0 }; } }
    onCheckpoint?.(n, performance.now() - t0);
  }
  return { found: false, attempts: n, ms: performance.now() - t0 };
}
