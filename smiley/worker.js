import * as S from './smiley-core.js';
let run = null;
onmessage = (e) => { const m = e.data; if (m.cmd === 'stop') { run = null; return; }
  if (m.cmd === 'start') { const id = run = {}; const seed = m.seed >>> 0; let n = 0; const t0 = performance.now(); let lastPost = 0;
    const slice = () => { if (run !== id) return; const end = n + 2_000_000, sT = performance.now();
      for (; n < end; n++) { const a = S.words(seed, n); if (S.isSmiley(a)) { postMessage({ type: 'found', n, ms: performance.now() - t0, words: a }); run = null; return; } }
      const now = performance.now(); if (now - lastPost > 40) { lastPost = now; postMessage({ type: 'tick', n, ms: now - t0, words: S.words(seed, n - 1) }); } setTimeout(slice); };
    slice(); } };
