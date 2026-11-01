import * as C from './core.js';
import { openStore, floorRecord } from './store.js';

const $ = (s, r = document) => r.querySelector(s);
const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, ''); else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
};
const fmt = (n) => Number(n).toLocaleString('en-US');
const pad18 = (n) => String(n).padStart(18, '0');
const dur = (ms) => ms == null ? '—' : ms < 1 ? (ms * 1000).toFixed(1) + ' µs' : ms < 1000 ? ms.toFixed(2) + ' ms' : ms < 60000 ? (ms / 1000).toFixed(3) + ' s' : (ms / 60000).toFixed(2) + ' min';
const stamp = (t) => t ? new Date(t).toISOString().replace('T', ' ').replace('Z', '') + ' UTC' : '—';
const toast = (m) => { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 1600); };
const settings = { rate: 250000, anim: 'slide', fs: 19, theme: 'light', running: true, ...JSON.parse((() => { try { return localStorage.getItem('babel-settings') || '{}'; } catch { return '{}'; } })()) };
const saveSettings = () => { try { localStorage.setItem('babel-settings', JSON.stringify(settings)); } catch {} };
if (!settings.v) { settings.v = 2; settings.rate = 250000; settings.theme = 'light'; try { localStorage.setItem('babel-settings', JSON.stringify(settings)); } catch {} }
if (matchMedia('(prefers-reduced-motion: reduce)').matches && !localStorage.getItem('babel-settings')) settings.anim = 'none';
const applyTheme = () => { if (settings.theme === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.dataset.theme = settings.theme; };
applyTheme();

const A = { store: null, eng: null, world: 0, n: 0, prev: 'GENESIS', inflight: [], sigs: new Map(), sess: 0, activeMs: 0, frameSubs: new Set(), rateSamples: [], measured: 0, busy: false, lastPersistErr: null };

// ---------------------------------------------------------------- boot
async function boot() {
  A.store = await openStore();
  const hy = (b) => (b && !b.rgba ? { ...b, rgba: new Uint8Array(C.paintBoard(C.boardSpec(A.world, b.idx), b.startSeq, b.count)) } : b);
  for (const m of ['get', 'all', 'last', 'byIndex']) { const f = A.store[m]; A.store[m] = async (st, ...r) => { const out = await f(st, ...r); if (st !== 'boards') return out; return Array.isArray(out) ? out.map(hy) : hy(out); }; }
  let w = await A.store.get('meta', 'world');
  if (!w) { w = { k: 'world', v: crypto.getRandomValues(new Uint32Array(1))[0] }; await A.store.put('meta', w); }
  A.world = w.v;
  const st = await A.store.get('meta', 'state');
  const led = await A.store.last('ledger', 1);
  if (led[0]) { A.n = led[0].n + 1; A.prev = led[0].hash; }
  A.eng = new C.Engine(A.world, st ? st.v.s : null);
  if (st) { A.activeMs = st.v.activeMs || 0; A.eng.totals = st.v.totals || A.eng.totals; }
  for (const s of await A.store.all('sigs')) A.sigs.set(s.idx, s.sig);
  A.eng.drain(); // books announced on restore are already persisted
  if (!st) A.eng.pending.books.push({ ...A.eng.bookRecord(), created: C.now() });
  buildNav(); route(); startLoop(); if (settings.agents) agentConnect();
  setInterval(persist, 1000);
  setInterval(async () => { try { const e = await navigator.storage.estimate(); const cap = Math.min((e.quota || 1e9) * 0.8, (settings.capMB || 500) * 1048576); if (settings.running && e.usage > cap) { settings.running = false; saveSettings(); toast('Library full — generation paused'); } } catch {} }, 4000);
  document.addEventListener('visibilitychange', () => { if (document.hidden) persist(); });
  addEventListener('pagehide', persist);
}
async function persist() {
  if (A.busy || !A.eng) return; const p0 = A.eng.pending; if (!p0.ticks.length && !p0.books.length) return;
  A.busy = true;
  try {
    const snap = structuredClone(A.eng.s), totals = { ...A.eng.totals }, activeMs = A.activeMs;
    const p = A.eng.drain(); A.inflight = p.ticks; const writes = [];
    if (p.ticks.length) { const e = await C.makeLedgerEntry(A.n, A.prev, A.world, p); writes.push(['ledger', e]); A.n++; A.prev = e.hash; }
    for (const pg of p.pages) { pg.hash = await C.sha256(pg.text); const sig = C.sigOf(pg.text); writes.push(['pages', pg], ['sigs', { idx: pg.idx, sig }]); A.sigs.set(pg.idx, sig); }
    for (const b of p.boards) { b.hash = await C.hashBoard(b.w, b.h, b.rgba); const { rgba, ...slim } = b; writes.push(['boards', slim]); }
    for (const b of p.books) writes.push(['books', b]);
    writes.push(['meta', { k: 'state', v: { s: snap, totals, activeMs } }]);
    await A.store.commit(writes); A.inflight = [];
  } catch (e) { A.lastPersistErr = e; console.error('persist failed', e); toast('Archive write failed: ' + e.message); }
  A.busy = false;
}

// ---------------------------------------------------------------- generation loop (never blocks UI: ≤ ~6 ms per slice)
let lastLoop = 0, carry = 0;
function startLoop() {
  lastLoop = performance.now();
  const loop = () => {
    const t = performance.now(), dt = Math.min(t - lastLoop, 250); lastLoop = t;
    if (settings.running) {
      const want = settings.rate === 0 ? 1e9 : (carry += dt * settings.rate / 1000);
      let todo = settings.rate === 0 ? 1e9 : Math.floor(carry); if (settings.rate) carry -= todo;
      const t0 = performance.now(); let made = 0;
      while (todo > 0 && performance.now() - t0 < 6) { const c = Math.min(todo, 512); const r = A.eng.tick(c); A.activeMs += r.compute; todo -= c; made += c; }
      if (todo > 0 && settings.rate) carry = 0; // cannot keep up: drop backlog rather than fake timing
      A.measured += made;
      if (settings.stopAt && A.eng.s.head >= settings.stopAt) { settings.stopAt = null; settings.rate = A.prevRate || 500; settings.running = true; saveSettings(); toast('Target amount generated'); A.onTarget?.(); }
    }
    const now = performance.now(); if (now - (A.lastSample || 0) > 500) { const el = (now - (A.lastSample || now)) / 1000 || .5; A.rateSamples.push(A.measured / (A.lastSample ? el : .5)); if (A.rateSamples.length > 240) A.rateSamples.shift(); A.measured = 0; A.lastSample = now; }
    A.frameSubs.forEach((f) => f());
    setTimeout(loop, 8);
  };
  loop();
  const nc = $('#navcount'), ns = $('#navstate');
  setInterval(() => { nc.textContent = pad18(A.eng.s.head); ns.innerHTML = ''; ns.append(h('span', { class: 'dot' + (settings.running ? ' live' : '') }), settings.running ? 'generating' : 'paused'); }, 200);
}
const curRate = () => A.rateSamples.length ? A.rateSamples[A.rateSamples.length - 1] : 0;
const sub = (f) => { A.frameSubs.add(f); cleanup.push(() => A.frameSubs.delete(f)); };

// ---------------------------------------------------------------- nav & routing
const ICON = {
  library: 'M4 19V5a2 2 0 0 1 2-2h12v16H6a2 2 0 0 0-2 2zm2 0h12M8 7h6', canvas: 'M4 4h16v16H4zM4 12h16M12 4v16', archive: 'M3 5h18v4H3zM5 9v10h14V9M10 13h4',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5', clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2', media: 'M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6',
  coll: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', stats: 'M4 20V10M10 20V4M16 20v-8M22 20H2', origin: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5', home: 'M3 11l9-8 9 8M5 10v10h14V10',
};
const NAV = [['#/', 'home', 'Home'], ['#/library', 'library', 'The Library'], ['#/canvas', 'canvas', 'The Canvas'], ['#/archive', 'archive', 'The Archive'], ['#/search', 'search', 'The Oracle'], ['#/clock', 'clock', 'Atom Clock'], ['#/media', 'media', 'Media'], ['#/collections', 'coll', 'Collections'], ['#/stats', 'stats', 'Statistics'], ['#/origin', 'origin', 'The Origin'], ['#/more', 'home', 'More']];
function buildNav() {
  const nl = $('#navlinks'); nl.innerHTML = '';
  for (const [href, ic, label] of NAV) { const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 24 24'); const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', ICON[ic]); svg.append(p); nl.append(h('a', { href, 'data-h': href, class: ['#/', '#/library', '#/canvas', '#/search', '#/more'].includes(href) ? 'core' + (href === '#/more' ? ' morelink' : '') : 'extra' }, svg, h('span', {}, label))); }
  $('#inspclose').onclick = () => { A.sheetOpen = false; $('#app').classList.add('noinsp'); };
  $('#detailsbtn').onclick = () => { A.sheetOpen = !A.sheetOpen; $('#app').classList.toggle('noinsp', !A.sheetOpen); };
}
let cleanup = [];
const small = () => matchMedia('(max-width:980px)').matches;
const setInsp = (...nodes) => { const b = $('#inspbody'); b.replaceChildren(...nodes.flat().filter(Boolean)); if (small()) { $('#detailsbtn').hidden = false; if (!A.sheetOpen) $('#app').classList.add('noinsp'); } else $('#app').classList.remove('noinsp'); };
const hideInsp = () => { A.sheetOpen = false; $('#app').classList.add('noinsp'); $('#inspbody').replaceChildren(); $('#detailsbtn').hidden = true; };
const kv = (k, v, cls) => h('div', { class: 'kv' }, h('div', { class: 'k' }, k), h('div', { class: 'v ' + (cls || '') }, v));
const crumbs = (...parts) => { const c = $('#crumbs'); c.replaceChildren(...parts.flatMap((p, i) => [i ? h('i', {}, '/') : null, Array.isArray(p) ? h('a', { href: p[1] }, p[0]) : p]).filter((x) => x != null)); };
const _unused = (...parts) => { const c = $('#crumbs'); c.replaceChildren(...parts.flatMap((p, i) => [i ? h('i', {}, '/') : null, Array.isArray(p) ? h('a', { href: p[1] }, p[0]) : p])); };

async function route() {
  cleanup.forEach((f) => f()); cleanup = [];
  const [path, qs] = (location.hash.slice(1) || '/').split('?'); const q = new URLSearchParams(qs || ''); const seg = path.split('/').filter(Boolean);
  document.querySelectorAll('#navlinks a').forEach((a) => a.classList.toggle('on', a.dataset.h === '#/' + (seg[0] || '') || (seg[0] === 'page' || seg[0] === 'book') && a.dataset.h === '#/library' || (seg[0] === 'board' || seg[0] === 'atlas') && a.dataset.h === '#/canvas' || seg[0] === 'event' && a.dataset.h === '#/archive' || seg[0] === 'replay' && a.dataset.h === '#/library'));
  const v = $('#view'); v.replaceChildren(); $('#center').scrollTop = 0;
  try {
    const r = { '': vHome, library: vLibrary, book: vBook, page: vPage, more: vMore, canvas: vCanvas, board: vBoard, atlas: vAtlas, archive: vArchive, event: vEvent, search: vSearch, clock: vClock, media: vMedia, collections: vCollections, stats: vStats, origin: vOrigin, replay: vReplay }[seg[0] || ''];
    if (!r) throw new Error('Unknown address'); hideInsp(); await r(v, seg.slice(1), q);
  } catch (e) { console.error(e); v.replaceChildren(h('div', { class: 'empty' }, 'This address could not be opened: ' + e.message)); }
}
addEventListener('hashchange', route);
addEventListener('keydown', (e) => {
  const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); location.hash = '#/search'; setTimeout(() => $('#q')?.focus(), 30); }
  else if (e.key === 'Escape') { if (typing) document.activeElement.blur(); else hideInsp(); }
  else if (!typing) A.keyHandlers?.forEach((f) => f(e));
});

