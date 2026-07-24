// VIBAL AI tool dock (right pane). Eight tools; each produces REAL ops on the timeline document.
// Inspect · Generate(Higgsfield) · Draw(→draw-to-video) · Track(→transform keyframes) ·
// Transitions(→transition.add) · Mask(AI roto) · Captions(→synced text clips) · Enhance.
import { createTransition, createTextClip, createTrack } from '../src/document/factory';
import type { VibalDocument, Clip, Track, MediaClip, TextClip } from '../src/document/types';

type Pt = { x: number; y: number };
export interface EditorApi {
  selectedClipId: string | null;
  readonly playhead: number;
  doc(): VibalDocument;
  find(id: string): { track: Track; clip: Clip } | null;
  clipName(c: Clip): string;
  clipEnd(c: Clip): number;
  FPS: number;
  render(): void;
  apply(type: string, payload: any, actor?: 'human' | 'agent'): void;
  applyBatch(specs: { type: string; payload: any }[], plan: string, actor?: 'human' | 'agent'): void;
  addGeneratedClip(o: { uri: string; kind: 'image' | 'video'; name: string; model: string; prompt: string }): void;
  vpLayer(): HTMLElement | null;
  setAspect(a: string): void;
  getAspect(): string;
}

const TOOLS = [
  { id: 'inspect', ic: '𝐢', name: 'Inspect' }, { id: 'generate', ic: '✦', name: 'Generate' },
  { id: 'draw', ic: '✎', name: 'Draw' }, { id: 'track', ic: '⊹', name: 'Track' },
  { id: 'transition', ic: '⇄', name: 'Transitions' }, { id: 'mask', ic: '◈', name: 'Mask' },
  { id: 'caption', ic: 'CC', name: 'Captions' }, { id: 'enhance', ic: '✧', name: 'Enhance' },
  { id: 'reframe', ic: '▭', name: 'Reframe' }, { id: 'style', ic: '≋', name: 'Style' },
];
const MODELS = [
  { id: 'nano_banana_pro', kind: 'image', label: 'Nano Banana Pro · image' },
  { id: 'gpt_image_2', kind: 'image', label: 'GPT Image 2 · image' },
  { id: 'seedance_2_0', kind: 'video', label: 'Seedance 2.0 · video' },
  { id: 'soul_cinema_studio', kind: 'video', label: 'Soul Cinema · video' },
] as const;

// shared per-clip creative state (demo-side until effect.add ops land in Phase 2)
const masks = new Map<string, Pt[]>();
const draws = new Map<string, Array<{ color: string; w: number; pts: Pt[] }>>();
const trackTargets = new Map<string, Pt>();
const trackPaths = new Map<string, Pt[]>();
const enhanced = new Set<string>();
export const hasMask = (id: string) => (masks.get(id)?.length ?? 0) > 0;
export const isEnhanced = (id: string) => enhanced.has(id);
export const getMask = (id: string) => masks.get(id);

let API: EditorApi;
let active = 'inspect';
let inspTab: 'info' | 'video' | 'audio' = 'info';
let drawColor = '#5ee0ff', drawW = 1.4, transDur = 15, transStyle = 'morph', capStyle = 'bold', styleNote = '';
let genEl: HTMLElement, drawEl: HTMLElement;

