/** Port of Fabrication.py — MillVertex, RoughPixel, arc helpers. */
import type { Vec3 } from '../model/types';
import type { Mat2 } from '../model/types';
import { rotateVectorAroundAxis } from '../view/vertexGrid';

export function angleBetween(v1: Vec3, v2: Vec3, normal: Vec3 | null = null): number {
  const n1 = Math.sqrt(v1[0] * v1[0] + v1[1] * v1[1] + v1[2] * v1[2]);
  const n2 = Math.sqrt(v2[0] * v2[0] + v2[1] * v2[1] + v2[2] * v2[2]);
  const u1: Vec3 = [v1[0] / n1, v1[1] / n1, v1[2] / n1];
  const u2: Vec3 = [v2[0] / n2, v2[1] / n2, v2[2] / n2];
  const dot = u1[0] * u2[0] + u1[1] * u2[1] + u1[2] * u2[2];
  let angle = Math.acos(Math.min(1, Math.max(-1, dot)));
  if (normal) {
    const cross: Vec3 = [
      u1[1] * u2[2] - u1[2] * u2[1],
      u1[2] * u2[0] - u1[0] * u2[2],
      u1[0] * u2[1] - u1[1] * u2[0],
    ];
    const d = normal[0] * cross[0] + normal[1] * cross[1] + normal[2] * cross[2];
    if (d < 0) angle = -angle;
  }
  return angle;
}

/** Python round() (half-even would differ negligibly; toFixed suffices). */
export function pyRound(x: number, d: number): number {
  return parseFloat(x.toFixed(d));
}

/** Python str(float): keep one decimal for integral values. */
export function pyFloatStr(x: number): string {
  const s = String(x);
  if (!s.includes('.') && !s.includes('e') && !s.includes('E') && !s.includes('Infinity'))
    return `${s}.0`;
  return s;
}

export class MillVertex {
  pt: Vec3;
  x: number;
  y: number;
  z: number;
  isArc: boolean;
  arcCtr: Vec3;
  isTra: boolean;
  xstr = '';
  ystr = '';
  zstr = '';

  constructor(pt: readonly number[], opts: { isTra?: boolean; isArc?: boolean; arcCtr?: readonly number[] } = {}) {
    this.pt = [pt[0], pt[1], pt[2]];
    this.x = pt[0];
    this.y = pt[1];
    this.z = pt[2];
    this.isArc = opts.isArc ?? false;
    this.arcCtr = opts.arcCtr ? [opts.arcCtr[0], opts.arcCtr[1], opts.arcCtr[2]] : [0, 0, 0];
    this.isTra = opts.isTra ?? false;
  }

  /** Port of scale_and_swap. */
  scaleAndSwap(
    ax: number,
    dir: number,
    ratio: number,
    unitScale: number,
    realTimDims: Vec3,
    coords: [number, number, number],
    d: number,
  ): void {
    let xyz: Vec3 = [
      unitScale * ratio * this.x,
      unitScale * ratio * this.y,
      unitScale * ratio * this.z,
    ];
    if (ax === 2) xyz[1] = -xyz[1];
    xyz = [xyz[coords[0]], xyz[coords[1]], xyz[coords[2]]];
    this.x = xyz[0];
    this.y = xyz[1];
    this.z = xyz[2];
    this.z = -(2 * dir - 1) * this.z - 0.5 * unitScale * realTimDims[ax];
    this.y = -(2 * dir - 1) * this.y;
    this.pt = [this.x, this.y, this.z];
    this.xstr = pyFloatStr(pyRound(this.x, d));
    this.ystr = pyFloatStr(pyRound(this.y, d));
    this.zstr = pyFloatStr(pyRound(this.z, d));
    if (this.isArc) {
      let ctr: Vec3 = [
        unitScale * ratio * this.arcCtr[0],
        unitScale * ratio * this.arcCtr[1],
        unitScale * ratio * this.arcCtr[2],
      ];
      if (ax === 2) ctr[1] = -ctr[1];
      ctr = [ctr[coords[0]], ctr[coords[1]], ctr[coords[2]]];
      ctr[2] = -(2 * dir - 1) * ctr[2] - 0.5 * unitScale * realTimDims[ax];
      ctr[1] = -(2 * dir - 1) * ctr[1];
      this.arcCtr = ctr;
    }
  }

