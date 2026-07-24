# VIBAL — Decisions & Open Questions

> Updated 2026-07-24 after review. Most first-action questions are now resolved. Nothing below has been guessed at in code — genuinely unresolved items are parked in §C/§D.

## A. Resolved decisions

1. **Name & repo.** Product is **VIBAL**. Public repo on GitHub `AlphaSaleAidan/vibal`. Own repo at `/root/vibal` (not inside `/root/ruflo`).
2. **Timeline rate.** Rational frame rate `{num,den}` + integer frame times (drift-free 29.97/23.976). Locked into the schema.
3. **Marker ops.** `marker.update` and `marker.remove` promoted into **v1** (schema §4.2 — now 24 ops).
4. **Motion-graphics engine.** **Motion Canvas (MIT)**. Remotion is out (license blocker).
5. **Queue backend.** **Valkey (BSD-3)**. Not Redis 8 (AGPL/SSPL).
6. **Compute/storage topology.** Contabo VPS = stateless coordinator only (app + Valkey + orchestration). **It stores no footage and does no GPU work.** Media bytes → object storage (Supabase Storage / S3-compatible), content-addressed. Render/transcode/analysis → the **GPU box** that runs the repo. Generation → remote Higgsfield. (Schema §1.1.)
7. **Higgsfield integration.** **MCP path is primary** (`https://mcp.higgsfield.ai/mcp`, already connected + OAuth'd, credits-billed, 30+ models). REST client deferred until a concrete need MCP can't serve. (HIGGSFIELD_API.md banner.)
8. **Muxer / low-level media.** **Mediabunny (MPL-2.0) directly**, not Diffusion Studio.
9. **FFmpeg.** Not vendored; users install a default-LGPL or `--enable-gpl` build from their package manager; never `--enable-nonfree`.

## B. Deferred (parked with Higgsfield REST; only matters if/when we build the REST fallback)

These were "needs a live account" questions. Since MCP is primary, they're **parked**, not blocking:
- Official Text-to-Video REST endpoint (vs image-to-video `/v1/image2video/dop` only) — MCP already does native T2V (Seedance/Kling/Veo/Sora).
- Canonical base host (`platform.higgsfield.ai` vs `cloud.higgsfield.ai`).
- Full submit-response schema (`success` boolean? `request_id` across all endpoints?).
- "Soul" for video vs Soul-image → I2V.
- Webhook HMAC signature scheme.
- Exact credit costs per model/resolution; shared credit pool REST vs MCP.

## C. Refinements (not blocking; I'll fold in as the relevant phase arrives)

- **OpenReelio per-op rollback** internals — compare their `commands/` Rust approach against our self-describing-inverse design when we build the reducer (Phase 0).
- **OpenReelio WASM plugin host-function API** — only relevant when we build provider extensibility (post-v1).
- **Palmier per-tool typed input schemas** — pull exact arg lists from `ToolDefinitions.swift` when we design our MCP surface (Phase 3).
- **OpenMontage `analysis/` tools** (`scene_detect`, `transcriber`, `frame_sampler`, `audio_energy`, `face_tracker`, `composition_validator`) — the checklist for our style-engine extractors (Phase 3).

## D. License follow-ups (re-check at the moment we add each dep)

- OTIO **adapter** packages (AAF, some Premiere/FCPXML) may carry different licenses than OTIO core — verify per adapter when added.
- Third-party fine-tuned Whisper checkpoints are not automatically MIT — re-check per checkpoint if we swap the model.
- Supabase self-host bundled components (Studio, Kong, Logflare) — enumerate before redistributing a customized image.
- MotionForge (backup to Motion Canvas) is a young solo project — re-confirm LICENSE at the pinned commit if ever promoted.