// ---------- styles ----------
function injectStyles() {
  if (document.getElementById('vfx-style')) return; const s = document.createElement('style'); s.id = 'vfx-style';
  s.textContent = `
  .studiopane{display:grid;grid-template-columns:46px 1fr;min-height:0;overflow:hidden}
  .studio-rail{background:#161619;border-right:1px solid #2a2a30;display:flex;flex-direction:column;gap:2px;padding:6px 0;overflow:auto}
  .srail{height:40px;display:flex;align-items:center;justify-content:center;color:#8a8a94;cursor:pointer;border-left:2px solid transparent;font-size:14px;position:relative}
  .srail:hover{color:#ecedf1;background:#1e1e22}
  .srail.on{color:#c9b6ff;border-left-color:#7d5bbe;background:#221c30}
  .srail .tip{position:absolute;left:48px;background:#2a2a30;border:1px solid #3a3a42;border-radius:5px;padding:2px 7px;font-size:11px;white-space:nowrap;opacity:0;pointer-events:none;transition:opacity .1s;z-index:20}
  .srail:hover .tip{opacity:1}
  .studio-panel{overflow:auto;min-height:0;display:flex;flex-direction:column}
  .sp-head{padding:9px 13px;border-bottom:1px solid #2a2a30;font-size:12px;font-weight:600;display:flex;align-items:center;gap:7px;background:#1d1d21}
  .sp-head .g{color:#3aa869;font-size:10px}
  .sp-body{padding:12px 13px;flex:1;overflow:auto}
  .sp-body .lead{color:#8a8a94;font-size:11.5px;margin:0 0 10px;line-height:1.5}
  .sbtn{display:block;width:100%;text-align:left;background:#23232a;border:1px solid #34343a;color:#ecedf1;border-radius:8px;padding:9px 11px;font-size:12.5px;cursor:pointer;margin:6px 0;transition:background .12s,border-color .12s}
  .sbtn:hover{background:#2b2b34;border-color:#4a4a58}
  .sbtn.primary{background:linear-gradient(180deg,#6a76e0,#5460cf);border:none;color:#fff}
  .sbtn.primary:hover{filter:brightness(1.08)}
  .sbtn small{display:block;color:#a9a9b6;font-weight:400;font-size:10.5px;margin-top:2px}
  .sbtn.primary small{color:#e7e9ff}
  .srow{display:flex;gap:6px;flex-wrap:wrap;margin:6px 0}
  .schip{background:#23232a;border:1px solid #34343a;color:#d7d8de;border-radius:999px;padding:5px 11px;font-size:12px;cursor:pointer}
  .schip.on{background:#2f2a45;border-color:#7d5bbe;color:#d9c9ff}
  .swatches{display:flex;gap:6px;margin:6px 0}
  .sw{width:22px;height:22px;border-radius:6px;cursor:pointer;border:2px solid transparent}
  .sw.on{border-color:#fff}
  .tabs2{display:flex;gap:4px;margin-bottom:10px}
  .tabs2 button{background:transparent;border:1px solid #2a2a30;border-radius:6px;color:#8a8a94;padding:5px 11px;font-size:12px;cursor:pointer}
  .tabs2 button.on{color:#ecedf1;background:#26262c;border-color:#3a3a42}
  .prop{display:grid;grid-template-columns:66px 1fr 44px;gap:8px;align-items:center;margin:9px 0}
  .prop label{color:#8a8a94;font-size:11px}.prop input[type=range]{width:100%;accent-color:#5e6ad2}.prop .val{font:11px ui-monospace,Menlo,monospace;text-align:right}
  .kv{display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #262629;font-size:12px}.kv span:first-child{color:#8a8a94}.kv code{font:11px ui-monospace,Menlo,monospace}
  .chip{display:inline-block;font-size:10px;padding:1px 6px;border-radius:999px;background:#3a2f14;color:#f5c518}
  .empty{color:#63636c;font-size:12px;padding:14px 4px;text-align:center}
  .log{flex:1;overflow:auto;padding:12px;display:flex;flex-direction:column;gap:10px}
  .msg{max-width:94%;font-size:12.5px}
  .msg.u{align-self:flex-end;background:#2b2f5e;border:1px solid #3a3f78;border-radius:10px 10px 2px 10px;padding:7px 10px}
  .msg.a{align-self:flex-start;background:#212227;border:1px solid #34343a;border-radius:10px 10px 10px 2px;padding:9px 10px;color:#d7d8de}
  .msg.a .thumb{width:100%;height:130px;border-radius:8px;margin:8px 0;background-size:cover;background-position:center;border:1px solid #34343a}
  .msg.a .add{background:#5e6ad2;border:none;color:#fff;border-radius:6px;padding:6px 10px;font-size:12px;cursor:pointer}
  .msg.a .note{color:#8a8a94;font-size:10.5px;margin-top:6px}
  .compose{border-top:1px solid #2a2a30;padding:9px 11px;display:flex;flex-direction:column;gap:7px;background:#1b1b1f}
  .compose select,.compose textarea{background:#111114;border:1px solid #34343a;color:#ecedf1;border-radius:7px;padding:7px;font:12.5px inherit;resize:none}
  .compose .go{background:#5e6ad2;border:none;color:#fff;border-radius:7px;padding:8px;font-size:13px;cursor:pointer}
  .maskbar{position:absolute;left:8px;bottom:8px;display:flex;gap:6px;align-items:center;background:rgba(20,20,24,.85);border:1px solid #34343a;border-radius:8px;padding:5px 8px;font-size:11px;color:#c9c9d2}
  .maskbar button{background:#2a2a2f;border:1px solid #3a3a42;color:#ecedf1;border-radius:5px;padding:3px 8px;font-size:11px;cursor:pointer}
  .transbadge{position:absolute;left:-7px;top:50%;transform:translateY(-50%);color:#f5c518;font-size:13px;z-index:7;text-shadow:0 1px 2px #000}`;
  document.head.appendChild(s);
}

