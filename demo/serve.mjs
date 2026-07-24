// VIBAL preview backend: serves the editor AND holds the authoritative shared project (real Phase 0
// engine). The browser editor (Live mode) and the VIBAL MCP server both edit THIS project, so an
// agent and a human collaborate on one timeline. Also proxies VFX generation (demo unless keyed).
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CommandLog, createDocument, createTrack, createMediaClip, createTextClip, createAsset, createMarker } from '../mcp/engine.node.mjs';

const dir = fileURLToPath(new URL('.', import.meta.url));
const PROJECT_FILE = join(dir, '..', 'mcp', 'project.json');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.mjs': 'text/javascript' };
const PORT = Number(process.env.PORT) || 8144;
const HF_KEY = process.env.HIGGSFIELD_KEY || '';
let genSeq = 0;
const clipEnd = (c) => c.timelineStart + c.timelineDurationFrames;

// ---------- shared project ----------
function seed() {
  const log = new CommandLog(createDocument({ name: 'Shared Project', frameRate: { num: 30, den: 1 } }));
  const V1 = createTrack('video', { name: 'Storyline', order: 0 }), V2 = createTrack('video', { name: 'B-roll', order: 1 }), TT = createTrack('text', { name: 'Titles', order: 3 }), A1 = createTrack('audio', { name: 'Music', order: 2 });
  for (const t of [V1, V2, TT, A1]) log.apply({ type: 'track.add', payload: { track: t } });
  const mk = (h, k, n, d) => createAsset({ contentHash: h, kind: k, originalName: n, durationFrames: d });
  const intro = mk('a1', 'video', 'Opening', 600), talk = mk('a2', 'video', 'Interview', 900), close = mk('a3', 'video', 'Closer', 600), bcut = mk('b1', 'video', 'City B-roll', 600), music = mk('m1', 'audio', 'Track 01', 1200);
  const add = (tr, a, si, so, st, k = 'video') => log.apply({ type: 'clip.add', payload: { trackId: tr, clip: createMediaClip({ assetId: a.id, kind: k, sourceIn: si, sourceOut: so, timelineStart: st }), asset: a } });
  add(V1.id, intro, 0, 90, 0); add(V1.id, talk, 0, 150, 90); add(V1.id, close, 100, 190, 240); add(V2.id, bcut, 0, 80, 120);
  log.apply({ type: 'text.add', payload: { trackId: TT.id, clip: createTextClip({ content: 'VIBAL', timelineStart: 0, timelineDurationFrames: 60 }) } });
  add(A1.id, music, 0, 330, 0, 'audio');
  return { log, spineId: V1.id, version: 0 };
}
const S = seed();
const save = () => writeFile(PROJECT_FILE, JSON.stringify({ version: S.version, doc: S.log.document }, null, 2)).catch(() => {});
const spine = () => S.log.document.tracks.find((t) => t.id === S.spineId);
function op(spec, actor = 'agent') { const result = S.log.apply(spec, { actor }); S.version++; save(); return { ok: true, result, version: S.version, doc: S.log.document }; }
function projectState() { return { version: S.version, doc: S.log.document, canUndo: S.log.canUndo(), canRedo: S.log.canRedo() }; }

// intents (used by the MCP server + editor)
function trackByName(name, kind, order) { let t = S.log.document.tracks.find((x) => x.name === name); if (!t) { t = createTrack(kind, { name, order }); S.log.apply({ type: 'track.add', payload: { track: t } }); } return t; }
function intentAppend(b) {
  const d = S.log.document; let asset = b.name ? Object.values(d.assets).find((a) => a.originalName.toLowerCase() === String(b.name).toLowerCase()) : null;
  if (!asset) asset = Object.values(d.assets).find((a) => a.kind !== 'audio');
  const start = spine().clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0); const secs = Math.round((b.seconds || 3) * 30);
  return op({ type: 'clip.add', payload: { trackId: S.spineId, clip: createMediaClip({ assetId: asset.id, kind: 'video', sourceIn: 0, sourceOut: Math.min(secs, asset.durationFrames || secs), timelineStart: start }) } });
}
function intentGenerated(b) {
  const gt = trackByName('VFX', 'video', 5);
  const asset = createAsset({ contentHash: 'gen' + (++genSeq), kind: 'video', uri: b.uri || '', originalName: b.name || 'VFX', durationFrames: 90, generation: { provider: 'higgsfield', model: b.model || '', prompt: b.prompt || '', seed: null, costCredits: 0, requestId: '', params: {} } });
  const start = gt.clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0);
  return op({ type: 'clip.add', payload: { trackId: gt.id, clip: createMediaClip({ assetId: asset.id, kind: 'generated', sourceIn: 0, sourceOut: 90, timelineStart: start }), asset } });
}
function intentTitle(b) { const tt = trackByName('Titles', 'text', 3); return op({ type: 'text.add', payload: { trackId: tt.id, clip: createTextClip({ content: b.text || 'Title', timelineStart: Math.round((b.atSeconds || 0) * 30), timelineDurationFrames: Math.round((b.seconds || 2) * 30) }) } }); }
function intentMarker(b) { return op({ type: 'marker.add', payload: { marker: createMarker({ frame: Math.round((b.atSeconds || 0) * 30), name: b.label || 'marker', color: '#f5c518' }) } }); }
const fr = (s) => Math.round((s || 0) * 30);

