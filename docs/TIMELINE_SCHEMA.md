# CUTROOM — Timeline Document & Command Log (v1 schema)

> **Draft for review. Nothing downstream gets built until this is approved.** (Handoff §4, §11.)
>
> The core contract of the whole product: **the AI never renders a video — it edits this document through the command log; the document renders the video.** Human direct-manipulation, conversational edits, and agentic batches all emit the same ops against the same document.

---

## 0. Design invariants (non-negotiable)

1. **Ops are the only mutation path.** The UI emits ops; the agent emits ops. No code anywhere mutates the document object directly. Enforced by (a) a lint rule banning assignment into the document tree outside the reducer, and (b) a runtime guard — the in-memory document is deep-frozen (`Object.freeze`) so a stray direct mutation *throws*. **Red-first Phase 0 proof:** a test that attempts a direct field write and asserts it throws.
2. **Every entity has a stable UUID.** Agents reference entities by `id`, never by index or timeline position. IDs are prefixed by kind (`clip_`, `track_`, `asset_`, `op_`, `tr_`, `mk_`, `fx_`, `kf_`) for log readability.
3. **Assets are content-addressed.** Referenced by `contentHash`, never by absolute path — projects are portable between the Ubuntu dev box and the VPS.
4. **Provenance on every element.** `provenance.createdBy: "human" | "agent" | "import"` + the `opId` (and `batchId`) that created it. The UI can highlight everything the AI touched at a glance.
5. **Deterministic time.** All times are **integer frame counts**. Frame rate is **rational** (`{ num, den }`) to represent 23.976/29.97/59.94 without drift. No floating-point seconds in the document.
6. **Append-only, replayable history.** The op log is the source of truth for edit history; the document is a materialized view you can rebuild by replaying ops from empty.

---

## 1. Document format

```jsonc
{
  "schemaVersion": "1.0.0",          // semver; migrations keyed off major.minor (see §5)
  "id": "proj_1f2e…",
  "name": "My Short",
  "frameRate": { "num": 30000, "den": 1001 },   // 29.97; { "num":30,"den":1 } for exact 30
  "resolution": { "width": 1080, "height": 1920 },
  "durationFrames": 5400,            // derived = max clip end across tracks; stored for convenience
  "commercialUse": true,             // gates the media library (§ LICENSES / handoff §7)
  "styleProfileId": null,            // reference to styles/<id>.json when a profile is applied

  "assets":   { "asset_…": { /* §2 */ } },   // map keyed by asset id
  "tracks":   [ { /* §3 */ } ],              // ordered; array index is NOT identity
  "transitions": [ { /* §3.4 */ } ],         // first-class, reference the clip edge they join
  "markers":  [ { /* §3.5 */ } ],
  "transcripts": { "tr_…": { /* §2.1 */ } }, // keyed; produced by transcription provider

  "meta": {
    "createdAt": "2026-07-24T00:00:00Z",     // ISO; caller-supplied (no ambient clock in reducer)
    "modifiedAt": "2026-07-24T00:00:00Z",
    "app": "cutroom",
    "opSeq": 0                                // last applied op seq — see §4
  }
}
```

Notes:
- `durationFrames`, `meta.modifiedAt`, `meta.opSeq` are **derived/bookkeeping** — recomputed by the reducer, never authored by ops directly.
- The document is fully **lossless JSON**: serialize → deserialize → deep-equal is a Phase 0 test (distinct from the lossy OTIO/FCPXML round-trip, §5).

## 2. Assets (content-addressed)