// ---------------------------------------------------------------- shared bits
let $$bm = null;
const hue = (seed) => seed % 360;
const coverStyle = (seed) => `background:linear-gradient(160deg,hsl(${hue(seed)} 28% 22%),hsl(${(hue(seed) + 24) % 360} 30% 14%))`;
function cover(b, sizeCls) { return h('a', { href: '#/book/' + b.idx, class: 'cover', style: coverStyle(b.seed), title: b.title }, h('small', {}, b.id), h('b', {}, b.title), h('small', {}, `${b.pages} PAGES · ${b.chapters} CH`)); }
function spine(b) { return h('a', { href: '#/book/' + b.idx, class: 'spine', style: coverStyle(b.seed), title: b.title + ' ' + b.id }, b.title.slice(0, 22), h('small', {}, b.id.slice(-5))); }
const timesOf = (r) => ({ wall: r.t1 - r.t0, run: r.t1 - r.t0 - (r.idleMs || 0) });
async function ticksFor(from, to) {
  const led = await A.store.ledgerFor(from, to);
  const ticks = C.tickTimes(led, [...A.inflight, ...A.eng.pending.ticks], from, to);
  let covered = 0; for (const t of ticks) covered += Math.min(t[0] + t[1] - 1, to) - Math.max(t[0], from) + 1;
  return { ticks, complete: covered === to - from + 1, covered };
}
function genInspector(kind, r) {
  const t = timesOf(r);
  return [kv('Address', r.id), r.bookId && kv('Book', r.bookId), r.chapter && kv('Chapter', C.ids.chapter(r.chapter)), kv('Seed', r.seedHex), kv(kind === 'page' ? 'Mode' : 'Size', kind === 'page' ? C.MODES[r.mode].label : `${r.w} × ${r.h}`),
    kv('First event', C.ids.event(r.startSeq)), kv('Last event', C.ids.event(r.endSeq)), kv('Events', fmt(r.count)), kv('Wall-clock', dur(t.wall)), kv('− idle gaps', dur(r.idleMs || 0)), kv('Running time', dur(t.run)), kv('Active compute', dur(r.activeMs)),
    kv('Started', stamp(r.t0)), kv('Finished', stamp(r.t1)), kv('Content hash', r.hash ? r.hash.slice(0, 32) + '…' : 'pending'), kv('Engine', r.engine),
    h('p', { class: 'mute', style: 'font-size:12px;margin-top:12px' }, 'Wall-clock runs from the tick holding the first event to the tick holding the last. Event timestamps are tick-resolution (one tick = a batch of events). Replay time is never original time.')];
}
function bookmarkBtn(type, id, href, label) {
  return $$bm = h('button', { class: 'btn', onclick: async () => { await A.store.put('user', { id: 'bm:' + id, kind: 'bookmark', name: label, parent: null, target: { type, id, href }, created: Date.now() }); toast('Bookmarked ' + id); } }, '☆ Bookmark');
}
function highlighted(text, a, b) { // a..b inclusive offsets
  if (a == null) return [text]; return [text.slice(0, a), h('mark', { id: 'hl' }, text.slice(a, b + 1)), text.slice(b + 1)];
}

