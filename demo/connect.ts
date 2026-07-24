// Connect panel — configure API keys and wire up Claude Code / the merged MCP environment.
export function mountConnect(): void {
  injectStyles();
  const btn = document.createElement('button'); btn.className = 'iconbtn'; btn.id = 'connectBtn'; btn.textContent = '⚙ Connect';
  document.querySelector('.topbar .spacer')?.after(btn);

  const cmd = (label: string, c: string) => `<div class="cmdrow"><div><div class="cmdlabel">${label}</div><code>${c}</code></div><button class="copy" data-copy="${c.replace(/"/g, '&quot;')}">copy</button></div>`;
  const modal = document.createElement('div'); modal.id = 'connectModal';
  modal.innerHTML = `<div class="ccard">
    <div class="chead"><b>Connect VIBAL</b><span class="csub">keys + agent setup</span><button class="cx">✕</button></div>
    <div class="cbody">
      <div class="pills"><span class="pill" id="stBackend">Backend …</span><span class="pill" id="stHf">Higgsfield …</span></div>

      <div class="csec"><h4>1 · Higgsfield</h4>
        <p>Two ways to use Higgsfield. <b>Recommended:</b> the MCP path via your Higgsfield account (no key) — see step 2. <b>Or</b> paste a REST API key for the backend to use directly.</p>
        <div class="keyrow"><input id="hfKey" type="password" placeholder="Higgsfield REST key (KEY_ID:KEY_SECRET)"/><button class="primary" id="saveKey">Save</button></div>
        <div class="hint" id="keyHint"></div>
      </div>

      <div class="csec"><h4>2 · Connect Claude Code — the merged MCP environment</h4>
        <p>Give one agent <b>both</b> VIBAL and Higgsfield MCP servers. Then it generates on Higgsfield and drops the clip onto the timeline you're watching.</p>
        ${cmd('Build + run the VIBAL backend (holds the shared project)', 'npm run build:engine && npm run serve')}
        ${cmd('Register the VIBAL MCP server (from the repo root)', 'claude mcp add vibal node mcp/server.mjs')}
        ${cmd('Register the Higgsfield MCP (auth via your Higgsfield account)', 'claude mcp add -t http higgsfield https://mcp.higgsfield.ai/mcp')}
        <p class="then">Then in the editor toggle <b>◉ Live</b>, and ask the agent:<br><i>"generate a neon rainy alley shot and add it to the timeline, then split the opening clip at 2s."</i></p>
      </div>

      <div class="csec"><h4>3 · Test</h4>
        <button id="testHf">Test generation</button> <span class="tout" id="testOut"></span>
      </div>
    </div>
  </div>`;
  document.body.appendChild(modal);

  const open = () => { modal.classList.add('open'); refresh(); };
  const close = () => modal.classList.remove('open');
  btn.onclick = open;
  (modal.querySelector('.cx') as HTMLElement).onclick = close;
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  modal.querySelectorAll('[data-copy]').forEach((b) => (b as HTMLElement).addEventListener('click', () => { navigator.clipboard?.writeText((b as HTMLElement).dataset.copy!); const o = b.textContent; b.textContent = 'copied ✓'; setTimeout(() => (b.textContent = o), 1200); }));
  (modal.querySelector('#saveKey') as HTMLElement).onclick = async () => {
    const inp = modal.querySelector('#hfKey') as HTMLInputElement; const k = inp.value.trim(); if (!k) return;
    const j = await (await fetch('/api/config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ higgsfieldKey: k }) })).json();
    inp.value = ''; (modal.querySelector('#keyHint') as HTMLElement).textContent = 'Saved to .env.local (gitignored). Backend generation is enabled.'; refresh(j);
  };
  (modal.querySelector('#testHf') as HTMLElement).onclick = async () => {
    (modal.querySelector('#testOut') as HTMLElement).textContent = 'testing…';
    const j = await (await fetch('/api/vfx', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'connection test', kind: 'image' }) })).json();
    (modal.querySelector('#testOut') as HTMLElement).textContent = `mode: ${j.mode} — ${j.note || ''}`;
  };
  async function refresh(pre?: any) {
    let s = pre; try { if (!s) s = await (await fetch('/api/status')).json(); } catch { s = { backend: false, higgsfield: false }; }
    const set = (id: string, ok: boolean, txt: string) => { const e = modal.querySelector(id) as HTMLElement; e.className = 'pill ' + (ok ? 'ok' : 'off'); e.textContent = txt; };
    set('#stBackend', !!s.backend, s.backend ? 'Backend ● connected' : 'Backend ○ down');
    set('#stHf', !!s.higgsfield, s.higgsfield ? 'Higgsfield key ● set' : 'Higgsfield key ○ not set (MCP path OK)');
  }
  if (new URLSearchParams(location.search).get('connect')) open();
}