```jsonc
"asset_9c1a…": {
  "id": "asset_9c1a…",
  "contentHash": "sha256:9c1a…",       // identity; dedupes re-imports
  "kind": "video" | "audio" | "image",
  "uri": "cutroom-asset://9c1a…",       // resolved by the asset store; NEVER an absolute path
  "originalName": "a-roll_01.mov",
  "durationFrames": 1800,               // null for still images
  "frameRate": { "num": 24, "den": 1 }, // source rate (may differ from timeline rate)
  "width": 3840, "height": 2160,
  "hasAudio": true,
  "transcriptId": "tr_…" | null,

  // license metadata — REQUIRED for any library/stock asset (handoff §7)
  "license": {
    "type": "cc0" | "cc-by" | "royalty-free" | "user-upload" | "generated",
    "attributionRequired": false,
    "attributionText": null,
    "commercialUseAllowed": true,
    "sourceUrl": null,
    "retrievedAt": null
  },

  // present only when kind was produced by a generation provider (handoff §5)
  "generation": null | {
    "provider": "higgsfield",
    "model": "dop-turbo",
    "prompt": "…",
    "seed": 12345 | null,               // null where model doesn't support seed (e.g. Soul)
    "costCredits": 8,
    "requestId": "…",                    // Higgsfield request_id
    "params": { /* full submit payload, for one-tweak regeneration */ }
  }
}
```

### 2.1 Transcript

```jsonc
"tr_…": {
  "id": "tr_…",
  "assetId": "asset_…",
  "language": "en",
  "source": "faster-whisper" | "whisper-api" | "imported-srt" | "imported-vtt",
  "words": [ { "text": "Hello", "startFrame": 12, "endFrame": 20 } ]  // frame-accurate
}
```
Transcript word ranges are the substrate for text-based editing (`ripple.delete` of "um"s, caption generation with `sourceTranscriptRange`).

## 3. Tracks, clips, text, transitions, markers

### 3.1 Track

```jsonc
{
  "id": "track_…",
  "kind": "video" | "audio" | "image" | "text" | "effect",
  "name": "V1",
  "order": 0,          // stacking order; higher = composited on top (video/text/image)
  "enabled": true,
  "locked": false,
  "muted": false,      // audio tracks
  "clips": [ /* §3.2 / §3.3, ordered by timelineStart, non-overlapping within a track */ ],
  "effects": [ /* §3.6 — effect tracks only: track-wide effects */ ]
}
```
Invariant: within one track, clips never overlap (overlap between tracks is how compositing works). The reducer rejects any op that would create an intra-track overlap.

### 3.2 Media clip (video / audio / image / generated)

```jsonc
{
  "id": "clip_…",
  "kind": "video" | "audio" | "image" | "generated",
  "assetId": "asset_…",
  "sourceIn": 0,             // frames into the source (in source's own rate)
  "sourceOut": 300,          // exclusive
  "timelineStart": 0,        // frames on the track (timeline rate)
  // timelineDurationFrames is DERIVED: round((sourceOut - sourceIn) / speed), retimed to timeline rate.
  // For image/generated stills with no intrinsic duration, timelineDurationFrames is stored explicitly.
  "timelineDurationFrames": 300,
  "speed": 1.0,              // 0.5 = half-speed (longer); negative = reverse
  "opacity": 1.0,
  "volume": 1.0,             // linear gain; audio + video-with-audio
  "transform": { "x": 0, "y": 0, "scale": 1.0, "rotation": 0, "anchorX": 0.5, "anchorY": 0.5 },
  "keyframes": { /* §3.7 */ },
  "effects": [ /* §3.6 */ ],
  "provenance": { "createdBy": "human", "opId": "op_…", "batchId": null }
}
```

### 3.3 Text clip (on a text track)

```jsonc
{
  "id": "clip_…",
  "kind": "text",
  "timelineStart": 120,
  "timelineDurationFrames": 90,
  "text": {
    "content": "matched to his mouth",
    "font": "Inter",
    "sizePx": 64,
    "color": "#FFFFFF",
    "position": { "x": 0.5, "y": 0.82 },     // normalized 0–1 of frame
    "alignment": "left" | "center" | "right",
    "animationPreset": "none" | "fade" | "pop" | "typewriter" | "slide-up",
    "sourceTranscriptRange": null | { "transcriptId": "tr_…", "startFrame": 120, "endFrame": 210 }
  },
  "opacity": 1.0,
  "transform": { /* same shape as media */ },
  "keyframes": { /* §3.7 */ },
  "provenance": { "createdBy": "agent", "opId": "op_…", "batchId": "batch_…" }
}
```

### 3.4 Transition (first-class entity)

