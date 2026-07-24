// VIBAL editor preview — a Final Cut-style shell (Browser / Viewer / Inspector / Magnetic Timeline)
// driven by the REAL Phase 0 engine. Selecting, appending, blading, the agent batch, and every
// inspector edit dispatch actual ops through CommandLog, so undo/redo and the op log are genuine.
import { createDocument, createTrack, createMediaClip, createAsset, createTextClip } from '../src/document/factory';
import { CommandLog } from '../src/oplog/log';
import type { VibalDocument, Clip, Track, MediaClip, TextClip, Asset } from '../src/document/types';

const FPS = 30;
let log: CommandLog;
let assetIds: Record<string, string> = {};
let spineTrackId = '';
let selected: string | null = null;
let inspTab: 'info' | 'video' | 'audio' = 'info';
let playhead = 0;         // frames
let playing = false;
let pxf = 3;              // px per frame (zoom)
let lastBatch: string | null = null;

// ---------- sample project ----------
function buildSample(): void {
  log = new CommandLog(createDocument({ name: 'Demo Short', frameRate: { num: 30, den: 1 } }));
  const V1 = createTrack('video', { name: 'Storyline', order: 0 });   // primary storyline (spine)
  const V2 = createTrack('video', { name: 'B-roll', order: 1 });      // connected (above)
  const TT = createTrack('text', { name: 'Titles', order: 3 });       // connected titles (above)
  const A1 = createTrack('audio', { name: 'Music', order: 2 });       // below
  const A2 = createTrack('audio', { name: 'VO', order: 4 });          // below
  for (const t of [V1, V2, TT, A1, A2]) log.apply({ type: 'track.add', payload: { track: t } });
  spineTrackId = V1.id;

  const mk = (hash: string, kind: Asset['kind'], name: string, dur: number) => {
    const a = createAsset({ contentHash: hash, kind, originalName: name, durationFrames: dur });
    assetIds[name] = a.id;
    return a;
  };
  const intro = mk('a1', 'video', 'Opening', 600);
  const talk = mk('a2', 'video', 'Interview', 900);
  const close = mk('a3', 'video', 'Closer', 600);
  const bcut = mk('b1', 'video', 'City B-roll', 600);
  const music = mk('m1', 'audio', 'Track 01', 1200);
  const vo = mk('v1', 'audio', 'Voiceover', 900);

  const add = (trackId: string, asset: Asset, sourceIn: number, sourceOut: number, start: number, kind: MediaClip['kind'] = 'video') =>
    log.apply({ type: 'clip.add', payload: { trackId, clip: createMediaClip({ assetId: asset.id, kind, sourceIn, sourceOut, timelineStart: start }), asset } });

  // primary storyline, gapless
  add(V1.id, intro, 0, 90, 0);
  add(V1.id, talk, 0, 150, 90);
  add(V1.id, close, 100, 190, 240);
  // connected b-roll above the spine
  add(V2.id, bcut, 0, 80, 120);
  // connected title
  log.apply({ type: 'text.add', payload: { trackId: TT.id, clip: createTextClip({ content: 'VIBAL', timelineStart: 0, timelineDurationFrames: 60 }) } });
  // audio below
  add(A1.id, music, 0, 330, 0, 'audio');
  add(A2.id, vo, 0, 150, 90, 'audio');

  selected = null; playhead = 0; playing = false; lastBatch = null;
}

// ---------- helpers ----------
const $ = (id: string) => document.getElementById(id)!;
const allClips = (d: VibalDocument): Array<{ track: Track; clip: Clip }> =>
  d.tracks.flatMap((t) => t.clips.map((clip) => ({ track: t, clip })));
const findClip = (d: VibalDocument, id: string) => allClips(d).find((x) => x.clip.id === id);
const clipEnd = (c: Clip) => c.timelineStart + c.timelineDurationFrames;
const clipName = (d: VibalDocument, c: Clip) =>
  c.kind === 'text' ? (c as TextClip).text.content : (d.assets[(c as MediaClip).assetId]?.originalName ?? c.kind);
const clipClass = (c: Clip) => (c.kind === 'text' ? 'title' : c.kind === 'audio' ? 'audio' : c.kind === 'generated' ? 'generated' : 'video');

