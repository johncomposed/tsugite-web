import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { jointFromTsu } from '../src/io/tsu';
import { buildMillContext, millingPathVertices } from '../src/fab/millingPath';
import { exportGcode } from '../src/fab/gcode';
import { createJointVertices } from '../src/view/vertexGrid';

const orig = join(__dirname, '..', '..', 'tsugite-original');

/** Compare two machine-code lines: identical structure, numbers within tol. */
function compareLines(a: string, b: string, tol: number): string | null {
  const numRe = /-?\d+(?:\.\d+)?/g;
  const aNums = (a.match(numRe) ?? []).map(Number);
  const bNums = (b.match(numRe) ?? []).map(Number);
  const aSkel = a.replace(numRe, '#').trim();
  const bSkel = b.replace(numRe, '#').trim();
  if (aSkel !== bSkel) return `structure: "${a}" vs "${b}"`;
  if (aNums.length !== bNums.length) return `num count: "${a}" vs "${b}"`;
  for (let i = 0; i < aNums.length; i++) {
    if (Math.abs(aNums[i] - bNums[i]) > tol) return `value: "${a}" vs "${b}"`;
  }
  return null;
}

function checkFixture(tsuName: string, expectedFiles: string[]): void {
  const tsuPath = join(orig, tsuName);
  const joint = jointFromTsu(readFileSync(tsuPath, 'utf-8'));
  const jverts = createJointVertices(joint, 0);
  const ctx = buildMillContext(joint, jverts);
  const millVerts = [];
  for (let n = 0; n < joint.noc; n++) millVerts.push(millingPathVertices(ctx, n).millVertices);
  const files = exportGcode(joint, millVerts, 'out');

  for (let n = 0; n < expectedFiles.length; n++) {
    const expectedPath = join(orig, expectedFiles[n]);
    const expected = readFileSync(expectedPath, 'utf-8').split(/\r?\n/).filter((l) => l.length);
    const actual = files[n].content.split(/\r?\n/).filter((l) => l.length);
    expect(actual.length, `${expectedFiles[n]}: line count`).toBe(expected.length);
    const errors: string[] = [];
    for (let i = 0; i < expected.length; i++) {
      const err = compareLines(actual[i], expected[i], 2e-3);
      if (err) errors.push(`line ${i + 1}: ${err}`);
    }
    expect(errors.slice(0, 10), `${expectedFiles[n]}`).toEqual([]);
  }
}

describe('fabrication parity vs original exports', () => {
  it('my_joint.tsu → gcode matches my_joint_A/B.gcode', () => {
    checkFixture('my_joint.tsu', ['my_joint_A.gcode', 'my_joint_B.gcode']);
  });

  it('20241028_test_joint.tsu → sbp matches original exports', () => {
    const name = '20241028_test_joint.tsu';
    if (!existsSync(join(orig, name))) return;
    checkFixture(name, ['20241028_test_joint_A.sbp', '20241028_test_joint_B.sbp']);
  });
});
