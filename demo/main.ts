// VIBAL editor preview — Final Cut-style shell on the real Phase 0 engine.
// Direct-manipulation tools (drag-move, trim handles, blade, delete, ripple, markers, keyboard),
// a mask tool (+ AI assist), and a Higgsfield-connected VFX Studio chat. Every timeline mutation
// goes through CommandLog (one op per gesture) so undo/redo and the op log stay genuine.
import { createDocument, createTrack, createMediaClip, createAsset, createTextClip, createMarker } from '../src/document/factory';
import { CommandLog } from '../src/oplog/log';
import type { VibalDocument, Clip, Track, MediaClip, TextClip, Asset } from '../src/document/types';
import { mountStudio, mountMaskUI, type EditorApi } from './studio';

const FPS = 30;
export type Tool = 'select' | 'blade' | 'mask';

let log: CommandLog;
const assetIds: Record<string, string> = {};
let spineTrackId = '';
let selected: string | null = null;
let inspTab: 'info' | 'video' | 'audio' = 'info';
let tool: Tool = 'select';
let playhead = 0, playing = false, pxf = 3;
let lastBatch: string | null = null;
export const masks = new Map<string, Array<{ x: number; y: number }>>(); // clipId -> normalized polygon

// ---------- sample project ----------
function buildSample(): void {
  log = new CommandLog(createDocument({ name: 'Demo Short', frameRate: { num: 30, den: 1 } }));
  const V1 = createTrack('video', { name: 'Storyline', order: 0 });
  const V2 = createTrack('video', { name: 'B-roll', order: 1 });
  const TT = createTrack('text', { name: 'Titles', order: 3 });
  const A1 = createTrack('audio', { name: 'Music', order: 2 });
  const A2 = createTrack('audio', { name: 'VO', order: 4 });
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

// ---------- helpers ----------
const $ = (id: string) => document.getElementById(id)!;
const doc = () => log.document;
const allClips = (d: VibalDocument) => d.tracks.flatMap((t) => t.clips.map((clip) => ({ track: t, clip })));
const findClip = (id: string) => allClips(doc()).find((x) => x.clip.id === id);
const clipEnd = (c: Clip) => c.timelineStart + c.timelineDurationFrames;
const clipName = (c: Clip) => c.kind === 'text' ? (c as TextClip).text.content : (doc().assets[(c as MediaClip).assetId]?.originalName ?? c.kind);
const clipClass = (c: Clip) => c.kind === 'text' ? 'title' : c.kind === 'audio' ? 'audio' : c.kind === 'generated' ? 'generated' : 'video';
const hue = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h % 360; };
function tc(frame: number): string {
  const f = Math.max(0, Math.round(frame)); const p = (n: number) => String(n).padStart(2, '0');
  return `${p(Math.floor(f / (FPS * 3600)))}:${p(Math.floor(f / (FPS * 60)) % 60)}:${p(Math.floor(f / FPS) % 60)}:${p(f % FPS)}`;
}
function waveform(id: string, w: number): string {
  let s = 0; for (let i = 0; i < id.length; i++) s = (s * 31 + id.charCodeAt(i)) >>> 0;
  const r = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const bars = Math.max(4, Math.floor(w / 3)); let p = '';
  for (let i = 0; i < bars; i++) { const h = 3 + r() * 13; p += `<rect x="${i * 3}" y="${16 - h}" width="1.6" height="${h * 2}" fill="rgba(255,255,255,.32)"/>`; }
  return `<svg width="${bars * 3}" height="32" viewBox="0 0 ${bars * 3} 32" preserveAspectRatio="none" style="position:absolute;left:0;bottom:2px">${p}</svg>`;
}
const spine = () => doc().tracks.find((t) => t.id === spineTrackId)!;
const clipAtPlayhead = () => spine().clips.find((c) => playhead >= c.timelineStart && playhead < clipEnd(c)) ?? null;
function frameAtClientX(clientX: number): number { const r = $('tlcontent').getBoundingClientRect(); return Math.max(0, Math.round((clientX - r.left) / pxf)); }

