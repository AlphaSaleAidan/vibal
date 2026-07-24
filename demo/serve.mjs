import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('.', import.meta.url));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.mp4': 'video/mp4' };
const PORT = Number(process.env.PORT) || 8144;
const HF_KEY = process.env.HIGGSFIELD_KEY || '';

const json = (res, obj) => { res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); };

// A colored SVG data-URI placeholder so demo mode still shows a "generated" tile.
function placeholder(prompt, kind) {
  let h = 0; for (const c of prompt) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const a = h % 360, b = (h + 60) % 360;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='512' height='288'>
    <defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>
    <stop offset='0' stop-color='hsl(${a} 55% 42%)'/><stop offset='1' stop-color='hsl(${b} 50% 22%)'/></linearGradient></defs>
    <rect width='512' height='288' fill='url(#g)'/>
    <text x='24' y='250' fill='rgba(255,255,255,.9)' font-family='sans-serif' font-size='18'>${(prompt || 'VFX').slice(0, 40).replace(/[<&]/g, '')}</text>
    <text x='24' y='40' fill='rgba(255,255,255,.55)' font-family='sans-serif' font-size='13'>${kind === 'video' ? '▶ video' : '🖼 image'} · demo</text>
  </svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}
const ellipse = (n = 14) => Array.from({ length: n }, (_, i) => { const t = (i / n) * Math.PI * 2; return { x: 0.5 + 0.3 * Math.cos(t), y: 0.5 + 0.34 * Math.sin(t) }; });

async function handleVfx(body, res) {
  if (body.action === 'segment') { return json(res, { ok: true, mode: HF_KEY ? 'real' : 'demo', points: ellipse() }); }
  // Live REST wiring lands in Phase 1; if a key is present we'd call Higgsfield here.
  // Browser -> node cannot reach the Higgsfield MCP (that's the agent runtime), so demo by default.
  return json(res, {
    ok: true, mode: HF_KEY ? 'real' : 'demo', kind: body.kind || 'image', model: body.model || 'nano_banana_pro',
    url: placeholder(body.prompt, body.kind),
    note: HF_KEY ? 'HIGGSFIELD_KEY set — REST client wires in Phase 1' : 'live generation runs through the Higgsfield MCP (agent runtime)',
  });
}

createServer((req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (req.method === 'POST' && p === '/api/vfx') {
    let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { try { handleVfx(JSON.parse(b || '{}'), res); } catch (e) { json(res, { ok: false, error: String(e) }); } });
    return;
  }
  if (p === '/') p = '/index.html';
  const file = normalize(join(dir, p));
  if (!file.startsWith(dir)) { res.writeHead(403); return res.end('forbidden'); }
  readFile(file).then((buf) => { res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' }); res.end(buf); })
    .catch(() => { res.writeHead(404); res.end('not found'); });
}).listen(PORT, '0.0.0.0', () => console.log(`VIBAL demo on http://0.0.0.0:${PORT}`));
