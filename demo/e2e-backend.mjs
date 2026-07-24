// End-to-end test of the shared-project backend + agent intent endpoints (the MCP surface).
const B = process.env.VIBAL_URL || 'http://localhost:8144';
const call = async (p, b) => { const r = await fetch(B + p, { method: b ? 'POST' : 'GET', headers: b ? { 'content-type': 'application/json' } : {}, body: b ? JSON.stringify(b) : undefined }); return r.json(); };
let ok = 0, fail = 0; const chk = (c, m) => { c ? ok++ : fail++; console.log('  ' + (c ? '✓' : '✗ FAIL') + ' ' + m); };
const v0 = (await call('/api/project')).version;
const a = await call('/api/append', { name: 'Interview', seconds: 2 }); chk(a.version > v0 && a.result.createdIds.length === 1, 'append_clip');
const t = await call('/api/title', { text: 'E2E', atSeconds: 1 }); chk(t.ok !== false && t.result?.createdIds?.length === 1, 'add_title (nudges past overlap)');
const g = await call('/api/generated', { uri: 'x.mp4', name: 'E2Egen', model: 'seedance' }); chk(g.result.createdIds.length >= 1, 'add_generated_clip');
const proj = await call('/api/project'); const clip = proj.doc.tracks.find((x) => x.name === 'Storyline').clips[0];
const sp = await call('/api/split', { clipId: clip.id, atSeconds: (clip.timelineStart + 15) / 30 }); chk(sp.result?.createdIds?.length === 1, 'split_clip');
const tr = await call('/api/trim', { clipId: clip.id, outSeconds: (clip.timelineStart + 10) / 30 + 1 }); chk(tr.ok !== false, 'trim_clip');
const u = await call('/api/undo', {}); chk(u.ok, 'undo'); const r = await call('/api/redo', {}); chk(r.ok, 'redo');
const rm = await call('/api/remove', { clipId: g.result.createdIds[0] }); chk(rm.ok !== false, 'remove_clip');
console.log('\nBackend E2E: ' + ok + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