async function vMore(v) {
  crumbs('More'); v.append(h('h2', {}, 'More'));
  for (const [href, , label] of NAV.filter((n) => !['#/more', '#/'].includes(n[0]))) v.append(h('a', { href, class: 'row morerow', style: 'font-size:17px;padding:14px 0' }, label, h('span', { class: 'mute' }, '›')));
}
// ---------------------------------------------------------------- HOME
async function vHome(v) {
  crumbs('The Book of Babel');
  const cnt = h('div', { class: 'atom' }), state = h('div', { class: 'lbl', style: 'margin-top:6px' });
  const live = h('div', { class: 'live-txt' });
  v.append(h('div', { class: 'lbl' }, 'An archive of everything that could be generated'), h('h1', { style: 'margin:8px 0 6px' }, 'The Book of Babel'), h('div', { class: 'sub' }, 'An archive of everything that could be generated.'),
    h('div', { style: 'margin:30px 0 4px' }, h('div', { class: 'lbl' }, 'Atom Second'), cnt, state), h('div', { class: 'toolbar big' }, h('a', { class: 'btn pri', href: '#/library' }, 'Read'), h('a', { class: 'btn', href: '#/search' }, 'Search'), h('a', { class: 'btn', href: '#/canvas' }, 'Canvas')), h('div', { class: 'adv' }, live), h('hr', { class: 'adv' }));
  sub(() => { cnt.textContent = pad18(A.eng.s.head); state.replaceChildren(h('span', { class: 'dot' + (settings.running ? ' live' : '') }), settings.running ? `generating · ${fmt(Math.round(curRate()))} events / s` : 'generation paused'); live.textContent = A.eng.chars.slice(-260).join(''); });
  const books = (await A.store.last('books', 14)).reverse();
  v.append(h('div', { class: 'lbl adv', style: 'margin-bottom:8px' }, 'Recently shelved'), h('div', { class: 'spines adv' }, books.map(spine)));
  const pages = await A.store.last('pages', 8);
  v.append(h('div', { class: 'lbl', style: 'margin:22px 0 4px' }, 'Latest pages written'), ...pages.map((p) => h('a', { href: '#/page/' + p.idx, class: 'row', style: 'grid-template-columns:130px 1fr 110px' }, h('span', { class: 'mono' }, p.id), h('span', { class: 'snip mute', style: 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis' }, p.text.slice(0, 90)), h('span', { class: 'mono mute' }, dur(timesOf(p).wall)))));
  if (!pages.length) v.append(h('div', { class: 'empty' }, 'The first page is still being written. It will appear here when complete.'));
  v.append(h('p', { class: 'mute', style: 'max-width:60ch;margin-top:30px;font-size:13px' }, 'Every character and pixel here was produced by a recorded generation event. Generation runs only while this app is open. Nothing is invented: if a thing is not in the archive, the Oracle will say so.'));
}

// ---------------------------------------------------------------- LIBRARY
async function vLibrary(v) {
  crumbs('Library');
  const total = await A.store.count('books');
  v.append(h('h1', {}, 'The Library'), h('div', { class: 'sub' }, `${fmt(total)} books shelved · the current book is still being written`));
  v.append(h('div', { class: 'toolbar' }, h('button', { class: 'btn', onclick: async () => { const n = await A.store.count('pages'); if (!n) return toast('No finished pages yet'); const i = Math.floor(Math.random() * n); location.hash = '#/page/' + i; } }, 'Random page'), h('a', { class: 'btn', href: '#/page/' + A.eng.s.pageIdx }, 'Watch the live page')));
  const shelf = h('div', { class: 'shelf' }); v.append(shelf);
  const books = await A.store.last('books', 60);
  for (const b of books) shelf.append(h('div', {}, cover(b), h('div', { class: 'mono mute', style: 'font-size:11px;margin-top:6px' }, `${b.id}`)));
  if (total > 60) v.append(h('p', { class: 'mute' }, `Showing the 60 most recent of ${fmt(total)}. Use the Oracle or a Book ID to reach older ones.`));
}
async function vBook(v, [idx]) {
  idx = +idx; const b = await A.store.get('books', idx); if (!b) throw new Error('Book not found in archive');
  crumbs(['Library', '#/library'], b.id);
  const have = await A.store.range('pages', b.firstPage, b.firstPage + b.pages - 1, 500);
  v.append(h('div', { style: 'display:flex;gap:28px;flex-wrap:wrap' }, cover(b), h('div', { style: 'flex:1;min-width:240px' }, h('div', { class: 'lbl' }, b.id), h('h1', {}, b.title), h('div', { class: 'sub' }, `${b.pages} pages · ${b.chapters} chapters`),
    h('div', { class: 'toolbar' }, h('a', { class: 'btn pri', href: '#/page/' + b.firstPage }, 'Open book'), bookmarkBtn('book', b.id, '#/book/' + b.idx, b.title), h('button', { class: 'btn', onclick: () => saveText(b.id + '.txt', have.map(pageBlock).join('')) }, '⭳ Download book (.txt)')), h('p', { class: 'mute' }, `${have.length} of ${b.pages} pages written so far.`))));
  setInsp(kv('Book', b.id), kv('Seed', C.ids.seed(b.seed)), kv('Pages planned', b.pages), kv('Chapters', b.chapters), kv('First page', C.ids.page(b.firstPage)), kv('Engine', b.engine));
  v.append(h('hr'), h('div', { class: 'lbl' }, 'Contents'));
  for (let c = 1; c <= b.chapters; c++) {
    const ps = have.filter((p) => p.chapter === c); v.append(h('h3', { style: 'margin-top:16px' }, `Chapter ${c}`));
    for (const p of ps) v.append(h('a', { href: '#/page/' + p.idx, class: 'row', style: 'grid-template-columns:130px 70px 1fr' }, h('span', { class: 'mono' }, p.id), h('span', { class: 'mute' }, 'p. ' + p.pageNo), h('span', { class: 'snip mute', style: 'overflow:hidden;white-space:nowrap;text-overflow:ellipsis' }, p.text.slice(0, 70))));
  }
}

// ---------------------------------------------------------------- PAGE READER
async function vPage(v, [idx], q) {
  idx = +idx; const isLive = idx === A.eng.s.pageIdx; let p = isLive ? null : await A.store.get('pages', idx);
  if (!isLive && !p) throw new Error('That page has not been generated (yet). Pages exist only once written.');
  const spec = C.pageSpec(A.world, idx);
  const bookIdx = p ? p.bookIdx : A.eng.s.bookIdx; const book = await A.store.get('books', bookIdx) || A.eng.bookRecord();
  const pageNo = p ? p.pageNo : A.eng.pageNo; const chapter = C.chapterOf(book, pageNo - 1);
  crumbs(['Library', '#/library'], [book.title, '#/book/' + bookIdx], 'Chapter ' + chapter, 'Page ' + pageNo);
  let hl = q.get('hl'); hl = hl ? hl.split('-').map(Number) : null;
  const txt = h('div', { class: 'txt', style: `--fs:${settings.fs}px` }), paper = h('div', { class: 'paper' });
  const dir = A.navDir || 'r'; A.navDir = null;
  if (settings.anim !== 'none') paper.classList.add(`anim-${settings.anim === 'turn' ? 'turn' : 'slide'}-${dir}`);
  const go = (i) => { A.navDir = i > idx ? 'r' : 'l'; location.hash = '#/page/' + i; };
  const first = book.firstPage, last = book.firstPage + book.pages - 1;
  paper.append(h('div', { class: 'hd' }, h('span', {}, book.title), h('span', {}, `CHAPTER ${chapter}`)), txt);
  paper.append(h('div', { class: 'foot' }, h('span', {}, `${book.id} · ${C.ids.chapter(chapter)} · ${C.ids.page(idx)}`), h('span', {}, `— ${pageNo} / ${book.pages} —`), h('span', {}, 'SEED ' + C.ids.seed(spec.seed))));
  paper.append(h('div', { class: 'zone l', title: 'Previous page', onclick: () => idx > first && go(idx - 1) }), h('div', { class: 'zone r', title: 'Next page', onclick: () => idx < last && go(idx + 1) }));
  let sx = null; paper.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; }, { passive: true }); paper.addEventListener('touchend', (e) => { if (sx == null) return; const dx = e.changedTouches[0].clientX - sx; sx = null; if (dx < -50 && idx < last) go(idx + 1); else if (dx > 50 && idx > first) go(idx - 1); });
  const prevB = h('button', { class: 'btn', disabled: idx <= first, onclick: () => go(idx - 1) }, '← Prev'), nextB = h('button', { class: 'btn', disabled: idx >= last, onclick: () => go(idx + 1) }, 'Next →');
  const jump = h('input', { type: 'number', min: 1, max: book.pages, value: pageNo, style: 'width:76px', title: 'Jump to page in this book', onchange: (e) => go(first + Math.max(1, Math.min(book.pages, +e.target.value)) - 1) });
  const tb = h('div', { class: 'toolbar' }, prevB, nextB, h('span', { class: 'mute' }, 'page'), jump, bookmarkBtn('page', C.ids.page(idx), '#/page/' + idx, `${book.title} p.${pageNo}`),
    h('select', { class: 'adv', onchange: (e) => { settings.anim = e.target.value; saveSettings(); } }, ['none', 'slide', 'turn'].map((o) => h('option', { value: o, selected: settings.anim === o }, o === 'none' ? 'No animation' : o === 'slide' ? 'Slide' : 'Page turn'))),
    h('button', { class: 'btn adv', onclick: () => { settings.fs = Math.max(13, settings.fs - 2); saveSettings(); route(); } }, 'A−'), h('button', { class: 'btn adv', onclick: () => { settings.fs = Math.min(32, settings.fs + 2); saveSettings(); route(); } }, 'A+'));
  const sb = h('input', { type: 'search', class: 'adv', placeholder: 'find in this page…', style: 'width:150px', oninput: (e) => { const s = e.target.value, t = (p ? p.text : A.eng.chars.join('')); const i = s ? t.indexOf(s) : -1; txt.replaceChildren(...(i < 0 ? [t] : highlighted(t, i, i + s.length - 1))); } });
  tb.append(sb);
  v.append(h('div', { class: 'reader' }, tb, paper));
  const renderInsp = () => {
    if (p) setInsp(h('div', { class: 'toolbar', style: 'margin-top:8px' }, h('a', { class: 'btn pri', href: '#/replay/page/' + idx }, '▶ Watch generation'), h('button', { class: 'btn', onclick: () => saveText(p.id + '.txt', pageBlock(p)) }, '⭳ Download page')), ...genInspector('page', p));
  };
  if (p) { txt.replaceChildren(...highlighted(p.text, hl?.[0], hl?.[1])); renderInsp(); if (hl) setTimeout(() => $('#hl')?.scrollIntoView({ block: 'center' }), 60); }
  else {
    paper.prepend(h('div', { class: 'pill brass', style: 'align-self:flex-start;margin-bottom:10px' }, 'being written now — not yet archived'));
    sub(() => { if (A.eng.s.pageIdx !== idx) { location.hash = '#/page/' + idx; return; } txt.textContent = A.eng.chars.join('') + '▌'; setInsp(kv('Address', C.ids.page(idx)), kv('Seed', C.ids.seed(spec.seed)), kv('Mode', C.MODES[spec.mode].label), kv('Character limit', fmt(spec.cap)), kv('Written', fmt(A.eng.chars.length)), kv('First event', C.ids.event(A.eng.s.pageStart))); });
  }
  A.keyHandlers = [(e) => { if (e.key === 'ArrowRight' && idx < last) go(idx + 1); else if (e.key === 'ArrowLeft' && idx > first) go(idx - 1); else if (e.key === 'b') $$bm?.click(); }];
  cleanup.push(() => { A.keyHandlers = null; });
}

// ---------------------------------------------------------------- REPLAY
async function vReplay(v, [kind, idx]) {
  idx = +idx; const isPage = kind === 'page'; const rec = await A.store.get(isPage ? 'pages' : 'boards', idx); if (!rec) throw new Error('Only archived items can be replayed.');
  crumbs(['Library', '#/library'], [rec.id, isPage ? '#/page/' + idx : '#/board/' + idx], 'Generation replay');
  const spec = isPage ? C.pageSpec(A.world, idx) : C.boardSpec(A.world, idx);
  const { ticks, complete, covered } = await ticksFor(rec.startSeq, rec.endSeq);
  const N = rec.count, T0 = ticks.length ? ticks[0][2] : rec.t0;
  // virtual timeline: recorded tick times with idle gaps >1 s compressed to 250 ms
  const vt = []; let acc = 0, prevT = null; for (const t of ticks) { if (prevT != null) acc += Math.min(t[2] - prevT, t[2] - prevT > 1000 ? 250 : 1e9); vt.push(acc); prevT = t[2]; }
  const total = vt.length ? vt[vt.length - 1] : 0;
  // reproducibility check
  let regen = ''; if (isPage) for (let n = rec.startSeq; n <= rec.endSeq; n++) regen += C.charAt(spec.mode, spec.seed, n);
  const reproOK = isPage ? regen === rec.text : (await C.hashBoard(rec.w, rec.h, C.paintBoard(spec, rec.startSeq, N))) === rec.hash;
  let i = 0, playing = false, speed = 1, vtime = 0, last = 0;
  const out = h('div', {}), canvas = h('canvas'), status = h('div', { class: 'mono', style: 'margin:8px 0' }), scrub = h('input', { type: 'range', class: 'scrub', min: 0, max: N, value: 0, 'aria-label': 'Generation timeline' }), done = h('div');
  const view = isPage ? h('div', { class: 'paper', style: 'min-height:300px;width:100%' }, out) : h('div', { class: 'board-wrap chk', style: 'display:flex;justify-content:center;padding:12px' }, canvas);
  if (!isPage) { canvas.width = rec.w; canvas.height = rec.h; const sc = Math.max(1, Math.floor(Math.min(560 / rec.w, 440 / rec.h))); canvas.style.width = rec.w * sc + 'px'; canvas.style.height = rec.h * sc + 'px'; }
  const ctx = canvas.getContext('2d');
  const tickIdxOf = (seq) => { let lo = 0, hi = ticks.length - 1; while (lo <= hi) { const m = (lo + hi) >> 1; if (seq < ticks[m][0]) hi = m - 1; else if (seq >= ticks[m][0] + ticks[m][1]) lo = m + 1; else return m; } return -1; };
  const draw = () => {
    scrub.value = i;
    if (isPage) out.replaceChildren(h('div', { class: 'txt', style: `--fs:${settings.fs}px;white-space:pre-wrap;word-break:break-all;font:${settings.fs}px/1.55 var(--serif)` }, regen.slice(0, i) + (i < N ? '▌' : '')));
    else { const b = C.paintBoard(spec, rec.startSeq, i); ctx.putImageData(new ImageData(b, rec.w, rec.h), 0, 0); }
    const seq = rec.startSeq + Math.max(0, i - 1), ti = i ? tickIdxOf(seq) : -1;
    status.textContent = `event ${fmt(i)} / ${fmt(N)}   ·   ${i ? C.ids.event(seq) : '—'}   ·   recorded at ${ti >= 0 ? '+' + dur(ticks[ti][2] - T0) + ' from first event' : 'n/a'}   ·   replay speed ${speed === Infinity ? 'max' : speed + '×'}`;
    const evInfo = []; if (i) { if (isPage) evInfo.push(kv('Character', JSON.stringify(regen[i - 1]) + '  U+' + regen.charCodeAt(i - 1).toString(16).toUpperCase().padStart(4, '0'))); else { const px = C.pixelAt(spec, seq); evInfo.push(kv('Pixel', `(${px.x}, ${px.y}) rgba(${px.r},${px.g},${px.b},${px.a})`)); } evInfo.push(kv('Event', C.ids.event(seq)), kv('Tick', ti >= 0 ? `${ticks[ti][1]} events @ ${stamp(ticks[ti][2])}` : 'no ledger tick'), kv('Tick compute', ti >= 0 ? dur(ticks[ti][3]) : '—')); }
    setInsp(h('div', { class: 'lbl', style: 'margin-top:10px' }, 'Current event'), ...evInfo, h('div', { class: 'lbl', style: 'margin-top:16px' }, 'Original generation'), ...genInspector(kind, rec).slice(0, -1));
    done.replaceChildren(...(i >= N ? [h('div', { class: 'lbl ok', style: 'margin-top:12px' }, 'GENERATION COMPLETE'), h('div', { class: 'mono' }, `${fmt(N)} recorded events · original wall-clock ${dur(timesOf(rec).wall)} · running ${dur(timesOf(rec).run)} · final ${C.ids.event(rec.endSeq)}`)] : []));
  };
  const frame = (t) => {
    if (!playing) return; const dt = last ? t - last : 0; last = t;
    if (speed === Infinity) i = Math.min(N, i + Math.max(1, Math.ceil(N / 120)));
    else { vtime += dt * speed; let k = vt.findIndex((x) => x > vtime); if (k < 0) k = ticks.length; const tk = ticks[Math.max(0, k - 1)]; i = ticks.length ? Math.min(N, k === 0 ? 0 : tk[0] + tk[1] - rec.startSeq) : N; if (k >= ticks.length) i = N; }
    if (i >= N) { playing = false; pb.textContent = '▶ Play'; } draw(); if (playing) requestAnimationFrame(frame);
  };
  const setI = (n) => { i = Math.max(0, Math.min(N, n)); const ti = i ? tickIdxOf(rec.startSeq + i - 1) : -1; vtime = ti >= 0 ? vt[ti] : 0; draw(); };
  const pb = h('button', { class: 'btn pri', onclick: () => { if (i >= N) setI(0); playing = !playing; pb.textContent = playing ? '❚❚ Pause' : '▶ Play'; last = 0; if (playing) requestAnimationFrame(frame); } }, '▶ Play');
  scrub.oninput = () => setI(+scrub.value);
  const sp = [0.25, 0.5, 1, 2, 5, 10, 25, 50, 100, Infinity];
  const spBtns = sp.map((s) => h('button', { class: 'btn' + (s === 1 ? ' sel' : '') + ([1, 10, Infinity].includes(s) ? '' : ' adv'), onclick: (e) => { speed = s; spBtns.forEach((b) => b.classList.remove('sel')); e.target.classList.add('sel'); draw(); } }, s === Infinity ? 'max' : s + '×'));
  const custom = h('input', { class: 'adv', type: 'number', min: 0.01, step: 'any', placeholder: 'custom ×', style: 'width:90px', onchange: (e) => { if (+e.target.value > 0) { speed = +e.target.value; draw(); } } });
  v.append(h('div', { class: 'lbl' }, 'Generation replay'), h('h2', {}, rec.id),
    h('div', { style: 'margin:6px 0 12px;display:flex;gap:8px;flex-wrap:wrap' }, h('span', { class: 'pill ' + (reproOK ? 'ok' : 'warn') }, reproOK ? 'seed reproduces stored content exactly' : 'REPRODUCTION MISMATCH'), h('span', { class: 'pill ' + (complete ? 'ok' : 'warn') }, complete ? 'ledger timing complete' : `ledger timing incomplete: ${fmt(covered)} of ${fmt(N)} events have ticks`)),
    view, status, scrub,
    h('div', { class: 'toolbar' }, pb, h('button', { class: 'btn', onclick: () => setI(0) }, '⏮'), h('button', { class: 'btn', onclick: () => setI(i - 1) }, '◀ step'), h('button', { class: 'btn', onclick: () => setI(i + 1) }, 'step ▶'), h('button', { class: 'btn', onclick: () => setI(N) }, '⏭'), ...spBtns, custom), done,
    h('p', { class: 'mute', style: 'font-size:12px;max-width:70ch' }, 'Replay follows the recorded tick times from the ledger (idle gaps over 1 s are compressed to 0.25 s for viewing). Playback speed changes only what you watch; it never changes original timestamps or durations. Total replay length at 1× is ' + dur(total) + ' of recorded activity.'));
  A.keyHandlers = [(e) => { if (e.key === ' ') { e.preventDefault(); pb.click(); } else if (e.key === 'ArrowRight') setI(i + 1); else if (e.key === 'ArrowLeft') setI(i - 1); }];
  cleanup.push(() => { playing = false; A.keyHandlers = null; });
  draw();
}

// ---------------------------------------------------------------- CANVAS (board viewer) + ATLAS
function boardCanvas(spec, rgba, scale) {
  const c = h('canvas', { width: spec.w, height: spec.h }); c.style.width = spec.w * scale + 'px'; c.style.height = spec.h * scale + 'px';
  c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba), spec.w, spec.h), 0, 0); return c;
}
async function vCanvas(v) { location.replace('#/board/' + A.eng.s.boardIdx); }
async function vBoard(v, [idx]) {
  idx = +idx; const live = idx === A.eng.s.boardIdx; const rec = live ? null : await A.store.get('boards', idx);
  if (!live && !rec) throw new Error('That board has not been generated yet.');
  crumbs(['Canvas', '#/canvas'], live ? 'Board ' + C.ids.board(idx) + ' (live)' : C.ids.board(idx));
  const spec = C.boardSpec(A.world, idx); let zoom = 8, ox = 0, oy = 0;
  const wrap = h('div', { class: 'board-wrap chk', style: 'height:min(64vh,560px)' }), cv = h('canvas'), info = h('div', { class: 'mono mute', style: 'margin:8px 0;min-height:20px' });
  wrap.append(cv);
  const draw = () => {
    const W = wrap.clientWidth, H = wrap.clientHeight; if (cv.width !== W) { cv.width = W; cv.height = H; cv.style.width = '100%'; cv.style.height = '100%'; }
    const g = cv.getContext('2d'); g.imageSmoothingEnabled = false; g.clearRect(0, 0, W, H);
    const rgba = live ? A.eng.px : rec.rgba; const tmp = draw.tmp || (draw.tmp = document.createElement('canvas')); tmp.width = spec.w; tmp.height = spec.h;
    tmp.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba), spec.w, spec.h), 0, 0);
    g.drawImage(tmp, ox, oy, spec.w * zoom, spec.h * zoom); g.strokeStyle = '#A48753'; g.strokeRect(ox - .5, oy - .5, spec.w * zoom + 1, spec.h * zoom + 1);
    if (zoom >= 10) { g.strokeStyle = 'rgba(128,128,128,.25)'; g.beginPath(); for (let x = 0; x <= spec.w; x++) { g.moveTo(ox + x * zoom, oy); g.lineTo(ox + x * zoom, oy + spec.h * zoom); } for (let y = 0; y <= spec.h; y++) { g.moveTo(ox, oy + y * zoom); g.lineTo(ox + spec.w * zoom, oy + y * zoom); } g.stroke(); }
  };
  const fit = () => { zoom = Math.max(1, Math.floor(Math.min(wrap.clientWidth / spec.w, wrap.clientHeight / spec.h))); ox = (wrap.clientWidth - spec.w * zoom) / 2; oy = (wrap.clientHeight - spec.h * zoom) / 2; draw(); };
  const zoomAt = (f, cx, cy) => { const nz = Math.max(1, Math.min(60, zoom * f)); ox = cx - (cx - ox) * nz / zoom; oy = cy - (cy - oy) * nz / zoom; zoom = nz; draw(); };
  let drag = null, moved = false;
  wrap.onpointerdown = (e) => { drag = [e.clientX, e.clientY, ox, oy]; moved = false; wrap.setPointerCapture(e.pointerId); };
  wrap.onpointermove = (e) => { const r = wrap.getBoundingClientRect(); if (drag) { if (Math.abs(e.clientX - drag[0]) + Math.abs(e.clientY - drag[1]) > 3) moved = true; ox = drag[2] + e.clientX - drag[0]; oy = drag[3] + e.clientY - drag[1]; draw(); } const px = Math.floor((e.clientX - r.left - ox) / zoom), py = Math.floor((e.clientY - r.top - oy) / zoom); info.textContent = px >= 0 && py >= 0 && px < spec.w && py < spec.h ? `x ${px}  y ${py}  ·  zoom ${zoom.toFixed(1)}×` : `outside board · zoom ${zoom.toFixed(1)}×`; };
  wrap.onpointerup = (e) => { drag = null; if (moved) return; const r = wrap.getBoundingClientRect(); const px = Math.floor((e.clientX - r.left - ox) / zoom), py = Math.floor((e.clientY - r.top - oy) / zoom); if (px >= 0 && py >= 0 && px < spec.w && py < spec.h) inspectPixel(px, py); };
  wrap.ondblclick = (e) => { const r = wrap.getBoundingClientRect(); zoomAt(2, e.clientX - r.left, e.clientY - r.top); };
  wrap.onwheel = (e) => { e.preventDefault(); const r = wrap.getBoundingClientRect(); zoomAt(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.clientX - r.left, e.clientY - r.top); };
  const inspectPixel = (px, py) => {
    const end = live ? A.eng.s.head : rec.endSeq + 1; let seq = -1; for (let s = end - 1; s >= spec.cap * 0 + (live ? A.eng.s.boardStart : rec.startSeq); s--) { const p = C.pixelAt(spec, s); if (p.x === px && p.y === py) { seq = s; break; } }
    if (seq < 0) return setInsp(kv('Pixel', `(${px}, ${py})`), h('p', { class: 'mute' }, 'No event has touched this pixel yet.'));
    const p = C.pixelAt(spec, seq); const cnt = (() => { let n = 0; for (let s = live ? A.eng.s.boardStart : rec.startSeq; s < end; s++) { const q = C.pixelAt(spec, s); if (q.x === px && q.y === py) n++; } return n; })();
    setInsp(kv('Board', C.ids.board(idx)), kv('X / Y', `${px} / ${py}`), kv('Colour', h('span', {}, h('span', { style: `display:inline-block;width:11px;height:11px;margin-right:6px;background:rgba(${p.r},${p.g},${p.b},${p.a / 255});border:1px solid var(--line)` }), `rgba(${p.r},${p.g},${p.b},${(p.a / 255).toFixed(2)})`)), kv('Event', C.ids.event(seq)), kv('Placements here', cnt + (cnt > 1 ? ' (last one shown)' : '')), kv('Pixel ID', `${C.ids.board(idx)}:${px},${py}@${seq}`), live ? null : h('a', { class: 'btn', style: 'display:inline-block;margin-top:12px', href: '#/replay/board/' + idx }, '▶ Watch this board being generated'));
  };
  const nav = h('div', { class: 'toolbar' }, h('a', { class: 'btn', href: '#/board/' + Math.max(0, idx - 1) }, '← Board'), h('a', { class: 'btn', href: '#/board/' + (idx + 1) }, 'Board →'), h('a', { class: 'btn', href: '#/board/' + A.eng.s.boardIdx }, 'Live board'), h('a', { class: 'btn', href: '#/atlas' }, 'Atlas'),
    h('button', { class: 'btn', onclick: () => zoomAt(1.5, wrap.clientWidth / 2, wrap.clientHeight / 2) }, '＋'), h('button', { class: 'btn', onclick: () => zoomAt(1 / 1.5, wrap.clientWidth / 2, wrap.clientHeight / 2) }, '−'), h('button', { class: 'btn', onclick: fit }, 'Fit'),
    h('button', { class: 'btn', onclick: () => { const c = boardCanvas(spec, live ? A.eng.px : rec.rgba, 8); c.toBlob((b) => { const a = h('a', { href: URL.createObjectURL(b), download: C.ids.board(idx) + '.png' }); a.click(); }); } }, 'Export PNG'), bookmarkBtn('board', C.ids.board(idx), '#/board/' + idx, C.ids.board(idx)));
  v.append(h('div', { class: 'lbl' }, live ? 'Live board — being filled right now' : 'Archived board'), h('h2', {}, C.ids.board(idx) + `  ·  ${spec.w}×${spec.h}`), nav, wrap, info);
  requestAnimationFrame(fit);
  if (live) { sub(() => { if (A.eng.s.boardIdx !== idx) { location.hash = '#/board/' + idx; return; } draw(); setInsp(kv('Board', C.ids.board(idx)), kv('Seed', C.ids.seed(spec.seed)), kv('Size', `${spec.w} × ${spec.h}`), kv('Placed', fmt(A.eng.s.head - A.eng.s.boardStart) + ' / ' + fmt(spec.cap)), kv('First event', C.ids.event(A.eng.s.boardStart)), h('p', { class: 'mute', style: 'font-size:12px' }, 'Click a pixel to inspect it. When the board reaches capacity it is sealed and a new one begins.')); }); }
  else setInsp(h('div', { class: 'toolbar', style: 'margin-top:8px' }, h('a', { class: 'btn pri', href: '#/replay/board/' + idx }, '▶ Watch generation')), ...genInspector('board', rec));
}
async function vAtlas(v) {
  crumbs(['Canvas', '#/canvas'], 'Atlas');
  const COLS = 32; let zoom = 1, ox = 20, oy = 20; const cache = new Map(), loading = new Set();
  const wrap = h('div', { class: 'board-wrap', style: 'height:70vh' }), cv = h('canvas'); wrap.append(cv); cv.style.imageRendering = 'auto';
  v.append(h('h2', {}, 'The Atlas'), h('div', { class: 'sub' }, 'Shelves of 32 boards, running downward without end. Only the visible shelves are loaded.'), h('div', { class: 'toolbar mute' }, 'Drag to pan · wheel to zoom · click a board to open it'), wrap);
  const CELL = 72; const draw = () => {
    const W = wrap.clientWidth, H = wrap.clientHeight; cv.width = W; cv.height = H; cv.style.width = '100%'; cv.style.height = '100%'; const g = cv.getContext('2d'); g.imageSmoothingEnabled = false;
    const cs = CELL * zoom, cx0 = Math.max(0, Math.floor(-ox / cs)), cx1 = Math.min(COLS - 1, Math.floor((W - ox) / cs)), cy0 = Math.max(0, Math.floor(-oy / cs)), cy1 = Math.floor((H - oy) / cs), cur = A.eng.s.boardIdx;
    const style = getComputedStyle(document.documentElement); g.font = '9px IBM Plex Mono, monospace';
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
      const idx = cy * COLS + cx, x = ox + cx * cs, y = oy + cy * cs;
      if (idx < cur) { const e = cache.get(idx); if (e) { const sp = C.boardSpec(A.world, idx), s = Math.min((cs - 6) / sp.w, (cs - 6) / sp.h); g.drawImage(e, x + 3, y + 3, sp.w * s, sp.h * s); } else if (!loading.has(idx)) { loading.add(idx); A.store.get('boards', idx).then((r) => { if (r) { const sp = C.boardSpec(A.world, idx), c = document.createElement('canvas'); c.width = sp.w; c.height = sp.h; c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(r.rgba), sp.w, sp.h), 0, 0); cache.set(idx, c); if (cache.size > 600) cache.delete(cache.keys().next().value); } loading.delete(idx); draw(); }); } }
      else { g.setLineDash([3, 3]); g.strokeStyle = style.getPropertyValue('--line'); g.strokeRect(x + 3.5, y + 3.5, cs - 7, cs - 7); g.setLineDash([]); if (idx === cur) { g.fillStyle = style.getPropertyValue('--brass'); g.fillText('LIVE', x + 8, y + 16); } }
      if (cs > 40) { g.fillStyle = style.getPropertyValue('--mute'); g.fillText(String(idx), x + 6, y + cs - 6); }
    }
  };
  let drag = null, moved = false;
  wrap.onpointerdown = (e) => { drag = [e.clientX, e.clientY, ox, oy]; moved = false; wrap.setPointerCapture(e.pointerId); };
  wrap.onpointermove = (e) => { if (!drag) return; if (Math.abs(e.clientX - drag[0]) + Math.abs(e.clientY - drag[1]) > 3) moved = true; ox = drag[2] + e.clientX - drag[0]; oy = drag[3] + e.clientY - drag[1]; draw(); };
  wrap.onpointerup = (e) => { drag = null; if (moved) return; const r = wrap.getBoundingClientRect(), cs = CELL * zoom, cx = Math.floor((e.clientX - r.left - ox) / cs), cy = Math.floor((e.clientY - r.top - oy) / cs); if (cx >= 0 && cx < COLS && cy >= 0) { const idx = cy * COLS + cx; if (idx <= A.eng.s.boardIdx) location.hash = '#/board/' + idx; else toast('Board ' + idx + ' has not been generated'); } };
  wrap.onwheel = (e) => { e.preventDefault(); const r = wrap.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, nz = Math.max(.25, Math.min(6, zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15))); ox = mx - (mx - ox) * nz / zoom; oy = my - (my - oy) * nz / zoom; zoom = nz; draw(); };
  requestAnimationFrame(draw);
}

