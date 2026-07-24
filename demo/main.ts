// VIBAL editor — Final Cut-style shell on the real Phase 0 engine. The right pane is an AI tool
// dock (studio.ts). Every timeline mutation flows through CommandLog (one op / gesture) so
// undo/redo + the op log stay genuine.
import { createDocument, createTrack, createMediaClip, createAsset, createTextClip, createMarker } from '../src/document/factory';
import { CommandLog } from '../src/oplog/log';
import type { VibalDocument, Clip, Track, MediaClip, TextClip, Asset } from '../src/document/types';
import { mountDock, refreshDock, renderViewerOverlay, hasMask, isEnhanced, getMask, type EditorApi } from './studio';
import { renderComposite } from './compositor';
import { mountConnect } from './connect';

const FPS = 30;
type Tool = 'select' | 'blade';
let log: CommandLog;
const assetIds: Record<string, string> = {};
let spineTrackId = '';
let selected: string | null = null;
let tool: Tool = 'select';
let playhead = 0, playing = false, pxf = 3;
let previewAspect = '16:9';
let lastBatch: string | null = null;
// Live (shared-project) mode: mirror + edit the backend project that the VIBAL MCP agent also drives.
let live = false, serverDoc: VibalDocument | null = null, serverVersion = -1, pollTimer = 0;
let serverMeta = { canUndo: false, canRedo: false };

function buildSample(): void {
  log = new CommandLog(createDocument({ name: 'Demo Short', frameRate: { num: 30, den: 1 } }));
  const V1 = createTrack('video', { name: 'Storyline', order: 0 }), V2 = createTrack('video', { name: 'B-roll', order: 1 });
  const TT = createTrack('text', { name: 'Titles', order: 3 }), A1 = createTrack('audio', { name: 'Music', order: 2 }), A2 = createTrack('audio', { name: 'VO', order: 4 });
  for (const t of [V1, V2, TT, A1, A2]) log.apply({ type: 'track.add', payload: { track: t } });
  spineTrackId = V1.id;
  const mk = (h: string, k: Asset['kind'], n: string, d: number) => { const a = createAsset({ contentHash: h, kind: k, originalName: n, durationFrames: d }); assetIds[n] = a.id; return a; };
  const intro = mk('a1', 'video', 'Opening', 600), talk = mk('a2', 'video', 'Interview', 900), close = mk('a3', 'video', 'Closer', 600);
  const bcut = mk('b1', 'video', 'City B-roll', 600), music = mk('m1', 'audio', 'Track 01', 1200), vo = mk('v1', 'audio', 'Voiceover', 900);
  const add = (tr: string, a: Asset, si: number, so: number, st: number, k: MediaClip['kind'] = 'video') =>
    log.apply({ type: 'clip.add', payload: { trackId: tr, clip: createMediaClip({ assetId: a.id, kind: k, sourceIn: si, sourceOut: so, timelineStart: st }), asset: a } });
  add(V1.id, intro, 0, 90, 0); add(V1.id, talk, 0, 150, 90); add(V1.id, close, 100, 190, 240);
  add(V2.id, bcut, 0, 80, 120);
  log.apply({ type: 'text.add', payload: { trackId: TT.id, clip: createTextClip({ content: 'VIBAL', timelineStart: 0, timelineDurationFrames: 60 }) } });
  add(A1.id, music, 0, 330, 0, 'audio'); add(A2.id, vo, 0, 150, 90, 'audio');
  selected = null; playhead = 0; playing = false; lastBatch = null;
}

