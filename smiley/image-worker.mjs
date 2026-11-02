import { parentPort, workerData } from 'node:worker_threads'; import { scanRange } from './image-core.js';
parentPort.on('message', (m) => { if (m.stop) process.exit(0); parentPort.postMessage({ from: m.from, recs: scanRange(workerData.seed, m.from, m.to) }); });
parentPort.postMessage({ ready: true });
