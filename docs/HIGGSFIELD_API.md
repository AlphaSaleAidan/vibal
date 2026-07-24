# CUTROOM — Higgsfield API Verification

> Verified 2026-07-24 against **official Higgsfield sources** (JS SDK `higgsfield-ai/higgsfield-js`, Python SDK `higgsfield-ai/higgsfield-client`, `higgsfield.ai/mcp`). Third-party aggregators (Segmind, WaveSpeed, apidog) wrap Higgsfield behind their **own** gateways with their **own** auth — they are NOT the surface a stranger with a Higgsfield key hits, and are flagged where they conflict.
>
> **This feeds Phase 1 (provider abstraction). Do not code the REST client until the OPEN QUESTIONS below are closed against a live account.**

## Headline correction
Our handoff notes said `Authorization: Bearer <key>`. **That is wrong for the official API.** The official API uses **`Authorization: Key <KEY_ID>:<KEY_SECRET>`** — a key **pair**. The `Bearer` claim comes only from a third-party wrapper (apidog) and must not be coded against.

## REST API — CONFIRMED (official SDKs)
- **Base URL:** `https://platform.higgsfield.ai` (default in both official SDKs). ⚠️ Python DeepWiki also references `cloud.higgsfield.ai` once — see OQ.
- **Auth:** `Authorization: Key KEY_ID:KEY_SECRET`. JS SDK accepts `"KEY_ID:KEY_SECRET"` or `apiKey`/`apiSecret`; Python reads `HF_KEY` (`id:secret`) then falls back to `HF_API_KEY` + `HF_API_SECRET`.
- **Async-job-with-polling:** confirmed. SDK auto-polls `GET /requests/{request_id}/status` when `withPolling: true` (default `pollInterval` 2000ms, `maxPollTime` 300000ms).
- **Response shape:**
  ```json
  { "status": "queued|in_progress|completed|nsfw|failed",
    "request_id": "<uuid>",
    "status_url": "https://platform.higgsfield.ai/requests/{request_id}/status",
    "cancel_url": "https://platform.higgsfield.ai/requests/{request_id}/cancel",
    "images": [{ "url": "..." }], "video": { "url": "..." } }
  ```
  - `request_id` ✅, `status_url` ✅, `status` (terminal: `completed`/`nsfw`/`failed`) ✅.
  - `success` (boolean) — **NOT confirmed; treat as stale.** State is signalled by `status`.
  - `generation_id` — **NOT an official field name; use `request_id`.**
- **Confirmed endpoints:**
  - Image-to-Video (DoP): `/v1/image2video/dop` — `input_image_url`, `prompt`, motion params, `model` tier (`dop-lite`/`dop-preview`/`dop-turbo`).
  - Soul (Text-to-**Image**): `/v1/text2image/soul`.
  - Speech-to-Video: `/v1/speak/higgsfield` (relevant for talking-head).
  - Also: `flux-pro/kontext/max/text-to-image`.
- **Seed:** supported in Text-to-Image / Image-to-Video / DoP (`seed` in `input`); **NOT supported in Soul.** ✅ matches our notes. → surface in UI so we never offer reproducibility where it doesn't exist.
- **Webhooks:** confirmed — `webhook: { url, secret }` on submit; SDK appends `?hf_webhook=<url>`; `secret` for signature verification. Prefer webhooks over polling when we have a public endpoint.

## REST API — UNVERIFIED / STALE
- **Distinct official Text-to-Video endpoint:** NOT confirmed. Official video path is **image**-to-video (`/v1/image2video/dop`). Native T2V models (Seedance 2.0, Kling 3, Veo 3, Sora 2) exist on the platform/MCP but their REST paths aren't in the SDK sources. → OQ.
- **"Soul Mode" as a *video* mode:** stale framing. Soul is an **image** identity/aesthetic family. Identity-consistent video is likely Soul-image → `/v1/image2video/dop`. → OQ.
- **`api.higgsfield.ai/v1/generations` + `Bearer` + `id`:** third-party (apidog), NOT official. Do not use.

## MCP Server — CONFIRMED
- **Hosted endpoint:** `https://mcp.higgsfield.ai/mcp`. Launched ~2026-04-30, 30+ image/video models through one endpoint.
- **Auth: account OAuth, NOT API keys.** "Authenticate through your Higgsfield account… No API keys to manage." Bills against plan **credits**.
- **Models exposed:** video (Seedance 2.0, Kling 3, Seedream 5.0 Lite, +Veo 3/Sora 2/Wan/Hailuo per launch coverage); image (Nano Banana Pro, Google Omni Flash, GPT Image 2, Soul 2.0); character training (Soul). 4K images, video ~15s.
- **This session already has the Higgsfield MCP connected** (`generate_image`, `generate_video`, `generate_audio`, `generate_3d`, `models_explore`, `balance`, `job_status`, `job_display`, `upscale_*`, `outpaint_image`, `reframe`, `remove_background`, `motion_control`, workflow tools). A stranger cloning our repo connects the same URL and OAuths with their own account.

## Two integration paths (per handoff §5)
1. **MCP path (preferred):** wire `https://mcp.higgsfield.ai/mcp` as an MCP client; account OAuth; credits billing. Already live in our dev environment.
2. **REST path (fallback):** `platform.higgsfield.ai` + `Key ID:SECRET`; submit → poll `status_url` (or webhook); use `request_id`, `status`; `seed` where supported.

Generated clips land on the timeline as normal clips with `provenance.createdBy: "agent"` and full `generation` params (model, prompt, seed, cost, requestId) in asset metadata — so any clip is regenerable with one tweaked parameter (see TIMELINE_SCHEMA.md `asset.generation`).

## Pricing
Credits, tied to plan; "cost depends on model and resolution" (2K/4K cost more; DoP `lite`<`preview`/`turbo`). Exact per-model numbers not published — read from a live account.
