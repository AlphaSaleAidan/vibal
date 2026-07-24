// CommandLog: the public entry point for mutation. Emits ops, holds the frozen current document,
// records history for undo/redo, and supports agent batches that revert as a unit.
import { ID } from '../document/ids';
import { deepFreeze } from '../document/freeze';
import { applyOp } from './reducer';
import type { VibalDocument, Actor } from '../document/types';
import type { OpSpec, Op, CommandResult, BatchRecord } from './ops';

export interface ApplyMeta { actor?: Actor; batchId?: string | null; timestamp?: string; }

export class CommandLog {
  private _doc: VibalDocument;
  private _history: Op[] = [];
  private _redo: Op[] = [];
  private _batches: BatchRecord[] = [];

  constructor(doc: VibalDocument) {
    this._doc = Object.isFrozen(doc) ? doc : deepFreeze(doc);
  }

  get document(): VibalDocument { return this._doc; }
  get ops(): readonly Op[] { return this._history; }
  get batches(): readonly BatchRecord[] { return this._batches; }

  private commit(draft: VibalDocument, timestamp: string): void {
    draft.meta = { ...draft.meta, opSeq: draft.meta.opSeq + 1, modifiedAt: timestamp };
    this._doc = deepFreeze(draft);
  }

  apply(spec: OpSpec, meta: ApplyMeta = {}): CommandResult {
    const ts = meta.timestamp ?? new Date().toISOString();
    const { document, inverse, result } = applyOp(this._doc, spec);
    const op: Op = {
      id: ID.op(),
      seq: this._doc.meta.opSeq + 1,
      timestamp: ts,
      actor: meta.actor ?? 'human',
      batchId: meta.batchId ?? null,
      type: spec.type,
      payload: spec.payload,
      inverse,
    };
    this.commit(document, ts);
    this._history.push(op);
    this._redo = [];
    return { ...result, opId: op.id };
  }

  applyBatch(specs: OpSpec[], meta: ApplyMeta & { plan: string }): { batchId: string; results: CommandResult[] } {
    const batchId = ID.batch();
    const results: CommandResult[] = [];
    const opIds: string[] = [];
    for (const spec of specs) {
      const res = this.apply(spec, { actor: meta.actor ?? 'agent', batchId });
      results.push(res);
      opIds.push(res.opId);
    }
    this._batches.push({ batchId, actor: meta.actor ?? 'agent', plan: meta.plan, opIds, createdAt: new Date().toISOString() });
    return { batchId, results };
  }

  canUndo(): boolean { return this._history.length > 0; }
  canRedo(): boolean { return this._redo.length > 0; }

  undo(): boolean {
    const op = this._history.pop();
    if (!op) return false;
    const { document } = applyOp(this._doc, op.inverse);
    this.commit(document, new Date().toISOString());
    this._redo.push(op);
    return true;
  }

  redo(): boolean {
    const op = this._redo.pop();
    if (!op) return false;
    const { document } = applyOp(this._doc, { type: op.type, payload: op.payload });
    this.commit(document, new Date().toISOString());
    this._history.push(op);
    return true;
  }

  /** Revert exactly the ops of one batch (inverses in reverse order), leaving other edits intact. */
  revertBatch(batchId: string): boolean {
    const batch = this._batches.find((b) => b.batchId === batchId);
    if (!batch) return false;
    const ops = this._history.filter((o) => o.batchId === batchId);
    if (ops.length === 0) return false;
    for (const op of [...ops].reverse()) {
      const { document } = applyOp(this._doc, op.inverse);
      this.commit(document, new Date().toISOString());
    }
    this._history = this._history.filter((o) => o.batchId !== batchId);
    this._redo = [];
    return true;
  }
}