const $ = (id: string) => document.getElementById(id)!;
const d0 = () => (live && serverDoc ? serverDoc : log.document);
const allClips = (d: VibalDocument) => d.tracks.flatMap((t) => t.clips.map((clip) => ({ track: t, clip })));
const find = (id: string) => allClips(d0()).find((x) => x.clip.id === id) ?? null;
const clipEnd = (c: Clip) => c.timelineStart + c.timelineDurationFrames;
const clipName = (c: Clip) => c.kind === 'text' ? (c as TextClip).text.content : (d0().assets[(c as MediaClip).assetId]?.originalName ?? c.kind);
const clipClass = (c: Clip) => c.kind === 'text' ? 'title' : c.kind === 'audio' ? 'audio' : c.kind === 'generated' ? 'generated' : 'video';
const hue = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h % 360; };
function tc(f0: number): string { const f = Math.max(0, Math.round(f0)); const p = (n: number) => String(n).padStart(2, '0'); return `${p(Math.floor(f / (FPS * 3600)))}:${p(Math.floor(f / (FPS * 60)) % 60)}:${p(Math.floor(f / FPS) % 60)}:${p(f % FPS)}`; }
function waveform(id: string, w: number): string { let s = 0; for (let i = 0; i < id.length; i++) s = (s * 31 + id.charCodeAt(i)) >>> 0; const r = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; const bars = Math.max(4, Math.floor(w / 3)); let p = ''; for (let i = 0; i < bars; i++) { const h = 3 + r() * 13; p += `<rect x="${i * 3}" y="${16 - h}" width="1.6" height="${h * 2}" fill="rgba(255,255,255,.32)"/>`; } return `<svg width="${bars * 3}" height="32" viewBox="0 0 ${bars * 3} 32" preserveAspectRatio="none" style="position:absolute;left:0;bottom:2px">${p}</svg>`; }
const spine = () => d0().tracks.find((t) => t.id === spineTrackId)!;
const clipAtPlayhead = () => spine().clips.find((c) => playhead >= c.timelineStart && playhead < clipEnd(c)) ?? null;
const frameAtX = (clientX: number) => { const r = $('tlcontent').getBoundingClientRect(); return Math.max(0, Math.round((clientX - r.left) / pxf)); };

