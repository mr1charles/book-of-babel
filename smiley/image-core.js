// 15×15, 16-colour random picture hunt. A try = 225 independent random colours (900 random bits).
// Counter-based like smiley-core: try n is a pure function of (seed, n). "Score" = pixels (of 225) equal to the target.
const K1 = 0x85ebca6b | 0, K2 = 0xc2b2ae35 | 0;
const fm = (h) => { h ^= h >>> 16; h = Math.imul(h, K1); h ^= h >>> 13; h = Math.imul(h, K2); h ^= h >>> 16; return h >>> 0; };
export const N = 15, CELLS = N * N, WORDS = 29;                 // 225 nibbles = 28.125 words
export const PALETTE_KEYS = '.tyskwbrdopGBPln';                  // 16 colours; the sprite uses 8 of them
export const PALETTE = ['#CFE8F5', '#1FB5B0', '#F6D338', '#F3D3AE', '#1A1A1A', '#FFFFFF', '#7B4B2A', '#CC2F2A', '#8B1E1A', '#F08A24', '#E88FA0', '#3E9B4F', '#3D6FD8', '#7A4DB8', '#9A9A9A', '#1D2B53'];
export const SPRITE = [   // Eric Cartman (South Park), my own 15×15 pixel art: teal hat, yellow pom-pom & brim, red jacket
  '......yyy......', '.....ttttt.....', '....ttttttt....', '...ttttttttt...', '..yyyyyyyyyyy..',
  '..sswkssskwss..', '.sssssssssssss.', '.sssssbbbsssss.', '.sssssssssssss.', '..sssssssssss..',
  '..rrrrrrrrrrr..', '.rrrrrrrrrrrrr.', 'yrrrrrrrrrrrrry', '.rrrrrrrrrrrrr.', '..bbb.....bbb..',
];
export const TARGET = SPRITE.join('').split('').map((c) => PALETTE_KEYS.indexOf(c));
if (SPRITE.some((r) => r.length !== N) || TARGET.some((v) => v < 0) || TARGET.length !== CELLS) throw new Error('bad sprite');
export const TW = new Uint32Array(WORDS); TARGET.forEach((c, i) => { TW[i >> 3] |= c << ((i & 7) * 4); });
export const POSSIBLE = 16n ** BigInt(CELLS);                    // distinct pictures
export const keys = (seed, hi) => { const b = fm((seed ^ Math.imul(hi + 1, 0x9e3779b1)) >>> 0), k = new Uint32Array(WORDS); for (let i = 0; i < WORDS; i++) k[i] = fm((b + Math.imul(i + 1, 0x7feb352d)) >>> 0); return k; };
export const picture = (seed, n) => { const lo = n >>> 0, k = keys(seed, Math.floor(n / 4294967296)), out = new Uint8Array(CELLS); for (let i = 0; i < CELLS; i++) out[i] = (fm((lo ^ k[i >> 3]) >>> 0) >>> ((i & 7) * 4)) & 15; return out; };
export const scorePicture = (p) => { let s = 0; for (let i = 0; i < CELLS; i++) if (p[i] === TARGET[i]) s++; return s; };
// scan tries [from,to): returns running-max records [[n, score], ...] (strictly increasing score, by try index)
export function scanRange(seed, from, to) {
  const recs = []; let best = -1, hi = Math.floor(from / 4294967296), k = keys(seed, hi), base = hi * 4294967296;
  for (let n = from; n < to; n++) {
    if (n - base >= 4294967296) { hi++; base = hi * 4294967296; k = keys(seed, hi); }
    const x = (n - base) | 0; let s = 0;
    for (let w = 0; w < WORDS - 1; w++) { // 8 nibbles per word: count equal nibbles
      const z = (fm((x ^ k[w]) >>> 0) ^ TW[w]) >>> 0, nz = ((((z & 0x77777777) + 0x77777777) | z) >>> 3) & 0x11111111; // 1 per non-equal nibble
      let c = (nz + (nz >>> 4)) & 0x0f0f0f0f; s += 8 - (Math.imul(c, 0x01010101) >>> 24); }
    if ((((fm((x ^ k[WORDS - 1]) >>> 0) ^ TW[WORDS - 1]) & 15) === 0)) s++; // 225th pixel
    if (s > best) { best = s; recs.push([n, s]); }
  }
  return recs;
}
