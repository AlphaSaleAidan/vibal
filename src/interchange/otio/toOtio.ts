// Map a VIBAL document to OpenTimelineIO JSON (schema strings verified against otio 0.18.1).
// OTIO tracks are sequential, so timeline positions become explicit Gap items. Our custom data
// (generation, provenance, keyframes) rides in a "vibal" metadata namespace for OTIO->OTIO fidelity.
import { RationalTime, TimeRange, rateOf, type OtioObject } from './schema';
import { isMediaClip, type VibalDocument, type Track, type Clip, type MediaClip } from '../../document/types';

const otioTrackKind = (kind: Track['kind']): 'Video' | 'Audio' =>
  kind === 'audio' ? 'Audio' : 'Video';

function gapItem(duration: number, rate: number): OtioObject {
  return {
    OTIO_SCHEMA: 'Gap.1', metadata: {}, name: '',
    source_range: TimeRange(0, duration, rate), effects: [], markers: [], enabled: true, color: null,
  };
}

function clipItem(doc: VibalDocument, clip: MediaClip, rate: number): OtioObject {
  const asset = doc.assets[clip.assetId];
  const srcDuration = clip.sourceOut - clip.sourceIn;
  const available = asset?.durationFrames ?? clip.sourceOut;
  return {
    OTIO_SCHEMA: 'Clip.2', metadata: { vibal: { clipId: clip.id } },
    name: asset?.originalName ?? clip.assetId,
    source_range: TimeRange(clip.sourceIn, srcDuration, rate),
    effects: [], markers: [], enabled: true, color: null,
    active_media_reference_key: 'DEFAULT_MEDIA',
    media_references: {
      DEFAULT_MEDIA: {
        OTIO_SCHEMA: 'ExternalReference.1', metadata: {}, name: '',
        available_range: TimeRange(0, available, rate),
        target_url: asset?.uri ?? `vibal-asset://${clip.assetId}`,
      },
    },
  };
}

function trackToOtio(doc: VibalDocument, track: Track, rate: number): OtioObject {
  const items: OtioObject[] = [];
  const clips: Clip[] = [...track.clips].sort((a, b) => a.timelineStart - b.timelineStart);
  let playhead = 0;
  for (const clip of clips) {
    if (clip.timelineStart > playhead) items.push(gapItem(clip.timelineStart - playhead, rate));
    // Text (and any non-media) clips don't map to FCPXML; represent as a gap to preserve positions.
    items.push(isMediaClip(clip) ? clipItem(doc, clip, rate) : gapItem(clip.timelineDurationFrames, rate));
    playhead = clip.timelineStart + clip.timelineDurationFrames;
  }
  return {
    OTIO_SCHEMA: 'Track.1', metadata: {}, name: track.name,
    source_range: null, effects: [], markers: [], enabled: track.enabled, color: null,
    kind: otioTrackKind(track.kind), children: items,
  };
}

export function documentToOtio(doc: VibalDocument): OtioObject {
  const rate = rateOf(doc.frameRate);
  const children = [...doc.tracks]
    .filter((t) => t.kind !== 'effect')
    .sort((a, b) => a.order - b.order)
    .map((t) => trackToOtio(doc, t, rate));
  return {
    OTIO_SCHEMA: 'Timeline.1', metadata: {}, name: doc.name, global_start_time: null,
    tracks: {
      OTIO_SCHEMA: 'Stack.1', metadata: {}, name: 'tracks',
      source_range: null, effects: [], markers: [], enabled: true, color: null,
      children,
    },
  };
}