function apply(type: string, payload: any, actor: 'human' | 'agent' = 'human') {
  if (live) { fetch('/api/op', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type, payload, actor }) }).then(syncProject).catch(() => {}); return; }
  try { log.apply({ type: type as any, payload }, { actor }); } catch { /* overlap etc. ignored */ }
}
function applyBatch(specs: { type: string; payload: any }[], plan: string, actor: 'human' | 'agent' = 'agent') {
  if (live) { fetch('/api/batch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ specs, plan, actor }) }).then(syncProject).catch(() => {}); return; }
  lastBatch = log.applyBatch(specs as any, { actor, plan }).batchId;
}
async function syncProject() { try { const j = await (await fetch('/api/project')).json(); serverDoc = j.doc; serverMeta = { canUndo: j.canUndo, canRedo: j.canRedo }; serverVersion = j.version; render(); } catch { /* backend down */ } }
async function pollLoop() { if (!live) return; try { const j = await (await fetch('/api/version')).json(); if (j.version !== serverVersion) await syncProject(); } catch { /* */ } if (live) pollTimer = window.setTimeout(pollLoop, 900); }
function setLive(on: boolean) { live = on; selected = null; if (on) { syncProject(); pollLoop(); } else { clearTimeout(pollTimer); render(); } }
function doUndo() { if (live) fetch('/api/undo', { method: 'POST' }).then(syncProject); else { log.undo(); render(); } }
function doRedo() { if (live) fetch('/api/redo', { method: 'POST' }).then(syncProject); else { log.redo(); render(); } }
function appendAsset(name: string): void { const id = assetIds[name]; if (!id) return; const a = d0().assets[id]; const start = spine().clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0); const clip = createMediaClip({ assetId: id, kind: a.kind === 'audio' ? 'audio' : 'video', sourceIn: 0, sourceOut: Math.min(120, a.durationFrames ?? 120), timelineStart: start }); apply('clip.add', { trackId: spineTrackId, clip }); selected = clip.id; }
function bladeAt(frame: number): void { const c = allClips(d0()).find((x) => frame > x.clip.timelineStart && frame < clipEnd(x.clip) && x.clip.kind !== 'text'); if (c) apply('clip.split', { clipId: c.clip.id, atFrame: frame }); }
function deleteSelected(ripple = false): void { const f = selected ? find(selected) : null; if (!f) return; if (ripple && f.clip.kind !== 'text') apply('ripple.delete', { trackId: f.track.id, startFrame: f.clip.timelineStart, endFrame: clipEnd(f.clip) }); else apply(f.clip.kind === 'text' ? 'text.remove' : 'clip.remove', { clipId: selected }); selected = null; }
function addTitleAt(frame: number, content = 'Title'): string { const d = d0(); let tt = d.tracks.find((t) => t.kind === 'text'); if (!tt) { tt = createTrack('text', { name: 'Titles', order: 3 }); apply('track.add', { track: tt }); } const clip = createTextClip({ content, timelineStart: Math.round(frame), timelineDurationFrames: 60 }); apply('text.add', { trackId: tt.id, clip }); return clip.id; }
function addMarker(): void { apply('marker.add', { marker: createMarker({ frame: Math.round(playhead), name: 'marker', color: '#f5c518' }) }); }
function agentTighten(): void { const first = spine().clips[0]; if (!first || first.kind === 'text') return; const titles = d0().tracks.find((t) => t.kind === 'text'); const specs: any[] = [{ type: 'clip.trim', payload: { clipId: first.id, sourceOut: (first as MediaClip).sourceIn + 60 } }]; if (titles) specs.push({ type: 'text.add', payload: { trackId: titles.id, clip: createTextClip({ content: 'Hook', timelineStart: 0, timelineDurationFrames: 40 }) } }); applyBatch(specs, 'Tighten the opening shot and add a hook caption.'); }
function addGeneratedClip(o: { uri: string; kind: 'image' | 'video'; name: string; model: string; prompt: string }): void {
  const d = d0(); let gt = d.tracks.find((t) => t.name === 'VFX'); if (!gt) { gt = createTrack('video', { name: 'VFX', order: 5 }); apply('track.add', { track: gt }); }
  const asset = createAsset({ contentHash: 'gen_' + hue(o.uri + o.prompt), kind: 'video', uri: o.uri, originalName: o.name, durationFrames: 90, generation: { provider: 'higgsfield', model: o.model, prompt: o.prompt, seed: null, costCredits: 0, requestId: '', params: {} } });
  const start = (gt.clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0)) || Math.round(playhead);
  const clip = createMediaClip({ assetId: asset.id, kind: 'generated', sourceIn: 0, sourceOut: 90, timelineStart: start });
  apply('clip.add', { trackId: gt.id, clip, asset }); selected = clip.id; render();
}

