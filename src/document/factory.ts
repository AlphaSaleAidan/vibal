import { ID } from './ids';
import { deepFreeze } from './freeze';
import type {
  VibalDocument, Track, TrackKind, MediaClip, TextClip, Asset, Transition, Marker, Keyframe,
  Transform, Provenance, License, TextContent,
} from './types';

const nowIso = () => new Date().toISOString();
const defaultTransform = (): Transform => ({ x: 0, y: 0, scale: 1, rotation: 0, anchorX: 0.5, anchorY: 0.5 });
const humanProvenance = (): Provenance => ({ createdBy: 'human', opId: null, batchId: null });
const permissiveLicense = (): License => ({
  type: 'user-upload', attributionRequired: false, attributionText: null,
  commercialUseAllowed: true, sourceUrl: null, retrievedAt: null,
});

/** Frame count a media clip occupies on the timeline given its source range + speed. */
export function mediaTimelineDuration(sourceIn: number, sourceOut: number, speed: number): number {
  return Math.round((sourceOut - sourceIn) / speed);
}

export function createDocument(opts: Partial<VibalDocument> = {}): VibalDocument {
  const doc: VibalDocument = {
    schemaVersion: '1.0.0',
    id: opts.id ?? ID.proj(),
    name: opts.name ?? 'Untitled',
    frameRate: opts.frameRate ?? { num: 30, den: 1 },
    resolution: opts.resolution ?? { width: 1920, height: 1080 },
    durationFrames: 0,
    commercialUse: opts.commercialUse ?? true,
    styleProfileId: opts.styleProfileId ?? null,
    assets: opts.assets ?? {},
    tracks: opts.tracks ?? [],
    transitions: opts.transitions ?? [],
    markers: opts.markers ?? [],
    transcripts: opts.transcripts ?? {},
    meta: { createdAt: nowIso(), modifiedAt: nowIso(), app: 'vibal', opSeq: 0 },
  };
  return deepFreeze(doc);
}

export function createTrack(kind: TrackKind, opts: Partial<Track> = {}): Track {
  return {
    id: opts.id ?? ID.track(),
    kind,
    name: opts.name ?? kind,
    order: opts.order ?? 0,
    enabled: opts.enabled ?? true,
    locked: opts.locked ?? false,
    muted: opts.muted ?? false,
    clips: opts.clips ?? [],
    effects: opts.effects ?? [],
  };
}

export function createMediaClip(
  opts: Partial<MediaClip> & { assetId: string; sourceOut: number },
): MediaClip {
  const sourceIn = opts.sourceIn ?? 0;
  const speed = opts.speed ?? 1;
  return {
    id: opts.id ?? ID.clip(),
    kind: opts.kind ?? 'video',
    assetId: opts.assetId,
    sourceIn,
    sourceOut: opts.sourceOut,
    timelineStart: opts.timelineStart ?? 0,
    timelineDurationFrames: opts.timelineDurationFrames ?? mediaTimelineDuration(sourceIn, opts.sourceOut, speed),
    speed,
    opacity: opts.opacity ?? 1,
    volume: opts.volume ?? 1,
    transform: opts.transform ?? defaultTransform(),
    keyframes: opts.keyframes ?? {},
    effects: opts.effects ?? [],
    provenance: opts.provenance ?? humanProvenance(),
  };
}

export function createTextClip(
  opts: Partial<TextClip> & { content: string },
): TextClip {
  const text: TextContent = {
    content: opts.content,
    font: opts.text?.font ?? 'Inter',
    sizePx: opts.text?.sizePx ?? 64,
    color: opts.text?.color ?? '#FFFFFF',
    position: opts.text?.position ?? { x: 0.5, y: 0.82 },
    alignment: opts.text?.alignment ?? 'center',
    animationPreset: opts.text?.animationPreset ?? 'none',
    sourceTranscriptRange: opts.text?.sourceTranscriptRange ?? null,
  };
  return {
    id: opts.id ?? ID.clip(),
    kind: 'text',
    timelineStart: opts.timelineStart ?? 0,
    timelineDurationFrames: opts.timelineDurationFrames ?? 60,
    opacity: opts.opacity ?? 1,
    transform: opts.transform ?? defaultTransform(),
    keyframes: opts.keyframes ?? {},
    effects: opts.effects ?? [],
    provenance: opts.provenance ?? humanProvenance(),
    text,
  };
}

export function createAsset(opts: Partial<Asset> & { contentHash: string }): Asset {
  return {
    id: opts.id ?? ID.asset(),
    contentHash: opts.contentHash,
    kind: opts.kind ?? 'video',
    uri: opts.uri ?? `vibal-asset://${opts.contentHash}`,
    originalName: opts.originalName ?? opts.contentHash,
    durationFrames: opts.durationFrames ?? null,
    frameRate: opts.frameRate ?? null,
    width: opts.width ?? null,
    height: opts.height ?? null,
    hasAudio: opts.hasAudio ?? (opts.kind === 'audio'),
    transcriptId: opts.transcriptId ?? null,
    license: opts.license ?? permissiveLicense(),
    generation: opts.generation ?? null,
  };
}

export function createTransition(opts: Partial<Transition> & { trackId: string }): Transition {
  return {
    id: opts.id ?? ID.transition(),
    trackId: opts.trackId,
    type: opts.type ?? 'crossDissolve',
    durationFrames: opts.durationFrames ?? 15,
    fromClipId: opts.fromClipId ?? null,
    toClipId: opts.toClipId ?? null,
    params: opts.params ?? {},
    provenance: opts.provenance ?? humanProvenance(),
  };
}

export function createMarker(opts: Partial<Marker> & { frame: number }): Marker {
  return {
    id: opts.id ?? ID.marker(),
    frame: opts.frame,
    name: opts.name ?? '',
    color: opts.color ?? '#FF5A5F',
    provenance: opts.provenance ?? humanProvenance(),
  };
}

export function createKeyframe(opts: Partial<Keyframe> & { frame: number; value: number }): Keyframe {
  return {
    id: opts.id ?? ID.keyframe(),
    frame: opts.frame,
    value: opts.value,
    interp: opts.interp ?? 'linear',
    ...(opts.bezier ? { bezier: opts.bezier } : {}),
  };
}
