# VIBAL — Prior Art

> Research date: 2026-07-24. Tool names and signatures below are extracted from **actual repo source** (GitHub trees, blob contents, official SDKs) — not marketing summaries — except where explicitly flagged as vendor claims. Each section leads with its verified sources.

We learned from these projects publicly; the public README will credit them. This document exists so our MCP surface and command-log design start from *what an agent actually needs*, which these teams already discovered.

---

## 1. Palmier Pro — the architecture to copy

**Sources:** `github.com/palmier-io/palmier-pro` — `Sources/PalmierPro/Agent/Tools/ToolDefinitions.swift`, `Sources/PalmierPro/Export/ExportOptions.swift`, `README.md`, `AGENTS.md`.

- **License: GPLv3.** *"The video editor (without the generative AI features) is fully open source… Generative AI features require login and subscription."* Core editor free, no login; MCP server + in-app chat are open source and share the same prompt/tools; only the generative pipeline is closed. → We can **study, not copy code**.
- **Platform: macOS 26, Apple Silicon only.** This is our wedge — cross-platform + self-hosted.
- **MCP endpoint:** `http://127.0.0.1:19789/mcp` (HTTP transport) while the app runs. Connect docs cover Claude Code, Codex, Cursor, Claude Desktop. A bundled `palmier-pro.mcpb` ships in Resources.

### The 47-tool MCP surface (authoritative, from the tool enum)

Design philosophy (from `AGENTS.md`): tools are *"designed from user intent, not internal APIs"* and *"return structured receipts."* Read tools return IDs; every edit tool targets those IDs and is undoable.

