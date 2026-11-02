#!/usr/bin/env node
// Book of Babel — MCP bridge. Lets AI agents query the archive held by the open Book of Babel app.
//   stdio (Claude Code):  claude mcp add babel -- node ~/babel/babel-mcp.mjs --stdio
//   HTTP  (other agents): POST http://127.0.0.1:8803/mcp   (JSON-RPC, MCP streamable-HTTP, single JSON replies)
// The archive lives in the browser tab; this process only relays. Nothing is invented here: if no app is
// connected, tools return an error. Binds to loopback only; rejects foreign Host headers (DNS-rebinding guard).
import http from 'node:http';
const PORT = +process.env.BABEL_MCP_PORT || 8803, STDIO = process.argv.includes('--stdio');
const log = (...a) => process.stderr.write(a.join(' ') + '\n');
let browser = null; const pending = new Map(); let nextId = 1;

const TOOLS = [
  ['babel_status', 'Current state: event count, pages/books/boards archived, rate, whether generation is running, ledger head.', {}],
  ['babel_search', 'Exact, case-sensitive substring search over archived pages (also resolves P-/B-/BRD-/E- IDs, 8-hex seeds, 64-hex hashes). Returns real matches only, or none.', { query: { type: 'string' }, limit: { type: 'number' } }, ['query']],
  ['babel_get_page', 'Full text and generation record of an archived page (index number or P-id).', { page: { type: 'string' } }, ['page']],
  ['babel_get_event', 'Recompute what generation event N produced (character, pixel) and its recorded tick time.', { event: { type: 'number' } }, ['event']],
  ['babel_recent_pages', 'The most recently archived pages (metadata + short preview).', { count: { type: 'number' } }],
  ['babel_verify_ledger', 'Verify the append-only hash chain of the generation ledger.', {}],
  ['babel_possibility', 'Theoretical odds/time to generate an exact string (not archive data).', { query: { type: 'string' } }, ['query']],
  ['babel_smiley_progress', 'Progress of the exact-smiley hunt (local or GitHub Actions): percent, estimate, whether it finished. Works without the app open; needs the progress server (node ~/babel/progress/progress-server.mjs).', {}],
  ['babel_progress_report', 'Report your own job to the shared progress board (shown full-screen at 22:00). Call at start, on meaningful progress, and when finished. Only report real progress.', { id: { type: 'string', description: 'stable id, a-z 0-9 _ . -' }, title: { type: 'string' }, agent: { type: 'string' }, state: { type: 'string', enum: ['running', 'done', 'failed', 'queued'] }, pct: { type: 'number' }, done: { type: 'number' }, total: { type: 'number' }, etaSeconds: { type: 'number' }, note: { type: 'string' } }, ['id']],
  ['babel_control', 'Pause/resume generation or set events/sec. Only works if the user enabled agent control in The Origin.', { running: { type: 'boolean' }, rate: { type: 'number' } }],
].map(([name, description, properties, required]) => ({ name, description, inputSchema: { type: 'object', properties, required: required || [] } }));