// ---------- actions (real ops) ----------
function apply(type: string, payload: any, actor: 'human' | 'agent' = 'human') { log.apply({ type: type as any, payload }, { actor }); }
function appendAsset(name: string): void {
  const id = assetIds[name]; if (!id) return; const d = doc(); const a = d.assets[id];
  const start = spine().clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0);
  const clip = createMediaClip({ assetId: id, kind: a.kind === 'audio' ? 'audio' : 'video', sourceIn: 0, sourceOut: Math.min(120, a.durationFrames ?? 120), timelineStart: start });
  apply('clip.add', { trackId: spineTrackId, clip }); selected = clip.id;
}
function bladeAt(frame: number): void { const f = findClip(selected!)?.clip ? findClip(selected!)! : null; const c = clipAtPointOnAnyTrack(frame); if (!c) return; if (frame > c.clip.timelineStart && frame < clipEnd(c.clip)) apply('clip.split', { clipId: c.clip.id, atFrame: frame }); }
function clipAtPointOnAnyTrack(frame: number) { return allClips(doc()).find((x) => frame > x.clip.timelineStart && frame < clipEnd(x.clip) && x.clip.kind !== 'text'); }
function deleteSelected(ripple = false): void {
  const f = selected ? findClip(selected) : null; if (!f) return;
  if (ripple && f.clip.kind !== 'text') apply('ripple.delete', { trackId: f.track.id, startFrame: f.clip.timelineStart, endFrame: clipEnd(f.clip) });
  else apply(f.clip.kind === 'text' ? 'text.remove' : 'clip.remove', { clipId: selected });
  masks.delete(selected!); selected = null;
}
function addTitle(): void {
  const d = doc(); let tt = d.tracks.find((t) => t.kind === 'text');
  if (!tt) { tt = createTrack('text', { name: 'Titles', order: 3 }); apply('track.add', { track: tt }); }
  const clip = createTextClip({ content: 'Title', timelineStart: Math.round(playhead), timelineDurationFrames: 60 });
  apply('text.add', { trackId: tt.id, clip }); selected = clip.id;
}
function addMarker(): void { apply('marker.add', { marker: createMarker({ frame: Math.round(playhead), name: 'marker', color: '#f5c518' }) }); }
function agentTighten(): void {
  const first = spine().clips[0]; if (!first || first.kind === 'text') return;
  const titles = doc().tracks.find((t) => t.kind === 'text');
  const specs: any[] = [{ type: 'clip.trim', payload: { clipId: first.id, sourceOut: (first as MediaClip).sourceIn + 60 } }];
  if (titles) specs.push({ type: 'text.add', payload: { trackId: titles.id, clip: createTextClip({ content: 'Hook', timelineStart: 0, timelineDurationFrames: 40 }) } });
  lastBatch = log.applyBatch(specs, { actor: 'agent', plan: 'Tighten the opening shot and add a hook caption.' }).batchId;
}

// exposed to the VFX studio: drop a generated clip onto the timeline (real clip.add + generation meta)
function addGeneratedClip(o: { uri: string; kind: 'image' | 'video'; name: string; model: string; prompt: string }): void {
  const d = doc(); let gt = d.tracks.find((t) => t.name === 'VFX');
  if (!gt) { gt = createTrack('video', { name: 'VFX', order: 5 }); apply('track.add', { track: gt }); }
  const asset = createAsset({ contentHash: 'gen_' + hue(o.uri + o.prompt), kind: 'video', uri: o.uri, originalName: o.name, durationFrames: 90,
    generation: { provider: 'higgsfield', model: o.model, prompt: o.prompt, seed: null, costCredits: 0, requestId: '', params: {} } });
  const start = (gt.clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0)) || Math.round(playhead);
  const clip = createMediaClip({ assetId: asset.id, kind: 'generated', sourceIn: 0, sourceOut: 90, timelineStart: start });
  apply('clip.add', { trackId: gt.id, clip, asset }); selected = clip.id; render();
}

