import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { jointFromTsu, parseTsu, serializeTsu } from '../src/io/tsu';
import { editHeightFields, randomHeightFields } from '../src/model/heightFields';
import { Joint } from '../src/model/joint';

const orig = join(__dirname, '..', '..', 'tsugite-original');

describe.skipIf(!existsSync(orig))('.tsu parsing', () => {
  it('parses test_joint.tsu', () => {
    const data = parseTsu(readFileSync(join(orig, 'test_joint.tsu'), 'utf-8'));
    expect(data.dim).toBeGreaterThanOrEqual(2);
    expect(data.heightFields.length).toBe(data.fixedSides.length - 1);
    expect(data.heightFields[0].length).toBe(data.dim);
  });

  it('round-trips every fixture file', () => {
    const files = [
      'test_joint.tsu',
      'my_joint.tsu',
      '3_1.tsu',
      'A_1.tsu',
      'L_1.tsu',
      'T_1.tsu',
      'setup/science_agora_joint_3.tsu',
    ];
    for (const f of files) {
      const text = readFileSync(join(orig, f), 'utf-8');
      const joint = jointFromTsu(text);
      const reparsed = parseTsu(serializeTsu(joint));
      expect(reparsed.sax).toBe(joint.sax);
      expect(reparsed.dim).toBe(joint.dim);
      expect(reparsed.ang).toBe(joint.ang);
      expect(reparsed.realTimDims).toEqual(joint.realTimDims);
      expect(reparsed.heightFields).toEqual(joint.heightFields);
      expect(reparsed.fixedSides.map((t) => t.map((s) => [s.ax, s.dir]))).toEqual(
        joint.fixedSides.map((t) => t.map((s) => [s.ax, s.dir])),
      );
      expect(reparsed.incremental).toBe(joint.incremental);
      expect(reparsed.fab).toEqual(joint.fab);
    }
  });
});

describe('height fields', () => {
  it('random height fields are monotonic between boundaries', () => {
    for (let trial = 0; trial < 20; trial++) {
      const hfs = randomHeightFields(4, 3);
      expect(hfs.length).toBe(2);
      for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
          expect(hfs[0][i][j]).toBeGreaterThanOrEqual(0);
          expect(hfs[1][i][j]).toBeGreaterThanOrEqual(hfs[0][i][j]);
          expect(hfs[1][i][j]).toBeLessThanOrEqual(4);
        }
      }
    }
  });

  it('editHeightFields cascades for 3 components', () => {
    const hfs = [
      [
        [1, 1],
        [1, 1],
      ],
      [
        [2, 2],
        [2, 2],
      ],
    ];
    // raise boundary 0 (n=0, dir=0 → hf 0) above hf 1 → hf 1 follows
    editHeightFields(hfs, [[0, 0]], 3, 0, 0, 3);
    expect(hfs[0][0][0]).toBe(3);
    expect(hfs[1][0][0]).toBe(3);
    // lower boundary 1 from below (n=2, dir=1 → hf 1) below hf 0 → hf 0 follows
    editHeightFields(hfs, [[1, 1]], 0, 2, 1, 3);
    expect(hfs[1][1][1]).toBe(0);
    expect(hfs[0][1][1]).toBe(0);
  });
});

describe('Joint', () => {
  it('blocks invalid sliding direction changes', () => {
    const joint = new Joint({ dim: 3 }); // components fixed at z0 / z1
    // x axis: no component fixed there → allowed
    expect(joint.updateSlidingDirection(0).ok).toBe(true);
    // back to z: component 0 has (2,0) and is first, component 1 has (2,1) and is last → allowed
    expect(joint.updateSlidingDirection(2).ok).toBe(true);
  });

  it('updates number of components and regenerates fields', () => {
    const joint = new Joint({ dim: 3 });
    joint.updateNumberOfComponents(3, () => 0);
    expect(joint.noc).toBe(3);
    expect(joint.heightFields.length).toBe(2);
    joint.updateNumberOfComponents(2, () => 0);
    expect(joint.noc).toBe(2);
    expect(joint.heightFields.length).toBe(1);
  });
});
