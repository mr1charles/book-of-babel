import { parentPort, workerData } from 'node:worker_threads'; import { makeHunt } from './smiley-core.js';
const H = makeHunt(workerData.rows), seed = workerData.seed;
parentPort.on('message', (m) => { if (m.stop) process.exit(0); const t = performance.now(); parentPort.postMessage({ from: m.from, found: H.searchRange(seed, m.from, m.to), ms: performance.now() - t }); });
parentPort.postMessage({ ready: true });