// ---------------------------------------------------------------- ARCHIVE
async function vArchive(v) {
  crumbs('Archive');
  const ents = await A.store.last('ledger', 40), tot = await A.store.count('ledger');
  const vres = h('span', { class: 'mono' }); const ev = h('input', { type: 'text', placeholder: 'event number or E-…', style: 'width:200px' });
  v.append(h('h1', {}, 'The Archive'), h('div', { class: 'sub' }, `${fmt(tot)} ledger entries · append-only, hash-chained`),
    h('div', { class: 'toolbar' }, h('button', { class: 'btn pri', onclick: async () => { vres.textContent = 'verifying…'; const all = (await A.store.all('ledger')).sort((a, b) => a.n - b.n); const t0 = performance.now(); const r = await C.verifyLedger(all); vres.className = 'mono ' + (r.ok ? 'ok' : 'warn'); vres.textContent = r.ok ? `✓ chain intact — ${fmt(r.checked)} entries in ${dur(performance.now() - t0)}` : `✗ broken at entry ${r.at}: ${r.why}`; } }, 'Verify integrity'), vres, h('span', { style: 'flex:1' }), ev, h('button', { class: 'btn', onclick: () => { const n = +String(ev.value).replace(/\D/g, ''); if (ev.value && n >= 0) location.hash = '#/event/' + n; } }, 'Inspect event')),
    h('p', { class: 'mute', style: 'font-size:12px;max-width:72ch' }, 'Each entry hashes its predecessor, detecting accidental corruption or edits to stored history. It is not a defence against someone rewriting the whole chain.'));
  const t = h('table', {}, h('thead', {}, h('tr', {}, ['Entry', 'First event', 'Last event', 'Ticks', 'Hash', 'Status'].map((x) => h('th', {}, x)))));
  const tb = h('tbody'); for (const e of ents) tb.append(h('tr', { class: 'click', onclick: () => location.hash = '#/event/' + e.seqStart }, h('td', {}, e.n), h('td', {}, C.ids.event(e.seqStart)), h('td', {}, C.ids.event(e.seqEnd)), h('td', {}, e.ticks.length), h('td', {}, e.hash.slice(0, 16) + '…'), h('td', {}, h('span', { class: 'pill ok' }, e.status))));
  t.append(tb); v.append(t); if (!ents.length) v.append(h('div', { class: 'empty' }, 'No ledger entries have been written yet.'));
}
async function vEvent(v, [n]) {
  n = Math.floor(+n); if (!(n >= 0) || n >= A.eng.s.head) throw new Error('No such event — only events that have occurred are recorded (head is ' + fmt(A.eng.s.head) + ').');
  crumbs(['Archive', '#/archive'], C.ids.event(n));
  const pg = n >= A.eng.s.pageStart ? null : await floorRecord(A.store, 'pages', 'startSeq', n); const bd = n >= A.eng.s.boardStart ? null : await floorRecord(A.store, 'boards', 'startSeq', n);
  const pIdx = pg ? pg.idx : A.eng.s.pageIdx, pSpec = C.pageSpec(A.world, pIdx), bIdx = bd ? bd.idx : A.eng.s.boardIdx, bSpec = C.boardSpec(A.world, bIdx);
  const ch = C.charAt(pSpec.mode, pSpec.seed, n), px = C.pixelAt(bSpec, n), { ticks } = await ticksFor(n, n), tk = ticks[0];
  v.append(h('div', { class: 'lbl' }, 'Generation event'), h('h1', { class: 'mono', style: 'font-size:34px' }, C.ids.event(n)),
    h('div', { class: 'toolbar' }, h('a', { class: 'btn', href: '#/event/' + Math.max(0, n - 1) }, '← previous'), h('a', { class: 'btn', href: '#/event/' + (n + 1) }, 'next →'), h('a', { class: 'btn', href: '#/page/' + pIdx }, 'Open its page'), h('a', { class: 'btn', href: '#/board/' + bIdx }, 'Open its board')),
    kv('Sequence', fmt(n)), kv('Text output', JSON.stringify(ch) + ` (U+${ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}) → ${C.ids.page(pIdx)}, offset ${n - (pg ? pg.startSeq : A.eng.s.pageStart)}`), kv('Pixel output', `board ${C.ids.board(bIdx)} (${px.x}, ${px.y}) rgba(${px.r},${px.g},${px.b},${px.a})`), kv('Page seed', C.ids.seed(pSpec.seed)), kv('Board seed', C.ids.seed(bSpec.seed)),
    kv('Tick time', tk ? stamp(tk[2]) : 'no ledger tick recorded for this event', tk ? '' : 'warn'), kv('Tick size', tk ? `${tk[1]} events, ${dur(tk[3])} compute` : '—'), kv('Engine', C.ENGINE), kv('Status', 'complete'),
    h('p', { class: 'mute', style: 'font-size:12px' }, 'Outputs are recomputed from the seeds above and match what was archived.'));
}