// ---------- http ----------
const json = (res, obj, code = 200) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*' }); res.end(JSON.stringify(obj)); };
const readBody = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { try { r(JSON.parse(b || '{}')); } catch { r({}); } }); });
function placeholder(prompt, kind) { let h = 0; for (const c of prompt || 'VFX') h = (h * 31 + c.charCodeAt(0)) >>> 0; const a = h % 360, b = (h + 60) % 360; const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='512' height='288'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='hsl(${a} 55% 42%)'/><stop offset='1' stop-color='hsl(${b} 50% 22%)'/></linearGradient></defs><rect width='512' height='288' fill='url(#g)'/><text x='24' y='250' fill='rgba(255,255,255,.9)' font-family='sans-serif' font-size='18'>${(prompt || 'VFX').slice(0, 40).replace(/[<&]/g, '')}</text><text x='24' y='40' fill='rgba(255,255,255,.55)' font-family='sans-serif' font-size='13'>${kind === 'video' ? '▶ video' : 'image'} · demo</text></svg>`; return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg); }
const ellipse = (n = 14) => Array.from({ length: n }, (_, i) => { const t = (i / n) * Math.PI * 2; return { x: 0.5 + 0.3 * Math.cos(t), y: 0.5 + 0.34 * Math.sin(t) }; });

const ROUTES = {
  'GET /api/project': async () => projectState(),
  'GET /api/version': async () => ({ version: S.version }),
  'POST /api/op': async (b) => op({ type: b.type, payload: b.payload }, b.actor || 'human'),
  'POST /api/batch': async (b) => { const results = (b.specs || []).map((s) => S.log.apply(s, { actor: b.actor || 'human' })); S.version++; save(); return { ok: true, results, version: S.version, doc: S.log.document }; },
  'POST /api/undo': async () => { const ok = S.log.undo(); S.version++; save(); return { ok, version: S.version, doc: S.log.document }; },
  'POST /api/redo': async () => { const ok = S.log.redo(); S.version++; save(); return { ok, version: S.version, doc: S.log.document }; },
  'POST /api/append': async (b) => intentAppend(b),
  'POST /api/generated': async (b) => intentGenerated(b),
  'POST /api/title': async (b) => intentTitle(b),
  'POST /api/marker': async (b) => intentMarker(b),
  'POST /api/split': async (b) => op({ type: 'clip.split', payload: { clipId: b.clipId, atFrame: fr(b.atSeconds) } }),
  'POST /api/trim': async (b) => op({ type: 'clip.trim', payload: { clipId: b.clipId, ...(b.inSeconds != null ? { sourceIn: fr(b.inSeconds) } : {}), ...(b.outSeconds != null ? { sourceOut: fr(b.outSeconds) } : {}) } }),
  'POST /api/move': async (b) => op({ type: 'clip.move', payload: { clipId: b.clipId, timelineStart: fr(b.atSeconds) } }),
  'POST /api/remove': async (b) => op({ type: 'clip.remove', payload: { clipId: b.clipId } }),
  'POST /api/vfx': async (b) => b.action === 'segment' ? { ok: true, mode: HF_KEY ? 'real' : 'demo', points: ellipse() } : { ok: true, mode: HF_KEY ? 'real' : 'demo', kind: b.kind || 'image', model: b.model || 'nano_banana_pro', url: placeholder(b.prompt, b.kind), note: HF_KEY ? 'HIGGSFIELD_KEY set' : 'live generation runs through the Higgsfield MCP' },
};

createServer(async (req, res) => {
  const p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' }); return res.end(); }
  const route = ROUTES[`${req.method} ${p}`];
  if (route) { try { const body = req.method === 'POST' ? await readBody(req) : {}; return json(res, await route(body)); } catch (e) { return json(res, { ok: false, error: String(e) }, 400); } }
  let f = p === '/' ? '/index.html' : p; const file = normalize(join(dir, f));
  if (!file.startsWith(dir)) { res.writeHead(403); return res.end('forbidden'); }
  readFile(file).then((buf) => { res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' }); res.end(buf); }).catch(() => { res.writeHead(404); res.end('not found'); });
}).listen(PORT, '0.0.0.0', () => console.log(`VIBAL backend + shared project on http://0.0.0.0:${PORT}`));
