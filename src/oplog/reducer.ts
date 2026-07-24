// The reducer: the ONLY code that mutates a document. Each op is applied to a fresh clone and
// returns { document, inverse, result }. Inverses are self-describing (undo = apply the inverse).
// Composite ops (split, ripple.delete, audio.*) restore via internal snapshot ops
// (_setTrackClips / _setKeyframes) so they undo atomically as a single inverse.
import { ID } from '../document/ids';
import { mediaTimelineDuration } from '../document/factory';
import type {
  VibalDocument, Track, Clip, MediaClip, TextClip, Keyframe, KeyframeMap,
} from '../document/types';
import type { OpSpec, CommandResult } from './ops';

export interface ApplyResult {
  document: VibalDocument;
  inverse: OpSpec;
  result: CommandResult;
}

interface HandlerOut {
  inverse: OpSpec;
  created?: string[];
  deleted?: string[];
  changed?: string[];
}

const clone = <T>(v: T): T => structuredClone(v);
const byStart = (a: Clip, b: Clip) => a.timelineStart - b.timelineStart;

function mustTrack(doc: VibalDocument, trackId: string): Track {
  const t = doc.tracks.find((x) => x.id === trackId);
  if (!t) throw new Error(`track not found: ${trackId}`);
  return t;
}
function locateClip(doc: VibalDocument, clipId: string): { track: Track; clip: Clip; index: number } {
  for (const track of doc.tracks) {
    const index = track.clips.findIndex((c) => c.id === clipId);
    if (index >= 0) return { track, clip: track.clips[index], index };
  }
  throw new Error(`clip not found: ${clipId}`);
}
const isMedia = (c: Clip): c is MediaClip => c.kind !== 'text';

function recomputeMediaDuration(clip: Clip): void {
  if (isMedia(clip)) clip.timelineDurationFrames = mediaTimelineDuration(clip.sourceIn, clip.sourceOut, clip.speed);
}
function assertNoOverlap(track: Track, clip: Clip): void {
  const s = clip.timelineStart, e = s + clip.timelineDurationFrames;
  for (const c of track.clips) {
    if (c.id === clip.id) continue;
    const cs = c.timelineStart, ce = cs + c.timelineDurationFrames;
    if (s < ce && cs < e) throw new Error(`clip overlap on track ${track.id}`);
  }
}
function insertClipSorted(track: Track, clip: Clip): void {
  assertNoOverlap(track, clip);
  track.clips.push(clip);
  track.clips.sort(byStart);
}
function recomputeDerived(doc: VibalDocument): void {
  let end = 0;
  for (const t of doc.tracks) for (const c of t.clips) end = Math.max(end, c.timelineStart + c.timelineDurationFrames);
  doc.durationFrames = end;
}

type Handler = (doc: VibalDocument, payload: any) => HandlerOut;

