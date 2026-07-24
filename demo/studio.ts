// VFX Studio (Higgsfield-connected chat) + Mask tool. Kept separate from the editor core.
// The studio POSTs to /api/vfx; results are dropped onto the timeline as real generated clips.
export interface EditorApi {
  readonly selectedClipId: string | null;
  readonly tool: string;
  masks: Map<string, Array<{ x: number; y: number }>>;
  addGeneratedClip(o: { uri: string; kind: 'image' | 'video'; name: string; model: string; prompt: string }): void;
  render(): void;
  setMaskForSelected(pts: Array<{ x: number; y: number }>): void;
  clearMaskForSelected(): void;
  renderMask(): void;
  toggleStudio(): void;
}

const MODELS = [
  { id: 'nano_banana_pro', kind: 'image', label: 'Nano Banana Pro · image' },
  { id: 'gpt_image_2', kind: 'image', label: 'GPT Image 2 · image' },
  { id: 'seedance_2_0', kind: 'video', label: 'Seedance 2.0 · video' },
  { id: 'soul_cinema_studio', kind: 'video', label: 'Soul Cinema · video' },
] as const;

function injectStyles(): void {
  if (document.getElementById('vfx-style')) return;
  const s = document.createElement('style'); s.id = 'vfx-style';
  s.textContent = `
  #studio{position:fixed;top:0;right:0;width:380px;height:100vh;background:#191a1f;border-left:1px solid #34343a;
    display:flex;flex-direction:column;transform:translateX(100%);transition:transform .22s cubic-bezier(.4,0,.2,1);z-index:50;box-shadow:-10px 0 40px rgba(0,0,0,.5)}
  #studio.open{transform:translateX(0)}
  #studio .sh{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid #34343a;background:linear-gradient(180deg,#20222a,#191a1f)}
  #studio .sh b{font-size:13px;letter-spacing:.02em}
  #studio .sh .dot{width:7px;height:7px;border-radius:50%;background:#3aa869;box-shadow:0 0 8px #3aa869}
  #studio .sh .x{margin-left:auto;cursor:pointer;color:#8a8a94;background:none;border:none;font-size:16px}
  #studio .log{flex:1;overflow:auto;padding:14px;display:flex;flex-direction:column;gap:12px}
  #studio .msg{max-width:92%}
  #studio .msg.u{align-self:flex-end;background:#2b2f5e;border:1px solid #3a3f78;border-radius:10px 10px 2px 10px;padding:8px 11px;font-size:12.5px}
  #studio .msg.a{align-self:flex-start;background:#212227;border:1px solid #34343a;border-radius:10px 10px 10px 2px;padding:10px 11px;font-size:12.5px;color:#d7d8de}
  #studio .msg.a .thumb{width:100%;height:150px;border-radius:8px;margin:8px 0;background-size:cover;background-position:center;border:1px solid #34343a}
  #studio .msg.a .add{background:#5e6ad2;border:none;color:#fff;border-radius:6px;padding:6px 10px;font-size:12px;cursor:pointer}
  #studio .msg.a .note{color:#8a8a94;font-size:10.5px;margin-top:6px}
  #studio .msg.a .spin{color:#8a8a94}
  #studio .compose{border-top:1px solid #34343a;padding:10px 12px;display:flex;flex-direction:column;gap:8px;background:#1c1d22}
  #studio select,#studio textarea{background:#111114;border:1px solid #34343a;color:#ecedf1;border-radius:7px;padding:8px;font:12.5px inherit;resize:none}
  #studio .row{display:flex;gap:8px}
  #studio .row button{flex:0 0 auto;background:#5e6ad2;border:none;color:#fff;border-radius:7px;padding:0 14px;font-size:13px;cursor:pointer}
  #studio .row button:disabled{opacity:.5}
  #vfxToggle{background:#2a2338;border:1px solid #4a3a6e;color:#c9b6ff}
  .maskbar{position:absolute;left:8px;bottom:8px;display:flex;gap:6px;align-items:center;background:rgba(20,20,24,.85);
    border:1px solid #34343a;border-radius:8px;padding:5px 8px;font-size:11px;color:#c9c9d2;backdrop-filter:blur(6px)}
  .maskbar button{background:#2a2a2f;border:1px solid #3a3a42;color:#ecedf1;border-radius:5px;padding:3px 8px;font-size:11px;cursor:pointer}
  .maskbar button:first-of-type{background:#5e6ad2;border-color:#5e6ad2;color:#fff}`;
  document.head.appendChild(s);
}

let studioEl: HTMLElement;
function log(): HTMLElement { return studioEl.querySelector('.log') as HTMLElement; }
function addMsg(cls: 'u' | 'a', html: string): HTMLElement {
  const m = document.createElement('div'); m.className = 'msg ' + cls; m.innerHTML = html;
  log().appendChild(m); log().scrollTop = log().scrollHeight; return m;
}