// ---------------------------------------------------------------- ORACLE (search)
async function archiveSearch(q, onProgress, limit = 40) {
  const t0 = performance.now(), res = [], live = A.eng.chars.join('');
  if (q.length < 1) return { res, ms: 0, scanned: 0, candidates: 0 };
  let scanned = 0, candidates = 0;
  const addMatches = (rec, text, isLive) => { let i = text.indexOf(q), c = 0; while (i >= 0 && c < 3) { res.push({ rec, at: i, text, live: isLive }); c++; i = text.indexOf(q, i + 1); } };
  const keys = [...A.sigs.keys()].sort((a, b) => a - b);
  for (const k of keys) {
    if (res.length >= limit) break; scanned++;
    if (q.length >= 3 && !C.sigMayContain(A.sigs.get(k), q)) continue;
    candidates++; const p = await A.store.get('pages', k); if (p && p.text.includes(q)) addMatches(p, p.text, false);
    if (scanned % 300 === 0) { onProgress?.(scanned, keys.length); await new Promise((r) => setTimeout(r)); }
  }
  if (res.length < limit && live.includes(q)) addMatches({ id: C.ids.page(A.eng.s.pageIdx), idx: A.eng.s.pageIdx, live: true }, live, true);
  return { res, ms: performance.now() - t0, scanned, candidates, total: keys.length };
}
async function idLookup(q) {
  const out = []; q = q.trim(); let m;
  if ((m = /^P-?(\d+)$/i.exec(q))) { const p = await A.store.get('pages', +m[1]); if (p) out.push({ type: 'Page', id: p.id, href: '#/page/' + p.idx, note: p.text.slice(0, 80) }); }
  if ((m = /^B-?(\d+)$/i.exec(q))) { const b = await A.store.get('books', +m[1]); if (b) out.push({ type: 'Book', id: b.id, href: '#/book/' + b.idx, note: b.title }); }
  if ((m = /^BRD-?(\d+)$/i.exec(q))) { const b = await A.store.get('boards', +m[1]); if (b) out.push({ type: 'Board', id: b.id, href: '#/board/' + b.idx, note: `${b.w}×${b.h}` }); }
  if ((m = /^E-?(\d+)$/i.exec(q))) { const n = +m[1]; if (n < A.eng.s.head) out.push({ type: 'Event', id: C.ids.event(n), href: '#/event/' + n, note: 'recorded generation event' }); }
  if (/^[0-9a-f]{8}$/i.test(q)) { const s = parseInt(q, 16); for (const p of await A.store.byIndex('pages', 'seed', s)) out.push({ type: 'Page (seed)', id: p.id, href: '#/page/' + p.idx, note: 'seed ' + p.seedHex }); for (const b of await A.store.byIndex('boards', 'seed', s)) out.push({ type: 'Board (seed)', id: b.id, href: '#/board/' + b.idx, note: 'seed ' + b.seedHex }); }
  if (/^[0-9a-f]{64}$/i.test(q)) { for (const p of await A.store.byIndex('pages', 'hash', q.toLowerCase())) out.push({ type: 'Page (content hash)', id: p.id, href: '#/page/' + p.idx, note: 'exact content hash match' }); for (const b of await A.store.byIndex('boards', 'hash', q.toLowerCase())) out.push({ type: 'Board (content hash)', id: b.id, href: '#/board/' + b.idx, note: 'exact content hash match' }); }
  return out;
}
async function vSearch(v, _, qp) {
  crumbs('The Oracle'); const inp = h('input', { id: 'q', type: 'search', placeholder: 'Search what exists…', value: qp.get('q') || '', autocomplete: 'off' }), box = h('div', { style: 'margin-top:22px' });
  v.append(h('div', { class: 'lbl' }, 'The Oracle'), h('h1', {}, 'Search what exists.'), h('div', { class: 'sub', style: 'margin-bottom:18px' }, 'Explore what could exist.'), h('div', { class: 'search' }, inp, h('span', { class: 'lbl', style: 'align-self:center' }, 'Ctrl K')), box);
  inp.focus(); let tok = 0;
  const run = async () => {
    const q = inp.value, my = ++tok; history.replaceState(null, '', '#/search?q=' + encodeURIComponent(q)); if (!q) { box.replaceChildren(h('div', { class: 'empty' }, 'Words, sentences, numbers, symbols, page / book / board / event IDs, 8-digit seeds, or 64-digit content hashes.')); return; }
    const prog = h('div', { class: 'mute mono' }, 'searching the archive…'); box.replaceChildren(prog);
    const ids = await idLookup(q); const r = await archiveSearch(q, (a, b) => { if (my === tok) prog.textContent = `searching… ${fmt(a)} / ${fmt(b)} pages`; }); if (my !== tok) return;
    const parts = [];
    if (ids.length) { parts.push(h('div', { class: 'lbl' }, 'Direct address matches'), ...ids.map((x) => h('a', { class: 'row', href: x.href, style: 'grid-template-columns:150px 170px 1fr' }, h('span', { class: 'pill ok' }, 'EXACT · ' + x.type), h('span', { class: 'mono' }, x.id), h('span', { class: 'snip mute' }, x.note)))); }
    parts.push(h('div', { class: 'lbl', style: 'margin-top:20px' }, 'Actual archive — exact substring match, case-sensitive'));
    if (r.res.length) {
      parts.push(...r.res.map((m) => { const a = Math.max(0, m.at - 40), b = m.at + q.length + 40; const href = m.live ? '#/page/' + m.rec.idx : `#/page/${m.rec.idx}?hl=${m.at}-${m.at + q.length - 1}`; const t = m.rec.t0 ? dur(timesOf(m.rec).wall) : 'in progress';
        return h('a', { class: 'row', href, style: 'grid-template-columns:128px 1fr 150px' }, h('div', {}, h('span', { class: 'pill ok' }, m.live ? 'EXACT · LIVE' : 'EXACT'), h('div', { class: 'mono', style: 'margin-top:4px' }, m.rec.id)), h('div', { class: 'snip' }, a > 0 ? '…' : '', m.text.slice(a, m.at), h('mark', {}, m.text.slice(m.at, m.at + q.length)), m.text.slice(m.at + q.length, b), b < m.text.length ? '…' : ''), h('div', { class: 'mono mute', style: 'font-size:11px' }, `offset ${m.at}`, h('br'), m.rec.bookId || '', h('br'), 'page took ' + t)); }));
    } else parts.push(h('div', { class: 'empty' }, `No exact match in the archive. ${fmt(r.total)} archived pages checked (${fmt(r.candidates)} opened after signature filtering) in ${dur(r.ms)}${A.eng.chars.length ? ', plus the page being written' : ''}. Similar text was not substituted — this exact string has not been generated yet.`));
    parts.push(h('div', { class: 'mono mute', style: 'font-size:11px;margin-top:8px' }, `search time ${dur(r.ms)} — this is lookup time, not generation time`));
    const poss = C.possibility(q, Math.max(1, settings.rate || curRate()));
    parts.push(h('div', { class: 'lbl', style: 'margin-top:28px' }, 'Explore possibility — theoretical, nothing here has been generated'));
    if (!poss.length) parts.push(h('p', { class: 'mute' }, 'This text contains characters outside every simple alphabet, so no per-position estimate is shown.'));
    else { const t = h('table', {}, h('thead', {}, h('tr', {}, ['Alphabet', 'K', 'L', 'K^L possible strings', 'Expected time at current rate'].map((x) => h('th', {}, x))))); const tb = h('tbody'); for (const p of poss) tb.append(h('tr', {}, h('td', {}, C.MODES[p.mode].label), h('td', {}, p.K), h('td', {}, p.L), h('td', {}, C.sci(p.space)), h('td', {}, C.humanTime(p.seconds)))); t.append(tb); parts.push(t, h('p', { class: 'mute', style: 'font-size:12px;max-width:72ch' }, `Expected waiting time to meet this exact string at one fixed position, at ${fmt(settings.rate || Math.round(curRate()))} events/s. These are possibility counts, not archive statistics; the library does not claim to contain it.`)); }
    box.replaceChildren(...parts);
  };
  let t; inp.oninput = () => { clearTimeout(t); t = setTimeout(run, 180); }; run();
}