// ---------- render ----------
function renderBrowser(): void {
  $('browserList').innerHTML = Object.values(doc().assets).map((a) => {
    const audio = a.kind === 'audio'; const vh = 200 + (hue(a.originalName) % 46);
    const bg = audio ? 'linear-gradient(180deg,#274b38,#1e3a2b)' : `linear-gradient(120deg,hsl(${vh} 42% 32%),hsl(${vh + 16} 38% 20%))`;
    return `<div class="media" data-asset="${a.originalName}"><div class="thumb" style="background:${bg}"><span class="k">${a.kind}</span></div><div><div class="mname">${a.originalName}</div><div class="mmeta">${a.durationFrames ?? '—'}f · ${a.kind}</div></div></div>`;
  }).join('');
}
function renderViewer(): void {
  const c = clipAtPlayhead(); const st = $('stage');
  if (c) { const col = clipClass(c) === 'title' ? 'var(--title)' : clipClass(c) === 'audio' ? 'var(--audio)' : 'var(--video)';
    st.innerHTML = `<div class="card"><div class="swatch" style="background:${col}"></div><div class="big">${clipName(c)}</div><div class="sub">frame ${Math.round(playhead)} · no pixel renderer yet — Phase 2 wires WebCodecs here</div></div><div id="maskLayer"></div>`;
  } else st.innerHTML = `<div class="card"><div class="big" style="color:#3a3a40">no clip under playhead</div></div><div id="maskLayer"></div>`;
  $('tc').textContent = tc(playhead); $('playBtn').textContent = playing ? '⏸' : '▶';
  api.renderMask();
}
function slider(l: string, prop: string, v: number, min: number, max: number, step: number) {
  return `<div class="prop"><label>${l}</label><input type="range" data-prop="${prop}" min="${min}" max="${max}" step="${step}" value="${v}"/><span class="val" id="val-${prop}">${Number(v).toFixed(2)}</span></div>`;
}
function renderInspector(): void {
  const f = selected ? findClip(selected) : null;
  document.querySelectorAll('#inspTabs button').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.tab === inspTab));
  const body = $('inspBody'); if (!f) { body.innerHTML = `<div class="empty">Select a clip to inspect it.</div>`; return; }
  const c = f.clip;
  if (inspTab === 'info') {
    const rows: Array<[string, string]> = [['Name', clipName(c)], ['Kind', c.kind], ['Timeline', `${c.timelineStart}–${clipEnd(c)}f`], ['Duration', `${c.timelineDurationFrames}f`]];
    if (c.kind !== 'text') rows.push(['Source', `${(c as MediaClip).sourceIn}–${(c as MediaClip).sourceOut}`], ['Speed', `${(c as MediaClip).speed}×`]);
    const gen = (doc().assets[(c as MediaClip).assetId]?.generation);
    body.innerHTML = rows.map(([k, v]) => `<div class="kv"><span>${k}</span><code>${v}</code></div>`).join('') +
      `<div class="kv"><span>Created by</span><code>${c.provenance.createdBy}${c.provenance.createdBy === 'agent' ? ' <span class="chip">AI</span>' : ''}</code></div>` +
      (masks.has(c.id) ? `<div class="kv"><span>Mask</span><code>${masks.get(c.id)!.length} pts <span class="chip">roto</span></code></div>` : '') +
      (gen ? `<div class="kv"><span>Higgsfield</span><code>${gen.model}</code></div>` : '');
  } else if (inspTab === 'video') {
    if (c.kind === 'audio') { body.innerHTML = `<div class="empty">Audio clip — see Audio tab.</div>`; return; }
    const t = (c as any).transform;
    body.innerHTML = slider('Scale', 'scale', t.scale, 0.2, 3, 0.05) + slider('Rotation', 'rotation', t.rotation, -180, 180, 1) + slider('Position X', 'x', t.x, -960, 960, 1) + slider('Position Y', 'y', t.y, -540, 540, 1) + `<div class="empty" style="text-align:left">Sliders fire <code>clip.setTransform</code> (undoable).</div>`;
  } else {
    if (c.kind === 'text') { body.innerHTML = `<div class="empty">Title clip — no audio.</div>`; return; }
    const m = c as MediaClip;
    body.innerHTML = slider('Volume', 'volume', m.volume, 0, 1.5, 0.01) + slider('Speed', 'speed', m.speed, 0.25, 4, 0.05);
  }
}
function renderTimeline(): void {
  const d = doc(); const dur = Math.max(d.durationFrames, 300); const laneH = 54;
  const above = d.tracks.filter((t) => t.id !== spineTrackId && t.kind !== 'audio' && t.kind !== 'effect').sort((a, b) => a.order - b.order);
  const below = d.tracks.filter((t) => t.kind === 'audio').sort((a, b) => a.order - b.order);
  const spineTop = above.length * laneH + 12, spineH = 50, belowTop = spineTop + spineH + 12;
  const contentH = belowTop + below.length * laneH + 16, contentW = Math.max(dur * pxf + 40, 600);
  $('tlcontent').style.width = contentW + 'px'; $('tlbody').style.height = contentH + 'px'; $('ruler').style.width = contentW + 'px';
  let ruler = ''; for (let f = 0; f <= dur; f += FPS) ruler += `<div class="tick" style="left:${(f * pxf).toFixed(1)}px">${tc(f).slice(3)}</div>`; $('ruler').innerHTML = ruler;
  const clipHtml = (c: Clip, top: number, h: number) => {
    const left = c.timelineStart * pxf, w = Math.max(8, c.timelineDurationFrames * pxf - 2), cls = clipClass(c);
    const vh = 200 + (hue(clipName(c)) % 46);
    const bg = cls === 'video' ? `background:linear-gradient(180deg,hsl(${vh} 52% 48%),hsl(${vh} 52% 36%))` : '';
    const inner = cls === 'audio' ? waveform(c.id, w) : `<div class="film"></div>`;
    const ai = c.provenance.createdBy === 'agent' ? `<span class="ai">AI</span>` : (doc().assets[(c as MediaClip).assetId]?.generation ? `<span class="ai">HF</span>` : '');
    const roto = masks.has(c.id) ? `<span class="ai" style="left:4px;right:auto">◆</span>` : '';
    return `<div class="clip ${cls}${c.id === selected ? ' sel' : ''}" data-clip="${c.id}" style="left:${left.toFixed(1)}px;top:${top}px;width:${w.toFixed(1)}px;height:${h}px;${bg}"><div class="top"></div>${inner}${ai}${roto}<div class="handle l" data-handle="l" data-clip="${c.id}"></div><div class="handle r" data-handle="r" data-clip="${c.id}"></div><div class="lab">${clipName(c)}</div></div>`;
  };
  let html = `<div class="spineband" style="top:${spineTop - 4}px;height:${spineH + 8}px"></div>`;
  above.forEach((t, i) => { const top = spineTop - (i + 1) * laneH; for (const c of t.clips) { html += clipHtml(c, top, laneH - 8); html += `<div class="connector" style="left:${(c.timelineStart * pxf).toFixed(1)}px;top:${top + laneH - 8}px;height:${spineTop - top - laneH + 8}px"></div>`; } });
  for (const c of spine().clips) html += clipHtml(c, spineTop, spineH);
  below.forEach((t, j) => { for (const c of t.clips) html += clipHtml(c, belowTop + j * laneH, laneH - 8); });
  for (const m of d.markers) html += `<div class="marker" data-marker="${m.id}" style="left:${(m.frame * pxf).toFixed(1)}px"><div class="flag"></div><div class="stem" style="height:${contentH}px"></div></div>`;
  html += `<div class="playhead" style="left:${(playhead * pxf).toFixed(1)}px;height:${contentH}px"><div class="ph"></div></div><div class="snapguide" id="snapguide" style="height:${contentH}px"></div>`;
  $('tlbody').innerHTML = html;
}
function renderIndex(): void {
  $('indexList').innerHTML = allClips(doc()).sort((a, b) => a.clip.timelineStart - b.clip.timelineStart).map(({ clip }) => {
    const col = clipClass(clip) === 'title' ? 'var(--title)' : clipClass(clip) === 'audio' ? 'var(--audio)' : 'var(--video)';
    return `<div class="irow ${clip.id === selected ? 'on' : ''}" data-clip="${clip.id}"><span class="idot" style="background:${col}"></span>${clipName(clip)}</div>`;
  }).join('');
}
function render(): void {
  $('projName').textContent = doc().name;
  renderBrowser(); renderViewer(); renderInspector(); renderTimeline(); renderIndex();
  document.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.tool === tool));
  $('tlscroll').className = 'tlscroll' + (tool === 'blade' ? ' blade' : '');
  ($('undoBtn') as HTMLButtonElement).disabled = !log.canUndo();
  ($('redoBtn') as HTMLButtonElement).disabled = !log.canRedo();
  ($('revertBtn') as HTMLButtonElement).disabled = !lastBatch;
  $('hud').textContent = `${tool} · ${selected ? clipName(findClip(selected)!.clip) : 'no selection'} · ${tc(playhead)}`;
}