function tc(frame: number): string {
  const f = Math.max(0, Math.round(frame));
  const ff = f % FPS, s = Math.floor(f / FPS) % 60, m = Math.floor(f / (FPS * 60)) % 60, h = Math.floor(f / (FPS * 3600));
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(h)}:${p(m)}:${p(s)}:${p(ff)}`;
}
// deterministic pseudo-waveform bars from a clip id
function waveform(id: string, widthPx: number): string {
  let seed = 0; for (let i = 0; i < id.length; i++) seed = (seed * 31 + id.charCodeAt(i)) >>> 0;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const bars = Math.max(4, Math.floor(widthPx / 3));
  let path = '';
  for (let i = 0; i < bars; i++) { const h = 3 + rnd() * 13; path += `<rect x="${i * 3}" y="${16 - h}" width="1.6" height="${h * 2}" fill="rgba(255,255,255,.35)"/>`; }
  return `<svg class="wf" width="${bars * 3}" height="32" viewBox="0 0 ${bars * 3} 32" preserveAspectRatio="none" style="position:absolute;left:0;bottom:2px">${path}</svg>`;
}

// which spine clip sits under the playhead
function clipAtPlayhead(d: VibalDocument): Clip | null {
  const spine = d.tracks.find((t) => t.id === spineTrackId);
  return spine?.clips.find((c) => playhead >= c.timelineStart && playhead < clipEnd(c)) ?? null;
}

// ---------- actions (real ops) ----------
function appendAsset(name: string): void {
  const assetId = assetIds[name]; if (!assetId) return;
  const d = log.document;
  const spine = d.tracks.find((t) => t.id === spineTrackId)!;
  const start = spine.clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0);
  const asset = d.assets[assetId];
  const clip = createMediaClip({ assetId, kind: asset.kind === 'audio' ? 'audio' : 'video', sourceIn: 0, sourceOut: Math.min(120, asset.durationFrames ?? 120), timelineStart: start });
  log.apply({ type: 'clip.add', payload: { trackId: spineTrackId, clip } }, { actor: 'human' });
  selected = clip.id;
}
function blade(): void {
  const c = clipAtPlayhead(log.document);
  if (!c || playhead <= c.timelineStart || playhead >= clipEnd(c)) return;
  log.apply({ type: 'clip.split', payload: { clipId: c.id, atFrame: playhead } }, { actor: 'human' });
}
function agentTighten(): void {
  const d = log.document;
  const spine = d.tracks.find((t) => t.id === spineTrackId)!;
  const first = spine.clips[0]; if (!first || first.kind === 'text') return;
  const titles = d.tracks.find((t) => t.kind === 'text');
  const specs: any[] = [{ type: 'clip.trim', payload: { clipId: first.id, sourceOut: (first as MediaClip).sourceIn + 60 } }];
  if (titles) specs.push({ type: 'text.add', payload: { trackId: titles.id, clip: createTextClip({ content: 'Hook', timelineStart: 0, timelineDurationFrames: 40 }) } });
  const { batchId } = log.applyBatch(specs, { actor: 'agent', plan: 'Tighten the opening shot and add a hook caption.' });
  lastBatch = batchId;
}
function setProp(clipId: string, op: string, payload: any): void {
  log.apply({ type: op as any, payload: { clipId, ...payload } }, { actor: 'human' });
}

// ---------- render ----------
function renderBrowser(): void {
  const d = log.document;
  const items = Object.values(d.assets).map((a) => {
    const audio = a.kind === 'audio';
    return `<div class="media" data-asset="${a.originalName}">
      <div class="thumb ${audio ? 'audiothumb' : ''}"><span class="k">${a.kind}</span></div>
      <div><div class="mname">${a.originalName}</div><div class="mmeta">${a.durationFrames ?? '—'}f · ${a.kind}</div></div>
    </div>`;
  }).join('');
  $('browserList').innerHTML = items;
}

function renderViewer(): void {
  const d = log.document;
  const c = clipAtPlayhead(d);
  const stage = $('stage');
  if (c) {
    const col = clipClass(c) === 'title' ? 'var(--title)' : clipClass(c) === 'audio' ? 'var(--audio)' : 'var(--video)';
    stage.innerHTML = `<div class="card"><div class="swatch" style="background:${col}"></div>
      <div class="big">${clipName(d, c)}</div>
      <div class="sub">frame ${Math.round(playhead)} · no pixel renderer yet — Phase 2 wires WebCodecs here</div></div>`;
  } else {
    stage.innerHTML = `<div class="card"><div class="big" style="color:#3a3a40">no clip under playhead</div></div>`;
  }
  $('tc').textContent = tc(playhead);
  $('playBtn').textContent = playing ? '⏸' : '▶';
}

function renderInspector(): void {
  const d = log.document;
  const found = selected ? findClip(d, selected) : null;
  document.querySelectorAll('#inspTabs button').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.tab === inspTab));
  const body = $('inspBody');
  if (!found) { body.innerHTML = `<div class="empty">Select a clip to inspect it.</div>`; return; }
  const c = found.clip;
  if (inspTab === 'info') {
    const rows: Array<[string, string]> = [
      ['Name', clipName(d, c)],
      ['Kind', c.kind],
      ['Timeline', `${c.timelineStart}–${clipEnd(c)}f`],
      ['Duration', `${c.timelineDurationFrames}f`],
    ];
    if (c.kind !== 'text') rows.push(['Source in/out', `${(c as MediaClip).sourceIn}–${(c as MediaClip).sourceOut}`], ['Speed', `${(c as MediaClip).speed}×`]);
    const prov = c.provenance.createdBy === 'agent' ? ` <span class="chip">AI</span>` : '';
    body.innerHTML = rows.map(([k, v]) => `<div class="kv"><span>${k}</span><code>${v}</code></div>`).join('') +
      `<div class="kv"><span>Created by</span><code>${c.provenance.createdBy}${prov}</code></div>`;
  } else if (inspTab === 'video') {
    if (c.kind === 'audio') { body.innerHTML = `<div class="empty">Audio clip — see the Audio tab.</div>`; return; }
    const t = (c as MediaClip).transform ?? (c as TextClip).transform;
    body.innerHTML = `
      ${slider('Scale', 'scale', t.scale, 0.2, 3, 0.05)}
      ${slider('Rotation', 'rotation', t.rotation, -180, 180, 1)}
      ${slider('Position X', 'x', t.x, -960, 960, 1)}
      ${slider('Position Y', 'y', t.y, -540, 540, 1)}
      <div class="empty" style="text-align:left;padding-top:6px">Drag a slider → fires <code>clip.setTransform</code> through the log (undoable).</div>`;
  } else {
    if (c.kind === 'text') { body.innerHTML = `<div class="empty">Title clip — no audio.</div>`; return; }
    const m = c as MediaClip;
    body.innerHTML = `
      ${slider('Volume', 'volume', m.volume, 0, 1.5, 0.01)}
      ${slider('Speed', 'speed', m.speed, 0.25, 4, 0.05)}
      <div class="empty" style="text-align:left;padding-top:6px">Volume → <code>clip.setVolume</code>, Speed → <code>clip.setSpeed</code>.</div>`;
  }
}
function slider(label: string, prop: string, val: number, min: number, max: number, step: number): string {
  return `<div class="prop"><label>${label}</label>
    <input type="range" data-prop="${prop}" min="${min}" max="${max}" step="${step}" value="${val}"/>
    <span class="val" id="val-${prop}">${Number(val).toFixed(2)}</span></div>`;
}

function renderTimeline(): void {
  const d = log.document;
  const dur = Math.max(d.durationFrames, 300);
  const laneH = 54;

  // buckets: spine (order-0 video), connected above (other video/image + text), audio below
  const spine = d.tracks.find((t) => t.id === spineTrackId)!;
  const above = d.tracks.filter((t) => t.id !== spineTrackId && t.kind !== 'audio' && t.kind !== 'effect')
    .sort((a, b) => a.order - b.order);
  const below = d.tracks.filter((t) => t.kind === 'audio').sort((a, b) => a.order - b.order);

  const spineTop = above.length * laneH + 12;
  const spineH = 50;
  const belowTop = spineTop + spineH + 12;
  const contentH = belowTop + below.length * laneH + 16;
  const contentW = Math.max(dur * pxf + 40, 600);

  $('tlcontent').style.width = contentW + 'px';
  $('tlbody').style.height = contentH + 'px';

  // ruler (one tick per second)
  let ruler = '';
  for (let f = 0; f <= dur; f += FPS) ruler += `<div class="tick" style="left:${(f * pxf).toFixed(1)}px">${tc(f).slice(3)}</div>`;
  $('ruler').innerHTML = ruler;
  $('ruler').style.width = contentW + 'px';

  const clipHtml = (c: Clip, top: number, h: number) => {
    const left = c.timelineStart * pxf, w = Math.max(8, c.timelineDurationFrames * pxf - 2);
    const cls = clipClass(c);
    const sel = c.id === selected ? ' sel' : '';
    const ai = c.provenance.createdBy === 'agent' ? `<span class="ai">AI</span>` : '';
    const inner = cls === 'audio' ? waveform(c.id, w) : `<div class="film"></div>`;
    return `<div class="clip ${cls}${sel}" data-clip="${c.id}" style="left:${left.toFixed(1)}px;top:${top}px;width:${w.toFixed(1)}px;height:${h}px">
      <div class="top"></div>${inner}${ai}<div class="lab">${clipName(d, c)}</div></div>`;
  };

  let html = `<div class="spineband" style="top:${spineTop - 4}px;height:${spineH + 8}px"></div>`;
  // above (connected) — lane 0 nearest spine
  above.forEach((t, i) => {
    const top = spineTop - (i + 1) * laneH;
    for (const c of t.clips) {
      html += clipHtml(c, top, laneH - 8);
      // connection point down to the spine
      html += `<div class="connector" style="left:${(c.timelineStart * pxf).toFixed(1)}px;top:${top + (laneH - 8)}px;height:${spineTop - (top + laneH - 8)}px"></div>`;
    }
  });
  // spine
  for (const c of spine.clips) html += clipHtml(c, spineTop, spineH);
  // below (audio)
  below.forEach((t, j) => { for (const c of t.clips) html += clipHtml(c, belowTop + j * laneH, laneH - 8); });

  // playhead
  html += `<div class="playhead" style="left:${(playhead * pxf).toFixed(1)}px;height:${contentH}px"><div class="ph"></div></div>`;
  $('tlbody').innerHTML = html;
}

function renderIndex(): void {
  const d = log.document;
  const rows = allClips(d).sort((a, b) => a.clip.timelineStart - b.clip.timelineStart).map(({ clip }) => {
    const col = clipClass(clip) === 'title' ? 'var(--title)' : clipClass(clip) === 'audio' ? 'var(--audio)' : 'var(--video)';
    const sel = clip.id === selected ? 'style="background:#2d2d33"' : '';
    return `<div class="irow" data-clip="${clip.id}" ${sel}><span class="idot" style="background:${col}"></span>${clipName(d, clip)}</div>`;
  }).join('');
  $('indexList').innerHTML = rows;
}

function render(): void {
  $('projName').textContent = log.document.name;
  renderBrowser(); renderViewer(); renderInspector(); renderTimeline(); renderIndex();
  ($('undoBtn') as HTMLButtonElement).disabled = !log.canUndo();
  ($('redoBtn') as HTMLButtonElement).disabled = !log.canRedo();
  ($('revertBtn') as HTMLButtonElement).disabled = !lastBatch;
}

// ---------- interactions (delegated) ----------
document.addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  const clipEl = t.closest('[data-clip]') as HTMLElement | null;
  if (clipEl) { selected = clipEl.dataset.clip!; render(); return; }
  const assetEl = t.closest('[data-asset]') as HTMLElement | null;
  if (assetEl) { appendAsset(assetEl.dataset.asset!); render(); return; }
  const tabEl = t.closest('[data-tab]') as HTMLElement | null;
  if (tabEl) { inspTab = tabEl.dataset.tab as any; renderInspector(); return; }
  const act = (t.closest('[data-action]') as HTMLElement | null)?.dataset.action;
  if (!act) return;
  if (act === 'undo') log.undo();
  else if (act === 'redo') log.redo();
  else if (act === 'split') blade();
  else if (act === 'agent') agentTighten();
  else if (act === 'revert') { if (lastBatch && log.revertBatch(lastBatch)) lastBatch = null; }
  else if (act === 'toStart') playhead = 0;
  else if (act === 'toEnd') playhead = log.document.durationFrames;
  else if (act === 'playpause') togglePlay();
  render();
});

// inspector edits -> real ops
document.addEventListener('change', (e) => {
  const inp = e.target as HTMLInputElement;
  const prop = inp.dataset.prop; if (!prop || !selected) return;
  const v = Number(inp.value);
  if (prop === 'volume') setProp(selected, 'clip.setVolume', { volume: v });
  else if (prop === 'speed') setProp(selected, 'clip.setSpeed', { speed: v });
  else setProp(selected, 'clip.setTransform', { transform: { [prop]: v } });
  render();
});
document.addEventListener('input', (e) => {
  const inp = e.target as HTMLInputElement;
  if (inp.dataset.prop) { const el = document.getElementById('val-' + inp.dataset.prop); if (el) el.textContent = Number(inp.value).toFixed(2); }
});

// scrub by clicking the ruler / timeline
function scrubFromEvent(ev: MouseEvent): void {
  const scroll = $('tlscroll');
  const rect = $('tlcontent').getBoundingClientRect();
  const x = ev.clientX - rect.left + 0; // rect already accounts for scroll
  playhead = Math.max(0, Math.round(x / pxf));
  renderViewer(); renderTimeline();
}
$('ruler').addEventListener('mousedown', (ev) => { scrubFromEvent(ev as MouseEvent); const mv = (m: MouseEvent) => scrubFromEvent(m); const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); }; document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up); });

$('zoom').addEventListener('input', (e) => { pxf = Number((e.target as HTMLInputElement).value); renderTimeline(); });

// transport playback (moves the playhead; no media, honest)
let raf = 0, lastT = 0;
function togglePlay(): void { playing = !playing; if (playing) { lastT = performance.now(); raf = requestAnimationFrame(tick); } else cancelAnimationFrame(raf); }
function tick(now: number): void {
  if (!playing) return;
  const dt = (now - lastT) / 1000; lastT = now;
  playhead += dt * FPS;
  if (playhead >= log.document.durationFrames) { playhead = log.document.durationFrames; playing = false; renderViewer(); renderTimeline(); return; }
  renderViewer(); renderTimeline();
  raf = requestAnimationFrame(tick);
}

buildSample();
render();