// ---------------------------------------------------------------- CLOCK
async function vClock(v) {
  crumbs('Atom Clock'); const cnt = h('div', { class: 'atom', style: 'font-size:46px' }), st = h('div', { class: 'lbl' }), feed = h('div', { class: 'mono', style: 'font-size:12px' }), spark = h('canvas', { width: 600, height: 80, style: 'width:100%;height:80px;image-rendering:auto' }); let paused = false;
  const live = h('div', { class: 'live-txt', style: 'max-height:140px' }), boardC = h('canvas'); boardC.style.cssText = 'width:100%;max-width:320px;image-rendering:pixelated;border:1px solid var(--line)';
  v.append(h('div', { class: 'lbl' }, 'Atom Clock'), h('h1', {}, 'The heartbeat of the library'), h('div', { class: 'sub' }, 'One Atom Second = one recorded generation event: one character, one pixel.'), h('div', { style: 'margin:22px 0' }, cnt, st),
    h('div', { class: 'toolbar' }, h('button', { class: 'btn', onclick: (e) => { settings.running = !settings.running; saveSettings(); e.target.textContent = settings.running ? '❚❚ Pause generation' : '▶ Resume generation'; } }, settings.running ? '❚❚ Pause generation' : '▶ Resume generation'), h('button', { class: 'btn', onclick: (e) => { paused = !paused; e.target.textContent = paused ? 'Resume view' : 'Pause view'; } }, 'Pause view'), h('span', { class: 'mute', style: 'font-size:12px' }, 'Pausing the view does not stop generation.')),
    spark, h('div', { class: 'cols', style: 'margin-top:20px' }, h('div', {}, h('div', { class: 'lbl' }, 'Page being written'), live, h('div', { class: 'lbl', style: 'margin:16px 0 6px' }, 'Board being filled'), boardC), h('div', {}, h('div', { class: 'lbl', style: 'margin-bottom:6px' }, 'Recent events'), feed)));
  let lastF = 0; sub(() => {
    cnt.textContent = pad18(A.eng.s.head); st.replaceChildren(h('span', { class: 'dot' + (settings.running ? ' live' : '') }), settings.running ? `generating · ${fmt(Math.round(curRate()))} events / s (target ${settings.rate ? fmt(settings.rate) : 'max'})` : 'generation paused — the clock is not ticking');
    if (paused || performance.now() - lastF < 100) return; lastF = performance.now();
    live.textContent = A.eng.chars.slice(-400).join(''); const sp = A.eng.bd; boardC.width = sp.w; boardC.height = sp.h; boardC.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(A.eng.px), sp.w, sp.h), 0, 0);
    const rows = []; for (let k = 0; k < 14; k++) { const n = A.eng.s.head - 1 - k; if (n < 0) break; const ps = C.pageSpec(A.world, A.eng.s.pageIdx); const bsp = A.eng.bd; if (n < A.eng.s.pageStart || n < A.eng.s.boardStart) { rows.push(h('div', { class: 'mute' }, C.ids.event(n) + '  (previous page/board)')); continue; } const px = C.pixelAt(bsp, n); rows.push(h('div', {}, C.ids.event(n) + '  ' + JSON.stringify(C.charAt(ps.mode, ps.seed, n)) + `  px(${px.x},${px.y})`)); } feed.replaceChildren(...rows);
    const g = spark.getContext('2d'), s = A.rateSamples, mx = Math.max(1, ...s); g.clearRect(0, 0, 600, 80); g.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--brass'); g.beginPath(); s.forEach((x, i) => { const X = i / 240 * 600, Y = 76 - x / mx * 70; i ? g.lineTo(X, Y) : g.moveTo(X, Y); }); g.stroke(); g.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--mute'); g.font = '10px IBM Plex Mono'; g.fillText('events/s (last 2 min), peak ' + fmt(Math.round(mx)), 6, 12);
  });
}

// ---------------------------------------------------------------- MEDIA (image matching)
async function vMedia(v) {
  crumbs('Media'); const out = h('div'); const file = h('input', { type: 'file', accept: 'image/*' });
  v.append(h('h1', {}, 'Media'), h('div', { class: 'sub' }, 'Is this exact image in the archive?'), h('div', { class: 'toolbar', style: 'margin-top:18px' }, file), out,
    h('p', { class: 'mute', style: 'font-size:12px;max-width:72ch' }, 'Exact matching compares the SHA-256 of your image’s pixels with every archived board. Boards are tiny random-pixel arrangements (8–64 px per side), so a photo or cartoon will almost surely return “no match”. That is the honest answer, not a failure.'));
  file.onchange = async () => {
    const f = file.files[0]; if (!f) return; out.replaceChildren(h('div', { class: 'mono mute' }, 'hashing…'));
    const bmp = await createImageBitmap(f); const cv = new OffscreenCanvas(bmp.width, bmp.height), g = cv.getContext('2d'); g.drawImage(bmp, 0, 0); const px = g.getImageData(0, 0, bmp.width, bmp.height);
    const hash = await C.hashBoard(bmp.width, bmp.height, new Uint8Array(px.data.buffer)); const ex = await A.store.byIndex('boards', 'hash', hash);
    const parts = [kv('Your image', `${bmp.width} × ${bmp.height} px`), kv('SHA-256', hash.slice(0, 40) + '…')];
    if (ex.length) parts.push(h('div', { class: 'pill ok', style: 'margin:12px 0' }, 'EXACT MATCH'), ...ex.map((b) => h('a', { class: 'btn pri', href: '#/board/' + b.idx }, `Open ${b.id} and its generation history`)));
    else {
      parts.push(h('div', { class: 'empty', style: 'margin:14px 0' }, bmp.width <= 64 && bmp.height <= 64 && bmp.width >= 8 && bmp.height >= 8 ? 'No exact match among archived boards.' : `No exact match. Archived boards are 8–64 px per side; a ${bmp.width}×${bmp.height} image cannot equal any of them, and no generation history is invented for it.`));
      // approximate: compare against same-size-class boards after downscaling the upload
      const boards = await A.store.last('boards', 300); const scored = [];
      for (const b of boards) { const c = new OffscreenCanvas(b.w, b.h), cg = c.getContext('2d'); cg.drawImage(bmp, 0, 0, b.w, b.h); const d = cg.getImageData(0, 0, b.w, b.h).data; let diff = 0; for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 4; k++) diff += Math.abs(d[i + k] - b.rgba[i + k]); scored.push({ b, sim: 1 - diff / (d.length * 255) }); }
      scored.sort((a, b) => b.sim - a.sim); const top = scored.slice(0, 5);
      parts.push(h('div', { class: 'lbl', style: 'margin-top:14px' }, `Similar arrangements (approximate, ${boards.length} most recent boards, downscaled)`), ...top.map((s) => h('a', { class: 'row', href: '#/board/' + s.b.idx, style: 'grid-template-columns:140px 130px 1fr' }, h('span', { class: 'pill brass' }, 'SIMILAR · NOT EXACT'), h('span', { class: 'mono' }, s.b.id), h('span', { class: 'mono mute' }, `pixel similarity ${(s.sim * 100).toFixed(1)}%  (random noise sits near 50–70%, so this is weak evidence)`))));
      if (!boards.length) parts.push(h('div', { class: 'mute' }, 'No boards have been completed yet.'));
    }
    out.replaceChildren(...parts);
  };
  v.append(h('hr'), h('div', { class: 'lbl', style: 'margin-bottom:10px' }, 'Latest sealed boards')); const g = h('div', { style: 'display:flex;flex-wrap:wrap;gap:10px' });
  for (const b of await A.store.last('boards', 24)) { const c = boardCanvas(b, b.rgba, Math.max(1, Math.floor(110 / Math.max(b.w, b.h)))); g.append(h('a', { href: '#/board/' + b.idx, title: b.id, class: 'chk', style: 'border:1px solid var(--line)' }, c)); } v.append(g);
}