// ---------- drag / trim ----------
interface Drag { mode: 'move' | 'l' | 'r'; clipId: string; trackId: string; startX: number; orig: any; el: HTMLElement; snaps: number[]; }
let drag: Drag | null = null;
function snapTargets(exceptId: string): number[] {
  const s = new Set<number>([0, Math.round(playhead)]);
  for (const { clip } of allClips(doc())) { if (clip.id === exceptId) continue; s.add(clip.timelineStart); s.add(clipEnd(clip)); }
  for (const m of doc().markers) s.add(m.frame);
  return [...s];
}
function snap(frame: number, targets: number[]): { f: number; hit: number | null } {
  const th = Math.max(1, Math.round(6 / pxf)); let best: number | null = null, bd = th + 1;
  for (const t of targets) { const dd = Math.abs(t - frame); if (dd <= th && dd < bd) { bd = dd; best = t; } }
  return best === null ? { f: frame, hit: null } : { f: best, hit: best };
}
$('tlbody').addEventListener('mousedown', (ev) => {
  const e = ev as MouseEvent; const t = e.target as HTMLElement;
  const mk = t.closest('[data-marker]') as HTMLElement | null; if (mk) { apply('marker.remove', { markerId: mk.dataset.marker }); render(); return; }
  const clipEl = t.closest('[data-clip]') as HTMLElement | null; if (!clipEl) return;
  const id = clipEl.dataset.clip!; selected = id;
  if (tool === 'blade') { bladeAt(frameAtClientX(e.clientX)); render(); return; }
  const found = findClip(id)!; const c = found.clip as any;
  const handle = t.getAttribute('data-handle');
  drag = { mode: handle === 'l' ? 'l' : handle === 'r' ? 'r' : 'move', clipId: id, trackId: found.track.id, startX: e.clientX,
    orig: { start: c.timelineStart, in: c.sourceIn, out: c.sourceOut, dur: c.timelineDurationFrames, media: c.kind !== 'text', avail: doc().assets[c.assetId]?.durationFrames ?? 1e6 },
    el: clipEl, snaps: snapTargets(id) };
  render(); // reflect selection
  drag.el = $('tlbody').querySelector(`.clip[data-clip="${id}"]`) as HTMLElement;
  e.preventDefault();
});
window.addEventListener('mousemove', (e) => {
  if (!drag) return; const d = drag; const deltaF = Math.round((e.clientX - d.startX) / pxf);
  const others = doc().tracks.find((t) => t.id === d.trackId)!.clips.filter((c) => c.id !== d.clipId);
  const prevEnd = others.filter((c) => clipEnd(c) <= d.orig.start).reduce((m, c) => Math.max(m, clipEnd(c)), 0);
  const nextStart = others.filter((c) => c.timelineStart >= d.orig.start + d.orig.dur).reduce((m, c) => Math.min(m, c.timelineStart), 1e9);
  const guide = $('snapguide'); let gx: number | null = null;
  if (d.mode === 'move') {
    let start = Math.min(Math.max(d.orig.start + deltaF, prevEnd), nextStart === 1e9 ? 1e9 : nextStart - d.orig.dur);
    const sn = snap(start, d.snaps); const en = snap(start + d.orig.dur, d.snaps);
    if (sn.hit !== null) { start = sn.f; gx = sn.hit; } else if (en.hit !== null) { start = en.f - d.orig.dur; gx = en.hit; }
    start = Math.min(Math.max(start, prevEnd), nextStart === 1e9 ? 1e9 : nextStart - d.orig.dur);
    d.el.style.left = (start * pxf).toFixed(1) + 'px'; d.el.dataset.pending = String(start);
  } else if (d.mode === 'r' && d.orig.media) {
    let out = Math.min(Math.max(d.orig.in + 1, d.orig.out + deltaF), Math.min(d.orig.avail, d.orig.in + (nextStart - d.orig.start)));
    const sn = snap(d.orig.start + (out - d.orig.in), d.snaps); if (sn.hit !== null) { out = d.orig.in + (sn.hit - d.orig.start); gx = sn.hit; }
    d.el.style.width = Math.max(8, (out - d.orig.in) * pxf - 2).toFixed(1) + 'px'; d.el.dataset.pending = String(out);
  } else if (d.mode === 'l' && d.orig.media) {
    const minIn = Math.max(0, d.orig.in + (prevEnd - d.orig.start));
    let inn = Math.min(Math.max(d.orig.in + deltaF, minIn), d.orig.out - 1);
    const start = d.orig.start + (inn - d.orig.in); const sn = snap(start, d.snaps); let s2 = start;
    if (sn.hit !== null) { s2 = sn.hit; inn = d.orig.in + (s2 - d.orig.start); gx = sn.hit; }
    d.el.style.left = (s2 * pxf).toFixed(1) + 'px'; d.el.style.width = Math.max(8, (d.orig.out - inn) * pxf - 2).toFixed(1) + 'px'; d.el.dataset.pending = String(inn);
  }
  if (gx !== null) { guide.style.display = 'block'; guide.style.left = (gx * pxf).toFixed(1) + 'px'; } else guide.style.display = 'none';
});
window.addEventListener('mouseup', () => {
  if (!drag) return; const d = drag; const v = Number(d.el.dataset.pending);
  if (!Number.isNaN(v)) {
    if (d.mode === 'move' && v !== d.orig.start) apply('clip.move', { clipId: d.clipId, timelineStart: v });
    else if (d.mode === 'r' && v !== d.orig.out) apply('clip.trim', { clipId: d.clipId, sourceOut: v });
    else if (d.mode === 'l' && v !== d.orig.in) apply('clip.trim', { clipId: d.clipId, sourceIn: v, timelineStart: d.orig.start + (v - d.orig.in) });
  }
  drag = null; render();
});

