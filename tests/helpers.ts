import {
  createDocument, createTrack, createMediaClip, createAsset, createMarker,
} from '../src/document/factory';
import { CommandLog } from '../src/oplog/log';
import type { VibalDocument } from '../src/document/types';

export function newLog(): CommandLog {
  return new CommandLog(createDocument({ name: 'T', frameRate: { num: 30, den: 1 } }));
}

/** Everything except volatile meta (opSeq / modifiedAt), for apply+undo equality checks. */
export function fingerprint(doc: VibalDocument): string {
  const { meta, ...rest } = doc;
  return JSON.stringify(rest);
}

/** 2 video clips (with a leading gap) + 1 audio clip — the FCPXML round-trip subject. */
export function buildMediaDoc(): VibalDocument {
  const log = newLog();
  const V = createTrack('video', { name: 'V1', order: 0 });
  const A = createTrack('audio', { name: 'A1', order: 1 });
  log.apply({ type: 'track.add', payload: { track: V } });
  log.apply({ type: 'track.add', payload: { track: A } });

  const aAsset = createAsset({ contentHash: 'aaa', kind: 'video', uri: 'vibal-asset://aaa', originalName: 'A-roll', durationFrames: 600 });
  const bAsset = createAsset({ contentHash: 'bbb', kind: 'video', uri: 'vibal-asset://bbb', originalName: 'B-roll', durationFrames: 600 });
  const cAsset = createAsset({ contentHash: 'ccc', kind: 'audio', uri: 'vibal-asset://ccc', originalName: 'music', durationFrames: 600 });

  const clipA = createMediaClip({ assetId: aAsset.id, kind: 'video', sourceIn: 30, sourceOut: 150, timelineStart: 24 });
  const clipB = createMediaClip({ assetId: bAsset.id, kind: 'video', sourceIn: 10, sourceOut: 100, timelineStart: 144 });
  const music = createMediaClip({ assetId: cAsset.id, kind: 'audio', sourceIn: 0, sourceOut: 210, timelineStart: 0 });

  log.apply({ type: 'clip.add', payload: { trackId: V.id, clip: clipA, asset: aAsset } });
  log.apply({ type: 'clip.add', payload: { trackId: V.id, clip: clipB, asset: bAsset } });
  log.apply({ type: 'clip.add', payload: { trackId: A.id, clip: music, asset: cAsset } });
  return log.document;
}

export interface RichCtx {
  log: CommandLog;
  V: ReturnType<typeof createTrack>;
  A: ReturnType<typeof createTrack>;
  aAsset: ReturnType<typeof createAsset>;
  cAsset: ReturnType<typeof createAsset>;
  clipA: ReturnType<typeof createMediaClip>;
  music: ReturnType<typeof createMediaClip>;
  mk: ReturnType<typeof createMarker>;
  [k: string]: any;
}

/** A doc with a video clip, an audio clip, and a marker — a target for every op. */
export function buildRichDoc(): RichCtx {
  const log = newLog();
  const V = createTrack('video', { name: 'V1', order: 0 });
  const A = createTrack('audio', { name: 'A1', order: 1 });
  log.apply({ type: 'track.add', payload: { track: V } });
  log.apply({ type: 'track.add', payload: { track: A } });
  const aAsset = createAsset({ contentHash: 'aaa', kind: 'video', uri: 'vibal-asset://aaa', originalName: 'A-roll', durationFrames: 600 });
  const cAsset = createAsset({ contentHash: 'ccc', kind: 'audio', uri: 'vibal-asset://ccc', originalName: 'music', durationFrames: 600 });
  const clipA = createMediaClip({ assetId: aAsset.id, kind: 'video', sourceIn: 30, sourceOut: 150, timelineStart: 24 });
  const music = createMediaClip({ assetId: cAsset.id, kind: 'audio', sourceIn: 0, sourceOut: 210, timelineStart: 0 });
  log.apply({ type: 'clip.add', payload: { trackId: V.id, clip: clipA, asset: aAsset } });
  log.apply({ type: 'clip.add', payload: { trackId: A.id, clip: music, asset: cAsset } });
  const mk = createMarker({ frame: 100, name: 'm', color: '#ffffff' });
  log.apply({ type: 'marker.add', payload: { marker: mk } });
  return { log, V, A, aAsset, cAsset, clipA, music, mk };
}