```jsonc
{
  "id": "tr_…",
  "trackId": "track_…",
  "type": "crossDissolve" | "dip" | "wipe" | "fade",
  "durationFrames": 15,
  "fromClipId": "clip_a" | null,     // null = transition from black (fade-in)
  "toClipId": "clip_b" | null,       // null = transition to black (fade-out)
  "params": {},
  "provenance": { /* … */ }
}
```
Transitions are first-class (not clip sub-fields) so `transition.add`/`transition.remove` are clean, and so a transition survives when one of its clips is trimmed.

### 3.5 Marker

```jsonc
{ "id": "mk_…", "frame": 300, "name": "hook end", "color": "#FF5A5F",
  "provenance": { /* … */ } }
```

### 3.6 Effect (per-clip or per-track)

```jsonc
{ "id": "fx_…", "type": "lut" | "brightness" | "blur" | "…", "params": { /* type-specific */ },
  "enabled": true, "order": 0 }
```

### 3.7 Keyframes (per animatable property)

Keyed by a dotted property path so any animatable field can be driven:

```jsonc
"keyframes": {
  "opacity":          [ { "id": "kf_…", "frame": 0, "value": 0, "interp": "linear" },
                        { "id": "kf_…", "frame": 12, "value": 1, "interp": "bezier", "bezier": [0.4,0,0.2,1] } ],
  "transform.scale":  [ … ],
  "volume":           [ … ]     // audio ramps + ducking are volume keyframes (see audio.duck / audio.setRamp)
}
```
Animatable paths in v1: `opacity`, `volume`, `transform.x`, `transform.y`, `transform.scale`, `transform.rotation`. `interp`: `hold` | `linear` | `bezier`.

---

## 4. The command log

