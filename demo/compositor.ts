// Canvas compositor — renders the timeline document at the playhead into a <canvas>.
// Real preview core: interpolates keyframes (so Track's motion is VISIBLE), applies transform/
// opacity, clips to masks, draws text clips, and covers generated clips with their image.
// Procedural fills stand in for source footage until WebCodecs decodes real video files.
import type { VibalDocument, Clip, MediaClip, TextClip } from '../src/document/types';

export interface CompCtx { aspect: string; mask: (id: string) => Array<{ x: number; y: number }> | undefined; requestRedraw: () => void; playing?: boolean; }

const AS: Record<string, [number, number]> = { '16:9': [1280, 720], '9:16': [720, 1280], '1:1': [900, 900] };
const imgCache = new Map<string, HTMLImageElement>();

// ---- video decoder pool: one <video> per source, seek-on-scrub, play-through on playback ----
const videoPool = new Map<string, HTMLVideoElement>();
const isVideoUri = (u: string) => /\.(mp4|webm|mov|m4v)(\?|$)/i.test(u);
function getVideo(uri: string, redraw: () => void): HTMLVideoElement {
  let v = videoPool.get(uri);
  if (!v) { v = document.createElement('video'); v.muted = true; (v as any).playsInline = true; v.preload = 'auto'; v.loop = false; v.style.display = 'none'; v.src = uri; document.body.appendChild(v); v.addEventListener('loadeddata', redraw); v.addEventListener('seeked', redraw); videoPool.set(uri, v); }
  return v;
}
function syncVideo(v: HTMLVideoElement, target: number, playing: boolean) {
  if (playing) { if (v.paused) { try { if (Math.abs(v.currentTime - target) > 0.3) v.currentTime = target; v.play(); } catch { /* */ } } else if (Math.abs(v.currentTime - target) > 0.4) v.currentTime = target; }
  else { if (!v.paused) v.pause(); if (Math.abs(v.currentTime - target) > 0.04) { try { v.currentTime = target; } catch { /* */ } } }
}
const cover = (g: CanvasRenderingContext2D, iw: number, ih: number, W: number, H: number, draw: (x: number, y: number, w: number, h: number) => void) => { const r = Math.max(W / iw, H / ih); draw((W - iw * r) / 2, (H - ih * r) / 2, iw * r, ih * r); };
const hue = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h % 360; };
const clipEnd = (c: Clip) => c.timelineStart + c.timelineDurationFrames;
const nameOf = (d: VibalDocument, c: Clip) => c.kind === 'text' ? (c as TextClip).text.content : (d.assets[(c as MediaClip).assetId]?.originalName ?? c.kind);
const ease = (t: number, interp: string) => interp === 'hold' ? 0 : interp === 'bezier' ? t * t * (3 - 2 * t) : t;

function evalKf(c: Clip, path: string, frame: number, def: number): number {
  const arr = (c.keyframes as any)[path]; if (!arr || !arr.length) return def;
  if (frame <= arr[0].frame) return arr[0].value;
  if (frame >= arr[arr.length - 1].frame) return arr[arr.length - 1].value;
  for (let i = 0; i < arr.length - 1; i++) { const a = arr[i], b = arr[i + 1]; if (frame >= a.frame && frame <= b.frame) { const t = (frame - a.frame) / ((b.frame - a.frame) || 1); return a.value + (b.value - a.value) * ease(t, a.interp); } }
  return def;
}
function getImg(uri: string, redraw: () => void): HTMLImageElement | null {
  if (!uri) return null;
  const looksImg = uri.startsWith('data:image') || uri.startsWith('http') || /\.(png|jpe?g|webp|gif|svg)$/i.test(uri);
  if (!looksImg) return null;
  let im = imgCache.get(uri); if (im) return (im.complete && im.naturalWidth) ? im : null;
  im = new Image(); im.onload = redraw; im.onerror = () => {}; im.src = uri; imgCache.set(uri, im); return null;
}

export function renderComposite(canvas: HTMLCanvasElement, d: VibalDocument, playhead: number, ctx: CompCtx): void {
  const [W, H] = AS[ctx.aspect] || AS['16:9']; canvas.width = W; canvas.height = H;
  const g = canvas.getContext('2d')!; g.fillStyle = '#050506'; g.fillRect(0, 0, W, H);
  const f = Math.round(playhead);
  const tracks = [...d.tracks].filter((t) => t.kind !== 'audio' && t.kind !== 'effect').sort((a, b) => a.order - b.order);
  for (const t of tracks) for (const c of t.clips) { if (f < c.timelineStart || f >= clipEnd(c)) continue; drawClip(g, d, c, f, W, H, ctx); }
}