// ---------- clicks / inputs / keyboard ----------
document.addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  const irow = t.closest('.irow') as HTMLElement | null; if (irow) { selected = irow.dataset.clip!; render(); return; }
  const asset = t.closest('[data-asset]') as HTMLElement | null; if (asset) { appendAsset(asset.dataset.asset!); render(); return; }
  const tab = t.closest('[data-tab]') as HTMLElement | null; if (tab) { inspTab = tab.dataset.tab as any; renderInspector(); return; }
  const toolBtn = t.closest('[data-tool]') as HTMLElement | null; if (toolBtn) { tool = toolBtn.dataset.tool as Tool; render(); return; }
  const act = (t.closest('[data-action]') as HTMLElement | null)?.dataset.action; if (!act) return;
  ({ undo: () => log.undo(), redo: () => log.redo(), agent: agentTighten, revert: () => { if (lastBatch && log.revertBatch(lastBatch)) lastBatch = null; },
    addTitle, marker: addMarker, delete: () => deleteSelected(false), ripple: () => deleteSelected(true),
    toStart: () => (playhead = 0), toEnd: () => (playhead = doc().durationFrames), playpause: togglePlay,
    studio: () => api.toggleStudio() } as Record<string, () => void>)[act]?.(); render();
});
document.addEventListener('change', (e) => {
  const inp = e.target as HTMLInputElement; const prop = inp.dataset.prop; if (!prop || !selected) return; const v = Number(inp.value);
  if (prop === 'volume') apply('clip.setVolume', { clipId: selected, volume: v });
  else if (prop === 'speed') apply('clip.setSpeed', { clipId: selected, speed: v });
  else apply('clip.setTransform', { clipId: selected, transform: { [prop]: v } });
  render();
});
document.addEventListener('input', (e) => { const inp = e.target as HTMLInputElement; if (inp.dataset.prop) { const el = document.getElementById('val-' + inp.dataset.prop); if (el) el.textContent = Number(inp.value).toFixed(2); } });
function scrub(ev: MouseEvent) { playhead = frameAtClientX(ev.clientX); renderViewer(); renderTimeline(); $('hud').textContent = `${tool} · ${selected ? clipName(findClip(selected)!.clip) : 'no selection'} · ${tc(playhead)}`; }
$('ruler').addEventListener('mousedown', (ev) => { scrub(ev as MouseEvent); const mv = (m: MouseEvent) => scrub(m); const up = () => { removeEventListener('mousemove', mv); removeEventListener('mouseup', up); }; addEventListener('mousemove', mv); addEventListener('mouseup', up); });
$('zoom').addEventListener('input', (e) => { pxf = Number((e.target as HTMLInputElement).value); renderTimeline(); });
window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).matches('input,textarea')) return;
  const meta = e.metaKey || e.ctrlKey;
  if (meta && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? log.redo() : log.undo(); render(); return; }
  const map: Record<string, () => void> = { ' ': togglePlay, a: () => (tool = 'select'), b: () => (tool = 'blade'), m: addMarker, t: addTitle,
    Delete: () => deleteSelected(e.shiftKey), Backspace: () => deleteSelected(e.shiftKey),
    ArrowLeft: () => (playhead = Math.max(0, playhead - (e.shiftKey ? FPS : 1))), ArrowRight: () => (playhead += e.shiftKey ? FPS : 1),
    '=': () => (pxf = Math.min(12, pxf + 1)), '-': () => (pxf = Math.max(1, pxf - 1)) };
  const fn = map[e.key]; if (fn) { e.preventDefault(); fn(); render(); }
});

// ---------- playback ----------
let raf = 0, lastT = 0;
function togglePlay() { playing = !playing; if (playing) { lastT = performance.now(); raf = requestAnimationFrame(tick); } else cancelAnimationFrame(raf); }
function tick(now: number) { if (!playing) return; playhead += (now - lastT) / 1000 * FPS; lastT = now; if (playhead >= doc().durationFrames) { playhead = doc().durationFrames; playing = false; } renderViewer(); renderTimeline(); if (playing) raf = requestAnimationFrame(tick); }

// ---------- editor api for studio + mask modules ----------
export const api: EditorApi = {
  get selectedClipId() { return selected; }, get tool() { return tool; }, masks,
  addGeneratedClip, render, setMaskForSelected(pts) { if (selected) masks.set(selected, pts); render(); },
  clearMaskForSelected() { if (selected) masks.delete(selected); render(); },
  renderMask() { mountMaskUI(api); },
  toggleStudio() {/* set by mountStudio */ },
};

buildSample();
mountStudio(api); // wires the VFX Studio dock + toggle button
render();