// ---------- render ----------
function renderBrowser(): void {
  $('browserList').innerHTML = Object.values(d0().assets).map((a) => { const audio = a.kind === 'audio'; const vh = 200 + (hue(a.originalName) % 46); const bg = audio ? 'linear-gradient(180deg,#274b38,#1e3a2b)' : `linear-gradient(120deg,hsl(${vh} 42% 32%),hsl(${vh + 16} 38% 20%))`; return `<div class="media" data-asset="${a.originalName}"><div class="thumb" style="background:${bg}"><span class="k">${a.kind}</span></div><div><div class="mname">${a.originalName}</div><div class="mmeta">${a.durationFrames ?? '—'}f · ${a.kind}</div></div></div>`; }).join('');
}
function renderViewer(): void {
  const st = $('stage'); st.style.aspectRatio = previewAspect.replace(':', '/');
  st.innerHTML = `<canvas id="vcanvas"></canvas><div id="vpLayer"></div><div class="vnote" id="vnote"></div>`;
  renderComposite($('vcanvas') as HTMLCanvasElement, d0(), playhead, { aspect: previewAspect, mask: getMask, requestRedraw: renderViewer });
  const c = clipAtPlayhead(); $('vnote').textContent = `${c ? clipName(c) : '—'} · procedural preview (drop in footage / WebCodecs for source frames)`;
  $('tc').textContent = tc(playhead); $('playBtn').textContent = playing ? '⏸' : '▶';
  renderViewerOverlay(api);
}
function renderTimeline(): void {
  const d = d0(); const dur = Math.max(d.durationFrames, 300); const laneH = 54;
  const above = d.tracks.filter((t) => t.id !== spineTrackId && t.kind !== 'audio' && t.kind !== 'effect').sort((a, b) => a.order - b.order);
  const below = d.tracks.filter((t) => t.kind === 'audio').sort((a, b) => a.order - b.order);
  const spineTop = above.length * laneH + 12, spineH = 50, belowTop = spineTop + spineH + 12;
  const contentH = belowTop + below.length * laneH + 16, contentW = Math.max(dur * pxf + 40, 600);
  $('tlcontent').style.width = contentW + 'px'; $('tlbody').style.height = contentH + 'px'; $('ruler').style.width = contentW + 'px';
  let ruler = ''; for (let f = 0; f <= dur; f += FPS) ruler += `<div class="tick" style="left:${(f * pxf).toFixed(1)}px">${tc(f).slice(3)}</div>`; $('ruler').innerHTML = ruler;
  const transIn = new Set(d.transitions.map((t) => t.toClipId));
  const clipHtml = (c: Clip, top: number, h: number) => {
    const left = c.timelineStart * pxf, w = Math.max(8, c.timelineDurationFrames * pxf - 2), cls = clipClass(c); const vh = 200 + (hue(clipName(c)) % 46);
    const bg = cls === 'video' ? `background:linear-gradient(180deg,hsl(${vh} 52% 48%),hsl(${vh} 52% 36%))` : '';
    const inner = cls === 'audio' ? waveform(c.id, w) : `<div class="film"></div>`;
    const badges = [c.provenance.createdBy === 'agent' ? 'AI' : (d0().assets[(c as MediaClip).assetId]?.generation ? 'HF' : ''), isEnhanced(c.id) ? '✧' : '', Object.keys(c.keyframes).length ? '⊹' : ''].filter(Boolean).map((b) => `<span class="ai">${b}</span>`).join('');
    const roto = hasMask(c.id) ? `<span class="ai" style="left:4px;right:auto">◆</span>` : '';
    const tr = transIn.has(c.id) ? `<span class="transbadge">⬦</span>` : '';
    return `<div class="clip ${cls}${c.id === selected ? ' sel' : ''}" data-clip="${c.id}" style="left:${left.toFixed(1)}px;top:${top}px;width:${w.toFixed(1)}px;height:${h}px;${bg}"><div class="top"></div>${inner}${badges}${roto}${tr}<div class="handle l" data-handle="l" data-clip="${c.id}"></div><div class="handle r" data-handle="r" data-clip="${c.id}"></div><div class="lab">${clipName(c)}</div></div>`;
  };
  let html = `<div class="spineband" style="top:${spineTop - 4}px;height:${spineH + 8}px"></div>`;
  above.forEach((t, i) => { const top = spineTop - (i + 1) * laneH; for (const c of t.clips) { html += clipHtml(c, top, laneH - 8); html += `<div class="connector" style="left:${(c.timelineStart * pxf).toFixed(1)}px;top:${top + laneH - 8}px;height:${spineTop - top - laneH + 8}px"></div>`; } });
  for (const c of spine().clips) html += clipHtml(c, spineTop, spineH);
  below.forEach((t, j) => { for (const c of t.clips) html += clipHtml(c, belowTop + j * laneH, laneH - 8); });
  for (const m of d.markers) html += `<div class="marker" data-marker="${m.id}" style="left:${(m.frame * pxf).toFixed(1)}px"><div class="flag"></div><div class="stem" style="height:${contentH}px"></div></div>`;
  html += `<div class="playhead" style="left:${(playhead * pxf).toFixed(1)}px;height:${contentH}px"><div class="ph"></div></div><div class="snapguide" id="snapguide" style="height:${contentH}px"></div>`;
  $('tlbody').innerHTML = html;
}
function renderIndex(): void { $('indexList').innerHTML = allClips(d0()).sort((a, b) => a.clip.timelineStart - b.clip.timelineStart).map(({ clip }) => { const col = clipClass(clip) === 'title' ? 'var(--title)' : clipClass(clip) === 'audio' ? 'var(--audio)' : 'var(--video)'; return `<div class="irow ${clip.id === selected ? 'on' : ''}" data-clip="${clip.id}"><span class="idot" style="background:${col}"></span>${clipName(clip)}</div>`; }).join(''); }
function render(): void {
  $('projName').textContent = d0().name; renderBrowser(); renderViewer(); renderTimeline(); renderIndex(); refreshDock(api);
  document.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.tool === tool));
  $('tlscroll').className = 'tlscroll' + (tool === 'blade' ? ' blade' : '');
  ($('undoBtn') as HTMLButtonElement).disabled = !(live ? serverMeta.canUndo : log.canUndo());
  ($('redoBtn') as HTMLButtonElement).disabled = !(live ? serverMeta.canRedo : log.canRedo());
  ($('revertBtn') as HTMLButtonElement).disabled = live || !lastBatch;
  const lb = $('liveBtn'); lb.textContent = live ? '◉ Live · shared project' : '○ Solo'; lb.style.color = live ? '#79e6ab' : ''; lb.style.borderColor = live ? '#2f8a56' : '';
  $('hud').textContent = `${tool} · ${selected ? clipName(find(selected)!.clip) : 'no selection'} · ${tc(playhead)}`;
}