function callBrowser(method, params) {
  return new Promise((res, rej) => {
    if (!browser) return rej(new Error('No Book of Babel app connected. Open the app and switch on “Allow AI agents” in The Origin.'));
    const id = nextId++, t = setTimeout(() => { pending.delete(id); rej(new Error('App did not answer in 30 s')); }, 30000);
    pending.set(id, { res, rej, t }); browser.write(`data: ${JSON.stringify({ id, method, params })}\n\n`);
  });
}
async function rpc(m) {
  const { id, method, params } = m; const ok = (result) => ({ jsonrpc: '2.0', id, result }); const bad = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
  if (method === 'initialize') return ok({ protocolVersion: params?.protocolVersion || '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'book-of-babel', version: '1.0.0' }, instructions: 'Read-only window onto a Book of Babel archive. Results are real recorded generation data; absence of a match means that exact text has not been generated.' });
  if (method === 'tools/list') return ok({ tools: TOOLS });
  if (method === 'tools/call') {
    const t = TOOLS.find((x) => x.name === params?.name); if (!t) return bad(-32602, 'unknown tool');
    if (t.name === 'babel_progress_report') { try { const a = params.arguments || {}; const r = await fetch('http://127.0.0.1:8805/api/jobs/' + encodeURIComponent(a.id), { method: 'POST', body: JSON.stringify(a) }); return ok({ content: [{ type: 'text', text: await r.text() }], isError: !r.ok }); } catch { return ok({ isError: true, content: [{ type: 'text', text: 'progress server not running: node ~/babel/progress/progress-server.mjs' }] }); } }
    if (t.name === 'babel_smiley_progress') { try { const r = await (await fetch('http://127.0.0.1:8805/api/status')).json(); return ok({ content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] }); } catch { return ok({ isError: true, content: [{ type: 'text', text: 'progress server not running: node ~/babel/progress/progress-server.mjs' }] }); } }
    try { const r = await callBrowser(t.name.replace('babel_', ''), params.arguments || {}); return ok({ content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] }); }
    catch (e) { return ok({ isError: true, content: [{ type: 'text', text: e.message }] }); }
  }
  if (method === 'ping') return ok({});
  if (id === undefined) return null; // notification
  return bad(-32601, 'method not found');
}

const okHost = (h) => /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(h || '');
const okOrigin = (o) => !o || /^(https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?|capacitor:\/\/localhost|ionic:\/\/localhost)$/.test(o);
const server = http.createServer(async (req, res) => {
  if (!okHost(req.headers.host)) { res.writeHead(403).end('bad host'); return; }
  const origin = req.headers.origin, isBrowserEp = req.url.startsWith('/browser/');
  if (isBrowserEp) { if (!okOrigin(origin)) { res.writeHead(403).end('bad origin'); return; } if (origin) res.setHeader('Access-Control-Allow-Origin', origin); }
  if (req.url === '/browser/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' }); res.write(': hi\n\n');
    browser = res; log('app connected'); req.on('close', () => { if (browser === res) browser = null; log('app disconnected'); }); return;
  }
  if (req.method === 'POST' && req.url === '/browser/result') {
    let b = ''; for await (const c of req) b += c; const m = JSON.parse(b), p = pending.get(m.id); if (p) { clearTimeout(p.t); pending.delete(m.id); m.error ? p.rej(new Error(m.error)) : p.res(m.result); } res.writeHead(204).end(); return;
  }
  if (req.method === 'POST' && req.url === '/mcp') {
    if (origin) { res.writeHead(403).end('browsers may not call /mcp'); return; }
    let b = ''; for await (const c of req) b += c; let m; try { m = JSON.parse(b); } catch { res.writeHead(400).end(); return; }
    const out = Array.isArray(m) ? (await Promise.all(m.map(rpc))).filter(Boolean) : await rpc(m);
    if (!out || (Array.isArray(out) && !out.length)) { res.writeHead(202).end(); return; }
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(out)); return;
  }
  if (req.url === '/health') { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ appConnected: !!browser })); return; }
  res.writeHead(404).end();
});
server.on('error', (e) => { log('bridge http error:', e.code === 'EADDRINUSE' ? `port ${PORT} busy (another bridge running?)` : e.message); if (!STDIO) process.exit(1); });
server.listen(PORT, '127.0.0.1', () => log(`Book of Babel MCP bridge on http://127.0.0.1:${PORT}  (app relay: /browser/events, agents: POST /mcp${STDIO ? ', stdio active' : ''})`));
if (STDIO) {
  let buf = ''; process.stdin.setEncoding('utf8');
  process.stdin.on('data', async (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!line) continue; try { const r = await rpc(JSON.parse(line)); if (r) process.stdout.write(JSON.stringify(r) + '\n'); } catch (e) { log('bad message', e.message); } } });
}
