// node render-video.mjs → out/smiley.mp4 from out/result.json. Every frame shows a REAL attempt (seed,n) recomputed here.
import fs from 'node:fs'; import { spawn } from 'node:child_process'; import { createCanvas } from '@napi-rs/canvas'; import * as S from './smiley-core.js';
const R = JSON.parse(fs.readFileSync('out/result.json')), W = 1280, H = 720, FPS = 30, last = R.attempts - 1;
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const elapsed = (n) => { const c = R.checkpoints; let i = 0; while (i < c.length - 1 && c[i + 1][0] <= n) i++; if (i >= c.length - 1) return c[c.length - 1][1]; const [a, ta] = c[i], [b, tb] = c[i + 1]; return ta + (tb - ta) * (n - a) / (b - a); };
// frame plan: 60 attempts one-by-one, then exponential climb, then the final 30 one-by-one, then hold on the smiley
const plan = []; for (let n = 0; n < 60; n++) for (let k = 0; k < 3; k++) plan.push(n);
const climbFrames = 1320, from = 60, to = Math.max(from + 1, last - 30);
for (let f = 0; f < climbFrames; f++) plan.push(Math.min(to, Math.floor(from * Math.pow(to / from, f / (climbFrames - 1)) + (f % 7))));
for (let n = Math.max(0, last - 29); n <= last; n++) for (let k = 0; k < 3; k++) plan.push(n);
const holdStart = plan.length; for (let f = 0; f < 150; f++) plan.push(last);
const cv = createCanvas(W, H), g = cv.getContext('2d'), sans = 'DejaVu Sans, sans-serif', mono = 'DejaVu Sans Mono, monospace';
const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', String(FPS), '-i', '-', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', 'out/smiley.mp4'], { stdio: ['pipe', 'inherit', 'inherit'] });
const txt = (s, x, y, size, color, font = sans, align = 'left') => { g.font = `${size}px ${font}`; g.fillStyle = color; g.textAlign = align; g.fillText(s, x, y); };
for (let f = 0; f < plan.length; f++) {
  const n = plan[f], w = S.words(R.seed, n), sc = S.score(w), won = n === last;
  g.fillStyle = '#F4F0E7'; g.fillRect(0, 0, W, H);
  const cs = 56, gx = 70, gy = 100; // 9×9 board
  g.fillStyle = '#24231D'; g.fillRect(gx - 6, gy - 6, cs * 9 + 12, cs * 9 + 12);
  for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) { g.fillStyle = S.cell(w, y * 9 + x) ? '#000' : '#fff'; g.fillRect(gx + x * cs + 1, gy + y * cs + 1, cs - 2, cs - 2); }
  txt('THE BOOK OF BABEL — SMILEY HUNT', 70, 52, 20, '#77736B', mono);
  txt(won ? 'FOUND' : 'ATTEMPT', 640, 140, 22, won ? '#526B59' : '#77736B', mono);
  txt('#' + fmt(n + 1), 640, 215, 72, '#24231F', mono);
  txt('ELAPSED (recorded run)', 640, 285, 18, '#77736B', mono); txt((elapsed(n) / 1000).toFixed(elapsed(n) < 10000 ? 2 : 1) + ' s', 640, 335, 44, '#24231F', mono);
  txt('CELLS MATCHING THE FACE', 640, 395, 18, '#77736B', mono); txt(`${sc} / ${S.CARE}`, 640, 445, 44, won ? '#526B59' : '#24231F', mono);
  g.fillStyle = '#D8D0C2'; g.fillRect(640, 465, 520, 10); g.fillStyle = won ? '#526B59' : '#A48753'; g.fillRect(640, 465, 520 * sc / S.CARE, 10);
  txt(`chance per attempt 1 in ${fmt(2 ** S.CARE)}  ·  seed ${R.seedHex}`, 640, 505, 16, '#77736B', mono);
  // template
  txt('TARGET', 640, 560, 15, '#77736B', mono);
  for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) { const ch = S.TEMPLATE[y][x]; g.fillStyle = ch === '#' ? '#000' : ch === 'o' ? '#fff' : '#D8D0C2'; g.fillRect(780 + x * 12, 532 + y * 12, 11, 11); }
  txt('black · white · any', 905, 600, 14, '#77736B', mono);
  if (won) { for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) { if (S.TEMPLATE[y][x] === '.') { g.fillStyle = 'rgba(244,240,231,.62)'; g.fillRect(gx + x * cs + 1, gy + y * cs + 1, cs - 2, cs - 2); } else { g.strokeStyle = '#526B59'; g.lineWidth = 3; g.strokeRect(gx + x * cs + 3, gy + y * cs + 3, cs - 6, cs - 6); } } g.fillStyle = 'rgba(82,107,89,.14)'; g.fillRect(0, H - 56, W, 56); txt(`Found a smiley on attempt #${fmt(R.attempts)} — ${(R.ms / 1000).toFixed(1)} s on ${R.host}`, W / 2, H - 20, 24, '#24231F', sans, 'center'); txt('faded cells are free (random); outlined cells form the face', 70, 78, 15, '#526B59', mono); }
  else txt(f < 180 ? 'every attempt shown' : f < holdStart - 90 ? 'sampled attempts — the real search ran through all of them' : 'the last attempts before the find', 70, H - 26, 18, '#77736B', mono);
  const buf = Buffer.from(g.getImageData(0, 0, W, H).data.buffer); if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
}
ff.stdin.end(); await new Promise((r) => ff.on('close', r)); console.log('wrote out/smiley.mp4', plan.length, 'frames');
