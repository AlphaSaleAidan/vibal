import { describe, it, expect } from 'vitest';
import { newLog, fingerprint } from './helpers';
import { createTrack, createMediaClip, createAsset } from '../src/document/factory';

describe('undo / redo across human and agent edits', () => {
  it('sequential undo then redo returns to the same state', () => {
    const log = newLog();
    const V = createTrack('video', { name: 'V1', order: 0 });
    log.apply({ type: 'track.add', payload: { track: V } });
    const s0 = fingerprint(log.document);

    const asset = createAsset({ contentHash: 'aaa', kind: 'video', uri: 'vibal-asset://aaa', originalName: 'A', durationFrames: 600 });
    const clip = createMediaClip({ assetId: asset.id, kind: 'video', sourceIn: 0, sourceOut: 60, timelineStart: 0 });
    log.apply({ type: 'clip.add', payload: { trackId: V.id, clip, asset } });
    const s1 = fingerprint(log.document);

    expect(log.undo()).toBe(true);
    expect(fingerprint(log.document)).toBe(s0);
    expect(log.redo()).toBe(true);
    expect(fingerprint(log.document)).toBe(s1);
  });

  it('undo returns false when there is nothing to undo', () => {
    const log = newLog();
    expect(log.canUndo()).toBe(false);
    expect(log.undo()).toBe(false);
  });

  it('an agent batch reverts as a unit, leaving prior human edits intact', () => {
    const log = newLog();
    const V = createTrack('video', { name: 'V1', order: 0 });
    log.apply({ type: 'track.add', payload: { track: V } }); // human edit
    const afterHuman = fingerprint(log.document);

    const asset = createAsset({ contentHash: 'aaa', kind: 'video', uri: 'vibal-asset://aaa', originalName: 'A', durationFrames: 600 });
    const c1 = createMediaClip({ assetId: asset.id, kind: 'video', sourceIn: 0, sourceOut: 60, timelineStart: 0 });
    const c2 = createMediaClip({ assetId: asset.id, kind: 'video', sourceIn: 0, sourceOut: 60, timelineStart: 100 });
    const { batchId, results } = log.applyBatch(
      [
        { type: 'clip.add', payload: { trackId: V.id, clip: c1, asset } },
        { type: 'clip.add', payload: { trackId: V.id, clip: c2 } },
      ],
      { actor: 'agent', plan: 'add two clips' },
    );
    expect(results).toHaveLength(2);
    expect(log.document.tracks[0].clips).toHaveLength(2);
    expect(log.batches.find((b) => b.batchId === batchId)?.opIds).toHaveLength(2);

    expect(log.revertBatch(batchId)).toBe(true);
    expect(fingerprint(log.document)).toBe(afterHuman); // agent batch gone, human edit stays

    expect(log.undo()).toBe(true); // now undo the human edit
    expect(log.document.tracks).toHaveLength(0);
  });
});