// ---------- drag / trim ----------
interface Drag { mode: 'move' | 'l' | 'r'; clipId: string; trackId: string; startX: number; orig: any; el: HTMLElement; snaps: number[]; }
let drag: Drag | null = null;
function snapTargets(except: string): number[] { const s = new Set<number>([0, Math.round(playhead)]); for (const { clip } of allClips(d0())) { if (clip.id === except) continue; s.add(clip.timelineStart); s.add(clipEnd(clip)); } for (const m of d0().markers) s.add(m.frame); return [...s]; }
function snap(f: number, t: number[]): { f: number; hit: number | null } { const th = Math.max(1, Math.round(6 / pxf)); let best: number | null = null, bd = th + 1; for (const x of t) { const dd = Math.abs(x - f); if (dd <= th && dd < bd) { bd = dd; best = x; } } return best === null ? { f, hit: null } : { f: best, hit: best }; }
$('tlbody').addEventListener('mousedown', (ev) => {
  const e = ev as MouseEvent; const t = e.target as HTMLElement;
  const mk = t.closest('[data-marker]') as HTMLElement | null; if (mk) { apply('marker.remove', { markerId: mk.dataset.marker }); render(); return; }
  const clipEl = t.closest('[data-clip]') as HTMLElement | null; if (!clipEl) return; const id = clipEl.dataset.clip!; selected = id;
  if (tool === 'blade') { bladeAt(frameAtX(e.clientX)); render(); return; }
  const c = find(id)!.clip as any; const handle = t.getAttribute('data-handle');
  drag = { mode: handle === 'l' ? 'l' : handle === 'r' ? 'r' : 'move', clipId: id, trackId: find(id)!.track.id, startX: e.clientX, orig: { start: c.timelineStart, in: c.sourceIn, out: c.sourceOut, dur: c.timelineDurationFrames, media: c.kind !== 'text', avail: d0().assets[c.assetId]?.durationFrames ?? 1e6 }, el: clipEl, snaps: snapTargets(id) };
  render(); drag.el = $('tlbody').querySelector(`.clip[data-clip="${id}"]`) as HTMLElement; e.preventDefault();
});
window.addEventListener('mousemove', (e) => {
  if (!drag) return; const d = drag; const deltaF = Math.round((e.clientX - d.startX) / pxf);
  const others = d0().tracks.find((t) => t.id === d.trackId)!.clips.filter((c) => c.id !== d.clipId);
  const prevEnd = others.filter((c) => clipEnd(c) <= d.orig.start).reduce((m, c) => Math.max(m, clipEnd(c)), 0);
  const nextStart = others.filter((c) => c.timelineStart >= d.orig.start + d.orig.dur).reduce((m, c) => Math.min(m, c.timelineStart), 1e9);
  const guide = $('snapguide'); let gx: number | null = null;
  if (d.mode === 'move') { let start = Math.min(Math.max(d.orig.start + deltaF, prevEnd), nextStart === 1e9 ? 1e9 : nextStart - d.orig.dur); const sn = snap(start, d.snaps), en = snap(start + d.orig.dur, d.snaps); if (sn.hit !== null) { start = sn.f; gx = sn.hit; } else if (en.hit !== null) { start = en.f - d.orig.dur; gx = en.hit; } start = Math.min(Math.max(start, prevEnd), nextStart === 1e9 ? 1e9 : nextStart - d.orig.dur); d.el.style.left = (start * pxf).toFixed(1) + 'px'; d.el.dataset.pending = String(start); }
  else if (d.mode === 'r' && d.orig.media) { let out = Math.min(Math.max(d.orig.in + 1, d.orig.out + deltaF), Math.min(d.orig.avail, d.orig.in + (nextStart - d.orig.start))); const sn = snap(d.orig.start + (out - d.orig.in), d.snaps); if (sn.hit !== null) { out = d.orig.in + (sn.hit - d.orig.start); gx = sn.hit; } d.el.style.width = Math.max(8, (out - d.orig.in) * pxf - 2).toFixed(1) + 'px'; d.el.dataset.pending = String(out); }
  else if (d.mode === 'l' && d.orig.media) { const minIn = Math.max(0, d.orig.in + (prevEnd - d.orig.start)); let inn = Math.min(Math.max(d.orig.in + deltaF, minIn), d.orig.out - 1); let s2 = d.orig.start + (inn - d.orig.in); const sn = snap(s2, d.snaps); if (sn.hit !== null) { s2 = sn.hit; inn = d.orig.in + (s2 - d.orig.start); gx = sn.hit; } d.el.style.left = (s2 * pxf).toFixed(1) + 'px'; d.el.style.width = Math.max(8, (d.orig.out - inn) * pxf - 2).toFixed(1) + 'px'; d.el.dataset.pending = String(inn); }
  if (gx !== null) { guide.style.display = 'block'; guide.style.left = (gx * pxf).toFixed(1) + 'px'; } else guide.style.display = 'none';
});
window.addEventListener('mouseup', () => { if (!drag) return; const d = drag; const v = Number(d.el.dataset.pending); if (!Number.isNaN(v)) { if (d.mode === 'move' && v !== d.orig.start) apply('clip.move', { clipId: d.clipId, timelineStart: v }); else if (d.mode === 'r' && v !== d.orig.out) apply('clip.trim', { clipId: d.clipId, sourceOut: v }); else if (d.mode === 'l' && v !== d.orig.in) apply('clip.trim', { clipId: d.clipId, sourceIn: v, timelineStart: d.orig.start + (v - d.orig.in) }); } drag = null; render(); });

