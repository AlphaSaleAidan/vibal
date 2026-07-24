# CUTROOM — Open Questions

> Per the standing rule ("If you don't know a value, add it here and stop — do not invent it"), every unresolved value or decision lives here. Nothing below has been guessed at in code.

## A. Decisions for you (product / process)

1. **Repo name & location.** Provisionally `/root/cutroom`, working name **CUTROOM**. Handoff says "rename in Phase 0 if you want." Confirm name and confirm this is its own repo (not inside `/root/ruflo`). GitHub org/owner for the public repo? (`AlphaSaleAidan`?)
2. **Timeline rate representation.** I chose a **rational** frame rate (`{num,den}`) + integer frame times for drift-free 29.97/23.976. Confirm you're happy with that over a plain float FPS. (Affects every op payload.)
3. **`marker.update` / `marker.remove`.** Handoff §4's op list includes only `marker.add`. I deferred update/remove to v1.1. Confirm that's fine or promote them into v1.
4. **Motion-graphics engine.** Remotion is a confirmed license blocker (LICENSES.md). I recommend **Motion Canvas (MIT)**. Approve, or evaluate MotionForge? (This only matters at Phase 2+; flagging early because it shapes the text/animation layer.)
5. **Queue backend.** Recommend **Valkey (BSD-3)** over Redis 8 (AGPL/SSPL) for a clean public repo. Approve?
6. **Which host renders.** Contabo VPS (St. Louis, 64GB/16-core) for render/generation workers per handoff — confirm we target that box for the BullMQ worker + FFmpeg in `docker-compose`.

## B. Higgsfield — needs a live account to close (blocks Phase 1 REST client)

7. **Text-to-Video REST endpoint.** Official SDK documents only image-to-video (`/v1/image2video/dop`). Is there an official `platform.higgsfield.ai` text-to-video path (or a model param on a generic route), or is native T2V (Seedance/Kling/Veo/Sora) only via the MCP? Need to check against your authenticated dashboard/docs.
8. **Base host.** `platform.higgsfield.ai` (SDK default) vs a `cloud.higgsfield.ai` reference on the Python DeepWiki page — confirm the canonical host from the live SDK config / your dashboard.
9. **Full submit-response schema.** Confirm from a real authenticated call whether any response includes a `success` boolean, and that the identifier field is `request_id` across *all* endpoints (confirmed for images/DoP; verify for video/soul).
10. **"Soul" for video.** Confirm identity-consistent video = Soul-image → `/v1/image2video/dop`, or whether a Soul-conditioned video endpoint exists.
11. **Webhook signature scheme.** The `secret` on `webhook: {url, secret}` — what HMAC scheme / header / signing payload, so CUTROOM can verify callbacks? Not documented publicly.
12. **Credit costs** per model and per resolution (2K vs 4K), and whether REST-key usage and MCP-OAuth usage draw from the same credit pool at the same rate. Only visible in a real account's billing.

## C. Prior-art detail (would refine our design; not blocking)

13. **OpenReelio per-op rollback.** Docs confirm "all Commands reversible" + `ops.jsonl`, but the exact procedure to revert *one arbitrary op* out of history (vs sequential undo) needs a read of their `commands/` Rust source. Our design uses self-describing inverses (§4) — worth comparing.
14. **OpenReelio WASM plugin host-function API.** Full Wasmtime host-function/provider-trait signatures live in `docs/PLUGIN_SPEC.md` (not extracted); plugin UX is "planned," so unstable. Relevant only when we build provider extensibility.
15. **OpenMontage registered-tool count** is environment-dependent (registry filters by available API keys), so there's no fixed "N tools" constant — our checklist uses the 108 module names instead.
16. **Palmier per-tool typed input schemas.** We have all 47 tool names + param vocabulary, not every field-by-field schema. `ToolDefinitions.swift` has them if we want exact arg lists when designing our MCP surface (Phase 3).

## D. License follow-ups (LICENSES.md)

17. **OTIO adapters.** Core is Apache-2.0, but specific adapters (AAF, some Premiere/FCPXML) can live in separate packages with different licenses — confirm the license of each adapter package we actually depend on before adding it.
18. **Third-party Whisper checkpoints** are not automatically MIT — re-check per checkpoint if we ever swap the model.
19. **Supabase self-host component sprawl** — enumerate bundled component licenses (Studio, Kong, Logflare) before redistributing a customized self-host image.
20. **Diffusion Studio** official docs site refused fetch; the ≥1.6.0 non-commercial boundary is corroborated via npm + mirror only. If we ever seriously consider it (we recommend Mediabunny instead), confirm terms with the vendor.
