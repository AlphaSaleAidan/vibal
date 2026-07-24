import type { Actor } from '../document/types';

export type OpType =
  | 'clip.add' | 'clip.remove' | 'clip.trim' | 'clip.split' | 'clip.move'
  | 'clip.setSpeed' | 'clip.setTransform' | 'clip.setVolume'
  | 'track.add' | 'track.remove' | 'track.reorder'
  | 'text.add' | 'text.update' | 'text.remove'
  | 'keyframe.set' | 'keyframe.remove'
  | 'transition.add' | 'transition.remove'
  | 'marker.add' | 'marker.update' | 'marker.remove'
  | 'ripple.delete' | 'audio.duck' | 'audio.setRamp';

export const OP_TYPES: OpType[] = [
  'clip.add', 'clip.remove', 'clip.trim', 'clip.split', 'clip.move',
  'clip.setSpeed', 'clip.setTransform', 'clip.setVolume',
  'track.add', 'track.remove', 'track.reorder',
  'text.add', 'text.update', 'text.remove',
  'keyframe.set', 'keyframe.remove',
  'transition.add', 'transition.remove',
  'marker.add', 'marker.update', 'marker.remove',
  'ripple.delete', 'audio.duck', 'audio.setRamp',
];

// Internal ops are the composite-inverse mechanism (not part of the public 24). They only ever
// appear as computed inverses of composite/import ops, never authored directly by callers.
export type InternalOpType =
  | '_setTrackClips' | '_setKeyframes' | '_addAsset' | '_removeAsset' | '_seq';
export type AnyOpType = OpType | InternalOpType;

/** A forward or inverse mutation spec. */
export interface OpSpec {
  type: AnyOpType;
  payload: any;
}

/** A logged op: an OpSpec with identity, ordering, actor, and its computed inverse. */
export interface Op extends OpSpec {
  id: string;
  seq: number;
  timestamp: string;
  actor: Actor;
  batchId: string | null;
  inverse: OpSpec;
}

export interface CommandResult {
  opId: string;
  changedIds: string[];
  createdIds: string[];
  deletedIds: string[];
}

export interface BatchRecord {
  batchId: string;
  actor: Actor;
  plan: string;
  opIds: string[];
  createdAt: string;
}
