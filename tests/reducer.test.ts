import { describe, it, expect } from 'vitest';
import { buildRichDoc, fingerprint, type RichCtx } from './helpers';
import {
  createTrack, createMediaClip, createTextClip, createTransition, createMarker, createKeyframe,
} from '../src/document/factory';
import type { OpSpec } from '../src/oplog/ops';

interface Case {
  name: string;
  seed?: (ctx: RichCtx) => void;
  op: (ctx: RichCtx) => OpSpec;
}

const cases: Case[] = [
  { name: 'clip.add', op: (c) => ({ type: 'clip.add', payload: { trackId: c.V.id, clip: createMediaClip({ assetId: c.aAsset.id, kind: 'video', sourceIn: 0, sourceOut: 30, timelineStart: 300 }) } }) },
  { name: 'clip.remove', op: (c) => ({ type: 'clip.remove', payload: { clipId: c.clipA.id } }) },
  { name: 'clip.trim', op: (c) => ({ type: 'clip.trim', payload: { clipId: c.clipA.id, sourceOut: 120 } }) },
  { name: 'clip.split', op: (c) => ({ type: 'clip.split', payload: { clipId: c.clipA.id, atFrame: 84 } }) },
  { name: 'clip.move', op: (c) => ({ type: 'clip.move', payload: { clipId: c.clipA.id, timelineStart: 300 } }) },
  { name: 'clip.setSpeed', op: (c) => ({ type: 'clip.setSpeed', payload: { clipId: c.clipA.id, speed: 2 } }) },
  { name: 'clip.setTransform', op: (c) => ({ type: 'clip.setTransform', payload: { clipId: c.clipA.id, transform: { scale: 2 } } }) },
  { name: 'clip.setVolume', op: (c) => ({ type: 'clip.setVolume', payload: { clipId: c.music.id, volume: 0.5 } }) },
  { name: 'track.add', op: () => ({ type: 'track.add', payload: { track: createTrack('video', { name: 'V2', order: 5 }) } }) },
  { name: 'track.remove', op: (c) => ({ type: 'track.remove', payload: { trackId: c.A.id } }) },
  { name: 'track.reorder', op: (c) => ({ type: 'track.reorder', payload: { trackId: c.V.id, order: 5 } }) },
  {
    name: 'text.add',
    seed: (c) => { const T = createTrack('text', { name: 'T', order: 2 }); c.log.apply({ type: 'track.add', payload: { track: T } }); c.T = T; },
    op: (c) => ({ type: 'text.add', payload: { trackId: c.T.id, clip: createTextClip({ content: 'hi', timelineStart: 0, timelineDurationFrames: 60 }) } }),
  },
  {
    name: 'text.update',
    seed: (c) => { const T = createTrack('text', { name: 'T', order: 2 }); c.log.apply({ type: 'track.add', payload: { track: T } }); const tc = createTextClip({ content: 'hi', timelineStart: 0, timelineDurationFrames: 60 }); c.log.apply({ type: 'text.add', payload: { trackId: T.id, clip: tc } }); c.textClip = tc; },
    op: (c) => ({ type: 'text.update', payload: { clipId: c.textClip.id, text: { content: 'bye' } } }),
  },
  {
    name: 'text.remove',
    seed: (c) => { const T = createTrack('text', { name: 'T', order: 2 }); c.log.apply({ type: 'track.add', payload: { track: T } }); const tc = createTextClip({ content: 'hi', timelineStart: 0, timelineDurationFrames: 60 }); c.log.apply({ type: 'text.add', payload: { trackId: T.id, clip: tc } }); c.textClip = tc; },
    op: (c) => ({ type: 'text.remove', payload: { clipId: c.textClip.id } }),
  },
  { name: 'keyframe.set', op: (c) => ({ type: 'keyframe.set', payload: { clipId: c.clipA.id, property: 'opacity', keyframe: createKeyframe({ frame: 10, value: 0.5 }) } }) },
  {
    name: 'keyframe.remove',
    seed: (c) => { const kf = createKeyframe({ frame: 10, value: 0.5 }); c.log.apply({ type: 'keyframe.set', payload: { clipId: c.clipA.id, property: 'opacity', keyframe: kf } }); c.kf = kf; },
    op: (c) => ({ type: 'keyframe.remove', payload: { clipId: c.clipA.id, property: 'opacity', keyframeId: c.kf.id } }),
  },
  { name: 'transition.add', op: (c) => ({ type: 'transition.add', payload: { transition: createTransition({ trackId: c.V.id, type: 'crossDissolve', durationFrames: 15, fromClipId: c.clipA.id, toClipId: null }) } }) },
  {
    name: 'transition.remove',
    seed: (c) => { const tr = createTransition({ trackId: c.V.id, type: 'crossDissolve', durationFrames: 15, fromClipId: c.clipA.id, toClipId: null }); c.log.apply({ type: 'transition.add', payload: { transition: tr } }); c.tr = tr; },
    op: (c) => ({ type: 'transition.remove', payload: { transitionId: c.tr.id } }),
  },
  { name: 'marker.add', op: () => ({ type: 'marker.add', payload: { marker: createMarker({ frame: 200, name: 'x', color: '#000000' }) } }) },
  { name: 'marker.update', op: (c) => ({ type: 'marker.update', payload: { markerId: c.mk.id, fields: { color: '#ff0000' } } }) },
  { name: 'marker.remove', op: (c) => ({ type: 'marker.remove', payload: { markerId: c.mk.id } }) },
  { name: 'ripple.delete', op: (c) => ({ type: 'ripple.delete', payload: { trackId: c.V.id, startFrame: 24, endFrame: 60 } }) },
  { name: 'audio.duck', op: (c) => ({ type: 'audio.duck', payload: { clipId: c.music.id, startFrame: 30, endFrame: 180, targetGain: 0.2, attackFrames: 6, releaseFrames: 6 } }) },
  { name: 'audio.setRamp', op: (c) => ({ type: 'audio.setRamp', payload: { clipId: c.music.id, fromGain: 1, toGain: 0, startFrame: 150, endFrame: 210 } }) },
];

describe('reducer: every op mutates, and its inverse restores exactly (apply -> undo == identity)', () => {
  for (const tc of cases) {
    it(tc.name, () => {
      const ctx = buildRichDoc();
      tc.seed?.(ctx);
      const before = fingerprint(ctx.log.document);
      const res = ctx.log.apply(tc.op(ctx));
      expect(res.opId).toBeTruthy();
      const after = fingerprint(ctx.log.document);
      expect(after).not.toBe(before); // op actually changed the document
      expect(ctx.log.undo()).toBe(true);
      expect(fingerprint(ctx.log.document)).toBe(before); // inverse restores exactly
    });
  }
});