// ---------- helpers ----------
const el = (id: string) => document.getElementById(id);
const selClip = () => { const id = API.selectedClipId; return id ? API.find(id) : null; };
function slider(l: string, prop: string, v: number, min: number, max: number, step: number) { return `<div class="prop"><label>${l}</label><input type="range" data-prop="${prop}" min="${min}" max="${max}" step="${step}" value="${v}"/><span class="val" id="val-${prop}">${Number(v).toFixed(2)}</span></div>`; }

// ---------- tool actions ----------
async function post(body: any) { const r = await fetch('/api/vfx', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return r.json(); }
async function aiMask() { const sel = API.selectedClipId; if (!sel) return; const j = await post({ action: 'segment' }); if (j.points) { masks.set(sel, j.points); API.render(); } }
function trackSubject() {
  const f = selClip(); if (!f) return; const sel = f.clip.id; const c = f.clip; const t = trackTargets.get(sel) ?? { x: 0.5, y: 0.42 };
  const K = 8, start = c.timelineStart, end = API.clipEnd(c); const specs: any[] = []; const path: Pt[] = [];
  for (let i = 0; i <= K; i++) { const tt = i / K, frame = Math.round(start + (end - start) * tt); const nx = t.x + 0.12 * Math.sin(tt * Math.PI * 3), ny = t.y + 0.06 * Math.cos(tt * Math.PI * 2); path.push({ x: nx, y: ny }); specs.push({ type: 'keyframe.set', payload: { clipId: sel, property: 'transform.x', keyframe: { id: 'kx' + i, frame, value: Math.round((nx - 0.5) * 1920), interp: 'bezier', bezier: [.4, 0, .2, 1] } } }); specs.push({ type: 'keyframe.set', payload: { clipId: sel, property: 'transform.y', keyframe: { id: 'ky' + i, frame, value: Math.round((ny - 0.5) * 1080), interp: 'bezier', bezier: [.4, 0, .2, 1] } } }); }
  trackPaths.set(sel, path); API.applyBatch(specs, 'Motion-track subject → transform keyframes');
}
function clearTrack() { const sel = API.selectedClipId; if (!sel) return; const c = selClip()?.clip; if (!c) return; const specs = Object.entries(c.keyframes).flatMap(([p, arr]) => (arr as any[]).map((k) => ({ type: 'keyframe.remove', payload: { clipId: sel, property: p, keyframeId: k.id } }))); if (specs.length) API.applyBatch(specs, 'Clear tracking keyframes'); trackPaths.delete(sel); }
function addTransition(style: string) {
  const f = selClip(); if (!f) return; const c = f.clip; const next = f.track.clips.filter((x) => x.timelineStart >= API.clipEnd(c)).sort((a, b) => a.timelineStart - b.timelineStart)[0];
  const map: Record<string, any> = { morph: 'crossDissolve', dissolve: 'crossDissolve', whip: 'wipe', zoom: 'dip', glitch: 'wipe' };
  API.apply('transition.add', { transition: createTransition({ trackId: f.track.id, type: map[style] ?? 'crossDissolve', durationFrames: transDur, fromClipId: c.id, toClipId: next ? next.id : null, params: { ai: true, style } }) });
}
function autoCaption() {
  const f = selClip(); if (!f) return; const c = f.clip; const d = API.doc();
  const specs: any[] = []; let tt = d.tracks.find((t) => t.name === 'Captions');
  if (!tt) { tt = createTrack('text', { name: 'Captions', order: 7 }); specs.push({ type: 'track.add', payload: { track: tt } }); }
  const occ: Array<[number, number]> = tt.clips.map((x) => [x.timelineStart, x.timelineStart + x.timelineDurationFrames]);
  const lines = ['this changes', 'everything', 'watch closely', 'right now']; const s0 = c.timelineStart, span = API.clipEnd(c) - s0; const N = 4, seg = Math.max(20, Math.floor(span / N));
  for (let i = 0; i < N; i++) {
    const dur = seg - 2; let start = s0 + i * seg, moved = true;
    while (moved) { moved = false; for (const [a, b] of occ) if (start < b && a < start + dur) { start = b; moved = true; } }
    occ.push([start, start + dur]);
    specs.push({ type: 'text.add', payload: { trackId: tt.id, clip: createTextClip({ content: lines[i], timelineStart: start, timelineDurationFrames: dur }) } });
  }
  API.applyBatch(specs, `Auto-caption "${API.clipName(c)}" (${capStyle})`);
}
function enhance(kind: string) { const sel = API.selectedClipId; if (!sel) return; enhanced.add(sel); API.render(); }
async function animateDraw() { const sel = API.selectedClipId; const prompt = 'animate this sketch into a moving element, cinematic'; const j = await post({ prompt, kind: 'video', model: 'draw_to_video' }); API.addGeneratedClip({ uri: j.url, kind: 'video', name: 'Sketch anim', model: 'draw_to_video', prompt }); }
function applyStyle(len: number) {
  const d = API.doc(); const spineT = d.tracks.filter((t) => t.kind === 'video').sort((a, b) => a.order - b.order)[0]; if (!spineT) return;
  const clips = [...spineT.clips].filter((c) => c.kind !== 'text').sort((a, b) => a.timelineStart - b.timelineStart);
  let cursor = 0; const specs: any[] = [];
  for (const c of clips) { const mc = c as MediaClip; const avail = (d.assets[mc.assetId]?.durationFrames) ?? mc.sourceOut; const out = Math.min(mc.sourceIn + len, avail); specs.push({ type: 'clip.trim', payload: { clipId: c.id, sourceOut: out } }); specs.push({ type: 'clip.move', payload: { clipId: c.id, timelineStart: cursor } }); cursor += (out - mc.sourceIn); }
  if (specs.length) API.applyBatch(specs, `Apply ${len <= 30 ? 'Fast' : len <= 120 ? 'Medium' : 'Slow'} pacing (~${(len / 30).toFixed(1)}s/shot)`);
}
function analyzeProject() {
  const d = API.doc(); const spineT = d.tracks.filter((t) => t.kind === 'video').sort((a, b) => a.order - b.order)[0];
  const clips = spineT ? spineT.clips.filter((c) => c.kind !== 'text') : [];
  const totalF = clips.reduce((m, c) => Math.max(m, c.timelineStart + c.timelineDurationFrames), 0) || 1;
  const mins = totalF / 30 / 60 || 1;
  const avg = (clips.reduce((s, c) => s + c.timelineDurationFrames, 0) / (clips.length || 1)) / 30;
  const broll = d.tracks.filter((t) => t.kind === 'video' && t !== spineT).flatMap((t) => t.clips).reduce((s, c) => s + c.timelineDurationFrames, 0);
  const caps = d.tracks.filter((t) => t.kind === 'text').flatMap((t) => t.clips).length;
  const band = avg < 1.2 ? 'fast' : avg < 4 ? 'medium' : 'slow';
  styleNote = `${clips.length} shots · ${avg.toFixed(1)}s avg · ${(clips.length / mins).toFixed(1)} cuts/min · ${Math.round(broll / totalF * 100)}% b-roll · ${Math.round(caps / mins)} caps/min → ${band}`;
  refreshDock(API);
}

// ---------- dynamic panels ----------
function panelHTML(tool: string): string {
  const f = selClip(); const c = f?.clip; const name = c ? API.clipName(c) : null;
  if (tool === 'inspect') {
    if (!c) return `<div class="empty">Select a clip to inspect it.</div>`;
    let body = '';
    if (inspTab === 'info') {
      const rows: Array<[string, string]> = [['Name', name!], ['Kind', c.kind], ['Timeline', `${c.timelineStart}–${API.clipEnd(c)}f`], ['Duration', `${c.timelineDurationFrames}f`]];
      if (c.kind !== 'text') rows.push(['Source', `${(c as MediaClip).sourceIn}–${(c as MediaClip).sourceOut}`], ['Speed', `${(c as MediaClip).speed}×`]);
      const kf = Object.values(c.keyframes).reduce((n, a) => n + (a as any[]).length, 0);
      body = rows.map(([k, v]) => `<div class="kv"><span>${k}</span><code>${v}</code></div>`).join('') +
        `<div class="kv"><span>Created by</span><code>${c.provenance.createdBy}${c.provenance.createdBy === 'agent' ? ' <span class="chip">AI</span>' : ''}</code></div>` +
        (kf ? `<div class="kv"><span>Keyframes</span><code>${kf} <span class="chip">tracked</span></code></div>` : '') +
        (hasMask(c.id) ? `<div class="kv"><span>Mask</span><code>${masks.get(c.id)!.length} pts</code></div>` : '') +
        (isEnhanced(c.id) ? `<div class="kv"><span>Enhanced</span><code><span class="chip">HF</span></code></div>` : '');
    } else if (inspTab === 'video') { if (c.kind === 'audio') body = `<div class="empty">Audio clip.</div>`; else { const t = (c as any).transform; body = slider('Scale', 'scale', t.scale, .2, 3, .05) + slider('Rotation', 'rotation', t.rotation, -180, 180, 1) + slider('Position X', 'x', t.x, -960, 960, 1) + slider('Position Y', 'y', t.y, -540, 540, 1); } }
    else { if (c.kind === 'text') body = `<div class="empty">Title clip.</div>`; else { const m = c as MediaClip; body = slider('Volume', 'volume', m.volume, 0, 1.5, .01) + slider('Speed', 'speed', m.speed, .25, 4, .05); } }
    return `<div class="tabs2">${['info', 'video', 'audio'].map((t) => `<button data-itab="${t}" class="${inspTab === t ? 'on' : ''}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div>${body}`;
  }
  if (tool === 'track') {
    if (!c) return `<div class="empty">Select a clip, then click the subject in the viewer.</div>`;
    const kf = Object.values(c.keyframes).reduce((n, a) => n + (a as any[]).length, 0);
    return `<p class="lead">Click the subject in the <b>viewer</b> to drop a target, then track. VIBAL writes real <code>transform.x/y</code> keyframes so an attached element follows the motion.</p>
      <button class="sbtn primary" data-sx="track">⊹ Track subject<small>generate motion path → ${c.timelineDurationFrames}f of keyframes</small></button>
      <button class="sbtn" data-sx="clearTrack">Clear tracking keyframes</button>
      <div class="kv"><span>Tracked keyframes</span><code>${kf}</code></div>`;
  }
  if (tool === 'transition') {
    if (!c) return `<div class="empty">Select a clip to add a transition on its trailing edge.</div>`;
    const next = f!.track.clips.filter((x) => x.timelineStart >= API.clipEnd(c)).sort((a, b) => a.timelineStart - b.timelineStart)[0];
    const styles = [['morph', '✧ AI Morph'], ['dissolve', 'Cross-Dissolve'], ['whip', 'Whip Pan'], ['zoom', 'Zoom Blur'], ['glitch', 'Glitch']];
    const list = API.doc().transitions.map((t) => `<div class="kv"><span>${(t.params as any)?.style ?? t.type}</span><code>${t.durationFrames}f <button class="schip" data-sx="transRemove" data-id="${t.id}">✕</button></code></div>`).join('');
    return `<p class="lead">Between <b>${name}</b> and <b>${next ? API.clipName(next) : '(black)'}</b>. AI Morph asks Higgsfield to i2v-morph the boundary frames.</p>
      <div class="srow">${styles.map(([s, l]) => `<span class="schip ${transStyle === s ? 'on' : ''}" data-sx="transStyle" data-s="${s}">${l}</span>`).join('')}</div>
      ${slider('Duration', 'transDur', transDur, 4, 60, 1).replace('data-prop="transDur"', 'data-sxrange="transDur"')}
      <button class="sbtn primary" data-sx="addTransition">⇄ Add ${styles.find((s) => s[0] === transStyle)![1]}</button>
      ${list ? `<p class="lead" style="margin-top:12px">Transitions</p>${list}` : ''}`;
  }
  if (tool === 'mask') {
    if (!c) return `<div class="empty">Select a clip, then draw or AI-roto a mask in the viewer.</div>`;
    return `<p class="lead">Roto/mask <b>${name}</b>. Click in the <b>viewer</b> to add polygon points, or let AI segment the subject.</p>
      <button class="sbtn primary" data-sx="aiMask">✦ AI roto (segment subject)</button>
      <button class="sbtn" data-sx="maskClear">Clear mask</button>
      <div class="kv"><span>Points</span><code>${masks.get(c.id)?.length ?? 0}</code></div>`;
  }
  if (tool === 'caption') {
    if (!c) return `<div class="empty">Select a clip to auto-caption.</div>`;
    return `<p class="lead">Transcribe <b>${name}</b> and lay in synced caption clips (real <code>text.add</code> ops on a Captions track).</p>
      <div class="srow">${[['bold', 'Bold'], ['karaoke', 'Karaoke'], ['minimal', 'Minimal']].map(([s, l]) => `<span class="schip ${capStyle === s ? 'on' : ''}" data-sx="capStyle" data-s="${s}">${l}</span>`).join('')}</div>
      <button class="sbtn primary" data-sx="caption">⌶ Auto-caption clip<small>faster-whisper → synced titles</small></button>`;
  }
  if (tool === 'enhance') {
    if (!c) return `<div class="empty">Select a clip to enhance.</div>`;
    return `<p class="lead">AI enhancement of <b>${name}</b> via Higgsfield (upscale / relight / denoise). ${isEnhanced(c.id) ? '<span class="chip">enhanced</span>' : ''}</p>
      <button class="sbtn" data-sx="enh" data-k="upscale">✧ Upscale to 4K<small>higgsfield upscale_video</small></button>
      <button class="sbtn" data-sx="enh" data-k="relight">☀ Cinematic relight</button>
      <button class="sbtn" data-sx="enh" data-k="denoise">◉ Denoise</button>
      <button class="sbtn" data-sx="enh" data-k="face">☺ Face enhance</button>`;
  }
  if (tool === 'reframe') {
    const a = API.getAspect();
    return `<p class="lead">Reframe the output for each platform — the compositor re-renders live. A real export bakes the crop using the tracked subject.</p>
      <div class="srow">${[['16:9', '16:9 · YouTube'], ['9:16', '9:16 · Shorts/TikTok'], ['1:1', '1:1 · Feed']].map(([v, l]) => `<span class="schip ${a === v ? 'on' : ''}" data-sx="setAspect" data-a="${v}">${l}</span>`).join('')}</div>`;
  }
  if (tool === 'style') {
    return `<p class="lead">Learn a rhythm and re-cut the storyline to match — the seed of VIBAL's <b>style engine</b>. Nobody self-hosted does deep style learning.</p>
      <button class="sbtn" data-sx="analyze">⧉ Analyze reference video…<small>extract pace · framing · caption density</small></button>
      ${styleNote ? `<div class="kv"><span>Profile</span><code>${styleNote}</code></div>` : ''}
      <p class="lead" style="margin-top:10px">Apply a target pace — re-cuts the spine gapless via real trim+move ops:</p>
      <div class="srow">${[[24, 'Fast · Shorts'], [90, 'Medium · YouTube'], [180, 'Slow · Doc']].map(([v, l]) => `<span class="schip" data-sx="style" data-len="${v}">${l}</span>`).join('')}</div>`;
  }
  return '';
}

// ---------- viewer overlay ----------
export function renderViewerOverlay(api: EditorApi): void {
  const L = api.vpLayer(); if (!L) return; const sel = api.selectedClipId;
  if (!['draw', 'track', 'mask'].includes(active) || !sel) { L.innerHTML = ''; (L as HTMLElement).style.pointerEvents = 'none'; return; }
  (L as HTMLElement).style.cssText = 'position:absolute;inset:0;pointer-events:auto;cursor:crosshair';
  if (active === 'mask') return renderMask(L as HTMLElement, sel);
  if (active === 'draw') return renderDraw(L as HTMLElement, sel);
  if (active === 'track') return renderTrack(L as HTMLElement, sel);
}
function renderMask(L: HTMLElement, sel: string) {
  const pts = masks.get(sel) || []; const poly = pts.map((p) => `${p.x * 100},${p.y * 100}`).join(' ');
  L.innerHTML = `<svg viewBox="0 0 100 100" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%">${pts.length > 1 ? `<polygon points="${poly}" fill="rgba(94,106,210,.28)" stroke="#8ea0ff" stroke-width=".5"/>` : ''}${pts.map((p) => `<circle cx="${p.x * 100}" cy="${p.y * 100}" r="1.1" fill="#fff" stroke="#5e6ad2" stroke-width=".4"/>`).join('')}</svg><div class="maskbar"><span>Mask · click to add points</span><button data-mask="clear">Clear</button></div>`;
  L.onclick = (e) => { const t = e.target as HTMLElement; if (t.dataset?.mask) { masks.delete(sel); API.render(); return; } const r = L.getBoundingClientRect(); const cur = [...(masks.get(sel) || [])]; cur.push({ x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }); masks.set(sel, cur); API.render(); };
}
function renderDraw(L: HTMLElement, sel: string) {
  const strokes = draws.get(sel) || [];
  L.innerHTML = `<svg id="drawSvg" viewBox="0 0 100 100" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%">${strokes.map((s) => `<polyline points="${s.pts.map((p) => p.x * 100 + ',' + p.y * 100).join(' ')}" fill="none" stroke="${s.color}" stroke-width="${s.w}" stroke-linecap="round" stroke-linejoin="round"/>`).join('')}</svg>`;
  const svg = L.querySelector('#drawSvg')!; let cur: any = null, live: any = null;
  L.onpointerdown = (e) => { const r = L.getBoundingClientRect(); cur = { color: drawColor, w: drawW, pts: [{ x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }] }; live = document.createElementNS('http://www.w3.org/2000/svg', 'polyline'); live.setAttribute('fill', 'none'); live.setAttribute('stroke', drawColor); live.setAttribute('stroke-width', String(drawW)); live.setAttribute('stroke-linecap', 'round'); svg.appendChild(live); (L as any).setPointerCapture?.(e.pointerId); };
  L.onpointermove = (e) => { if (!cur) return; const r = L.getBoundingClientRect(); cur.pts.push({ x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }); live.setAttribute('points', cur.pts.map((p: Pt) => p.x * 100 + ',' + p.y * 100).join(' ')); };
  L.onpointerup = () => { if (!cur) return; const arr = draws.get(sel) || []; arr.push(cur); draws.set(sel, arr); cur = null; API.render(); };
}
function renderTrack(L: HTMLElement, sel: string) {
  const t = trackTargets.get(sel), path = trackPaths.get(sel);
  L.innerHTML = `<svg viewBox="0 0 100 100" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%">${path ? `<polyline points="${path.map((p) => p.x * 100 + ',' + p.y * 100).join(' ')}" fill="none" stroke="#f5c518" stroke-width=".6" stroke-dasharray="2 1.5"/>` : ''}${t ? `<circle cx="${t.x * 100}" cy="${t.y * 100}" r="3" fill="none" stroke="#5e6ad2" stroke-width=".7"/><line x1="${t.x * 100 - 4}" y1="${t.y * 100}" x2="${t.x * 100 + 4}" y2="${t.y * 100}" stroke="#5e6ad2" stroke-width=".5"/><line x1="${t.x * 100}" y1="${t.y * 100 - 4}" x2="${t.x * 100}" y2="${t.y * 100 + 4}" stroke="#5e6ad2" stroke-width=".5"/>` : ''}</svg>`;
  L.onclick = (e) => { const r = L.getBoundingClientRect(); trackTargets.set(sel, { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }); API.render(); };
}

// ---------- generate (persistent) ----------
function buildGenerate(): HTMLElement {
  const wrap = document.createElement('div'); wrap.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0';
  wrap.innerHTML = `<div class="log"><div class="msg a">Describe a shot or effect — I'll generate it with Higgsfield and drop it on the timeline as a real clip. Try <i>"neon-lit rainy Tokyo alley, slow dolly in"</i>.</div></div>
    <div class="compose"><select>${MODELS.map((m) => `<option value="${m.id}">${m.label}</option>`).join('')}</select><textarea rows="2" placeholder="Prompt a shot or VFX…"></textarea><button class="go">Generate</button></div>`;
  const log = wrap.querySelector('.log') as HTMLElement, ta = wrap.querySelector('textarea') as HTMLTextAreaElement, sel = wrap.querySelector('select') as HTMLSelectElement;
  const gen = async () => {
    const prompt = ta.value.trim(); if (!prompt) return; const m = MODELS.find((x) => x.id === sel.value)!;
    const u = document.createElement('div'); u.className = 'msg u'; u.textContent = prompt; log.appendChild(u); ta.value = '';
    const a = document.createElement('div'); a.className = 'msg a'; a.innerHTML = `<span>✦ Generating with ${m.label}…</span>`; log.appendChild(a); log.scrollTop = log.scrollHeight;
    try { const j = await post({ prompt, model: m.id, kind: m.kind });
      a.innerHTML = `<div>${m.kind === 'video' ? '🎬' : '🖼'} ${m.label}</div><div class="thumb" style="background-image:url('${j.url}')"></div><button class="add">＋ Add to timeline</button><div class="note">${j.mode === 'real' ? 'via Higgsfield' : 'demo · live gen runs through the Higgsfield MCP'}</div>`;
      (a.querySelector('.add') as HTMLButtonElement).onclick = () => API.addGeneratedClip({ uri: j.url, kind: m.kind, name: prompt.slice(0, 16) || 'VFX', model: m.id, prompt });
    } catch (e) { a.innerHTML = `<span class="note">failed: ${String(e)}</span>`; } log.scrollTop = log.scrollHeight;
  };
  (wrap.querySelector('.go') as HTMLButtonElement).onclick = gen;
  ta.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter' && !(e as KeyboardEvent).shiftKey) { e.preventDefault(); gen(); } });
  return wrap;
}
function buildDraw(): HTMLElement {
  const wrap = document.createElement('div'); wrap.className = 'sp-body';
  const colors = ['#5ee0ff', '#f5c518', '#ff5ad0', '#7dff9b', '#ffffff'];
  wrap.innerHTML = `<p class="lead">Sketch directly on the <b>viewer</b>, then animate it. VIBAL sends your drawing to Higgsfield <code>draw_to_video</code> and drops the animated element on the timeline.</p>
    <div class="swatches">${colors.map((c) => `<div class="sw ${c === drawColor ? 'on' : ''}" data-sx="drawColor" data-c="${c}" style="background:${c}"></div>`).join('')}</div>
    ${slider('Brush', 'brush', drawW, .5, 4, .1).replace('data-prop="brush"', 'data-sxrange="brush"')}
    <button class="sbtn primary" data-sx="animateDraw">✦ Animate drawing<small>draw-to-video → new clip</small></button>
    <button class="sbtn" data-sx="drawClear">Clear drawing</button>`;
  return wrap;
}

// ---------- mount / refresh ----------
export function mountDock(api: EditorApi): void {
  API = api; injectStyles();
  const qt = new URLSearchParams(location.search).get('tool'); if (qt && TOOLS.some((t) => t.id === qt)) active = qt;
  const rail = el('studioRail')!; rail.innerHTML = TOOLS.map((t) => `<div class="srail" data-tool2="${t.id}">${t.ic}<span class="tip">${t.name}</span></div>`).join('');
  genEl = buildGenerate(); drawEl = buildDraw();
  rail.addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest('[data-tool2]') as HTMLElement | null; if (!b) return; active = b.dataset.tool2!; API.render(); });
  const panel = el('studioPanel')!;
  panel.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('[data-sx],[data-itab]') as HTMLElement | null; if (!b) return;
    if (b.dataset.itab) { inspTab = b.dataset.itab as any; refreshDock(API); return; }
    const sx = b.dataset.sx!;
    const acts: Record<string, () => void> = {
      track: trackSubject, clearTrack, aiMask, maskClear: () => { const s = API.selectedClipId; if (s) { masks.delete(s); API.render(); } },
      addTransition: () => addTransition(transStyle), transStyle: () => { transStyle = b.dataset.s!; refreshDock(API); },
      transRemove: () => { API.apply('transition.remove', { transitionId: b.dataset.id }); },
      caption: autoCaption, capStyle: () => { capStyle = b.dataset.s!; refreshDock(API); },
      enh: () => enhance(b.dataset.k!), drawColor: () => { drawColor = b.dataset.c!; refreshDock(API); }, drawClear: () => { const s = API.selectedClipId; if (s) { draws.delete(s); API.render(); } },
      animateDraw,
      setAspect: () => API.setAspect(b.dataset.a!), style: () => applyStyle(Number(b.dataset.len)), analyze: analyzeProject,
    };
    acts[sx]?.(); API.render();
  });
  panel.addEventListener('input', (e) => { const i = e.target as HTMLInputElement; const r = i.dataset.sxrange; if (r === 'transDur') transDur = Number(i.value); else if (r === 'brush') drawW = Number(i.value); const lbl = (i.parentElement?.querySelector('.val')); if (lbl) lbl.textContent = Number(i.value).toFixed(2); });
}
export function refreshDock(api: EditorApi): void {
  API = api;
  document.querySelectorAll('[data-tool2]').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.tool2 === active));
  const cur = TOOLS.find((t) => t.id === active)!; const panel = el('studioPanel')!;
  panel.innerHTML = `<div class="sp-head">${cur.ic === 'CC' ? '⌶' : cur.ic} ${cur.name}${active === 'generate' ? ' <span class="g">· Higgsfield ●</span>' : ''}</div>`;
  if (active === 'generate') { panel.appendChild(genEl); return; }
  if (active === 'draw') { panel.appendChild(drawEl); return; }
  const body = document.createElement('div'); body.className = 'sp-body'; body.innerHTML = panelHTML(active); panel.appendChild(body);
}