Every mutation is an **op**. Ops carry their own **inverse**, so undo = apply the inverse (not diff snapshots). The log is append-only and persisted (`ops.jsonl`, one op per line — following OpenReelio's proven pattern).

```jsonc
{
  "id": "op_…",
  "seq": 42,                       // monotonic per project; reducer rejects out-of-order
  "timestamp": "2026-07-24T…Z",    // caller-supplied (reducer has no ambient clock)
  "actor": "human" | "agent" | "import" | "system",
  "batchId": null | "batch_…",     // agent edits arrive as a batch
  "type": "clip.trim",
  "payload": { /* forward params — §4.2 */ },
  "inverse": { "type": "clip.trim", "payload": { /* params that undo it */ } }
}
```

- **Applying an op** returns a `CommandResult { opId, changedIds, createdIds, deletedIds }` (OpenReelio pattern) so the caller — especially the agent — **learns the IDs it just created**.
- **Undo** = append+apply the op's `inverse`. **Redo** = re-apply the forward op. Both are themselves recorded, so history is linear and fully replayable.
- Reducer computes each op's `inverse` at apply time from pre-state when the caller doesn't supply one; agent-supplied ops may omit `inverse` and the reducer fills it.

### 4.1 Agent batches (watch-the-edit + revert)

```jsonc
"batch_…": {
  "batchId": "batch_…",
  "actor": "agent",
  "plan": "Tighten the first 20s: trim 3 intro shots 15–25%, remove 4 filler words, add punch-in on line 2.",
  "opIds": [ "op_…", "op_…", … ],
  "createdAt": "…"
}
```
The UI streams a batch's ops in with a visible animation (so you watch the edit happen) and offers **"revert this batch"** (apply inverses of all opIds in reverse order) and **"revert this single op."**

### 4.2 v1 op types (all 22 required by handoff §4)

Each op below lists **payload** → and how its **inverse** is formed. All target entities by `id`.

| Op | payload | inverse |
|---|---|---|
| `clip.add` | `{ trackId, clip }` (full clip; ids pre-assigned) | `clip.remove { clipId }` |
| `clip.remove` | `{ clipId }` | `clip.add { trackId, clip }` (snapshot of removed clip) |
| `clip.trim` | `{ clipId, sourceIn?, sourceOut?, timelineStart? }` | `clip.trim` with prior values |
| `clip.split` | `{ clipId, atFrame }` → creates a 2nd clip | `clip.remove` of the new clip + `clip.trim` restoring the original's `sourceOut`/duration |
| `clip.move` | `{ clipId, trackId?, timelineStart }` | `clip.move` with prior `{ trackId, timelineStart }` |
| `clip.setSpeed` | `{ clipId, speed }` | `clip.setSpeed` prior speed |
| `clip.setTransform` | `{ clipId, transform }` (partial merge) | `clip.setTransform` prior transform fields |
| `clip.setVolume` | `{ clipId, volume }` | `clip.setVolume` prior volume |
| `track.add` | `{ track }` (kind, order, …) | `track.remove { trackId }` |
| `track.remove` | `{ trackId }` | `track.add { track }` (snapshot incl. its clips) |
| `track.reorder` | `{ trackId, order }` | `track.reorder` prior order |
| `text.add` | `{ trackId, clip }` (text clip) | `text.remove { clipId }` |
| `text.update` | `{ clipId, text }` (partial merge of `text` fields) | `text.update` prior fields |
| `text.remove` | `{ clipId }` | `text.add { trackId, clip }` (snapshot) |
| `keyframe.set` | `{ clipId, property, keyframe }` (add or replace at frame) | `keyframe.remove` (if added) or `keyframe.set` prior value (if replaced) |
| `keyframe.remove` | `{ clipId, property, keyframeId }` | `keyframe.set { clipId, property, keyframe }` (snapshot) |
| `transition.add` | `{ transition }` | `transition.remove { transitionId }` |
| `transition.remove` | `{ transitionId }` | `transition.add { transition }` (snapshot) |
| `marker.add` | `{ marker }` | `marker.remove { markerId }` |
| `ripple.delete` | `{ trackId, startFrame, endFrame }` → removes content in range and shifts downstream clips left by the gap | composite inverse: re-insert removed clips + shift downstream right (stored in inverse payload as a clip snapshot list + shift amount) |
| `audio.duck` | `{ clipId, underClipId?, targetGain, attackFrames, releaseFrames }` → writes `volume` keyframes | inverse restores prior `volume` keyframes (snapshot) |
| `audio.setRamp` | `{ clipId, fromGain, toGain, startFrame, endFrame }` → writes `volume` keyframes | inverse restores prior `volume` keyframes (snapshot) |

**Composite ops** (`clip.split`, `ripple.delete`, `audio.duck`, `audio.setRamp`) expand to primitive mutations internally but are logged as *one* op with a *single* inverse, so they undo atomically (matches OpenChatCut's "single undo step" behavior). `marker.update`/`marker.remove` beyond `marker.add` are deferred to v1.1 (only `marker.add` is required by §4; noted in OPEN_QUESTIONS).

---

## 5. Interchange (OTIO) & migration

- **Native JSON is lossless.** Round-trip serialize/deserialize → deep-equal. (Phase 0 test A.)
- **OTIO/FCPXML is intentionally lossy.** We map: document → OTIO `Timeline`; tracks → `Stack` of `Track`; media clip → `Clip` with `ExternalReference` + `source_range` (`TimeRange` of `RationalTime`); transition → `Transition`; marker → `Marker`. Fields FCPXML can't represent (keyframes on arbitrary paths, our `generation` metadata, effect params, `provenance`) are stored under an OTIO metadata namespace `"cutroom"` so an OTIO→OTIO round-trip is *lossless*, while OTIO→**FCPXML**→OTIO preserves only what FCPXML supports.
- **Phase 0 red-first proof (handoff §9):** round-trip a non-trivial timeline document → OTIO → **FCPXML** → back, and assert **semantic equality on the FCPXML-supported projection** (track structure, clip source in/out, timeline positions, transitions, markers). Shown *failing first*, then made to pass. The projection is defined explicitly in the test so "semantic equality" is unambiguous — it is NOT full-document equality (that's test A on native JSON).
- **Migration:** `schemaVersion` is semver. A `migrations/` registry maps `fromMajorMinor → toMajorMinor` transform fns; loading a document runs the chain up to current. v1.0.0 is the baseline (no-op migration).

---

## 6. What this schema deliberately does NOT include (v1 out-of-scope, handoff §8)
Multi-user real-time collab; color grading beyond LUT (`effect.type: "lut"` is the hook); motion tracking / rotoscoping; 3D compositing; nested-sequence editing UX (the data model allows a clip to reference another timeline, but the editing UX is deferred). These are noted so reviewers know the omissions are intentional.