- **Read / inspect:** `get_timeline`, `inspect_timeline`, `capture_frame` (renders a composited frame to PNG, burns the frame number top-left e.g. `f157`, and returns the visible clip IDs top-down — the agent's "see what I see" primitive), `inspect_media`, `inspect_color`, `get_media`, `get_transcript`, `get_multicam`, `list_models`, `read_skill`, `search_media` (on-device semantic visual + transcript search returning source-second ranges), `send_feedback`
- **Timeline mutation:** `add_clips`, `insert_clips`, `move_clips`, `remove_clips`, `split_clips`, `sync_clips`, `set_clip_properties`, `set_keyframes`, `set_active_timeline`, `create_timeline` (also the **versioning primitive** — copy-then-edit; a timeline nests as a clip with `mediaType 'sequence'`), `manage_tracks`, `ripple_delete_ranges`, `remove_silence`, `remove_words` (transcript-driven cutting), `apply_layout`, `change_cam`, `manage_multicam`, `undo` (explicit undo exposed to the agent)
- **Text/captions:** `add_texts`, `update_text`, `add_captions`
- **Color/effects/audio:** `apply_color`, `apply_effect`, `denoise_audio`, `detect_beats`
- **Generative (gated):** `generate_video`, `generate_image`, `generate_audio`, `upscale_media`
- **Media/project:** `import_media` (HTTPS url / local path / base64 bytes / generated matte; recursive dir import), `organize_media`, `manage_project`, `set_project_settings`, `manage_exports`, `export_project`

### Export (from `ExportOptions.swift`)
`enum ExportFormat`: `.h264`(mp4), `.h265`(mp4), `.prores`(mov), `.hevcHDR`(mov, Main10 BT.2020+HLG), `.xml`(Premiere-style), `.fcpxml`. Plus a native project-package export bundling *every* timeline. Resolutions 720p–4K + Match Timeline.

**Takeaways for VIBAL:** the read-returns-IDs / edit-targets-IDs contract; `capture_frame` as the agent's visual feedback loop; timeline-nesting as the versioning primitive; the FCPXML + generic-XML escape hatches; the open-editor / paid-generation split.

---

## 2. OpenReelio — the command-log to copy

**Sources:** `github.com/openreelio/openreelio` — `README.md`, `docs/COMMAND_REFERENCE.md`.

- **License: MIT.** Pre-alpha (v0.1.0). Stack: Tauri + Rust + React + TS + FFmpeg + SQLite + **Wasmtime** (WASM plugins).
- **Op model: Event Sourcing.** Hard rule: *"State changes must only occur through Commands."* Ops append to **`ops.jsonl`**. Each command returns a `CommandResult { opId, changes, createdIds, deletedIds }`. Atomic: *"Commands either completely succeed or completely fail."* *"All Commands are reversible."* Batches run via `execute_batch { atomic: true }`.

### Command vocabulary (verbatim — this is our v1 op-list cross-check)
- **Asset:** `ImportAsset`, `DeleteAsset`
- **Clip:** `InsertClip`, `MoveClip`, `SplitClip`, `TrimClip`, `DeleteClip`, `SetClipSpeed`, `SetClipTransform`, `SetClipVolume`, `SetClipOpacity`
- **Track:** `CreateTrack`, `DeleteTrack`, `ReorderTrack`, `SetTrackVisibility`, `SetTrackMute`, `SetTrackLock`
- **Effect/keyframe:** `AddEffect`, `RemoveEffect`, `SetEffectParams`, `SetEffectEnabled`, `ReorderEffects`, `AddKeyframe`, `RemoveKeyframe`
- **Caption:** `CreateCaption`, `UpdateCaption`, `SetCaptionStyle`, `DeleteCaption`, `ImportCaptions` (SRT/VTT)
- **Sequence:** `CreateSequence`, `DeleteSequence`, `SetSequenceFormat`
- **Marker:** `AddMarker`, `UpdateMarker`, `DeleteMarker`
- **Style transfer (directly relevant to our §6 style engine):** `analyze_video_full`, `get_analysis_bundle`, `generate_esd`, `get_esd`, `list_esds`, `delete_esd`, `apply_editing_style` — an **"ESD" (Editing Style Descriptor)** system that analyzes a reference video and applies its style. **This is the closest open-source, MIT-licensed analog to Mimics' "style profile" — study it directly for our style engine.**

**Takeaways:** the command log as the trust mechanism; `ops.jsonl` as the persisted audit trail; `CommandResult` returning `createdIds` (so the agent learns the IDs it just made); the ESD system as a buildable style-engine reference.

---

## 3. OpenMontage — the tool decomposition checklist

**Sources:** `github.com/calesthio/openmontage` — full tree, `tools/`, `pipeline_defs/*.yaml`, `tools/tool_registry.py`.

- **License: AGPLv3** (correction — read-only for us if we ever copy; fine as reference). **Correction:** the "52 tools / 500+ skills" figure is stale — current repo is **~108 tool modules** + "700+ skill files." No UI; pipeline-driven; discovered via `registry.discover()`.
- **13 pipelines:** `animated-explainer`, `animation`, `avatar-spokesperson`, `character-animation`, `cinematic`, `clip-factory`, `documentary-montage`, `hybrid`, `localization-dub`, `podcast-repurpose`, `screen-demo`, `talking-head`, (`framework-smoke`).
- **Tool categories (module = tool):** `video/` (36 — incl. `silence_cutter`, `auto_reframe`, `video_trimmer`, `video_stitch`, `clip_search`, `higgsfield_video`, `seedance_video`), `audio/` (16 — TTS selectors, `freesound_music`, `pixabay_music`, `elevenlabs_tts`), `graphics/` (16), `analysis/` (14 — `scene_detect`, `transcriber`, `face_tracker`, `audio_energy`, `frame_sampler`, `composition_validator`), `enhancement/` (6), `avatar/` (4), `capture/` (3), plus `subtitle/`, `character/`, `publishers/export_bundle`.
- Render runtime chosen at proposal time: **Remotion** (default) vs **HyperFrames** (HTML+GSAP). Note: their default (Remotion) is a license blocker for us — see LICENSES.md.

**Takeaway:** use the `analysis/` set (`scene_detect`, `transcriber`, `frame_sampler`, `audio_energy`, `face_tracker`, `composition_validator`) as the checklist for our style-engine feature extractors.

---

## 4. OpenChatCut — the review-gate model

**Sources:** `github.com/0xsline/OpenChatCut` — `server/external-agent/mcp.ts`, `src/agent/external-tool-schemas.ts`.

- **License: AGPLv3-or-later.** Independent of the commercial ChatCut.
- **Editing model: proposal/session-based, isolated-draft.** Agents don't mutate the live project; they open an edit session writing to an isolated draft; in `manual` mode a human previews/approves/rejects. Multitrack ops applied **atomically as single undo steps**. Everything routes through `EditorCore` commands. Renders via Remotion + FFmpeg (H.264). Interchange: FCPXML, SRT.
- **External-agent MCP surface (verbatim):** `begin_edit_session`, `get_edit_session`, `review_edit_session`, `discard_edit_session`; project tools `openchatcut_status`, `list_projects`, `create_project`, `target_project`, `get_editor_url`. A separate `external-tool-policy.ts` gates what external agents may do.

**Takeaway:** the isolated-draft + explicit human-review-gate maps cleanly onto our "agent batch → stream in → revert batch/op" requirement (§4). A per-agent tool policy is a good security default.

---

## 5. Mimics — the feature to beat (vendor claims only)

**Source:** `mimics.today/en` — **marketing page, closed/hosted, unaudited.** Treat as vendor claims.

- Extracts (claimed): **average clip pace, cut frequency, vocal tone, narrative structure** from an uploaded reference video.
- Pacing buckets (claimed): **fast** (TikTok/Shorts), **medium** (YouTube 3–10 min), **slow** (documentary).
- Word-budget (verbatim): *"about **2.5 words/sec × target duration**."* GPT-4o writes a calibrated script; ElevenLabs VO; auto-cut silences + sync subs.

**Our wedge (§6):** their profile is 4 shallow signals (means only). We extract **5 layers and store distributions, not means** — rhythm (full shot-length histogram, not just the average), framing, text, audio, structure. OpenReelio's ESD is the open reference to build against.

---

## Deferred detail (available if needed)
- Palmier per-tool typed input schemas exist in `ToolDefinitions.swift` (we captured all 47 names + param vocabulary, not every field-by-field schema).
- OpenReelio per-op revert mechanics and the WASM plugin host-function API live in `commands/` Rust source + `docs/PLUGIN_SPEC.md` (not fully extracted). → OPEN_QUESTIONS.md.
