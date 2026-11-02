// node image-search.mjs [seconds=90] → out/cartman-result.json. REAL timed run: random 15×15 16-colour pictures vs the Cartman target.
import fs from 'node:fs'; import os from 'node:os'; import crypto from 'node:crypto'; import { Worker } from 'node:worker_threads';
import { TARGET, SPRITE, PALETTE, CELLS } from './image-core.js';
const seconds = +(process.argv[2] || 90), seed = crypto.randomBytes(4).readUInt32BE(), T = +(process.env.THREADS || os.availableParallelism()), CHUNK = 2_000_000, t0 = performance.now(), startedAt = new Date().toISOString();
console.log(`seed ${seed.toString(16)} · ${seconds}s · ${T} threads`);
let next = 0, processed = 0, stopping = false; const outstanding = new Set(), checkpoints = [[0, 0]], all = [], workers = [];
await new Promise((resolve) => {
  const assign = (w) => { if (stopping || (performance.now() - t0) / 1000 >= seconds) { stopping = true; if (!outstanding.size) resolve(); return; } const from = next++ * CHUNK; outstanding.add(from); checkpoints.push([from, performance.now() - t0]); w.postMessage({ from, to: from + CHUNK }); };
  for (let i = 0; i < T; i++) { const w = new Worker(new URL('./image-worker.mjs', import.meta.url), { workerData: { seed } }); workers.push(w);
    w.on('message', (m) => { if (m.ready) return assign(w); outstanding.delete(m.from); processed += CHUNK; for (const r of m.recs) all.push(r); if (next % 40 === 0) console.log((next * CHUNK).toLocaleString(), 'tries', ((performance.now() - t0) / 1000).toFixed(0) + 's'); if (stopping && !outstanding.size) return resolve(); assign(w); }); }
});
const ms = performance.now() - t0; workers.forEach((w) => w.terminate()); checkpoints.push([processed, ms]);
all.sort((a, b) => a[0] - b[0]); const records = []; let best = -1; for (const r of all) if (r[1] > best) { best = r[1]; records.push(r); }
const out = { engine: 'image-hunt/1', seed, seedHex: seed.toString(16), size: 15, cells: CELLS, colors: 16, palette: PALETTE, sprite: SPRITE, target: TARGET, tries: processed, ms, perSecond: processed / (ms / 1000), threads: T, host: process.env.GITHUB_ACTIONS ? 'GitHub Actions runner' : 'local', startedAt, bestScore: best, bestTry: records[records.length - 1][0], records, checkpoints };
fs.mkdirSync('out', { recursive: true }); fs.writeFileSync('out/cartman-result.json', JSON.stringify(out));
console.log(`done: ${processed.toLocaleString()} tries in ${(ms / 1000).toFixed(1)}s (${Math.round(out.perSecond / 1e6)}M/s) · closest ${best}/${CELLS} at try #${out.bestTry.toLocaleString()}`);
