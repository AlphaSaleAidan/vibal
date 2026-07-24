// VIBAL timeline document — the core contract (see docs/TIMELINE_SCHEMA.md).
// All times are integer frame counts; frame rate is rational to avoid drift.

export type Actor = 'human' | 'agent' | 'import' | 'system';
export type CreatedBy = 'human' | 'agent' | 'import';

export interface FrameRate { num: number; den: number; }
export interface Resolution { width: number; height: number; }

export interface Provenance {
  createdBy: CreatedBy;
  opId: string | null;
  batchId: string | null;
}

export interface Transform {
  x: number; y: number; scale: number; rotation: number; anchorX: number; anchorY: number;
}

export type Interp = 'hold' | 'linear' | 'bezier';
export interface Keyframe {
  id: string;
  frame: number;
  value: number;
  interp: Interp;
  bezier?: [number, number, number, number];
}
export type KeyframeMap = Record<string, Keyframe[]>;

export interface Effect {
  id: string; type: string; params: Record<string, unknown>; enabled: boolean; order: number;
}

export interface License {
  type: 'cc0' | 'cc-by' | 'royalty-free' | 'user-upload' | 'generated';
  attributionRequired: boolean;
  attributionText: string | null;
  commercialUseAllowed: boolean;
  sourceUrl: string | null;
  retrievedAt: string | null;
}

export interface Generation {
  provider: string; model: string; prompt: string; seed: number | null;
  costCredits: number; requestId: string; params: Record<string, unknown>;
}

export type AssetKind = 'video' | 'audio' | 'image';
export interface Asset {
  id: string;
  contentHash: string;
  kind: AssetKind;
  uri: string;                 // vibal-asset://<hash> — never an absolute path
  originalName: string;
  durationFrames: number | null;
  frameRate: FrameRate | null;
  width: number | null;
  height: number | null;
  hasAudio: boolean;
  transcriptId: string | null;
  license: License;
  generation: Generation | null;
}

export type TrackKind = 'video' | 'audio' | 'image' | 'text' | 'effect';
export type ClipKind = 'video' | 'audio' | 'image' | 'generated' | 'text';

export interface BaseClip {
  id: string;
  timelineStart: number;
  timelineDurationFrames: number;
  opacity: number;
  transform: Transform;
  keyframes: KeyframeMap;
  effects: Effect[];
  provenance: Provenance;
}

export interface MediaClip extends BaseClip {
  kind: 'video' | 'audio' | 'image' | 'generated';
  assetId: string;
  sourceIn: number;
  sourceOut: number;   // exclusive
  speed: number;
  volume: number;
}

export interface TextContent {
  content: string;
  font: string;
  sizePx: number;
  color: string;
  position: { x: number; y: number };
  alignment: 'left' | 'center' | 'right';
  animationPreset: 'none' | 'fade' | 'pop' | 'typewriter' | 'slide-up';
  sourceTranscriptRange: { transcriptId: string; startFrame: number; endFrame: number } | null;
}
export interface TextClip extends BaseClip {
  kind: 'text';
  text: TextContent;
}

export type Clip = MediaClip | TextClip;

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  order: number;
  enabled: boolean;
  locked: boolean;
  muted: boolean;
  clips: Clip[];
  effects: Effect[];
}

export interface Transition {
  id: string;
  trackId: string;
  type: 'crossDissolve' | 'dip' | 'wipe' | 'fade';
  durationFrames: number;
  fromClipId: string | null;
  toClipId: string | null;
  params: Record<string, unknown>;
  provenance: Provenance;
}

export interface Marker {
  id: string; frame: number; name: string; color: string; provenance: Provenance;
}

export interface TranscriptWord { text: string; startFrame: number; endFrame: number; }
export interface Transcript {
  id: string; assetId: string; language: string; source: string; words: TranscriptWord[];
}

export interface DocMeta {
  createdAt: string; modifiedAt: string; app: 'vibal'; opSeq: number;
}

export interface VibalDocument {
  schemaVersion: string;
  id: string;
  name: string;
  frameRate: FrameRate;
  resolution: Resolution;
  durationFrames: number;
  commercialUse: boolean;
  styleProfileId: string | null;
  assets: Record<string, Asset>;
  tracks: Track[];
  transitions: Transition[];
  markers: Marker[];
  transcripts: Record<string, Transcript>;
  meta: DocMeta;
}

export const isMediaClip = (c: Clip): c is MediaClip => c.kind !== 'text';
export const isTextClip = (c: Clip): c is TextClip => c.kind === 'text';
