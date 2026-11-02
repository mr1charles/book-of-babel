// node search.mjs [size=6] [seedHex]  → out/result.json. Multi-core, exact 1-to-1 N×N picture; REAL run.
import fs from 'node:fs'; import os from 'node:os'; import crypto from 'node:crypto'; import { Worker } from 'node:worker_threads';
import { makeHunt, PRESETS } from './smiley-core.js';
const size = +(process.argv[2] || 6), rows = PRESETS[size]; if (!rows) throw new Error('size must be 5 or 6');
const seed = process.argv[3] ? parseInt(process.argv[3], 16) >>> 0 : crypto.randomBytes(4).readUInt32BE();
const H = makeHunt(rows), T = Math.max(1, os.availableParallelism()), CHUNK = size === 5 ? 2_000_000 : 20_000_000, t0 = performance.now();
console.log(`${size}×${size} exact · seed ${seed.toString(16)} · 1 in ${H.expectedTries.toLocaleString()} · ${T} threads`);
const PF = process.env.GITHUB_ACTIONS ? null : `${process.env.HOME}/.babel-progress/status.json`; const startedAt = Date.now();
const report = (state, extra = {}) => { if (!PF) return; try { fs.mkdirSync(PF.replace(/\/[^/]*$/, ''), { recursive: true }); const tries = processed, rate = tries / ((performance.now() - t0) / 1000 || 1); fs.writeFileSync(PF, JSON.stringify({ job: 'smiley', title: `Local: exact ${size}×${size} smiley hunt`, state, tries, expected: H.expectedTries, rate: rate || 1e8, startedAt, updatedAt: Date.now(), ...extra })); } catch {} };
const rep = setInterval(() => report('running'), 1000); report('running');
let next = 0, best = Infinity, processed = 0, checkpoints = [[0, 0]]; const outstanding = new Set(), workers = [];
await new Promise((resolve) => {
  const assign = (w) => { if (next * CHUNK > best) return; const from = next++ * CHUNK; outstanding.add(from); checkpoints.push([from, performance.now() - t0]); w.postMessage({ from, to: from + CHUNK }); };
  for (let i = 0; i < T; i++) {
    const w = new Worker(new URL('./search-worker.mjs', import.meta.url), { workerData: { rows, seed } }); workers.push(w);
    w.on('message', (m) => {
      if (m.ready) return assign(w);
      outstanding.delete(m.from); processed += CHUNK; if (m.found >= 0) best = Math.min(best, m.found);
      if (next % 50 === 0) console.log((next * CHUNK).toLocaleString(), 'tries', ((performance.now() - t0) / 1000).toFixed(0) + 's');
      if (best < Infinity && ![...outstanding].some((s) => s <= best)) return resolve();
      assign(w);
    });
  }
});
clearInterval(rep); const ms = performance.now() - t0; workers.forEach((w) => w.terminate()); checkpoints.push([best + 1, ms]);
const out = { engine: 'smiley-hunt/2-exact', size, rows, seed, seedHex: seed.toString(16), care: H.CARE, expectedAttempts: H.expectedTries, attempt: best, attempts: best + 1, processed, ms, perSecond: processed / (ms / 1000), threads: T, startedAt: new Date(Date.now() - ms).toISOString(), host: process.env.GITHUB_ACTIONS ? 'GitHub Actions runner' : 'local', node: process.version, checkpoints };
fs.mkdirSync('out', { recursive: true }); fs.writeFileSync('out/result.json', JSON.stringify(out));
report('done', { result: { attempts: best + 1, ms } });
console.log(`FOUND exact match at try #${out.attempts.toLocaleString()} after ${(ms / 1000).toFixed(1)} s (${Math.round(out.perSecond / 1e6)}M tries/s on ${T} threads)`);
const w = H.words(seed, best); for (let y = 0; y < size; y++) console.log([...Array(size)].map((_, x) => (H.cell(w, y * size + x) ? '██' : '  ')).join(''));
const ok = [...Array(size * size)].every((_, i) => H.cell(w, i) === H.target(i)); console.log('verified identical to target:', ok); if (!ok) process.exit(1);