  /** Port of rotate (around z). */
  rotate(ang: number, d: number): void {
    this.pt = rotateVectorAroundAxis([this.x, this.y, this.z], [0, 0, 1], ang);
    this.x = this.pt[0];
    this.y = this.pt[1];
    this.z = this.pt[2];
    this.xstr = pyFloatStr(pyRound(this.x, d));
    this.ystr = pyFloatStr(pyRound(this.y, d));
    this.zstr = pyFloatStr(pyRound(this.z, d));
    if (this.isArc) {
      this.arcCtr = rotateVectorAroundAxis(this.arcCtr, [0, 0, 1], ang);
    }
  }
}

export function connectedArc(mv0: MillVertex, mv1: MillVertex): boolean {
  if (!mv0.isArc || !mv1.isArc) return false;
  return mv0.arcCtr[0] === mv1.arcCtr[0] && mv0.arcCtr[1] === mv1.arcCtr[1];
}

/** Port of arc_points: interpolated points between two arc vertices. */
export function arcPoints(
  st: Vec3,
  en: Vec3,
  ctr0: Vec3,
  ctr1: Vec3,
  ax: number,
  astepIn: number,
): Vec3[] {
  const pts: Vec3[] = [];
  const v0: Vec3 = [st[0] - ctr0[0], st[1] - ctr0[1], st[2] - ctr0[2]];
  const v1: Vec3 = [en[0] - ctr1[0], en[1] - ctr1[1], en[2] - ctr1[2]];
  const cnt = Math.trunc(0.5 + angleBetween(v0, v1) / astepIn);
  let astep = 0;
  let zstep = 0;
  if (cnt > 0) {
    astep = angleBetween(v0, v1) / cnt;
    zstep = (en[ax] - st[ax]) / cnt;
  }
  const axVec: Vec3 = [
    v0[1] * v1[2] - v0[2] * v1[1],
    v0[2] * v1[0] - v0[0] * v1[2],
    v0[0] * v1[1] - v0[1] * v1[0],
  ];
  for (let i = 1; i <= cnt; i++) {
    const rvec = rotateVectorAroundAxis(v0, axVec, astep * i);
    pts.push([ctr0[0] + rvec[0], ctr0[1] + rvec[1], ctr0[2] + rvec[2] + zstep * i]);
  }
  return pts;
}

/** Port of RoughPixel. */
export class RoughPixel {
  ind: number[];
  indAbs: number[];
  outside: boolean;
  neighbors: Mat2; // [ax][dir] 0 region/free, 1 blocked
  flatNeighbors: number[];

  constructor(ind: number[], mat: Mat2, padLoc: [number, number][], dim: number, n: number) {
    this.ind = ind.slice();
    this.indAbs = [ind[0] - padLoc[0][0], ind[1] - padLoc[1][0]];
    this.outside =
      this.indAbs[0] < 0 || this.indAbs[0] >= dim || this.indAbs[1] < 0 || this.indAbs[1] >= dim;
    this.neighbors = [];
    for (let ax = 0; ax < 2; ax++) {
      const temp: number[] = [];
      for (let dir = -1; dir < 2; dir += 2) {
        const nind = this.ind.slice();
        nind[ax] += dir;
        let type = 0;
        if (nind[0] >= 0 && nind[0] < mat.length && nind[1] >= 0 && nind[1] < mat[0].length) {
          if (mat[nind[0]][nind[1]] === n) type = 1;
        }
        temp.push(type);
      }
      this.neighbors.push(temp);
    }
    this.flatNeighbors = this.neighbors.flat();
  }
}
