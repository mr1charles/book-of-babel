// THE ORIGIN ENGINE — shared, deterministic generation core for The Book of Babel.
// One "Atom Second" = one generation event = one character on a page + one pixel on a board.
// Outputs are pure functions of (worldSeed, sequence number), so every event is reproducible.
export const ENGINE = 'babel-engine/1.0';

export function mix(a, b) {
  let h = (a ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (b >>> 0), 0x85ebca6b); h ^= h >>> 13;
  h = Math.imul(h ^ Math.imul(b >>> 0, 0xc2b2ae35), 0x27d4eb2f); h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12;
  return h >>> 0;
}
export function mix2(seed, n) { // n may exceed 2^32
  const lo = n >>> 0, hi = Math.floor(n / 4294967296) >>> 0;
  return mix(mix(seed, lo), hi + 0x51ed270b);
}

const WORDISH = (() => {
  const f = { ' ': 18, e: 12, t: 9, a: 8, o: 8, i: 7, n: 7, s: 6, h: 6, r: 6, d: 4, l: 4, u: 3, c: 3, m: 2, w: 2, f: 2, g: 2, y: 2, p: 2, b: 1, v: 1, k: 1, '.': 1, ',': 1 };
  let s = ''; for (const [c, n] of Object.entries(f)) s += c.repeat(n); return s;
})();
export const MODES = {
  babel:   { label: 'Babel (a–z , . space)', alphabet: 'abcdefghijklmnopqrstuvwxyz ,.', weight: 30 },
  wordish: { label: 'Language-like', alphabet: null, weight: 25 },
  alnum:   { label: 'Alphanumeric', alphabet: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ', weight: 10 },
  math:    { label: 'Numerals & mathematics', alphabet: '0123456789+-=×÷∑∫√π∞≈≠≤≥() ^_', weight: 10 },
  ascii:   { label: 'Printable ASCII', alphabet: Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join(''), weight: 10 },
  unicode: { label: 'Unicode', alphabet: null, weight: 15 },
};
const MODE_KEYS = Object.keys(MODES);
const UNI = [[0x391, 0x3c9], [0x410, 0x44f], [0x5d0, 0x5ea], [0x621, 0x64a], [0x3041, 0x3096], [0x4e00, 0x9fa5], [0x2200, 0x22ff], [0x2190, 0x21ff], [0x2500, 0x257f], [0x21, 0x7e]];

export function alphabetSize(mode) {
  if (mode === 'wordish') return new Set(WORDISH).size;
  if (mode === 'unicode') return UNI.reduce((a, [l, h]) => a + (h - l + 1), 0);
  return MODES[mode].alphabet.length;
}
export function charAt(mode, seed, n) {
  const v = mix2(seed, n);
  if (mode === 'wordish') return WORDISH[v % WORDISH.length];
  if (mode === 'unicode') { const [l, h] = UNI[v % UNI.length]; return String.fromCharCode(l + (mix(v, 7) % (h - l + 1))); }
  const a = MODES[mode].alphabet; return a[v % a.length];
}

export const pad = (n, w) => String(n).padStart(w, '0');
export const ids = {
  book: (i) => 'B-' + pad(i, 10), page: (i) => 'P-' + pad(i, 9), board: (i) => 'BRD-' + pad(i, 8),
  event: (i) => 'E-' + pad(i, 12), chapter: (i) => 'C-' + pad(i, 6), seed: (s) => (s >>> 0).toString(16).toUpperCase().padStart(8, '0'),
};

export function pageSpec(world, idx) {
  const s = mix2(world ^ 0x70616765, idx), r = (k) => mix(s, k);
  const big = r(9) % 100 < 6;
  const cap = big ? 2500 + r(1) % 17500 : 80 + r(1) % 2400;
  let w = r(2) % 100, mode = MODE_KEYS[0];
  for (const k of MODE_KEYS) { if (w < MODES[k].weight) { mode = k; break; } w -= MODES[k].weight; }
  return { idx, seed: s, cap, mode, cols: 36 + r(3) % 50, lines: 14 + r(4) % 40 };
}
export function bookSpec(world, idx) {
  const s = mix2(world ^ 0x626f6f6b, idx), r = (k) => mix(s, k);
  const pages = r(5) % 100 < 6 ? 25 + r(1) % 375 : 1 + r(1) % 20;
  const chapters = 1 + r(2) % Math.min(pages, 8);
  return { idx, seed: s, pages, chapters, title: titleFor(s) };
}
export function chapterOf(spec, pageNo) { return 1 + Math.floor(pageNo * spec.chapters / spec.pages); }
function titleFor(s) {
  const n = 2 + mix(s, 11) % 5, words = [];
  for (let w = 0; w < n; w++) {
    const len = 2 + mix(s, 20 + w) % 8; let t = '';
    for (let i = 0; i < len; i++) t += 'abcdefghijklmnopqrstuvwxyz'[mix(s, 100 + w * 16 + i) % 26];
    words.push(t[0].toUpperCase() + t.slice(1));
  }
  return words.join(' ');
}
export function boardSpec(world, idx) {
  const s = mix2(world ^ 0x626f6172, idx);
  const w = 8 + mix(s, 1) % 57, h = 8 + mix(s, 2) % 57;
  return { idx, seed: s, w, h, cap: w * h };
}
export function pixelAt(spec, seq) {
  const v = mix2(spec.seed, seq), v2 = mix(v, 1), v3 = mix(v, 2), v4 = mix(v, 3);
  return { x: v % spec.w, y: v2 % spec.h, r: v3 & 255, g: (v3 >>> 8) & 255, b: (v3 >>> 16) & 255, a: 64 + (v4 % 192) };
}
export function paintBoard(spec, startSeq, upto) { // upto = number of events applied
  const buf = new Uint8ClampedArray(spec.w * spec.h * 4);
  for (let i = 0; i < upto; i++) { const p = pixelAt(spec, startSeq + i), o = (p.y * spec.w + p.x) * 4; buf[o] = p.r; buf[o + 1] = p.g; buf[o + 2] = p.b; buf[o + 3] = p.a; }
  return buf;
}

export const now = () => performance.timeOrigin + performance.now();

export async function sha256(input) {
  const data = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const d = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export const hashBoard = (w, h, rgba) => { const hd = new TextEncoder().encode(`${w}x${h}:`); const u = new Uint8Array(hd.length + rgba.length); u.set(hd); u.set(rgba, hd.length); return sha256(u); };

// 2048-bit trigram signature per page: lets search skip pages that cannot contain the query.
export const SIG_BYTES = 256;
export function sigOf(text) {
  const s = new Uint8Array(SIG_BYTES);
  for (let i = 0; i + 3 <= text.length; i++) { const b = tri(text, i); s[b >> 3] |= 1 << (b & 7); }
  return s;
}
function tri(t, i) { return mix(mix(t.charCodeAt(i), t.charCodeAt(i + 1)), t.charCodeAt(i + 2)) & 2047; }
export function sigMayContain(sig, q) {
  for (let i = 0; i + 3 <= q.length; i++) { const b = tri(q, i); if (!(sig[b >> 3] & (1 << (b & 7)))) return false; }
  return true;
}

export class Engine {
  constructor(world, state) {
    this.world = world >>> 0;
    this.s = state || { head: 0, bookIdx: 0, bookStartPage: 0, pageIdx: 0, pageStart: 0, boardIdx: 0, boardStart: 0, lastT: 0, page: { t0: null, activeMs: 0, idleMs: 0 }, board: { t0: null, activeMs: 0, idleMs: 0 } };
    this.pending = { ticks: [], pages: [], boards: [], books: [] };
    this.totals = { chars: 0, pixels: 0 };
    this._load();
  }
  _load() {
    const s = this.s;
    this.book = bookSpec(this.world, s.bookIdx);
    this.pg = pageSpec(this.world, s.pageIdx);
    this.bd = boardSpec(this.world, s.boardIdx);
    this.chars = [];
    for (let n = s.pageStart; n < s.head; n++) this.chars.push(charAt(this.pg.mode, this.pg.seed, n));
    this.px = paintBoard(this.bd, s.boardStart, s.head - s.boardStart);
    if (s.head === 0) this._announceBook();
  }
  _announceBook() { this.pending.books.push({ ...this.bookRecord(), created: now() }); }
  bookRecord() { const b = this.book; return { id: ids.book(b.idx), idx: b.idx, seed: b.seed, pages: b.pages, chapters: b.chapters, title: b.title, firstPage: this.s.bookStartPage, engine: ENGINE }; }
  get pageNo() { return this.s.pageIdx - this.s.bookStartPage + 1; }
  tick(count) {
    const s = this.s, t0 = now(), p0 = performance.now();
    if (s.lastT && t0 - s.lastT > 1000) { const gap = t0 - s.lastT; if (s.page.t0 != null) s.page.idleMs += gap; if (s.board.t0 != null) s.board.idleMs += gap; }
    const startSeq = s.head; let inPage = 0, inBoard = 0;
    let done = 0, since = 0;
    const flushShare = (ms) => { const d = ms - done; done = ms; if (since) { s.page.activeMs += d * inPage / since; s.board.activeMs += d * inBoard / since; } inPage = 0; inBoard = 0; since = 0; };
    const events = [];
    for (let i = 0; i < count; i++) {
      const seq = s.head;
      if (s.page.t0 == null) s.page.t0 = t0;
      if (s.board.t0 == null) s.board.t0 = t0;
      this.chars.push(charAt(this.pg.mode, this.pg.seed, seq)); inPage++; since++;
      const p = pixelAt(this.bd, seq), o = (p.y * this.bd.w + p.x) * 4;
      this.px[o] = p.r; this.px[o + 1] = p.g; this.px[o + 2] = p.b; this.px[o + 3] = p.a; inBoard++;
      this.totals.chars++; this.totals.pixels++;
      s.head++;
      if (events.length < 20 || i >= count - 20) events.push(seq);
      if (this.chars.length >= this.pg.cap) { this._finishPage(t0, p0, flushShare); }
      if (s.head - s.boardStart >= this.bd.cap) { this._finishBoard(t0, p0, flushShare); }
    }
    const compute = performance.now() - p0;
    flushShare(compute);
    s.lastT = t0;
    this.pending.ticks.push([startSeq, count, t0, +compute.toFixed(4)]);
    return { startSeq, count, t: t0, compute };
  }
  _finishPage(t, p0, flushShare) {
    const s = this.s, pg = this.pg;
    flushShare(performance.now() - p0);
    const rec = {
      id: ids.page(pg.idx), idx: pg.idx, bookIdx: s.bookIdx, bookId: ids.book(s.bookIdx), pageNo: this.pageNo,
      chapter: chapterOf(this.book, this.pageNo - 1), startSeq: s.pageStart, endSeq: s.head - 1, count: this.chars.length,
      seed: pg.seed, seedHex: ids.seed(pg.seed), mode: pg.mode, text: this.chars.join(''),
      t0: s.page.t0, t1: t, activeMs: s.page.activeMs, idleMs: s.page.idleMs, engine: ENGINE,
    };
    this.pending.pages.push(rec);
    // advance
    s.pageIdx++; s.pageStart = s.head;
    if (this.pageNo > this.book.pages) { s.bookIdx++; s.bookStartPage = s.pageIdx; this.book = bookSpec(this.world, s.bookIdx); this._announceBook(); }
    this.pg = pageSpec(this.world, s.pageIdx); this.chars = []; s.page = { t0: null, activeMs: 0, idleMs: 0 };
    this._lastRec = rec;
  }
  _finishBoard(t, p0, flushShare) {
    const s = this.s, b = this.bd;
    this.pending.boards.push({
      id: ids.board(b.idx), idx: b.idx, seed: b.seed, seedHex: ids.seed(b.seed), w: b.w, h: b.h, startSeq: s.boardStart, endSeq: s.head - 1, count: b.cap,
      rgba: new Uint8Array(this.px), t0: s.board.t0, t1: t, activeMs: s.board.activeMs, idleMs: s.board.idleMs, engine: ENGINE,
    });
    s.boardIdx++; s.boardStart = s.head; this.bd = boardSpec(this.world, s.boardIdx);
    this.px = new Uint8ClampedArray(this.bd.w * this.bd.h * 4); s.board = { t0: null, activeMs: 0, idleMs: 0 };
  }
  drain() { const p = this.pending; this.pending = { ticks: [], pages: [], boards: [], books: [] }; return p; }
}

// ---- ledger -------------------------------------------------------------
export async function makeLedgerEntry(n, prev, world, p) {
  const seqStart = p.ticks[0][0], last = p.ticks[p.ticks.length - 1], seqEnd = last[0] + last[1] - 1;
  const body = { n, prev, world, seqStart, seqEnd, ticks: p.ticks, engine: ENGINE, status: 'complete' };
  return { ...body, hash: await sha256(JSON.stringify(body)) };
}
export async function verifyLedger(entries) { // entries sorted by n
  let prev = 'GENESIS';
  for (const e of entries) {
    const { hash, ...body } = e;
    if (body.prev !== prev) return { ok: false, at: e.n, why: 'prev-hash link broken' };
    if ((await sha256(JSON.stringify(body))) !== hash) return { ok: false, at: e.n, why: 'entry hash mismatch' };
    prev = hash;
  }
  return { ok: true, checked: entries.length };
}
export function tickTimes(entries, extraTicks, from, to) { // -> sorted ticks overlapping [from,to]
  const out = [];
  for (const e of entries) for (const t of e.ticks) if (t[0] + t[1] - 1 >= from && t[0] <= to) out.push(t);
  for (const t of extraTicks || []) if (t[0] + t[1] - 1 >= from && t[0] <= to) out.push(t);
  return out.sort((a, b) => a[0] - b[0]);
}
export function eventTime(ticks, seq) {
  let lo = 0, hi = ticks.length - 1;
  while (lo <= hi) { const m = (lo + hi) >> 1, t = ticks[m]; if (seq < t[0]) hi = m - 1; else if (seq >= t[0] + t[1]) lo = m + 1; else return t[2]; }
  return null;
}

// ---- possibility maths (BigInt) ----------------------------------------
export function possibility(query, rateEps) {
  const out = [];
  for (const mode of ['babel', 'wordish', 'alnum', 'ascii']) {
    const chars = new Set(MODES[mode].alphabet || WORDISH);
    if (![...query].every((c) => chars.has(c))) continue;
    const K = BigInt(alphabetSize(mode)), L = BigInt(query.length);
    out.push({ mode, K: Number(K), L: query.length, space: K ** L, seconds: Number(K ** L) / rateEps });
  }
  return out;
}
export function sci(big) {
  const s = big.toString(); if (s.length <= 12) return Number(s).toLocaleString();
  return `${s[0]}.${s.slice(1, 4)} × 10^${s.length - 1}`;
}
export function humanTime(sec) {
  if (!isFinite(sec)) return '> 10^308 seconds';
  if (sec < 1) return '< 1 second'; const u = [['years', 31557600], ['days', 86400], ['hours', 3600], ['minutes', 60], ['seconds', 1]];
  for (const [n, d] of u) if (sec >= d) { const v = sec / d; return (v >= 1e6 ? v.toExponential(2) : v.toLocaleString(undefined, { maximumFractionDigits: 1 })) + ' ' + n; }
}