// ---------------------------------------------------------------- COLLECTIONS
async function vCollections(v) {
  crumbs('Collections'); const all = await A.store.all('user'), folders = all.filter((x) => x.kind === 'folder'), items = all.filter((x) => x.kind === 'bookmark');
  const nm = h('input', { type: 'text', placeholder: 'new folder name' });
  v.append(h('h1', {}, 'Collections'), h('div', { class: 'sub' }, 'Your own order. Moving things here never changes their permanent address or history.'), h('div', { class: 'toolbar', style: 'margin-top:16px' }, nm, h('button', { class: 'btn', onclick: async () => { if (!nm.value.trim()) return; await A.store.put('user', { id: 'f:' + Date.now(), kind: 'folder', name: nm.value.trim(), parent: null }); route(); } }, 'Create folder')));
  const sect = (title, f) => { const kids = items.filter((i) => (i.parent || null) === (f ? f.id : null)); v.append(h('h3', { style: 'margin-top:22px;display:flex;gap:10px;align-items:baseline' }, title, f && h('button', { class: 'ghost', title: 'rename', onclick: async () => { const n = prompt('Rename folder', f.name); if (n) { f.name = n; await A.store.put('user', f); route(); } } }, '✎'), f && h('button', { class: 'ghost', title: 'delete folder (items go to Unfiled)', onclick: async () => { for (const k of kids) { k.parent = null; await A.store.put('user', k); } await A.store.del('user', f.id); route(); } }, '×')));
    if (!kids.length) v.append(h('div', { class: 'mute', style: 'padding:6px 0' }, 'empty')); for (const k of kids) v.append(h('div', { class: 'row', style: 'grid-template-columns:90px 1fr 160px 30px' }, h('span', { class: 'pill' }, k.target.type), h('a', { href: k.target.href }, k.name + '  ', h('span', { class: 'mono mute' }, k.target.id)), h('select', { onchange: async (e) => { k.parent = e.target.value || null; await A.store.put('user', k); route(); } }, h('option', { value: '' }, 'Unfiled'), folders.map((fo) => h('option', { value: fo.id, selected: k.parent === fo.id }, fo.name))), h('button', { class: 'ghost', onclick: async () => { await A.store.del('user', k.id); route(); } }, '×'))); };
  sect('Unfiled', null); folders.forEach((f) => sect(f.name, f));
  if (!items.length) v.append(h('div', { class: 'empty', style: 'margin-top:20px' }, 'Bookmark pages, books and boards from their viewers and they will gather here.'));
}

