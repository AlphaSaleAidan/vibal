import { describe, it, expect } from 'vitest';
import { buildMediaDoc } from './helpers';
import { documentToOtio } from '../src/interchange/otio/toOtio';
import { documentToProjection, otioToProjection, normalizeProjection } from '../src/interchange/projection';

describe('native OTIO mapping is internally consistent', () => {
  it('document -> OTIO -> projection equals the document projection (no external tool)', () => {
    const doc = buildMediaDoc();
    const otio = documentToOtio(doc);
    expect(normalizeProjection(otioToProjection(otio)))
      .toEqual(normalizeProjection(documentToProjection(doc)));
  });
});
