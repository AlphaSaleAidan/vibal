import { randomUUID } from 'node:crypto';

export const newId = (prefix: string): string => `${prefix}_${randomUUID().slice(0, 8)}`;

// Kind-prefixed ids for log readability (schema §0 invariant 2).
export const ID = {
  proj: () => newId('proj'),
  clip: () => newId('clip'),
  track: () => newId('track'),
  asset: () => newId('asset'),
  op: () => newId('op'),
  batch: () => newId('batch'),
  transition: () => newId('tr'),
  transcript: () => newId('tsc'),
  marker: () => newId('mk'),
  effect: () => newId('fx'),
  keyframe: () => newId('kf'),
};
