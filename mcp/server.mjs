#!/usr/bin/env node
// VIBAL MCP server — exposes the timeline as agent tools. Any agent runtime (Claude Code, Cursor,
// Codex) can drive the SAME shared project the browser editor shows. In a MERGED MCP environment
// (VIBAL + Higgsfield connected together), an agent can generate_video on Higgsfield and then call
// vibal add_generated_clip here — real generation lands on the human's timeline. Palmier's model.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const BASE = process.env.VIBAL_URL || 'http://localhost:8144';
async function call(path, body) {
  const r = await fetch(BASE + path, { method: body ? 'POST' : 'GET', headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error(`${path} -> ${r.status}`);
  return r.json();
}
const txt = (s) => ({ content: [{ type: 'text', text: s }] });
const done = (j, msg) => txt(`${msg}\nproject now at version ${j.version}${j.result?.createdIds?.length ? `, created ${j.result.createdIds.join(', ')}` : ''}`);

const server = new McpServer({ name: 'vibal', version: '0.1.0' });

server.tool('get_timeline', 'Read the current VIBAL timeline: tracks, clips, ids, and times.', {}, async () => {
  const j = await call('/api/project'); const d = j.doc;
  let out = `Project "${d.name}" — ${(d.durationFrames / 30).toFixed(1)}s @ 30fps · version ${j.version} · undo:${j.canUndo} redo:${j.canRedo}`;
  for (const t of [...d.tracks].sort((a, b) => a.order - b.order)) {
    out += `\n\n[${t.kind}] ${t.name}`;
    for (const c of t.clips) { const nm = c.kind === 'text' ? `"${c.text.content}"` : (d.assets[c.assetId]?.originalName || c.kind); const g = d.assets[c.assetId]?.generation ? ' (generated)' : ''; out += `\n  ${c.id}  ${nm}${g}  ${(c.timelineStart / 30).toFixed(1)}s → ${((c.timelineStart + c.timelineDurationFrames) / 30).toFixed(1)}s`; }
  }
  return txt(out);
});
server.tool('append_clip', 'Append a media clip to the primary storyline. name = an asset in the browser, seconds = duration.', { name: z.string().optional(), seconds: z.number().optional() }, async (a) => done(await call('/api/append', a), `Appended ${a.name || 'a clip'}.`));
server.tool('add_generated_clip', 'Place an AI-generated clip on the timeline. Pass the media URL from a Higgsfield generation. THE bridge for a merged Higgsfield+VIBAL environment.', { uri: z.string(), name: z.string().optional(), model: z.string().optional(), prompt: z.string().optional() }, async (a) => done(await call('/api/generated', a), `Added generated clip "${a.name || a.prompt || 'VFX'}".`));
server.tool('add_title', 'Add a title/caption clip at a time.', { text: z.string(), atSeconds: z.number().optional(), seconds: z.number().optional() }, async (a) => done(await call('/api/title', a), `Added title "${a.text}".`));
server.tool('add_marker', 'Drop a marker at a time.', { atSeconds: z.number(), label: z.string().optional() }, async (a) => done(await call('/api/marker', a), `Marker at ${a.atSeconds}s.`));
server.tool('split_clip', 'Split (blade) a clip at a time.', { clipId: z.string(), atSeconds: z.number() }, async (a) => done(await call('/api/split', a), `Split ${a.clipId}.`));
server.tool('trim_clip', 'Trim a clip source in/out (seconds).', { clipId: z.string(), inSeconds: z.number().optional(), outSeconds: z.number().optional() }, async (a) => done(await call('/api/trim', a), `Trimmed ${a.clipId}.`));
server.tool('move_clip', 'Move a clip to a timeline position (seconds).', { clipId: z.string(), atSeconds: z.number() }, async (a) => done(await call('/api/move', a), `Moved ${a.clipId}.`));
server.tool('remove_clip', 'Remove a clip.', { clipId: z.string() }, async (a) => done(await call('/api/remove', a), `Removed ${a.clipId}.`));
server.tool('undo', 'Undo the last edit.', {}, async () => done(await call('/api/undo', {}), 'Undid last edit.'));
server.tool('redo', 'Redo.', {}, async () => done(await call('/api/redo', {}), 'Redid.'));

await server.connect(new StdioServerTransport());
