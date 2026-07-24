# VIBAL — License Due-Diligence

> **This file is a Phase 0 gate.** If a dependency's license is unclear, it does not go in.
>
> **Constraint:** VIBAL is a **public** GitHub repo built by a **for-profit company that will exceed 3 employees and generates revenue.** Any "free only for <4 employees" or "free only if no revenue / non-commercial" license is a **BLOCKER** for a core dependency. Verified 2026-07-24 against primary sources (LICENSE files, official pricing pages).
>
> **Chosen defaults (decided 2026-07-24):** motion-graphics engine → **Motion Canvas (MIT)** (Remotion is out); queue backend → **Valkey (BSD-3)** (not Redis 8 AGPL/SSPL); muxer → **Mediabunny (MPL-2.0) directly** (not Diffusion Studio); we do **not** vendor an FFmpeg binary — users install a default-LGPL or `--enable-gpl` build from their package manager, never `--enable-nonfree`.

| Dependency | License (SPDX) | Source | Verdict |
|---|---|---|---|
| Next.js (App Router) | MIT | vercel/next.js `license.md` | ✅ OK (permissive) |
| OpenTimelineIO (OTIO) | Apache-2.0 | AcademySoftwareFoundation/OpenTimelineIO `LICENSE.txt` | ✅ OK w/ obligations: keep NOTICE + license, state changes on modify |
| WebCodecs + Canvas2D | N/A (W3C/WHATWG standard) | w3.org/TR/webcodecs | ✅ OK — browser API, no license to satisfy |
| FFmpeg (default LGPL build) | LGPL-2.1-or-later | ffmpeg.org/legal.html | ✅ OK (shell-out) |
| FFmpeg (`--enable-gpl`) | GPL-2.0/3.0-or-later | FFmpeg `LICENSE.md` | ✅ OK — copyleft only bites if *we* redistribute the binary; shell-out doesn't reach our code |
| FFmpeg (`--enable-nonfree`) | non-free | ffmpeg.org/legal.html | ⛔ **BLOCKER — non-redistributable. Never ship or bundle it.** |
| faster-whisper | MIT | SYSTRAN/faster-whisper `LICENSE` | ✅ OK |
| OpenAI Whisper (code + weights) | MIT | openai/whisper `LICENSE` | ✅ OK — weights MIT too |
| PySceneDetect | BSD-3-Clause | Breakthrough/PySceneDetect `LICENSE` | ✅ OK w/ obligations: retain notice |
| Supabase (`supabase-js`) | MIT | supabase/supabase-js `LICENSE` | ✅ OK |
| Supabase (self-host server) | Apache-2.0 (+MIT parts) | supabase/supabase `LICENSE` | ✅ OK w/ obligations if redistributing server |
| **Redis 8.x** | AGPL-3.0 / RSALv2 / SSPLv1 (tri) | redis.io/legal/licenses | ✅ OK for queue-only use — but see note |
| **Valkey** (recommended) | BSD-3-Clause | redis.io/blog/what-is-valkey | ✅ OK — cleanest choice, drop-in for BullMQ |
| BullMQ | MIT | taskforcesh/bullmq | ✅ OK |
| **Remotion** | Proprietary "Remotion License" | remotion.dev/docs/license/pricing | ⛔ **BLOCKER — free only ≤3 employees; 4+ needs paid Company License** |
| **Diffusion Studio Core ≥1.6.0** | Diffusion Studio Non-Commercial | npmjs.com/package/@diffusionstudio/core | ⛔ **BLOCKER — non-commercial, we have revenue** |
| Diffusion Studio Core <1.6.0 | MPL-2.0 | GitHub mirror | ⚠️ OK but pinning old = security trap; avoid |
| **Mediabunny** (recommended) | MPL-2.0 | mediabunny.dev | ✅ OK — commercial at any size; use directly instead of Diffusion Studio |
| Palmier Pro | GPL-3.0 | palmier-io/palmier-pro | 📖 READ-ONLY — study, do not copy code |
| Motion Canvas (recommended) | MIT | motion-canvas/motion-canvas `LICENSE` | ✅ OK — no threshold; Remotion replacement |
| MotionForge | MIT | codedbytahir/motionforge | ⚠️ OK — young solo project; vet maturity before core dep |

## Critical notes

**FFmpeg build flags.** VIBAL invokes `ffmpeg` as a **separate process**, not linked — mere aggregation, so neither LGPL nor GPL imposes copyleft on our source. Default **LGPL build** = essentially no obligation. A `--enable-gpl` build (Homebrew/apt default, adds x264/x265) is also fine. Hard rule: **`--enable-nonfree` (libfdk_aac etc.) is legally non-redistributable — private use only, never bundle.** **We do NOT vendor an ffmpeg binary; the README points users at their system package manager (apt/brew/winget) for a default LGPL or `--enable-gpl` build.**

**Redis → Valkey.** Both are legally fine for pure queue use (AGPL/SSPL only bites if you *modify* Redis *and* offer it as a network service; connecting via BullMQ triggers nothing, and we don't distribute it). **We default to Valkey (BSD-3-Clause, LF governance)** to remove all SSPL/AGPL reasoning from a diligence/acquisition review. Wire-compatible drop-in.

**Remotion — confirmed BLOCKER.** Source-available, free only for individuals/non-profits/for-profits ≤3 employees; above that, paid ($25/seat/mo Creators, $0.01/render min $100/mo Automators). **→ Motion Canvas (MIT) is our React/programmatic motion-graphics engine.** Do not put Remotion on the critical path.

**Diffusion Studio / Mediabunny.** The v1.6.0 license flip is real (was MPL-2.0, now non-commercial). Pinning <1.6.0 to dodge it is a maintenance/security trap. **Clean move: depend on Mediabunny directly** — MPL-2.0, no size/revenue threshold, it's the muxer Diffusion Studio wraps. MPL obligation is file-level (only modified Mediabunny files must stay MPL; our code stays any-license).

## Open license questions (see OPEN_QUESTIONS.md)
- Third-party fine-tuned Whisper checkpoints are NOT automatically MIT — re-check per checkpoint.
- OTIO **adapter** packages (AAF, some Premiere/FCPXML paths) can carry different licenses than OTIO core — confirm per adapter we actually depend on.
- Diffusion Studio official docs site refused fetch; ≥1.6.0 non-commercial boundary corroborated via npm + mirror only. Confirm with vendor if seriously considered.
- Supabase self-host bundles components (Studio, Kong, Logflare) with their own licenses — enumerate before redistributing a customized image.
