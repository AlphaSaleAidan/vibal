// Runs the OTIO JSON through FCPXML and back using the Python `otioconvert` CLI (OTIO as the
// FCPXML adapter only — our document<->OTIO mapping stays in TypeScript). No custom Python logic.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { OtioObject } from '../otio/schema';

export function otioconvertPath(): string {
  const fromEnv = process.env.OTIOCONVERT;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const local = join(process.cwd(), '.venv', 'bin', 'otioconvert');
  if (existsSync(local)) return local;
  return 'otioconvert';
}

/** OTIO object -> .otio -> .fcpxml -> .otio -> OTIO object. Throws on any converter failure. */
export function fcpxmlRoundTrip(otioObj: OtioObject): OtioObject {
  const bin = otioconvertPath();
  const dir = mkdtempSync(join(tmpdir(), 'vibal-otio-'));
  try {
    const aOtio = join(dir, 'a.otio');
    const fcp = join(dir, 'a.fcpxml');
    const backOtio = join(dir, 'b.otio');
    writeFileSync(aOtio, JSON.stringify(otioObj));

    const r1 = spawnSync(bin, ['-i', aOtio, '-o', fcp], { encoding: 'utf8' });
    if (r1.status !== 0) {
      throw new Error(`otioconvert (otio->fcpxml) failed: ${r1.stderr || r1.error?.message || r1.status}`);
    }
    const r2 = spawnSync(bin, ['-i', fcp, '-o', backOtio], { encoding: 'utf8' });
    if (r2.status !== 0) {
      throw new Error(`otioconvert (fcpxml->otio) failed: ${r2.stderr || r2.error?.message || r2.status}`);
    }
    return JSON.parse(readFileSync(backOtio, 'utf8')) as OtioObject;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
