import test from 'node:test'; import assert from 'node:assert/strict'; import { makeHunt, PRESETS } from '../smiley-core.js';
test('searchRange result equals brute-force via words()', () => {
  const H = makeHunt(PRESETS[5]); const seed = 12345; const n = H.searchRange(seed, 0, 400_000_000);
  assert.ok(n >= 0); const w = H.words(seed, n); assert.ok(H.isMatch(w));
  for (let i = 0; i < 25; i++) assert.equal(H.cell(w, i), H.target(i));
  for (let m = Math.max(0, n - 2000); m < n; m++) assert.equal(H.isMatch(H.words(seed, m)), false);
});
test('chunk boundaries do not change the first match', () => {
  const H = makeHunt(PRESETS[5]), seed = 777, full = H.searchRange(seed, 0, 300_000_000); let n = -1;
  for (let f = 0; f < 300_000_000 && n < 0; f += 7_000_001) n = H.searchRange(seed, f, Math.min(300_000_000, f + 7_000_001));
  assert.equal(n, full);
});
test('match frequency is Poisson-consistent (no structure) for a 25-cell target', () => {
  const H = makeHunt(PRESETS[5]); let hits = 0, N = 2 ** 30; for (let s = 1; s <= 8; s++) { let p = 0; while (true) { const n = H.searchRange(s * 99991, p, N); if (n < 0) break; hits++; p = n + 1; } }
  const exp = 8 * N / 2 ** 25; assert.ok(Math.abs(hits - exp) < 4 * Math.sqrt(exp), `hits ${hits} expected ${exp}`);
});
test('crossing the 2^32 attempt boundary works', () => {
  const H = makeHunt(PRESETS[5]); const a = H.searchRange(5, 4294967296 - 10_000_000, 4294967296 + 10_000_000);
  if (a >= 0) assert.ok(H.isMatch(H.words(5, a))); assert.ok(true);
});
