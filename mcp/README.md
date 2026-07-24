# VIBAL MCP server — drive the timeline from any agent

VIBAL exposes its timeline as MCP tools, so an agent runtime (Claude Code, Cursor, Codex) edits the
**same shared project** the browser editor shows. This is the handoff's Phase 3 and Palmier Pro's
"agent + human on one project" model — cross-platform and self-hosted.

## The point: a *merged* MCP environment

Connect **VIBAL** and **Higgsfield** MCP servers to the same agent. Then the agent can:

1. `higgsfield generate_video(prompt)` → gets a media URL
2. `vibal add_generated_clip(uri, model, prompt)` → the clip lands on the human's timeline

That's real Higgsfield generation on the timeline — the thing a browser→backend can't do, because the
Higgsfield MCP lives in the agent runtime, not the Node process.

```
   ┌─────────── agent runtime (Claude Code) ───────────┐
   │   Higgsfield MCP  ── generate ──►  clip URL         │
   │        │                              │             │
   │        └──────────► VIBAL MCP ── add_generated_clip │
   └───────────────────────────│───────────────────────┘
                                ▼
                 VIBAL backend (shared project, real engine)
                                ▲
                                │  Live mode (poll + POST ops)
                     browser editor  ◄── human watches & edits
```

## Run it

```bash
# 1. build the engine bundle the backend + MCP server use
npm run build:engine
npm run build:demo
# 2. start the backend (holds the shared project) + serve the editor
npm run serve            # http://localhost:8144
# 3. in the editor, click "○ Solo" → "◉ Live · shared project"
# 4. register the VIBAL MCP with your agent (project-scoped .mcp.json is already here), or:
claude mcp add vibal node mcp/server.mjs
```

`mcp/test-client.mjs` is a smoke test: `node mcp/test-client.mjs` spawns the server, lists tools, and
makes an edit you can see appear in the browser (Live mode).

## Tools

`get_timeline`, `append_clip`, `add_generated_clip`, `add_title`, `add_marker`, `split_clip`,
`trim_clip`, `move_clip`, `remove_clip`, `undo`, `redo`. Every one applies a real op through the
Phase 0 `CommandLog`, so undo/redo and provenance stay intact.

> Preview note: the shared-project backend keeps state in memory (persisted to `mcp/project.json`).
> `engine.node.mjs` and `project.json` are build/runtime artifacts and are gitignored — run
> `npm run build:engine` after cloning.
