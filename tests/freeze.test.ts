import { describe, it, expect } from 'vitest';
import { createDocument, createTrack } from '../src/document/factory';
import { CommandLog } from '../src/oplog/log';

describe('mutation guard (ops are the only mutation path)', () => {
  it('throws on direct top-level mutation of the document', () => {
    const doc = createDocument({ name: 'x' });
    expect(() => { (doc as any).name = 'y'; }).toThrow();
  });

  it('throws on direct nested mutation of the document tree', () => {
    const log = new CommandLog(createDocument({ name: 'x' }));
    log.apply({ type: 'track.add', payload: { track: createTrack('video', { name: 'V1', order: 0 }) } });
    const doc = log.document;
    expect(() => { (doc.tracks[0] as any).name = 'z'; }).toThrow();
    expect(() => { (doc.tracks as any).push({}); }).toThrow();
  });

  it('an op produces a NEW frozen document, leaving the prior one intact', () => {
    const log = new CommandLog(createDocument({ name: 'x' }));
    const before = log.document;
    log.apply({ type: 'track.add', payload: { track: createTrack('video', { name: 'V1', order: 0 }) } });
    expect(before.tracks.length).toBe(0);
    expect(log.document.tracks.length).toBe(1);
    expect(log.document).not.toBe(before);
  });
});
