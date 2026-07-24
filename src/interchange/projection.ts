// The "FCPXML-supported projection": the semantically meaningful structure that survives an
// OTIO -> FCPXML -> OTIO round-trip. Empirically (fcpx_xml adapter, otio 0.18.1) FCPXML preserves
// clip names, source in/out, media positions (via gaps), track KIND and clip order — but NOT track
// name or track order (it uses lanes). So equality is a MULTISET of tracks, each a {kind, ordered
// clip/gap sequence with timing}. See docs/TIMELINE_SCHEMA.md §5.
import { rateOf, type OtioObject } from './otio/schema';
import { documentToOtio } from './otio/toOtio';
import type { VibalDocument } from '../document/types';

export type ProjItem =
  | { t: 'clip'; name: string; in: number; dur: number }
  | { t: 'gap'; dur: number };

export interface ProjTrack { kind: 'Video' | 'Audio'; items: ProjItem[]; }

const round = (v: number) => Math.round(v);

/** Project directly from an OTIO object (used for both our own output and the round-tripped result). */
export function otioToProjection(otio: OtioObject): ProjTrack[] {
  const trackNodes: OtioObject[] = otio?.tracks?.children ?? [];
  const out: ProjTrack[] = [];
  for (const track of trackNodes) {
    const kind: 'Video' | 'Audio' = String(track.kind) === 'Audio' ? 'Audio' : 'Video';
    const items: ProjItem[] = [];
    for (const child of track.children ?? []) {
      const schema = String(child.OTIO_SCHEMA ?? '');
      const sr = child.source_range;
      if (schema.startsWith('Clip')) {
        items.push({ t: 'clip', name: String(child.name ?? ''), in: round(sr.start_time.value), dur: round(sr.duration.value) });
      } else if (schema.startsWith('Gap')) {
        items.push({ t: 'gap', dur: round(sr.duration.value) });
      }
    }
    out.push({ kind, items });
  }
  return out;
}

/** Project straight from our document (via the same OTIO mapping, so both sides agree by construction). */
export function documentToProjection(doc: VibalDocument): ProjTrack[] {
  void rateOf; // rate handled inside documentToOtio
  return otioToProjection(documentToOtio(doc));
}

/** Order-independent normalization for equality: FCPXML doesn't preserve track name/order. */
export function normalizeProjection(tracks: ProjTrack[]): ProjTrack[] {
  return [...tracks].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}
