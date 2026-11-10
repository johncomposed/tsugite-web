import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { Evaluation } from '../src/model/evaluation';
import { fixedSidesFromString } from '../src/model/fixedSides';
import { matFromFields } from '../src/model/heightFields';
import type { Axis, Mat2 } from '../src/model/types';

interface Fixture {
  file: string;
  sax: Axis;
  dim: number;
  fss: string;
  hfs: Mat2[];
  voxel_matrix: number[][][];
  valid: boolean;
  connected: boolean[];
  bridged: boolean[];
  checker: boolean[];
  checker_vertices: number[][][];
  interlock: boolean;
  interlocks: boolean[];
  slides: [number, number][][];
  number_of_slides: number[];
  friction_nums: number[];
  contact_nums: number[];
  breakable: boolean[];
  breakable_voxel_inds: number[][][];
  fab_direction_ok: boolean[];
  fab_directions: number[];
}

const fixturesDir = join(__dirname, 'fixtures');
const fixtureFiles = readdirSync(fixturesDir).filter((f) => f.endsWith('.json'));

describe.each(fixtureFiles)('evaluation parity: %s', (file) => {
  const fx: Fixture = JSON.parse(readFileSync(join(fixturesDir, file), 'utf-8'));
  const fixedSides = fixedSidesFromString(fx.fss);
  const noc = fixedSides.length;

  it('voxel matrix matches mat_from_fields', () => {
    expect(matFromFields(fx.hfs, fx.sax)).toEqual(fx.voxel_matrix);
  });

  const voxelMatrix = matFromFields(fx.hfs, fx.sax);
  const ev = new Evaluation(voxelMatrix, { fixedSides, sax: fx.sax, noc, dim: fx.dim });

  it('connectivity / bridging', () => {
    expect(ev.connected).toEqual(fx.connected);
    expect(ev.bridged).toEqual(fx.bridged);
  });

  it('checkerboard', () => {
    expect(ev.checker).toEqual(fx.checker);
    expect(ev.checkerVertices).toEqual(fx.checker_vertices);
  });

  it('sliding directions / interlock', () => {
    expect(ev.slides).toEqual(fx.slides);
    expect(ev.numberOfSlides).toEqual(fx.number_of_slides);
    expect(ev.interlock).toBe(fx.interlock);
    expect(ev.interlocks).toEqual(fx.interlocks);
  });

  it('friction / contact counts', () => {
    expect(ev.frictionNums).toEqual(fx.friction_nums);
    expect(ev.contactNums).toEqual(fx.contact_nums);
  });

  it('breakability', () => {
    expect(ev.breakable).toEqual(fx.breakable);
    expect(ev.breakableVoxelInds).toEqual(fx.breakable_voxel_inds);
  });

  it('fabricability', () => {
    expect(ev.fabDirectionOk).toEqual(fx.fab_direction_ok);
    expect(ev.fabDirections).toEqual(fx.fab_directions);
  });

  it('overall validity', () => {
    expect(ev.valid).toBe(fx.valid);
  });
});
