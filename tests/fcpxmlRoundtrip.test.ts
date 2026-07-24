import { describe, it, expect } from 'vitest';
import { buildMediaDoc } from './helpers';
import { documentToOtio } from '../src/interchange/otio/toOtio';
import { documentToProjection, otioToProjection, normalizeProjection } from '../src/interchange/projection';
import { fcpxmlRoundTrip } from '../src/interchange/fcpxml/roundtrip';

// THE PHASE 0 GATE: document -> OTIO -> FCPXML -> OTIO -> back, and the FCPXML-supported
// projection (track kind + ordered clip/gap sequence with source in/out and positions) is
// preserved. This is NOT full-document equality — FCPXML is lossy by design (see TIMELINE_SCHEMA §5).
describe('FCPXML round-trip semantic equality (Phase 0 gate)', () => {
  it('preserves the FCPXML-supported projection through otioconvert', () => {
    const doc = buildMediaDoc();
    const otio = documentToOtio(doc);
    const back = fcpxmlRoundTrip(otio);
    expect(normalizeProjection(otioToProjection(back)))
      .toEqual(normalizeProjection(documentToProjection(doc)));
  });
});
