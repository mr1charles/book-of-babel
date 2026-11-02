import { makeHunt } from './smiley-core.js';
let H, seed; onmessage = (e) => { const m = e.data; if (m.init) { H = makeHunt(m.rows); seed = m.seed; postMessage({ ready: true }); return; } const t = performance.now(); postMessage({ from: m.from, found: H.searchRange(seed, m.from, m.to), ms: performance.now() - t }); };