function injectStyles() {
  if (document.getElementById('connect-style')) return; const s = document.createElement('style'); s.id = 'connect-style';
  s.textContent = `
  #connectModal{position:fixed;inset:0;background:rgba(0,0,0,.6);display:none;align-items:center;justify-content:center;z-index:100;backdrop-filter:blur(3px)}
  #connectModal.open{display:flex}
  #connectModal .ccard{width:620px;max-width:94vw;max-height:88vh;overflow:auto;background:#1b1c20;border:1px solid #34343a;border-radius:14px;box-shadow:0 20px 80px rgba(0,0,0,.6)}
  #connectModal .chead{display:flex;align-items:center;gap:9px;padding:14px 18px;border-bottom:1px solid #2a2a30;position:sticky;top:0;background:#1d1e22;z-index:1}
  #connectModal .chead b{font-size:15px}#connectModal .csub{color:#8a8a94;font-size:12px}
  #connectModal .cx{margin-left:auto;background:none;border:none;color:#8a8a94;font-size:16px;cursor:pointer}
  #connectModal .cbody{padding:16px 18px}
  #connectModal .pills{display:flex;gap:8px;margin-bottom:14px}
  #connectModal .pill{font-size:11.5px;padding:4px 10px;border-radius:999px;border:1px solid #34343a;color:#9a9aa4}
  #connectModal .pill.ok{color:#79e6ab;border-color:#2f8a56;background:#12251b}
  #connectModal .pill.off{color:#e6a879;border-color:#6a4a2f}
  #connectModal .csec{margin:16px 0;padding-top:14px;border-top:1px solid #26262c}
  #connectModal h4{margin:0 0 6px;font-size:13px}
  #connectModal p{color:#a9a9b4;font-size:12.5px;line-height:1.55;margin:0 0 10px}
  #connectModal .keyrow{display:flex;gap:8px}
  #connectModal input{flex:1;background:#111114;border:1px solid #34343a;color:#ecedf1;border-radius:7px;padding:8px 10px;font:12.5px ui-monospace,Menlo,monospace}
  #connectModal button.primary,#connectModal #testHf{background:#5e6ad2;border:none;color:#fff;border-radius:7px;padding:8px 14px;font-size:13px;cursor:pointer}
  #connectModal .hint{color:#79e6ab;font-size:11px;margin-top:6px}
  #connectModal .cmdrow{display:flex;align-items:center;gap:10px;background:#0f1013;border:1px solid #2a2a30;border-radius:8px;padding:9px 11px;margin:8px 0}
  #connectModal .cmdlabel{color:#8a8a94;font-size:10.5px;margin-bottom:3px}
  #connectModal .cmdrow code{color:#cfe3ff;font:12px ui-monospace,Menlo,monospace;word-break:break-all}
  #connectModal .copy{background:#2a2a30;border:1px solid #3a3a42;color:#ecedf1;border-radius:6px;padding:5px 10px;font-size:11px;cursor:pointer;flex:0 0 auto}
  #connectModal .then{color:#c9c9d2;margin-top:10px}#connectModal .then i{color:#9fb6ff}
  #connectModal .tout{color:#9a9aa4;font-size:12px;margin-left:8px}
  #connectBtn{background:#2a2338;border:1px solid #4a3a6e;color:#c9b6ff}`;
  document.head.appendChild(s);
}