function drawClip(g: CanvasRenderingContext2D, d: VibalDocument, c: Clip, f: number, W: number, H: number, ctx: CompCtx) {
  const op = Math.max(0, Math.min(1, evalKf(c, 'opacity', f, (c as any).opacity ?? 1)));
  const tx = evalKf(c, 'transform.x', f, c.transform.x), ty = evalKf(c, 'transform.y', f, c.transform.y);
  const sc = evalKf(c, 'transform.scale', f, c.transform.scale), rot = evalKf(c, 'transform.rotation', f, c.transform.rotation);
  g.save(); g.globalAlpha = op;
  g.translate(W / 2 + tx / 1920 * W, H / 2 + ty / 1080 * H); g.rotate(rot * Math.PI / 180); g.scale(sc, sc);
  if (c.kind === 'text') { drawText(g, c as TextClip, W, H); g.restore(); return; }
  g.translate(-W / 2, -H / 2);
  const mask = ctx.mask(c.id);
  if (mask && mask.length > 2) { g.beginPath(); mask.forEach((p, i) => { const x = p.x * W, y = p.y * H; i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath(); g.clip(); }
  const asset = d.assets[(c as MediaClip).assetId];
  const img = asset?.uri ? getImg(asset.uri, ctx.requestRedraw) : null;
  if (img) { cover(g, img.naturalWidth, img.naturalHeight, W, H, (x, y, w, h) => g.drawImage(img, x, y, w, h)); }
  else if (asset?.uri && isVideoUri(asset.uri)) {
    const v = getVideo(asset.uri, ctx.requestRedraw);
    if (v.readyState >= 2 && v.videoWidth) {
      const speed = (c as MediaClip).speed || 1;
      syncVideo(v, ((c as MediaClip).sourceIn + (f - c.timelineStart) * speed) / 30, !!ctx.playing);
      cover(g, v.videoWidth, v.videoHeight, W, H, (x, y, w, h) => g.drawImage(v, x, y, w, h));
    } else drawProcedural(g, d, c, f, W, H);
  }
  else drawProcedural(g, d, c, f, W, H);
  g.restore();
}
function drawProcedural(g: CanvasRenderingContext2D, d: VibalDocument, c: Clip, f: number, W: number, H: number) {
  const h = 200 + (hue(nameOf(d, c)) % 46);
  const grd = g.createLinearGradient(0, 0, W, H); grd.addColorStop(0, `hsl(${h} 45% 30%)`); grd.addColorStop(1, `hsl(${h} 48% 13%)`);
  g.fillStyle = grd; g.fillRect(0, 0, W, H);
  const prog = (f - c.timelineStart) / Math.max(1, c.timelineDurationFrames);
  g.fillStyle = `hsla(${(h + 45) % 360} 70% 62% / .45)`;
  g.beginPath(); g.arc(W * (0.18 + 0.64 * prog), H * (0.5 + 0.16 * Math.sin(prog * 6.283)), Math.min(W, H) * 0.1, 0, 6.29); g.fill();
  g.fillStyle = 'rgba(255,255,255,.9)'; g.font = `600 ${Math.round(H * 0.055)}px sans-serif`; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  g.fillText(nameOf(d, c), W * 0.05, H * 0.9);
}
function drawText(g: CanvasRenderingContext2D, c: TextClip, W: number, H: number) {
  const t = c.text; const size = (t.sizePx || 64) / 1080 * H;
  g.fillStyle = t.color || '#fff'; g.font = `700 ${Math.round(size)}px ${t.font || 'Inter'},sans-serif`;
  g.textAlign = t.alignment === 'left' ? 'left' : t.alignment === 'right' ? 'right' : 'center'; g.textBaseline = 'middle';
  const px = (t.position.x - 0.5) * W, py = (t.position.y - 0.5) * H;
  g.shadowColor = 'rgba(0,0,0,.65)'; g.shadowBlur = 8; g.shadowOffsetY = 2;
  g.fillText(t.content, px, py); g.shadowBlur = 0; g.shadowOffsetY = 0;
}
