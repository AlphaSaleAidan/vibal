# Phase 0 Report — Headless Core

**Branch:** `phase-0/timeline-core` · **Date:** 2026-07-24 · **Gate:** headless suite green after being red; FCPXML round-trip semantic equality.

## What was built

A headless TypeScript core — no UI, no framework — implementing the schema contract from `docs/TIMELINE_SCHEMA.md`:

- **`src/document/`** — the timeline types (`types.ts`), kind-prefixed id generator, factory helpers, and the deep-freeze mutation guard.
- **`src/oplog/`** — op definitions (`ops.ts`), the **reducer** (`reducer.ts`, the only code that mutates a document), and the **`CommandLog`** (`log.ts`: apply / undo / redo / agent batches / revert-batch).
- **`src/interchange/`** — document → OpenTimelineIO JSON mapping (`otio/toOtio.ts`), the FCPXML-supported **projection** (`projection.ts`), and the FCPXML round-trip via the Python `otioconvert` CLI (`fcpxml/roundtrip.ts`).

All 24 public ops are implemented: `clip.add/remove/trim/split/move/setSpeed/setTransform/setVolume`, `track.add/remove/reorder`, `text.add/update/remove`, `keyframe.set/remove`, `transition.add/remove`, `marker.add/update/remove`, `ripple.delete`, `audio.duck/setRamp`.

## What was verified, and how (red-first)

Every capability was shown **failing first** (32/32 red with `NOT_IMPLEMENTED` stubs), then implemented, then shown passing (32/32 green). Raw runs are in the git history of this branch.

| Test file | Proves | Result |
|---|---|---|
| `tests/freeze.test.ts` | Direct mutation of the document tree **throws**; ops produce a new frozen document | 3 ✓ |
| `tests/reducer.test.ts` | For **all 24 ops**: the op changes the document, and its inverse restores it **exactly** (apply→undo == identity, verified by full non-meta fingerprint) | 24 ✓ |
| `tests/undoRedo.test.ts` | Sequential undo/redo; empty-undo returns false; an **agent batch reverts as a unit** leaving prior human edits intact | 3 ✓ |
| `tests/otioRoundtrip.test.ts` | Our document→OTIO mapping is internally consistent (no external tool) | 1 ✓ |
| `tests/fcpxmlRoundtrip.test.ts` | **THE GATE:** document → OTIO → FCPXML → OTIO preserves the FCPXML-supported projection, via real `otioconvert` | 1 ✓ |

`npm run typecheck` (tsc strict, `--noEmit`) is clean.

### How to run
```
cd /root/vibal
npm install
python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt
OTIOCONVERT="$PWD/.venv/bin/otioconvert" npm test
npm run typecheck
```

## Key design decisions made during implementation

1. **Composite inverses without breaking the single-inverse rule.** `clip.split`, `ripple.delete`, and `audio.duck/setRamp` restructure more than one thing. Rather than multi-op inverses, they store a single internal snapshot op (`_setTrackClips` / `_setKeyframes`) as their inverse, so they undo atomically — matching OpenChatCut's "single undo step" behavior. A generic `_seq` composes sub-inverses when needed (used by asset-importing `clip.add`). These internal ops are **not** part of the public 24 and are never authored by callers.
2. **`clip.add` can import its asset.** The op list has no `asset.add` (handoff §4), so `clip.add` optionally carries the `asset`; if the asset is new, undo removes **both** clip and asset (perfect restoration). This is the entry point for imported and generated media.
3. **The FCPXML projection is defined by what the adapter actually preserves.** Empirically probed first: `fcpx_xml` (otio 0.18.1) preserves clip names, source in/out, timeline positions (as gaps), track kind, and clip order — but **not** track names or track order (it uses lanes). So semantic equality is a *multiset of tracks*, each a `{kind, ordered clip/gap sequence with timing}`. This is honest, not hand-tuned to pass.

## Deliberately deferred (out of Phase 0 scope)

- **Speed ≠ 1 in the OTIO/FCPXML mapping** — needs an OTIO `LinearTimeWarp`; the gate document uses speed 1. The reducer fully supports `clip.setSpeed`; only the interchange retime is deferred.
- **Rational rates other than exact 30** — the round-trip is exercised at 30fps; 29.97 (30000/1001) should work but isn't yet asserted (parked in OPEN_QUESTIONS).
- **Text/caption, transition, marker, effect, and keyframe interchange** — FCPXML can't represent our text/keyframes/generation metadata; text clips map to gaps to preserve positions. Our custom data rides in a `vibal` OTIO metadata namespace, so OTIO→OTIO is lossless while OTIO→FCPXML is lossy by design.
- **Migration runner** — `schemaVersion` is present; v1.0.0 is the no-op baseline. No prior versions to migrate yet.

## Known sharp edges

- **`ripple.delete` drops any clip intersecting the range** (Phase 0 semantics) rather than trimming partial overlaps. Fine for filler-word removal on whole clips; partial-overlap trimming is a follow-up.
- **The FCPXML test requires the Python venv.** Without `otioconvert` it fails (not skips) — intentional, since it's the gate. A stranger must run the two-line venv setup above; `docker-compose` (later phase) will bundle this.
- **`structuredClone` per op** is O(document size). Fine at Phase 0 scale; structural sharing is a perf item for later, not correctness.
