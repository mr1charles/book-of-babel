// v1 format — "How long does it take to generate this?"  TikTok 1080×1920, 30 s, 30 fps.
// usage: node render.mjs <result.json> [out.mp4]   (result.json from babel/site/smiley/search.mjs — a REAL run)
import fs from 'node:fs'; import { spawn } from 'node:child_process'; import { createCanvas } from '@napi-rs/canvas';
import { makeHunt } from './smiley-core.js';
const R = JSON.parse(fs.readFileSync(process.argv[2] || 'out/result.json')), HU = makeHunt(R.rows), N = HU.N, OUT = process.argv[3] || 'out/v1-smiley.mp4';
const LINK = 'mr1charles.github.io/book-of-babel', W = 1080, H = 1920, FPS = 30, TOTAL = 900, last = R.attempts - 1;
const expectedTries = HU.expectedTries, expectedSec = expectedTries / R.perSecond, luck = R.attempts / expectedTries;
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const elapsed = (n) => { const c = R.checkpoints; let i = 0; while (i < c.length - 1 && c[i + 1][0] <= n) i++; if (i >= c.length - 1) return c[c.length - 1][1]; const [a, ta] = c[i], [b, tb] = c[i + 1]; return ta + (tb - ta) * (n - a) / (b - a); };
const P = { hook: [0, 120], est: [120, 240], gen: [240, 660], rev: [660, 780], end: [780, 900] };
// generation-phase attempt plan (420 frames): 20 attempts one-by-one, exponential climb, last 10 one-by-one
const gen = []; for (let n = 0; n < 20; n++) for (let k = 0; k < 3; k++) gen.push(n);
const to = Math.max(21, last - 10); for (let f = 0; f < 330; f++) gen.push(Math.min(to, Math.floor(20 * Math.pow(to / 20, f / 329) + (f % 7))));
for (let n = last - 9; n <= last; n++) for (let k = 0; k < 3; k++) gen.push(n);
// ---- audio: ticks while generating, chime on the find
const SR = 44100, au = new Float32Array(SR * TOTAL / FPS);
const blip = (t, freq, vol, dur = 0.05) => { const s = Math.floor(t * SR); for (let i = 0; i < dur * SR && s + i < au.length; i++) au[s + i] += Math.sin(2 * Math.PI * freq * i / SR) * vol * Math.exp(-i / (dur * SR * 0.25)); };
for (let f = P.gen[0]; f < P.gen[1]; f++) { const p = (f - P.gen[0]) / 420; blip(f / FPS, 220 + 900 * p, f - P.gen[0] < 60 ? 0.28 : 0.1, 0.02); }
for (let f = P.est[0] + 10; f < P.est[0] + 100; f += 6) blip(f / FPS, 400, 0.12, 0.02);
[523, 659, 784, 1047].forEach((fr, i) => blip(P.rev[0] / FPS + i * 0.12, fr, 0.35, 0.5));
blip(P.end[0] / FPS, 392, 0.2, 0.6);
const pcm = Buffer.alloc(au.length * 2); au.forEach((v, i) => pcm.writeInt16LE(Math.max(-1, Math.min(1, v)) * 30000, i * 2));
const hdr = Buffer.alloc(44); hdr.write('RIFF', 0); hdr.writeUInt32LE(36 + pcm.length, 4); hdr.write('WAVEfmt ', 8); hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20); hdr.writeUInt16LE(1, 22); hdr.writeUInt32LE(SR, 24); hdr.writeUInt32LE(SR * 2, 28); hdr.writeUInt16LE(2, 32); hdr.writeUInt16LE(16, 34); hdr.write('data', 36); hdr.writeUInt32LE(pcm.length, 40);
fs.mkdirSync('out', { recursive: true }); fs.writeFileSync('out/v1.wav', Buffer.concat([hdr, pcm]));
// ---- video
const cv = createCanvas(W, H), g = cv.getContext('2d'), SANS = 'DejaVu Sans', MONO = 'DejaVu Sans Mono', SERIF = 'DejaVu Serif';
const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', String(FPS), '-i', '-', '-i', 'out/v1.wav', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '19', '-c:a', 'aac', '-b:a', '128k', '-shortest', OUT], { stdio: ['pipe', 'inherit', 'inherit'] });
const T = (s, x, y, size, color, font = SANS, align = 'center', weight = '') => { g.font = `${weight} ${size}px ${font}`; g.fillStyle = color; g.textAlign = align; g.fillText(s, x, y); };
const ease = (t) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
const BG = '#F4F0E7', INK = '#24231F', MUTE = '#77736B', BRASS = '#A48753', GREEN = '#526B59';
const CS = Math.floor(810 / N), GX = Math.floor((W - CS * N) / 2), GY = 470, BOT = 1480;
function board(words, mode) { // 'attempt' draws the attempt; 'target'/'found' draw the exact same target picture
  g.fillStyle = INK; g.fillRect(GX - 10, GY - 10, CS * N + 20, CS * N + 20);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const black = mode === 'attempt' ? HU.cell(words, y * N + x) : HU.target(y * N + x);
    g.fillStyle = black ? '#000' : '#fff'; g.fillRect(GX + x * CS + 2, GY + y * CS + 2, CS - 4, CS - 4);
  }
}
for (let f = 0; f < TOTAL; f++) {
  g.fillStyle = BG; g.fillRect(0, 0, W, H);
  const inR = (r) => f >= r[0] && f < r[1], lt = (r) => (f - r[0]) / (r[1] - r[0]);
  T('THE BOOK OF BABEL', W / 2, 150, 30, MUTE, MONO);
  if (inR(P.hook)) {
    const a = ease(lt(P.hook) * 3); g.globalAlpha = a;
    ['HOW LONG DOES', 'IT TAKE TO', 'GENERATE THIS?'].forEach((l, i) => T(l, W / 2, 270 + i * 84, 72, INK, SERIF, 'center', 'bold')); g.globalAlpha = 1;
    board(null, 'target'); T(`${N}×${N} · black & white · every pixel random`, W / 2, BOT - 100 + 90, 34, MUTE, MONO); T('all ' + (N * N) + ' cells must match exactly', W / 2, BOT - 100 + 140, 28, MUTE, MONO);
  } else if (inR(P.est)) {
    const p = lt(P.est); board(null, 'target');
    g.fillStyle = 'rgba(244,240,231,.9)'; g.fillRect(0, GY - 20, W, CS * 9 + 40);
    T('CHANCE PER TRY', W / 2, GY + 110, 34, MUTE, MONO); T('1 in ' + fmt(expectedTries * ease(p * 2.2)), W / 2, GY + 230, 70, INK, MONO, 'center', 'bold');
    if (p > .45) { g.globalAlpha = ease((p - .45) * 3); T('MY ESTIMATE', W / 2, GY + 420, 34, MUTE, MONO); T('~' + Math.round(expectedSec) + ' seconds', W / 2, GY + 540, 100, BRASS, SERIF, 'center', 'bold'); T(`at ${fmt(R.perSecond / 1e6)} million tries / second`, W / 2, GY + 620, 32, MUTE, MONO); g.globalAlpha = 1; }
    T('HOW LONG DOES IT TAKE TO GENERATE THIS?', W / 2, 270, 34, MUTE, SANS);
  } else if (inR(P.gen)) {
    const i = f - P.gen[0], n = gen[i], w = HU.words(R.seed, n), sc = HU.score(w); board(w, 'attempt');
    T('TRY', W / 2, 330, 36, MUTE, MONO); T('#' + fmt(n + 1), W / 2, 430, 96, INK, MONO, 'center', 'bold');
    const e = elapsed(n) / 1000; T('TIME  ' + e.toFixed(e < 10 ? 2 : 1) + ' s', W / 2, BOT - 100 + 100, 54, INK, MONO, 'center', 'bold');
    T(`${sc} / ${HU.CARE} cells match`, W / 2, BOT - 100 + 170, 36, MUTE, MONO); g.fillStyle = '#D8D0C2'; g.fillRect(190, BOT - 100 + 200, 700, 14); g.fillStyle = BRASS; g.fillRect(190, BOT - 100 + 200, 700 * sc / HU.CARE, 14);
    T(i < 60 ? 'every try shown' : i < 390 ? 'sampled — the real search ran through all of them' : 'the last tries before the find', W / 2, BOT - 100 + 290, 28, MUTE, MONO);
  } else if (inR(P.rev)) {
    const p = lt(P.rev), w = HU.words(R.seed, last); board(w, 'found');
    T('FOUND', W / 2, 320, 60, GREEN, MONO, 'center', 'bold'); T(fmt(R.attempts) + ' tries', W / 2, 420, 70, INK, MONO, 'center', 'bold');
    T((R.ms / 1000).toFixed(1) + ' seconds', W / 2, BOT - 100 + 120, 96, GREEN, SERIF, 'center', 'bold');
    T('identical to the picture at the start', W / 2, BOT - 100 + 330, 30, GREEN, MONO); if (p > .35) { g.globalAlpha = ease((p - .35) * 3); T(`my estimate was ~${Math.round(expectedSec)} s`, W / 2, BOT - 100 + 200, 38, MUTE, MONO); T(luck < 1 ? `lucky: only ${(luck * 100).toFixed(0)}% of the expected tries` : `unlucky: ${(luck * 100).toFixed(0)}% of the expected tries`, W / 2, BOT - 100 + 255, 34, INK, MONO); g.globalAlpha = 1; }
  } else {
    const p = lt(P.end), a = ease(p * 3); g.globalAlpha = a;
    board(HU.words(R.seed, last), 'found'); g.globalAlpha = 1; g.fillStyle = BG; g.fillRect(0, 0, W, H); g.globalAlpha = a;
    T('THE BOOK OF BABEL', W / 2, 560, 66, INK, SERIF, 'center', 'bold'); T('an archive of everything that could be generated', W / 2, 640, 30, MUTE, SERIF);
    g.fillStyle = INK; g.fillRect(60, 760, 960, 150); T(LINK, W / 2, 855, 36, '#EDE6D6', MONO, 'center', 'bold');
    T('watch it generate. search it. replay it.', W / 2, 1010, 36, INK, SANS); T('free · runs in your browser', W / 2, 1070, 30, MUTE, MONO); g.globalAlpha = 1;
  }
  if (!inR(P.end)) { g.fillStyle = INK; g.fillRect(0, 1330, W, 84); T(LINK, W / 2, 1385, 38, '#EDE6D6', MONO, 'center', 'bold'); }
  const buf = Buffer.from(g.getImageData(0, 0, W, H).data.buffer); if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
}
ff.stdin.end(); await new Promise((r) => ff.on('close', r)); console.log('wrote', OUT);
