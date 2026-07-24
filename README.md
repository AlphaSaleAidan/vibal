# VIBAL

**An AI-native, self-hostable video editor.** Final Cut–style timeline you can drive by hand, plus an agent that edits the same project — because the AI never renders a video, it edits a JSON document through a command log, and the document renders the video. Full undo/redo across human *and* agent edits, reproducible renders, and an FCPXML escape hatch.

> **Status: pre-Phase-0 (design under review).** No application code yet. This repo currently holds the first-action research and the timeline schema that everything downstream is built on. Implementation starts once the schema is approved.

## What's here now

| Doc | Contents |
|---|---|
| [`docs/TIMELINE_SCHEMA.md`](docs/TIMELINE_SCHEMA.md) | **The core contract** — the JSON timeline document + the full command-log op list (24 ops, each with its inverse). |
| [`docs/PRIOR_ART.md`](docs/PRIOR_ART.md) | Verified tool/MCP surfaces of Palmier Pro, OpenReelio, OpenMontage, OpenChatCut (from source, not marketing) + Mimics. |
| [`docs/LICENSES.md`](docs/LICENSES.md) | License due-diligence for every intended dependency (this repo is public + commercial). |
| [`docs/HIGGSFIELD_API.md`](docs/HIGGSFIELD_API.md) | Verified Higgsfield MCP + REST surface for the generation providers. |
| [`docs/OPEN_QUESTIONS.md`](docs/OPEN_QUESTIONS.md) | Resolved decisions + parked/deferred items. |

## Prior art — credit where due

VIBAL learns publicly from prior open-source work: **[Palmier Pro](https://github.com/palmier-io/palmier-pro)** (local-MCP architecture, agent+human on one project), **[OpenReelio](https://github.com/openreelio/openreelio)** (the command log as the trust mechanism), **[OpenMontage](https://github.com/calesthio/openmontage)** (agent tool decomposition), and **[OpenChatCut](https://github.com/0xsline/OpenChatCut)** (the review-gate model). Our wedge over the closest of these (Palmier, macOS-only): **cross-platform + self-hosted + bring-your-own-keys + deep style learning.**

## Planned stack

Next.js (App Router) · custom JSON timeline + immutable command log · OpenTimelineIO for interchange · WebCodecs preview · FFmpeg render (on a GPU host, not this repo's coordinator) · faster-whisper · PySceneDetect · Motion Canvas · Supabase · Valkey + BullMQ · Higgsfield (MCP) generation. See `docs/LICENSES.md` for why each choice is safe for a public commercial repo.

## License

TBD at Phase 0 (candidate: a permissive OSS license for the editor, mirroring the open-editor / paid-generation split). Third-party license obligations are tracked in `docs/LICENSES.md`.
