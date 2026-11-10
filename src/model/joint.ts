/**
 * Root joint aggregate — port of the state/parameter parts of Types.py.
 * Rendering (vertex/index building) lives in src/view; fabrication in src/fab.
 */
import {
  FixedSide,
  defaultFixedSides,
  rotationAllowed,
  unblockedPositions,
} from './fixedSides';
import { Evaluation } from './evaluation';
import {
  clearHeightFields,
  editHeightFields,
  matFromFields,
  randomHeightFields,
} from './heightFields';
import type { Axis, Mat2, Mat3, Vec3 } from './types';

export interface FabSettings {
  realDia: number; // milling bit diameter (mm)
  tol: number; // tolerance (mm)
  speed: number; // feed rate
  spindleSpeed: number;
  ext: 'gcode' | 'nc' | 'sbp';
  alignAx: number; // 0..5: axis*2+dir to align timber with during fabrication
  interp: boolean; // true arcs (G2/G3) vs interpolated points
}

export interface JointOptions {
  sax?: Axis;
  dim?: number;
  ang?: number;
  realTimDims?: Vec3;
  fixedSides?: FixedSide[][];
  heightFields?: Mat2[];
  incremental?: boolean;
  fab?: Partial<FabSettings>;
}

export const COMPONENT_SIZE = 0.275;

export const DEFAULT_FAB: FabSettings = {
  realDia: 6.0,
  tol: 0.15,
  speed: 400,
  spindleSpeed: 6000,
  ext: 'gcode',
  alignAx: 0,
  interp: true,
};

export class Joint {
  sax: Axis;
  dim: number;
  ang: number;
  realTimDims: Vec3;
  fixedSides: FixedSide[][];
  heightFields: Mat2[];
  incremental: boolean;
  fab: FabSettings;

  // Derived state
  voxelMatrix!: Mat3;
  eval!: Evaluation;
  fabDirections!: number[];

  constructor(options: JointOptions = {}) {
    this.sax = options.sax ?? 2;
    this.dim = options.dim ?? 3;
    this.ang = options.ang ?? 0.0;
    this.realTimDims = options.realTimDims ?? [44.0, 44.0, 44.0];
    this.fixedSides = options.fixedSides ?? defaultFixedSides();
    this.incremental = options.incremental ?? false;
    this.fab = { ...DEFAULT_FAB, ...options.fab };
    this.heightFields =
      options.heightFields && options.heightFields.length > 0
        ? options.heightFields
        : randomHeightFields(this.dim, this.noc);
    this.recompute();
  }

  get noc(): number {
    return this.fixedSides.length;
  }

  /** avg timber dim (mm) per model unit. */
  get ratio(): number {
    const avg = (this.realTimDims[0] + this.realTimDims[1] + this.realTimDims[2]) / 3;
    return avg / COMPONENT_SIZE;
  }

  get voxelSizes(): Vec3 {
    const r = this.ratio * this.dim;
    return [this.realTimDims[0] / r, this.realTimDims[1] / r, this.realTimDims[2] / r];
  }

  get componentLength(): number {
    return 0.5 * COMPONENT_SIZE;
  }

  /** Effective milling radius/diameter/tolerance in model units. */
  get vdia(): number {
    return this.effDia / this.ratio;
  }
  get vrad(): number {
    return this.effRad / this.ratio;
  }
  get vtol(): number {
    return this.fab.tol / this.ratio;
  }
  get effRad(): number {
    return 0.5 * this.fab.realDia - this.fab.tol;
  }
  get effDia(): number {
    return 2 * this.effRad;
  }

  get rotAllowed(): boolean {
    return rotationAllowed(this.fixedSides, this.sax);
  }

  get unblocked(): FixedSide[] {
    return unblockedPositions(this.fixedSides);
  }

  recompute(): void {
    this.voxelMatrix = matFromFields(this.heightFields, this.sax);
    this.eval = new Evaluation(this.voxelMatrix, {
      fixedSides: this.fixedSides,
      sax: this.sax,
      noc: this.noc,
      dim: this.dim,
    });
    this.fabDirections = this.eval.fabDirections;
  }

  /** Port of Types.update_sliding_direction. */
  updateSlidingDirection(sax: Axis): { ok: boolean; msg: string } {
    for (let i = 0; i < this.fixedSides.length; i++) {
      for (const side of this.fixedSides[i]) {
        if (side.ax !== sax) continue;
        if (side.dir === 0 && i === 0) continue;
        if (side.dir === 1 && i === this.noc - 1) continue;
        return { ok: false, msg: 'This sliding direction is blocked' };
      }
    }
    this.sax = sax;
    this.recompute();
    return { ok: true, msg: '' };
  }

  updateDimension(dim: number): void {
    this.dim = dim;
    this.heightFields = randomHeightFields(this.dim, this.noc);
    this.recompute();
  }

  updateAngle(ang: number): void {
    this.ang = ang;
  }

  updateTimberDims(inds: number[], val: number): void {
    for (const i of inds) this.realTimDims[i] = val;
  }

  /** Port of Types.update_number_of_components. */
  updateNumberOfComponents(newNoc: number, rand: () => number = Math.random): void {
    if (newNoc === this.noc) return;
    if (newNoc > this.noc) {
      const unblocked = this.unblocked;
      if (unblocked.length < newNoc - this.noc) return;
      for (let i = 0; i < newNoc - this.noc; i++) {
        const avail = this.unblocked;
        const randomSide = avail[Math.floor(rand() * avail.length)];
        const lastAligned = this.fixedSides[this.fixedSides.length - 1][0].ax === this.sax;
        if (lastAligned) this.fixedSides.splice(this.fixedSides.length - 1, 0, [randomSide]);
        else this.fixedSides.push([randomSide]);
      }
    }
    if (newNoc < this.noc) {
      for (let i = this.noc - newNoc; i > 0; i--) this.fixedSides.pop();
    }
    this.heightFields = randomHeightFields(this.dim, this.noc);
    this.recompute();
  }

  /** Port of Types.update_component_position. */
  updateComponentPosition(newSides: FixedSide[], n: number): void {
    this.fixedSides[n] = newSides;
    this.recompute();
  }

  editHeightFields(
    faces: readonly (readonly [number, number])[],
    h: number,
    n: number,
    dir: number,
  ): void {
    editHeightFields(this.heightFields, faces, h, n, dir, this.noc);
    this.recompute();
  }

  randomize(): void {
    this.heightFields = randomHeightFields(this.dim, this.noc);
    this.recompute();
  }

  clear(): void {
    this.heightFields = clearHeightFields(this.dim, this.noc);
    this.recompute();
  }
}
