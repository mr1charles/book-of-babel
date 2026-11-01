// node search.mjs [seedHex]  → writes out/result.json (real run: seed, attempts, wall time, checkpoints)
import fs from 'node:fs'; import crypto from 'node:crypto'; import * as S from './smiley-core.js';
const seed = process.argv[2] ? parseInt(process.argv[2], 16) >>> 0 : crypto.randomBytes(4).readUInt32BE();
const checkpoints = [[0, 0]]; const t0 = Date.now();
console.log(`seed ${seed.toString(16)}  constrained cells ${S.CARE}/81  P(attempt)=2^-${S.CARE}  expected attempts ${(2 ** S.CARE).toLocaleString()}`);
const r = S.search(seed, { max: 60e9, checkpointEvery: 10_000_000, onCheckpoint: (n, ms) => { checkpoints.push([n, ms]); if (checkpoints.length % 10 === 0) console.log(n.toLocaleString(), 'attempts', (ms / 1000).toFixed(1) + 's'); } });
checkpoints.push([r.attempts, r.ms]);
const out = { engine: 'smiley-hunt/1', seed, seedHex: seed.toString(16), care: S.CARE, expectedAttempts: 2 ** S.CARE, attempt: r.attempt, attempts: r.attempts, ms: r.ms, perSecond: r.attempts / (r.ms / 1000), startedAt: new Date(t0).toISOString(), host: process.env.GITHUB_ACTIONS ? 'GitHub Actions runner' : 'local', node: process.version, checkpoints };
fs.mkdirSync('out', { recursive: true }); fs.writeFileSync('out/result.json', JSON.stringify(out));
const w = S.words(seed, r.attempt); console.log(`FOUND at attempt #${r.attempts.toLocaleString()} after ${(r.ms / 1000).toFixed(2)} s (${Math.round(out.perSecond / 1e6)}M/s)`);
for (let y = 0; y < 9; y++) console.log([...Array(9)].map((_, x) => (S.cell(w, y * 9 + x) ? '██' : '  ')).join(''));