// ---------- clicks / inputs / keyboard ----------
document.addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  const irow = t.closest('.irow') as HTMLElement | null; if (irow) { selected = irow.dataset.clip!; render(); return; }
  const asset = t.closest('[data-asset]') as HTMLElement | null; if (asset) { appendAsset(asset.dataset.asset!); render(); return; }
  const toolBtn = t.closest('[data-tool]') as HTMLElement | null; if (toolBtn) { tool = toolBtn.dataset.tool as Tool; render(); return; }
  const act = (t.closest('[data-action]') as HTMLElement | null)?.dataset.action; if (!act) return;
  ({ undo: doUndo, redo: doRedo, live: () => setLive(!live), agent: agentTighten, revert: () => { if (lastBatch && log.revertBatch(lastBatch)) lastBatch = null; }, addTitle: () => (selected = addTitleAt(playhead)), marker: addMarker, delete: () => deleteSelected(false), ripple: () => deleteSelected(true), toStart: () => (playhead = 0), toEnd: () => (playhead = d0().durationFrames), playpause: togglePlay } as Record<string, () => void>)[act]?.(); render();
});
document.addEventListener('change', (e) => { const inp = e.target as HTMLInputElement; const prop = inp.dataset.prop; if (!prop || !selected) return; const v = Number(inp.value); if (prop === 'volume') apply('clip.setVolume', { clipId: selected, volume: v }); else if (prop === 'speed') apply('clip.setSpeed', { clipId: selected, speed: v }); else apply('clip.setTransform', { clipId: selected, transform: { [prop]: v } }); render(); });
document.addEventListener('input', (e) => { const inp = e.target as HTMLInputElement; if (inp.dataset.prop) { const el = document.getElementById('val-' + inp.dataset.prop); if (el) el.textContent = Number(inp.value).toFixed(2); } });
function scrub(ev: MouseEvent) { playhead = frameAtX(ev.clientX); renderViewer(); renderTimeline(); $('hud').textContent = `${tool} · ${selected ? clipName(find(selected)!.clip) : 'no selection'} · ${tc(playhead)}`; }
$('ruler').addEventListener('mousedown', (ev) => { scrub(ev as MouseEvent); const mv = (m: MouseEvent) => scrub(m); const up = () => { removeEventListener('mousemove', mv); removeEventListener('mouseup', up); }; addEventListener('mousemove', mv); addEventListener('mouseup', up); });
$('zoom').addEventListener('input', (e) => { pxf = Number((e.target as HTMLInputElement).value); renderTimeline(); });
window.addEventListener('keydown', (e) => { if ((e.target as HTMLElement).matches('input,textarea,select')) return; const meta = e.metaKey || e.ctrlKey; if (meta && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); return; } const map: Record<string, () => void> = { ' ': togglePlay, a: () => (tool = 'select'), b: () => (tool = 'blade'), m: addMarker, t: () => (selected = addTitleAt(playhead)), Delete: () => deleteSelected(e.shiftKey), Backspace: () => deleteSelected(e.shiftKey), ArrowLeft: () => (playhead = Math.max(0, playhead - (e.shiftKey ? FPS : 1))), ArrowRight: () => (playhead += e.shiftKey ? FPS : 1), '=': () => (pxf = Math.min(12, pxf + 1)), '-': () => (pxf = Math.max(1, pxf - 1)) }; const fn = map[e.key]; if (fn) { e.preventDefault(); fn(); render(); } });

