// v1 format — Cartman edition. node render-cartman.mjs out/cartman-result.json out/v1-cartman.mp4
// Every random picture shown is recomputed from (seed, try number); numbers come from the recorded run.
import fs from 'node:fs'; import { spawn } from 'node:child_process'; import { createCanvas } from '@napi-rs/canvas';
import { picture, scorePicture, TARGET, N, CELLS, PALETTE } from './image-core.js';
const R = JSON.parse(fs.readFileSync(process.argv[2] || 'out/cartman-result.json')), OUT = process.argv[3] || 'out/v1-cartman.mp4';
const LINK = 'mr1charles.github.io/book-of-babel', W = 1080, H = 1920, FPS = 30, TOTAL = 900, last = R.tries - 1;
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const sci = (log10) => { const e = Math.floor(log10), m = Math.pow(10, log10 - e); return `${m.toFixed(1)} × 10^${e}`; };
const LOG_POSSIBLE = CELLS * Math.log10(16);                                   // 16^225
const LOG_YEARS = LOG_POSSIBLE - Math.log10(R.perSecond) - Math.log10(365.25 * 86400);
const elapsed = (n) => { const c = R.checkpoints; let i = 0; while (i < c.length - 1 && c[i + 1][0] <= n) i++; if (i >= c.length - 1) return c[c.length - 1][1]; const [a, ta] = c[i], [b, tb] = c[i + 1]; return ta + (tb - ta) * (n - a) / (b - a); };
const bestAt = (n) => { let r = R.records[0]; for (const x of R.records) { if (x[0] <= n) r = x; else break; } return r; };
const P = { hook: [0, 120], est: [120, 270], run: [270, 660], rev: [660, 780], end: [780, 900] };
const plan = []; for (let n = 0; n < 20; n++) for (let k = 0; k < 3; k++) plan.push(n);
const to = Math.max(21, last - 10); for (let f = 0; f < 300; f++) plan.push(Math.min(to, Math.floor(20 * Math.pow(to / 20, f / 299) + (f % 7))));
for (let n = last - 9; n <= last; n++) for (let k = 0; k < 3; k++) plan.push(n);
// audio: ticks while running, low tone at the reveal
const SR = 44100, au = new Float32Array(SR * TOTAL / FPS);
const blip = (t, freq, vol, dur = 0.05) => { const s = Math.floor(t * SR); for (let i = 0; i < dur * SR && s + i < au.length; i++) au[s + i] += Math.sin(2 * Math.PI * freq * i / SR) * vol * Math.exp(-i / (dur * SR * 0.25)); };
for (let f = P.run[0]; f < P.run[1]; f++) { const p = (f - P.run[0]) / 390; blip(f / FPS, 220 + 900 * p, f - P.run[0] < 60 ? 0.28 : 0.1, 0.02); }
for (let f = P.est[0] + 10; f < P.est[0] + 100; f += 6) blip(f / FPS, 400, 0.12, 0.02);
blip(P.rev[0] / FPS, 147, 0.4, 0.9); blip(P.end[0] / FPS, 392, 0.2, 0.6);
const pcm = Buffer.alloc(au.length * 2); au.forEach((v, i) => pcm.writeInt16LE(Math.max(-1, Math.min(1, v)) * 30000, i * 2));
const hdr = Buffer.alloc(44); hdr.write('RIFF', 0); hdr.writeUInt32LE(36 + pcm.length, 4); hdr.write('WAVEfmt ', 8); hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20); hdr.writeUInt16LE(1, 22); hdr.writeUInt32LE(SR, 24); hdr.writeUInt32LE(SR * 2, 28); hdr.writeUInt16LE(2, 32); hdr.writeUInt16LE(16, 34); hdr.write('data', 36); hdr.writeUInt32LE(pcm.length, 40);
fs.mkdirSync('out', { recursive: true }); fs.writeFileSync('out/cartman.wav', Buffer.concat([hdr, pcm]));
const cv = createCanvas(W, H), g = cv.getContext('2d'), SANS = 'DejaVu Sans', MONO = 'DejaVu Sans Mono', SERIF = 'DejaVu Serif';
const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', String(FPS), '-i', '-', '-i', 'out/cartman.wav', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '19', '-c:a', 'aac', '-b:a', '128k', '-shortest', OUT], { stdio: ['pipe', 'inherit', 'inherit'] });
const T = (s, x, y, size, color, font = SANS, align = 'center', weight = '') => { g.font = `${weight} ${size}px ${font}`; g.fillStyle = color; g.textAlign = align; g.fillText(s, x, y); };
const ease = (t) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
const BG = '#F4F0E7', INK = '#24231F', MUTE = '#77736B', BRASS = '#A48753', GREEN = '#526B59', RED = '#9A4A3F';
function board(pic, x, y, cs) { g.fillStyle = INK; g.fillRect(x - 8, y - 8, cs * N + 16, cs * N + 16); for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) { g.fillStyle = PALETTE[pic[r * N + c]]; g.fillRect(x + c * cs + 1, y + r * cs + 1, cs - 2, cs - 2); } }
const TGT = Uint8Array.from(TARGET), GX = 135, GY = 470, CS = 54, BOT = 1480;
for (let f = 0; f < TOTAL; f++) {
  g.fillStyle = BG; g.fillRect(0, 0, W, H); const inR = (r) => f >= r[0] && f < r[1], lt = (r) => (f - r[0]) / (r[1] - r[0]);
  T('THE BOOK OF BABEL', W / 2, 150, 30, MUTE, MONO);
  if (inR(P.hook)) {
    g.globalAlpha = ease(lt(P.hook) * 3); ['HOW LONG DOES', 'IT TAKE TO', 'GENERATE THIS?'].forEach((l, i) => T(l, W / 2, 270 + i * 84, 72, INK, SERIF, 'center', 'bold')); g.globalAlpha = 1;
    board(TGT, GX, GY, CS); T('15×15 · 16 colours · every pixel random', W / 2, BOT - 10, 34, MUTE, MONO); T('Eric Cartman, all 225 pixels must match', W / 2, BOT + 44, 28, MUTE, MONO);
  } else if (inR(P.est)) {
    const p = lt(P.est); board(TGT, GX, GY, CS); g.fillStyle = 'rgb(244,240,231)'; g.fillRect(0, GY - 20, W, CS * N + 40);
    T('CHANCE PER TRY', W / 2, GY + 100, 34, MUTE, MONO); T('1 in ' + sci(LOG_POSSIBLE), W / 2, GY + 210, 66, INK, MONO, 'center', 'bold');
    if (p > .3) { g.globalAlpha = ease((p - .3) * 3); T('ESTIMATE TO MATCH EXACTLY', W / 2, GY + 360, 34, MUTE, MONO); T('~' + sci(LOG_YEARS) + ' years', W / 2, GY + 470, 66, BRASS, SERIF, 'center', 'bold'); T(`at ${fmt(R.perSecond / 1e6)} million tries / second`, W / 2, GY + 540, 30, MUTE, MONO); g.globalAlpha = 1; }
    if (p > .62) { g.globalAlpha = ease((p - .62) * 3); T('the universe is 1.4 × 10^10 years old', W / 2, GY + 650, 34, INK, MONO); T(`so I let it try for ${Math.round(R.ms / 1000)} seconds`, W / 2, GY + 710, 32, RED, MONO); g.globalAlpha = 1; }
    T('HOW LONG DOES IT TAKE TO GENERATE THIS?', W / 2, 270, 34, MUTE, SANS);
  } else if (inR(P.run)) {
    const n = plan[f - P.run[0]], pic = picture(R.seed, n), b = bestAt(n), bpic = picture(R.seed, b[0]); board(pic, GX, GY, CS);
    T('TRY', W / 2, 330, 36, MUTE, MONO); T('#' + fmt(n + 1), W / 2, 430, 84, INK, MONO, 'center', 'bold');
    T('TIME ' + (elapsed(n) / 1000).toFixed(elapsed(n) < 10000 ? 2 : 1) + ' s', 90, BOT + 20, 50, INK, MONO, 'left', 'bold');
    T(`closest so far: ${b[1]} / ${CELLS}`, 90, BOT + 90, 36, b[1] > 25 ? GREEN : MUTE, MONO, 'left'); g.fillStyle = '#D8D0C2'; g.fillRect(90, BOT + 115, 560, 14); g.fillStyle = BRASS; g.fillRect(90, BOT + 115, 560 * b[1] / CELLS, 14);
    T('pixels matching', 90, BOT + 170, 26, MUTE, MONO, 'left'); T('closest', 840, BOT - 30, 24, MUTE, MONO); board(bpic, 735, BOT, 14);
    T(f - P.run[0] < 60 ? 'every try shown' : f - P.run[0] < 360 ? 'sampled — the real run went through all of them' : 'the last tries of the run', W / 2, BOT + 330, 26, MUTE, MONO);
  } else if (inR(P.rev)) {
    const p = lt(P.rev), bpic = picture(R.seed, R.bestTry); T("TIME'S UP", W / 2, 300, 64, RED, MONO, 'center', 'bold'); T(`${fmt(R.tries)} tries · ${(R.ms / 1000).toFixed(0)} s`, W / 2, 380, 40, INK, MONO, 'center', 'bold');
    board(TGT, 50, 520, 32); board(bpic, 550, 520, 32); T('TARGET', 290, 1070, 30, MUTE, MONO); T('CLOSEST TRY', 790, 1070, 30, MUTE, MONO);
    T(`${R.bestScore} / ${CELLS} pixels right`, W / 2, 1170, 64, INK, SERIF, 'center', 'bold'); T(`(random pixels would get about ${Math.round(CELLS / 16)})`, W / 2, 1225, 28, MUTE, MONO);
    if (p > .45) { g.globalAlpha = ease((p - .45) * 3); T(`all ${CELLS} right: ~${sci(LOG_YEARS)} years`, W / 2, 1290, 36, BRASS, MONO, 'center', 'bold'); g.globalAlpha = 1; }
  } else {
    const a = ease(lt(P.end) * 3); g.globalAlpha = a; T('THE BOOK OF BABEL', W / 2, 560, 66, INK, SERIF, 'center', 'bold'); T('an archive of everything that could be generated', W / 2, 640, 30, MUTE, SERIF);
    g.fillStyle = INK; g.fillRect(60, 760, 960, 150); T(LINK, W / 2, 855, 36, '#EDE6D6', MONO, 'center', 'bold'); T('watch it generate. search it. replay it.', W / 2, 1010, 36, INK, SANS); T('free · runs in your browser', W / 2, 1070, 30, MUTE, MONO); g.globalAlpha = 1;
  }
  if (!inR(P.end) && !inR(P.rev)) { g.fillStyle = INK; g.fillRect(0, 1330, W, 84); T(LINK, W / 2, 1385, 38, '#EDE6D6', MONO, 'center', 'bold'); }
  else if (inR(P.rev)) { g.fillStyle = INK; g.fillRect(0, 1390, W, 84); T(LINK, W / 2, 1445, 38, '#EDE6D6', MONO, 'center', 'bold'); }
  const buf = Buffer.from(g.getImageData(0, 0, W, H).data.buffer); if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
}
ff.stdin.end(); await new Promise((r) => ff.on('close', r)); console.log('wrote', OUT);