// ---------------------------------------------------------------- STATS
async function vStats(v) {
  crumbs('Statistics'); const g = h('div', { class: 'stat' }), sess = performance.now(); v.append(h('h1', {}, 'Statistics'), h('div', { class: 'sub' }, 'The measured size of what actually exists — not of what is possible.'), h('div', { style: 'margin-top:18px' }, g));
  const [pages, boards, books, led] = await Promise.all(['pages', 'boards', 'books', 'ledger'].map((s) => A.store.count(s)));
  const est = await (navigator.storage?.estimate?.() || {}); const first = await A.store.get('pages', 0); const lastP = (await A.store.last('pages', 1))[0];
  const cell = (k, val) => h('div', {}, h('div', { class: 'lbl' }, k), h('div', { class: 'n' }, val));
  const render = () => g.replaceChildren(cell('Atom Seconds / events', fmt(A.eng.s.head)), cell('Characters generated', fmt(A.eng.totals.chars)), cell('Pixels generated', fmt(A.eng.totals.pixels)), cell('Pages archived', fmt(pages)), cell('Books shelved', fmt(books)), cell('Boards sealed', fmt(boards)), cell('Ledger entries', fmt(led)),
    cell('Total active compute', dur(A.activeMs)), cell('Current throughput', fmt(Math.round(curRate())) + ' ev/s'), cell('Storage used', est.usage ? (est.usage / 1048576).toFixed(1) + ' MB' : 'n/a'), cell('Oldest page', first ? stamp(first.t0) : '—'), cell('Newest page', lastP ? stamp(lastP.t1) : '—'),
    cell('Longest page (chars)', fmt(0)), cell('Engine', C.ENGINE), cell('World seed', C.ids.seed(A.world))); render(); sub(() => { if (performance.now() - (render.t || 0) > 500) { render.t = performance.now(); g.firstChild.querySelector('.n').textContent = fmt(A.eng.s.head); } });
  const lg = await A.store.last('pages', 2000); const longest = lg.reduce((a, p) => Math.max(a, p.count), 0); g.children[12].querySelector('.n').textContent = fmt(longest) + (lg.length >= 2000 ? ' (of last 2,000)' : '');
  const leds = await A.store.last('ledger', 3600), buckets = new Map(); for (const e of leds) for (const t of e.ticks) { const m = Math.floor(t[2] / 60000); buckets.set(m, (buckets.get(m) || 0) + t[1]); }
  v.append(h('h3', { style: 'margin-top:28px' }, 'Events per minute (from the ledger)'), (() => { const t = h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Minute (UTC)'), h('th', {}, 'Events')))), tb = h('tbody'); [...buckets.entries()].sort((a, b) => b[0] - a[0]).slice(0, 15).forEach(([m, n]) => tb.append(h('tr', {}, h('td', {}, stamp(m * 60000).slice(0, 16)), h('td', {}, fmt(n))))); t.append(tb); return t; })());
}

// ---------------------------------------------------------------- ORIGIN
async function vOrigin(v) {
  crumbs('The Origin'); v.append(h('h1', {}, 'The Origin'), h('div', { class: 'sub' }, 'Where the Atom Seconds are made.'));
  const eng = [['Text Engine', true, 'One character per event; six alphabets; per-page randomised length, mode and layout.'], ['Pixel Engine', true, 'One RGBA pixel per event on randomly sized boards (8–64 px); boards seal at capacity.'], ['Number / Symbol', false, 'Covered today only as the “math” and “unicode” text alphabets; no separate engine.'], ['Mathematics', false, 'Not built: needs a symbolic expression tree and verifier.'], ['Science', false, 'Not built.'], ['DNA / Biology', false, 'Not built.'], ['Image / Art (beyond pixels)', false, 'Not built.'], ['Audio · Video · Code · 3D', false, 'Not built; the engine registry is the planned extension point.']];
  const t = h('table', {}, h('thead', {}, h('tr', {}, ['Engine', 'Status', 'Notes'].map((x) => h('th', {}, x))))), tb = h('tbody'); for (const [n, on, d] of eng) tb.append(h('tr', {}, h('td', {}, n), h('td', {}, h('span', { class: 'pill ' + (on ? 'ok' : '') }, on ? 'running' : 'not implemented')), h('td', { class: 'mute' }, d))); t.append(tb); v.append(h('hr'), t);
  const rate = h('select', { onchange: (e) => { settings.rate = +e.target.value; saveSettings(); } }, [10, 100, 1000, 10000, 100000, 250000, 1000000, 0].map((r) => h('option', { value: r, selected: settings.rate === r }, r ? fmt(r) + ' events / s' : 'maximum (≈ millions/s — fills storage in minutes)')));
  const theme = h('select', { onchange: (e) => { settings.theme = e.target.value; saveSettings(); applyTheme(); } }, ['auto', 'light', 'dark'].map((o) => h('option', { value: o, selected: settings.theme === o }, o)));
  v.append(h('h3', { style: 'margin-top:26px' }, 'Controls'), h('div', { class: 'toolbar' }, h('button', { class: 'btn pri', onclick: (e) => { settings.running = !settings.running; saveSettings(); e.target.textContent = settings.running ? '❚❚ Pause' : '▶ Resume'; } }, settings.running ? '❚❚ Pause' : '▶ Resume'), rate, h('span', { class: 'mute' }, 'theme'), theme),
    h('p', { class: 'mute', style: 'font-size:12.5px;max-width:72ch' }, 'Generation runs in this tab in ≤6 ms slices so the interface never blocks. It cannot run in the background; if your target rate is more than this device can sustain, the shortfall is dropped, not back-filled, so recorded timestamps stay truthful. Randomness: the world seed is drawn from the OS secure RNG once; every output is then a deterministic function of (world seed, event number), which is what makes exact reproduction possible.'),
    downloadPanel(), agentPanel(),
    h('h3', { style: 'margin-top:22px' }, 'Backup & recovery'), h('div', { class: 'toolbar' }, h('button', { class: 'btn', onclick: async () => { const dump = { world: A.world, engine: C.ENGINE, ledger: await A.store.all('ledger'), state: await A.store.get('meta', 'state'), pages: await A.store.all('pages'), books: await A.store.all('books'), boards: (await A.store.all('boards')).map((b) => ({ ...b, rgba: Array.from(b.rgba) })) }; const blob = new Blob([JSON.stringify(dump)], { type: 'application/json' }); h('a', { href: URL.createObjectURL(blob), download: 'book-of-babel-backup.json' }).click(); toast('Backup downloaded'); } }, 'Export full backup (JSON)'),
      h('button', { class: 'btn', style: 'color:var(--red)', onclick: async () => { if (!confirm('Delete the ENTIRE local library, ledger and bookmarks? This cannot be undone. Export a backup first.')) return; settings.running = false; A.store.db.close(); indexedDB.deleteDatabase('book-of-babel').onsuccess = () => location.reload(); } }, 'Erase this library…')),
    h('p', { class: 'mute', style: 'font-size:12px' }, 'Import and cross-device sync are not built: this build stores everything locally in your browser.'));
}


// ---------------------------------------------------------------- DOWNLOADS
const pageBlock = (p) => `=== ${p.id} | ${p.bookId} | ${C.ids.chapter(p.chapter)} | seed ${p.seedHex} | events ${p.startSeq}-${p.endSeq} | wall ${dur(p.t1 - p.t0)} | sha256 ${p.hash || 'pending'} ===\n${p.text}\n\n`;
function saveText(name, text) { saveBlob(name, new Blob([text], { type: 'text/plain;charset=utf-8' })); }
function saveBlob(name, blob) { const a = h('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000); }
async function exportArchive(limitBytes, format, onProg) { // streams archived pages ascending, stopping before the size limit is exceeded
  const ext = format === 'jsonl' ? 'jsonl' : 'txt', name = `book-of-babel-${A.world.toString(16)}.${ext}`; let w = null, parts = [];
  if (window.showSaveFilePicker) { try { const fh = await window.showSaveFilePicker({ suggestedName: name }); w = await fh.createWritable(); } catch (e) { if (e.name === 'AbortError') return null; } }
  const enc = new TextEncoder(); let size = 0, pages = 0, lo = 0, more = true;
  while (more) {
    const recs = await A.store.range('pages', lo, Number.MAX_SAFE_INTEGER, 200); if (!recs.length) break; lo = recs[recs.length - 1].idx + 1;
    for (const p of recs) {
      const line = format === 'jsonl' ? JSON.stringify({ id: p.id, book: p.bookId, chapter: p.chapter, pageNo: p.pageNo, seed: p.seedHex, startEvent: p.startSeq, endEvent: p.endSeq, t0: p.t0, t1: p.t1, activeMs: p.activeMs, sha256: p.hash, text: p.text }) + '\n' : pageBlock(p);
      const bytes = enc.encode(line); if (size + bytes.length > limitBytes) { more = false; break; }
      size += bytes.length; pages++; if (w) await w.write(bytes); else parts.push(bytes);
    }
    onProg?.(pages, size); await new Promise((r) => setTimeout(r));
  }
  if (w) await w.close(); else if (pages) saveBlob(name, new Blob(parts, { type: 'text/plain' }));
  return { pages, size };
}
function downloadPanel() {
  const amt = h('input', { type: 'number', min: 1, value: 10, style: 'width:90px' }), unit = h('select', {}, h('option', { value: 1048576 }, 'MB'), h('option', { value: 1073741824 }, 'GB')), fm = h('select', {}, h('option', { value: 'txt' }, 'Plain text (.txt)'), h('option', { value: 'jsonl' }, 'JSON lines with metadata (.jsonl)')), st = h('div', { class: 'mono mute', style: 'margin-top:8px;min-height:20px' });
  const want = () => Math.floor(+amt.value * +unit.value);
  const archived = async () => { let t = 0, lo = 0; for (;;) { const r = await A.store.range('pages', lo, Number.MAX_SAFE_INTEGER, 500); if (!r.length) return t; lo = r[r.length - 1].idx + 1; for (const p of r) t += p.count; } };
  const dl = h('button', { class: 'btn pri', onclick: async () => { st.textContent = 'preparing…'; const r = await exportArchive(want(), fm.value, (p, s) => { st.textContent = `${fmt(p)} pages · ${(s / 1048576).toFixed(1)} MB written`; }); if (!r) st.textContent = 'cancelled'; else st.textContent = r.pages ? `Downloaded ${fmt(r.pages)} archived pages, ${(r.size / 1048576).toFixed(2)} MB.` + (r.size < want() * 0.98 ? ` The archive holds fewer than the ${amt.value} ${unit.selectedOptions[0].text} you asked for — use “Generate more” to create real events until it does.` : '') : 'The archive has no finished pages yet.'; } }, '⭳ Download archived pages');
  const gen = h('button', { class: 'btn', onclick: () => { const target = want(); if (A.eng.s.head + target > 4e9 && !confirm('That is a lot of generation. Continue?')) return; A.prevRate = settings.rate || 500; settings.stopAt = A.eng.s.head + target; settings.rate = 0; settings.running = true; saveSettings(); st.textContent = `Generating ≈${(target / 1048576).toFixed(0)} MB of new text at maximum speed… (browser storage must have room; watch Statistics)`; A.onTarget = () => { st.textContent = 'Done generating. Press Download.'; }; } }, 'Generate more to reach this size');
  const seedpack = h('button', { class: 'btn', onclick: () => saveText('babel-seed-pack.json', JSON.stringify({ format: 'babel-seed-pack/1', engine: C.ENGINE, worldSeed: A.world, eventsGenerated: A.eng.s.head, note: 'With core.js (engine babel-engine/1.0) and this world seed, every page, board and event up to eventsGenerated can be regenerated exactly. A few bytes stand in for the whole archive.' }, null, 2)) }, 'Seed pack (a few bytes)');
  return h('div', {}, h('h3', { style: 'margin-top:22px' }, 'Download pages'), h('div', { class: 'toolbar' }, amt, unit, fm, dl, gen, seedpack), st, h('p', { class: 'mute', style: 'font-size:12px;max-width:72ch' }, 'Downloads contain only pages that were actually generated and archived, up to the size you choose (whole pages; the file stops before exceeding the limit). Multi-GB exports stream straight to disk in Chrome/Edge; other browsers must hold the file in memory, so keep those exports modest. “Generate more” creates real, recorded events — it never pads files.'));
}

// ---------------------------------------------------------------- AI AGENT BRIDGE (MCP relay)
const AG = { es: null, state: 'off' };
const BRIDGE = 'http://127.0.0.1:8803';
async function agentCall(method, p) {
  const eng = A.eng;
  if (method === 'status') { const [pages, books, boards, led] = await Promise.all(['pages', 'books', 'boards', 'ledger'].map((x) => A.store.count(x))); return { engine: C.ENGINE, worldSeed: C.ids.seed(A.world), events: eng.s.head, pagesArchived: pages, booksShelved: books, boardsSealed: boards, ledgerEntries: led, ledgerHead: A.prev, running: settings.running, targetRate: settings.rate || 'max', measuredRate: Math.round(curRate()), livePage: C.ids.page(eng.s.pageIdx), liveBoard: C.ids.board(eng.s.boardIdx) }; }
  if (method === 'search') { const q = String(p.query ?? ''); if (!q) throw new Error('empty query'); const ids = await idLookup(q), r = await archiveSearch(q, null, Math.min(+p.limit || 20, 100)); return { exactMatchesOnly: true, direct: ids, matches: r.res.map((m) => ({ page: m.rec.id, pageIndex: m.rec.idx, offset: m.at, live: !!m.live, context: m.text.slice(Math.max(0, m.at - 60), m.at + q.length + 60), wallMs: m.rec.t0 ? m.rec.t1 - m.rec.t0 : null, firstEvent: m.rec.startSeq, lastEvent: m.rec.endSeq, seed: m.rec.seedHex })), pagesChecked: r.total, searchMs: +r.ms.toFixed(1), note: r.res.length || ids.length ? undefined : 'No exact match: this exact text is not in the archive.' }; }
  if (method === 'get_page') { const idx = typeof p.page === 'string' && /^P-?\d+$/i.test(p.page) ? +p.page.replace(/\D/g, '') : +p.page; const r = await A.store.get('pages', idx); if (!r) throw new Error('page not archived'); const { text, ...meta } = r; return { ...meta, timing: { wallMs: r.t1 - r.t0, idleMs: r.idleMs, runningMs: r.t1 - r.t0 - r.idleMs, activeComputeMs: r.activeMs }, text }; }
  if (method === 'get_event') { const n = Math.floor(+p.event); if (!(n >= 0 && n < eng.s.head)) throw new Error('no such event; head is ' + eng.s.head); const pg = n >= eng.s.pageStart ? null : await floorRecord(A.store, 'pages', 'startSeq', n), bd = n >= eng.s.boardStart ? null : await floorRecord(A.store, 'boards', 'startSeq', n); const ps = C.pageSpec(A.world, pg ? pg.idx : eng.s.pageIdx), bs = C.boardSpec(A.world, bd ? bd.idx : eng.s.boardIdx); const { ticks } = await ticksFor(n, n); return { event: C.ids.event(n), char: C.charAt(ps.mode, ps.seed, n), page: C.ids.page(ps.idx), pixel: { board: C.ids.board(bs.idx), ...C.pixelAt(bs, n) }, tickTimeUtc: ticks[0] ? stamp(ticks[0][2]) : null, tickSize: ticks[0]?.[1] ?? null }; }
  if (method === 'recent_pages') return (await A.store.last('pages', Math.min(+p.count || 10, 50))).map((r) => ({ id: r.id, book: r.bookId, events: r.count, wallMs: r.t1 - r.t0, seed: r.seedHex, preview: r.text.slice(0, 120) }));
  if (method === 'verify_ledger') { const all = (await A.store.all('ledger')).sort((a, b) => a.n - b.n); return C.verifyLedger(all); }
  if (method === 'possibility') return C.possibility(String(p.query), Math.max(1, settings.rate || curRate())).map((x) => ({ alphabet: x.mode, K: x.K, L: x.L, possibleStrings: x.space.toString(), expectedTime: C.humanTime(x.seconds) }));
  if (method === 'control') { if (!settings.agentCtl) throw new Error('The user has not allowed agents to control generation (The Origin → Allow control).'); if (typeof p.running === 'boolean') settings.running = p.running; if (p.rate >= 0) settings.rate = +p.rate; saveSettings(); return { running: settings.running, rate: settings.rate }; }
  throw new Error('unknown method');
}
function agentConnect() {
  agentDisconnect(); AG.state = 'connecting';
  const es = new EventSource(BRIDGE + '/browser/events'); AG.es = es;
  es.onopen = () => { AG.state = 'connected'; AG.onChange?.(); };
  es.onerror = () => { AG.state = es.readyState === 2 ? 'off' : 'waiting for bridge'; AG.onChange?.(); };
  es.onmessage = async (e) => { const m = JSON.parse(e.data); let result, error; try { result = await agentCall(m.method, m.params || {}); } catch (x) { error = String(x.message || x); } fetch(BRIDGE + '/browser/result', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ id: m.id, result, error }) }).catch(() => {}); };
}
function agentDisconnect() { AG.es?.close(); AG.es = null; AG.state = 'off'; }
function agentPanel() {
  const st = h('span', { class: 'pill' }), upd = () => { st.textContent = settings.agents ? AG.state : 'off'; st.className = 'pill ' + (AG.state === 'connected' ? 'ok' : ''); }; AG.onChange = upd; upd();
  const on = h('input', { type: 'checkbox', checked: !!settings.agents, onchange: (e) => { settings.agents = e.target.checked; saveSettings(); settings.agents ? agentConnect() : agentDisconnect(); upd(); } });
  const ctl = h('input', { type: 'checkbox', checked: !!settings.agentCtl, onchange: (e) => { settings.agentCtl = e.target.checked; saveSettings(); } });
  return h('div', {}, h('h3', { style: 'margin-top:22px' }, 'AI agents'), h('div', { class: 'toolbar' }, h('label', {}, on, ' Allow AI agents to read this archive '), st), h('div', { class: 'toolbar' }, h('label', {}, ctl, ' Also allow agents to pause/resume and change the rate')),
    h('p', { class: 'mute', style: 'font-size:12.5px;max-width:74ch' }, 'Agents connect through a local MCP bridge on this computer (127.0.0.1 only). Start it, then add it to your agent:'),
    h('pre', { class: 'mono', style: 'font-size:12px;background:var(--bg2);border:1px solid var(--line);padding:10px;overflow:auto' }, 'node ~/babel/babel-mcp.mjs                       # HTTP: POST http://127.0.0.1:8803/mcp\nclaude mcp add babel -- node ~/babel/babel-mcp.mjs --stdio   # Claude Code'),
    h('p', { class: 'mute', style: 'font-size:12px;max-width:74ch' }, 'Tools: status, search, get_page, get_event, recent_pages, verify_ledger, possibility, control. Agents see only what is actually archived; generation control is off unless you tick the box above. Needs this app open on the same machine (on a phone, the bridge is not reachable).'));
}

boot().catch((e) => { console.error(e); document.body.prepend(h('pre', { style: 'color:#a33;padding:20px;position:relative;z-index:9' }, 'Boot failed: ' + (e.stack || e))); });
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