async function generate(api: EditorApi): Promise<void> {
  const ta = studioEl.querySelector('textarea') as HTMLTextAreaElement;
  const sel = studioEl.querySelector('select') as HTMLSelectElement;
  const prompt = ta.value.trim(); if (!prompt) return;
  const model = MODELS.find((m) => m.id === sel.value)!;
  addMsg('u', prompt); ta.value = '';
  const pending = addMsg('a', `<span class="spin">✦ Generating with ${model.label}…</span>`);
  try {
    const r = await fetch('/api/vfx', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt, model: model.id, kind: model.kind }) });
    const j = await r.json();
    pending.innerHTML = `<div>${model.kind === 'video' ? '🎬' : '🖼'} ${model.label}</div>
      <div class="thumb" style="background-image:url('${j.url}')"></div>
      <button class="add">＋ Add to timeline</button>
      <div class="note">${j.mode === 'real' ? 'generated via Higgsfield' : 'demo placeholder · ' + (j.note || 'set a Higgsfield key or use the MCP path for live output')}</div>`;
    (pending.querySelector('.add') as HTMLButtonElement).onclick = () =>
      api.addGeneratedClip({ uri: j.url, kind: model.kind, name: prompt.slice(0, 16) || 'VFX', model: model.id, prompt });
  } catch (e) { pending.innerHTML = `<span class="note">generation failed: ${String(e)}</span>`; }
}

export function mountStudio(api: EditorApi): void {
  injectStyles();
  // toggle button in the top bar
  const tb = document.querySelector('.topbar .spacer');
  const btn = document.createElement('button'); btn.id = 'vfxToggle'; btn.className = 'iconbtn'; btn.textContent = '✦ VFX Studio';
  tb?.after(btn);
  studioEl = document.createElement('div'); studioEl.id = 'studio';
  studioEl.innerHTML = `
    <div class="sh"><span class="dot"></span><b>VFX Studio</b><span style="color:#8a8a94;font-size:11px">· Higgsfield</span><button class="x">✕</button></div>
    <div class="log">
      <div class="msg a">Describe a shot or effect and I'll generate it with Higgsfield, then drop it on the timeline as a real clip. Try: <i>"neon-lit rainy Tokyo alley, slow dolly in"</i>.</div>
    </div>
    <div class="compose">
      <select>${MODELS.map((m) => `<option value="${m.id}">${m.label}</option>`).join('')}</select>
      <textarea rows="2" placeholder="Prompt a shot or VFX…"></textarea>
      <div class="row"><textarea style="flex:1;display:none"></textarea><button>Generate</button></div>
    </div>`;
  document.body.appendChild(studioEl);
  const toggle = () => studioEl.classList.toggle('open');
  api.toggleStudio = toggle; btn.onclick = toggle;
  (studioEl.querySelector('.x') as HTMLElement).onclick = toggle;
  (studioEl.querySelector('.row button') as HTMLElement).onclick = () => generate(api);
  (studioEl.querySelector('textarea') as HTMLTextAreaElement).addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter' && !(e as KeyboardEvent).shiftKey) { e.preventDefault(); generate(api); }
  });
}

// ---------- Mask tool overlay ----------
async function aiAssist(api: EditorApi): Promise<void> {
  try {
    const r = await fetch('/api/vfx', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'segment' }) });
    const j = await r.json(); if (j.points) api.setMaskForSelected(j.points);
  } catch { /* ignore */ }
}
export function mountMaskUI(api: EditorApi): void {
  const layer = document.getElementById('maskLayer'); if (!layer) return;
  if (api.tool !== 'mask' || !api.selectedClipId) { layer.innerHTML = ''; (layer as HTMLElement).style.pointerEvents = 'none'; return; }
  const L = layer as HTMLElement;
  L.style.cssText = 'position:absolute;inset:0;pointer-events:auto;cursor:crosshair';
  const pts = api.masks.get(api.selectedClipId) || [];
  const poly = pts.map((p) => `${p.x * 100},${p.y * 100}`).join(' ');
  L.innerHTML = `<svg viewBox="0 0 100 100" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%">
      ${pts.length > 1 ? `<polygon points="${poly}" fill="rgba(94,106,210,.28)" stroke="#8ea0ff" stroke-width=".5"/>` : ''}
      ${pts.map((p) => `<circle cx="${p.x * 100}" cy="${p.y * 100}" r="1.1" fill="#fff" stroke="#5e6ad2" stroke-width=".4"/>`).join('')}
    </svg>
    <div class="maskbar"><span>Mask · click to add points</span><button data-mask="ai">✦ AI assist</button><button data-mask="clear">Clear</button></div>`;
  L.onclick = (e) => {
    const t = e.target as HTMLElement; if (t.dataset && t.dataset.mask) return;
    const r = L.getBoundingClientRect();
    const cur = [...(api.masks.get(api.selectedClipId!) || [])];
    cur.push({ x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height });
    api.setMaskForSelected(cur);
  };
  L.querySelectorAll('[data-mask]').forEach((b) => (b as HTMLElement).addEventListener('click', (ev) => {
    ev.stopPropagation(); const a = (b as HTMLElement).dataset.mask;
    if (a === 'clear') api.clearMaskForSelected(); else if (a === 'ai') aiAssist(api);
  }));
}
