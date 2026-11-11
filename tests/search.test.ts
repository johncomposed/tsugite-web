import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { Evaluation } from '../src/model/evaluation';
import { fixedSidesFromString } from '../src/model/fixedSides';
import { matFromFields, randomHeightFields } from '../src/model/heightFields';
import { quickValid, searchValidJoints } from '../src/model/search';
import { parseTsu } from '../src/io/tsu';
import type { Axis, Mat2 } from '../src/model/types';

const orig = join(__dirname, '..', '..', 'tsugite-original');

/** Deterministic rng for reproducible tests. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('quickValid agrees with Evaluation.valid', () => {
  it('on all parity fixtures', () => {
    const fixturesDir = join(__dirname, 'fixtures');
    for (const file of readdirSync(fixturesDir).filter((f) => f.endsWith('.json'))) {
      const fx = JSON.parse(readFileSync(join(fixturesDir, file), 'utf-8'));
      const fixedSides = fixedSidesFromString(fx.fss);
      const mat = matFromFields(fx.hfs as Mat2[], fx.sax as Axis);
      expect(quickValid(mat, fixedSides, fx.sax, fixedSides.length), file).toBe(fx.valid);
    }
  });

  it('on random height fields (2 and 3 components)', () => {
    const rand = mulberry32(7);
    const configs = [
      { fss: '2,0:2,1', sax: 2 as Axis },
      { fss: '2,0:0,0.0,1:2,1', sax: 2 as Axis },
    ];
    for (const { fss, sax } of configs) {
      const fixedSides = fixedSidesFromString(fss);
      for (let trial = 0; trial < 40; trial++) {
        const hfs = randomHeightFields(3, fixedSides.length, rand);
        const mat = matFromFields(hfs, sax);
        const ev = new Evaluation(mat, { fixedSides, sax, noc: fixedSides.length, dim: 3 });
        expect(quickValid(mat, fixedSides, sax, fixedSides.length)).toBe(ev.valid);
      }
    }
  });
});

describe('pruned joint search', () => {
  it('every search result is a valid joint', () => {
    const fixedSides = fixedSidesFromString('2,0:2,1');
    const { results } = searchValidJoints({
      dim: 3,
      sax: 2,
      fixedSides,
      targetCount: 10,
      maxLeafEvals: 5000,
      rand: mulberry32(1),
    });
    expect(results.length).toBeGreaterThan(0);
    for (const hfs of results) {
      const ev = new Evaluation(matFromFields(hfs, 2), { fixedSides, sax: 2, noc: 2, dim: 3 });
      expect(ev.valid).toBe(true);
    }
  });

  it.skipIf(!existsSync(join(orig, '3_2.tsu')))('finds valid joints for the 3_2 (3-timber) configuration', () => {
    // Random sampling found 0/3000 for this config; the pruned search must
    // succeed.
    const data = parseTsu(readFileSync(join(orig, '3_2.tsu'), 'utf-8'));
    const { results, examined } = searchValidJoints({
      dim: data.dim,
      sax: data.sax,
      fixedSides: data.fixedSides,
      targetCount: 10,
      maxLeafEvals: 25000,
      seedFields: data.heightFields,
      rand: mulberry32(2),
    });
    expect(results.length).toBeGreaterThan(0);
    for (const hfs of results) {
      const ev = new Evaluation(matFromFields(hfs, data.sax), {
        fixedSides: data.fixedSides,
        sax: data.sax,
        noc: data.fixedSides.length,
        dim: data.dim,
      });
      expect(ev.valid).toBe(true);
    }
    expect(examined).toBeLessThanOrEqual(25000);
  });

  it('exhausts tiny spaces completely (dim 2, 2 components)', () => {
    const fixedSides = fixedSidesFromString('2,0:2,1');
    const { exhausted, examined, results } = searchValidJoints({
      dim: 2,
      sax: 2,
      fixedSides,
      targetCount: 10000,
      maxLeafEvals: 100000,
      rand: mulberry32(3),
    });
    expect(exhausted).toBe(true);
    // dim 2: 3^4 = 81 assignments, minus chess-pruned ones
    expect(examined).toBeLessThanOrEqual(81);
    // Brute-force cross-check: there are NO valid 2-component joints at
    // resolution 2 (verified against Evaluation over all 81 assignments).
    let brute = 0;
    for (let a = 0; a <= 2; a++)
      for (let b = 0; b <= 2; b++)
        for (let c = 0; c <= 2; c++)
          for (let d = 0; d <= 2; d++) {
            const hfs = [
              [
                [a, b],
                [c, d],
              ],
            ];
            const ev = new Evaluation(matFromFields(hfs, 2), {
              fixedSides,
              sax: 2,
              noc: 2,
              dim: 2,
            });
            if (ev.valid) brute++;
          }
    expect(results.length).toBe(brute);
  });
});