const handlers: Record<string, Handler> = {
  'clip.add': (doc, p) => {
    const track = mustTrack(doc, p.trackId);
    const created: string[] = [p.clip.id];
    const addedAsset = Boolean(p.asset) && !doc.assets[p.asset.id];
    if (addedAsset) { doc.assets[p.asset.id] = clone(p.asset); created.push(p.asset.id); }
    insertClipSorted(track, clone(p.clip));
    // If this import also introduced the asset, undo must remove both (perfect restoration).
    const inverse: OpSpec = addedAsset
      ? { type: '_seq', payload: { specs: [
          { type: 'clip.remove', payload: { clipId: p.clip.id } },
          { type: '_removeAsset', payload: { assetId: p.asset.id } },
        ] } }
      : { type: 'clip.remove', payload: { clipId: p.clip.id } };
    return { inverse, created };
  },
  'clip.remove': (doc, p) => {
    const { track, clip, index } = locateClip(doc, p.clipId);
    const snap = clone(clip);
    track.clips.splice(index, 1);
    return { inverse: { type: 'clip.add', payload: { trackId: track.id, clip: snap } }, deleted: [p.clipId] };
  },
  'clip.trim': (doc, p) => {
    const { clip } = locateClip(doc, p.clipId) as { clip: MediaClip };
    const prior = { sourceIn: clip.sourceIn, sourceOut: clip.sourceOut, timelineStart: clip.timelineStart };
    if (p.sourceIn !== undefined) clip.sourceIn = p.sourceIn;
    if (p.sourceOut !== undefined) clip.sourceOut = p.sourceOut;
    if (p.timelineStart !== undefined) clip.timelineStart = p.timelineStart;
    recomputeMediaDuration(clip);
    return { inverse: { type: 'clip.trim', payload: { clipId: p.clipId, ...prior } }, changed: [p.clipId] };
  },
  'clip.split': (doc, p) => {
    const { track, clip } = locateClip(doc, p.clipId) as { track: Track; clip: MediaClip };
    if (!(clip.timelineStart < p.atFrame && p.atFrame < clip.timelineStart + clip.timelineDurationFrames)) {
      throw new Error('split point outside clip');
    }
    const before = clone(track.clips);
    const tOff = p.atFrame - clip.timelineStart;
    const srcOff = Math.round(tOff * clip.speed);
    const right = clone(clip) as MediaClip;
    right.id = ID.clip();
    right.sourceIn = clip.sourceIn + srcOff;
    right.timelineStart = p.atFrame;
    recomputeMediaDuration(right);
    clip.sourceOut = clip.sourceIn + srcOff;
    recomputeMediaDuration(clip);
    track.clips.push(right);
    track.clips.sort(byStart);
    return { inverse: { type: '_setTrackClips', payload: { trackId: track.id, clips: before } }, created: [right.id] };
  },
  'clip.move': (doc, p) => {
    const { track, clip, index } = locateClip(doc, p.clipId);
    const prior = { trackId: track.id, timelineStart: clip.timelineStart };
    track.clips.splice(index, 1);
    const target = p.trackId ? mustTrack(doc, p.trackId) : track;
    const moved = clone(clip);
    moved.timelineStart = p.timelineStart;
    insertClipSorted(target, moved);
    return { inverse: { type: 'clip.move', payload: { clipId: p.clipId, ...prior } }, changed: [p.clipId] };
  },
  'clip.setSpeed': (doc, p) => {
    const { clip } = locateClip(doc, p.clipId) as { clip: MediaClip };
    const prior = clip.speed;
    clip.speed = p.speed;
    recomputeMediaDuration(clip);
    return { inverse: { type: 'clip.setSpeed', payload: { clipId: p.clipId, speed: prior } }, changed: [p.clipId] };
  },
  'clip.setTransform': (doc, p) => {
    const { clip } = locateClip(doc, p.clipId);
    const prior = clone(clip.transform);
    clip.transform = { ...clip.transform, ...p.transform };
    return { inverse: { type: 'clip.setTransform', payload: { clipId: p.clipId, transform: prior } }, changed: [p.clipId] };
  },
  'clip.setVolume': (doc, p) => {
    const { clip } = locateClip(doc, p.clipId) as { clip: MediaClip };
    const prior = clip.volume;
    clip.volume = p.volume;
    return { inverse: { type: 'clip.setVolume', payload: { clipId: p.clipId, volume: prior } }, changed: [p.clipId] };
  },
  'track.add': (doc, p) => {
    doc.tracks.push(clone(p.track));
    return { inverse: { type: 'track.remove', payload: { trackId: p.track.id } }, created: [p.track.id] };
  },
  'track.remove': (doc, p) => {
    const index = doc.tracks.findIndex((t) => t.id === p.trackId);
    if (index < 0) throw new Error(`track not found: ${p.trackId}`);
    const snap = clone(doc.tracks[index]);
    doc.tracks.splice(index, 1);
    return { inverse: { type: 'track.add', payload: { track: snap } }, deleted: [p.trackId] };
  },
  'track.reorder': (doc, p) => {
    const track = mustTrack(doc, p.trackId);
    const prior = track.order;
    track.order = p.order;
    return { inverse: { type: 'track.reorder', payload: { trackId: p.trackId, order: prior } }, changed: [p.trackId] };
  },
  'text.add': (doc, p) => {
    const track = mustTrack(doc, p.trackId);
    insertClipSorted(track, clone(p.clip));
    return { inverse: { type: 'text.remove', payload: { clipId: p.clip.id } }, created: [p.clip.id] };
  },
  'text.update': (doc, p) => {
    const { clip } = locateClip(doc, p.clipId) as { clip: TextClip };
    const prior = clone(clip.text);
    clip.text = { ...clip.text, ...p.text };
    return { inverse: { type: 'text.update', payload: { clipId: p.clipId, text: prior } }, changed: [p.clipId] };
  },
  'text.remove': (doc, p) => {
    const { track, clip, index } = locateClip(doc, p.clipId);
    const snap = clone(clip);
    track.clips.splice(index, 1);
    return { inverse: { type: 'text.add', payload: { trackId: track.id, clip: snap } }, deleted: [p.clipId] };
  },
  'keyframe.set': (doc, p) => {
    const { clip } = locateClip(doc, p.clipId);
    const arr: Keyframe[] = (clip.keyframes[p.property] ??= []);
    const at = arr.findIndex((k) => k.frame === p.keyframe.frame);
    if (at >= 0) {
      const prev = clone(arr[at]);
      arr[at] = clone(p.keyframe);
      return { inverse: { type: 'keyframe.set', payload: { clipId: p.clipId, property: p.property, keyframe: prev } }, changed: [p.clipId] };
    }
    arr.push(clone(p.keyframe));
    arr.sort((a, b) => a.frame - b.frame);
    return { inverse: { type: 'keyframe.remove', payload: { clipId: p.clipId, property: p.property, keyframeId: p.keyframe.id } }, changed: [p.clipId] };
  },
  'keyframe.remove': (doc, p) => {
    const { clip } = locateClip(doc, p.clipId);
    const arr: Keyframe[] = clip.keyframes[p.property] ?? [];
    const at = arr.findIndex((k) => k.id === p.keyframeId);
    if (at < 0) throw new Error(`keyframe not found: ${p.keyframeId}`);
    const snap = clone(arr[at]);
    arr.splice(at, 1);
    if (arr.length === 0) delete clip.keyframes[p.property]; // no empty-array residue
    return { inverse: { type: 'keyframe.set', payload: { clipId: p.clipId, property: p.property, keyframe: snap } }, changed: [p.clipId] };
  },
  'transition.add': (doc, p) => {
    doc.transitions.push(clone(p.transition));
    return { inverse: { type: 'transition.remove', payload: { transitionId: p.transition.id } }, created: [p.transition.id] };
  },
  'transition.remove': (doc, p) => {
    const index = doc.transitions.findIndex((t) => t.id === p.transitionId);
    if (index < 0) throw new Error(`transition not found: ${p.transitionId}`);
    const snap = clone(doc.transitions[index]);
    doc.transitions.splice(index, 1);
    return { inverse: { type: 'transition.add', payload: { transition: snap } }, deleted: [p.transitionId] };
  },
  'marker.add': (doc, p) => {
    doc.markers.push(clone(p.marker));
    return { inverse: { type: 'marker.remove', payload: { markerId: p.marker.id } }, created: [p.marker.id] };
  },
  'marker.update': (doc, p) => {
    const m = doc.markers.find((x) => x.id === p.markerId);
    if (!m) throw new Error(`marker not found: ${p.markerId}`);
    const prior = { frame: m.frame, name: m.name, color: m.color };
    Object.assign(m, p.fields);
    return { inverse: { type: 'marker.update', payload: { markerId: p.markerId, fields: prior } }, changed: [p.markerId] };
  },
  'marker.remove': (doc, p) => {
    const index = doc.markers.findIndex((x) => x.id === p.markerId);
    if (index < 0) throw new Error(`marker not found: ${p.markerId}`);
    const snap = clone(doc.markers[index]);
    doc.markers.splice(index, 1);
    return { inverse: { type: 'marker.add', payload: { marker: snap } }, deleted: [p.markerId] };
  },
  'ripple.delete': (doc, p) => {
    const track = mustTrack(doc, p.trackId);
    const before = clone(track.clips);
    const gap = p.endFrame - p.startFrame;
    const kept: Clip[] = [];
    for (const c of track.clips) {
      const cs = c.timelineStart, ce = cs + c.timelineDurationFrames;
      if (ce <= p.startFrame) kept.push(c);              // entirely before the range
      else if (cs >= p.endFrame) { c.timelineStart -= gap; kept.push(c); } // after -> shift left
      // clips intersecting the range are removed (Phase 0 semantics)
    }
    track.clips = kept;
    return { inverse: { type: '_setTrackClips', payload: { trackId: track.id, clips: before } } };
  },
  'audio.duck': (doc, p) => {
    const { clip } = locateClip(doc, p.clipId);
    const beforeKf: KeyframeMap = clone(clip.keyframes);
    const base = isMedia(clip) ? clip.volume : 1;
    clip.keyframes.volume = [
      { id: ID.keyframe(), frame: p.startFrame, value: base, interp: 'linear' },
      { id: ID.keyframe(), frame: p.startFrame + p.attackFrames, value: p.targetGain, interp: 'linear' },
      { id: ID.keyframe(), frame: p.endFrame - p.releaseFrames, value: p.targetGain, interp: 'linear' },
      { id: ID.keyframe(), frame: p.endFrame, value: base, interp: 'linear' },
    ];
    return { inverse: { type: '_setKeyframes', payload: { clipId: p.clipId, keyframes: beforeKf } }, changed: [p.clipId] };
  },
  'audio.setRamp': (doc, p) => {
    const { clip } = locateClip(doc, p.clipId);
    const beforeKf: KeyframeMap = clone(clip.keyframes);
    clip.keyframes.volume = [
      { id: ID.keyframe(), frame: p.startFrame, value: p.fromGain, interp: 'linear' },
      { id: ID.keyframe(), frame: p.endFrame, value: p.toGain, interp: 'linear' },
    ];
    return { inverse: { type: '_setKeyframes', payload: { clipId: p.clipId, keyframes: beforeKf } }, changed: [p.clipId] };
  },

  // ---- internal snapshot ops (composite-inverse mechanism; not public) ----
  '_setTrackClips': (doc, p) => {
    const track = mustTrack(doc, p.trackId);
    const before = clone(track.clips);
    track.clips = clone(p.clips);
    return { inverse: { type: '_setTrackClips', payload: { trackId: p.trackId, clips: before } } };
  },
  '_setKeyframes': (doc, p) => {
    const { clip } = locateClip(doc, p.clipId);
    const before = clone(clip.keyframes);
    clip.keyframes = clone(p.keyframes);
    return { inverse: { type: '_setKeyframes', payload: { clipId: p.clipId, keyframes: before } } };
  },
  '_addAsset': (doc, p) => {
    doc.assets[p.asset.id] = clone(p.asset);
    return { inverse: { type: '_removeAsset', payload: { assetId: p.asset.id } }, created: [p.asset.id] };
  },
  '_removeAsset': (doc, p) => {
    const snap = doc.assets[p.assetId];
    if (!snap) throw new Error(`asset not found: ${p.assetId}`);
    const asset = clone(snap);
    delete doc.assets[p.assetId];
    return { inverse: { type: '_addAsset', payload: { asset } }, deleted: [p.assetId] };
  },
  // Generic composite: apply specs in order; inverse is the reversed sub-inverses.
  '_seq': (doc, p) => {
    const inverses: OpSpec[] = [];
    const created: string[] = [], deleted: string[] = [], changed: string[] = [];
    for (const spec of p.specs as OpSpec[]) {
      const out = handlers[spec.type](doc, spec.payload);
      inverses.push(out.inverse);
      if (out.created) created.push(...out.created);
      if (out.deleted) deleted.push(...out.deleted);
      if (out.changed) changed.push(...out.changed);
    }
    return { inverse: { type: '_seq', payload: { specs: inverses.reverse() } }, created, deleted, changed };
  },
};

export function applyOp(doc: VibalDocument, spec: OpSpec): ApplyResult {
  const handler = handlers[spec.type];
  if (!handler) throw new Error(`unknown op type: ${spec.type}`);
  const draft = clone(doc);
  const out = handler(draft, spec.payload);
  recomputeDerived(draft);
  return {
    document: draft, // unfrozen; CommandLog stamps meta + freezes
    inverse: out.inverse,
    result: { opId: '', changedIds: out.changed ?? [], createdIds: out.created ?? [], deletedIds: out.deleted ?? [] },
  };
}