let raf = 0, lastT = 0;
function togglePlay() { playing = !playing; if (playing) { lastT = performance.now(); raf = requestAnimationFrame(tick); } else cancelAnimationFrame(raf); }
function tick(now: number) { if (!playing) return; playhead += (now - lastT) / 1000 * FPS; lastT = now; if (playhead >= d0().durationFrames) { playhead = d0().durationFrames; playing = false; } renderViewer(); renderTimeline(); if (playing) raf = requestAnimationFrame(tick); }

// ---------- editor API for the studio dock ----------
export const api: EditorApi = {
  get selectedClipId() { return selected; }, set selectedClipId(v) { selected = v; }, get playhead() { return playhead; },
  doc: d0, find, clipName, FPS, render, apply, applyBatch, addGeneratedClip,
  vpLayer: () => document.getElementById('vpLayer'),
  clipEnd,
  setAspect: (a) => { previewAspect = a; }, getAspect: () => previewAspect,
};

buildSample(); mountDock(api); mountConnect();
// dev deep-link: ?sel=<clip index> preselects a clip (pairs with ?tool= handled in the dock)
{ const q = new URLSearchParams(location.search); if (q.get('live')) setLive(true); const si = q.get('sel'); if (si !== null) { const c = allClips(d0())[Number(si)]; if (c) selected = c.clip.id; } }
render();
