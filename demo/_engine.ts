// Node entry: re-export the real Phase 0 engine so the backend + MCP server operate the true core.
export { createDocument, createTrack, createMediaClip, createTextClip, createAsset, createMarker, createTransition } from '../src/document/factory';
export { CommandLog } from '../src/oplog/log';
export { applyOp } from '../src/oplog/reducer';
export { documentToOtio } from '../src/interchange/otio/toOtio';
