/** Port of Selection.py — hover / pull / move-rotate state machine. */
import { FixedSide } from '../model/fixedSides';
import { getSameHeightNeighbors } from '../model/heightFields';
import type { Joint } from '../model/joint';
import { COMPONENT_SIZE } from '../model/joint';
import type { Vec3 } from '../model/types';
import { getPosVecs } from '../view/vertexGrid';

export const enum SelState {
  None = -1,
  FaceHovered = 0,
  Pulling = 2,
  BodyHovered = 10,
  Moving = 12,
}

/** Rotate a model-space vector by the view rotation, drop z (screen project). */
export type ScreenProject = (v: Vec3) => [number, number];

function norm2(v: readonly number[]): number {
  return Math.hypot(v[0], v[1]);
}

function angleBetweenWithDirection(v0: [number, number], v1: [number, number]): number {
  const dot = v0[0] * v1[0] + v0[1] * v1[1];
  const det = v0[0] * v1[1] - v0[1] * v1[0];
  return (Math.atan2(det, dot) * 180) / Math.PI;
}

function unitize(v: Vec3): Vec3 {
  const n = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / n, v[1] / n, v[2] / n];
}

export class Selection {
  state: SelState = SelState.None;
  suggState = -1;
  n: number | null = null;
  x: number | null = null;
  y: number | null = null;
  dir = 0;
  refresh = false;
  shift = false;
  faces: [number, number][] = [];
  newFixedSides: FixedSide[] | null = null;
  newFixedSidesForDisplay: FixedSide[] | null = null;
  val = 0;
  currentHeight = 0;

  private startPos: [number, number] = [0, 0];
  private startHeight = 0;

  constructor(readonly joint: Joint) {}

  /** Port of update_pick. */
  updatePick(x: number | null, y: number | null, n: number | null, dir: number): void {
    this.n = n;
    this.x = x;
    this.y = y;
    this.dir = dir;
    if (x === null || y === null || n === null) return;
    if (this.shift) {
      this.faces = getSameHeightNeighbors(this.joint.heightFields[n - dir], [[x, y]]) as [
        number,
        number,
      ][];
      return;
    }
    this.faces = [[x, y]];
  }

  /** Port of start_pull. */
  startPull(mousePos: [number, number]): void {
    if (this.n === null || this.x === null || this.y === null) return;
    this.state = SelState.Pulling;
    this.startPos = [mousePos[0], -mousePos[1]];
    this.startHeight = this.joint.heightFields[this.n - this.dir][this.x][this.y];
    this.currentHeight = this.startHeight;
    this.val = 0;
  }

  /** Port of end_pull. Returns true if geometry changed. */
  endPull(): boolean {
    const changed = this.val !== 0 && this.n !== null;
    if (changed) this.joint.editHeightFields(this.faces, this.currentHeight, this.n!, this.dir);
    this.state = SelState.None;
    this.refresh = true;
    this.val = 0;
    return changed;
  }

  /** Port of edit: map mouse drag onto the screen-projected sliding axis. */
  edit(mousePos: [number, number], project: ScreenProject, w: number, h: number): void {
    const currentPos: [number, number] = [mousePos[0], -mousePos[1]];
    this.currentHeight = this.startHeight;
    const mouseVec: [number, number] = [
      (2 * (currentPos[0] - this.startPos[0])) / w,
      (2 * (currentPos[1] - this.startPos[1])) / h,
    ];
    const sdirVec = project(getPosVecs(this.joint)[this.joint.sax]);
    const cosang = mouseVec[0] * sdirVec[0] + mouseVec[1] * sdirVec[1];
    let val = Math.trunc(norm2(mouseVec) / norm2(sdirVec) + 0.5);
    if (cosang < 0) val = -val;
    if (this.startHeight + val > this.joint.dim) val = this.joint.dim - this.startHeight;
    if (this.startHeight + val < 0) val = -this.startHeight;
    this.currentHeight = this.startHeight + val;
    this.val = Math.trunc(val);
  }

  /** Port of start_move. */
  startMove(mousePos: [number, number], h: number): void {
    if (this.n === null) return;
    this.state = SelState.Moving;
    this.startPos = [mousePos[0], h - mousePos[1]];
    this.newFixedSides = this.joint.fixedSides[this.n];
    this.newFixedSidesForDisplay = this.joint.fixedSides[this.n];
  }

  /** Port of end_move. Returns true if the position changed. */
  endMove(): boolean {
    this.state = SelState.None;
    this.newFixedSidesForDisplay = null;
    if (this.n === null || !this.newFixedSides) return false;
    const current = this.joint.fixedSides[this.n];
    const same =
      current.length === this.newFixedSides.length &&
      current.every((s, i) => s.equals(this.newFixedSides![i]));
    if (!same) this.joint.updateComponentPosition(this.newFixedSides, this.n);
    this.newFixedSides = null;
    return !same;
  }

  /** Port of move (move OR rotate component). */
  move(mousePos: [number, number], project: ScreenProject, w: number, h: number): void {
    if (this.n === null) return;
    const joint = this.joint;
    const sax = joint.sax;
    const noc = joint.noc;
    const posVecs = getPosVecs(joint);
    this.newFixedSides = joint.fixedSides[this.n].slice();
    this.newFixedSidesForDisplay = joint.fixedSides[this.n].slice();
    const currentPos: [number, number] = [mousePos[0], h - mousePos[1]];
    const mouseVec: [number, number] = [
      (2 * (currentPos[0] - this.startPos[0])) / w,
      (2 * (currentPos[1] - this.startPos[1])) / h,
    ];
    if (norm2(mouseVec) <= 0.01) return;

    const compAx = joint.fixedSides[this.n][0].ax;
    const compDir = joint.fixedSides[this.n][0].dir;
    const compLen = 2.5 * (2 * compDir - 1) * COMPONENT_SIZE;
    const u = unitize(posVecs[compAx]);
    const compVec3: Vec3 = [compLen * u[0], compLen * u[1], compLen * u[2]];
    const compVec = project(compVec3);

    const ang = angleBetweenWithDirection(mouseVec, compVec);
    const absang = Math.abs(ang) % 180;
    if (absang > 45 && absang < 135) {
      // Timber rotation mode
      const otherAxes = [0, 1, 2].filter((a) => a !== compAx);
      let oax: number | null = null;
      let maxlen = 0;
      for (const a of otherAxes) {
        const otherVec: Vec3 = [0, 0, 0];
        otherVec[a] = 1;
        const flat = project(otherVec);
        const len = norm2(flat);
        if (len > maxlen) {
          maxlen = len;
          oax = a;
        }
      }
      if (oax === null) return;
      const clockwise = ang >= 0;
      const lax = [0, 1, 2].filter((a) => a !== compAx && a !== oax)[0];
      let screenDir = 1;
      const screenVecFull = this.rotateFull(posVecs[lax], project);
      if (screenVecFull[2] < 0) screenDir = -1;
      this.newFixedSidesForDisplay = [];
      for (const side of joint.fixedSides[this.n]) {
        let ndir = side.dir;
        let ordered = false;
        if (compAx < oax && oax - compAx === 1) ordered = true;
        if (oax < compAx && compAx - oax === 2) ordered = true;
        if ((clockwise && !ordered) || (!clockwise && ordered)) ndir = (1 - ndir) as 0 | 1;
        if (screenDir > 0) ndir = (1 - ndir) as 0 | 1;
        const newSide = new FixedSide(oax as 0 | 1 | 2, ndir);
        this.newFixedSidesForDisplay.push(newSide);
        if (newSide.ax === sax && newSide.dir === 0 && this.n !== 0) break;
        if (newSide.ax === sax && newSide.dir === 1 && this.n !== noc - 1) break;
      }
    } else {
      // Timber moving mode
      const lengthRatio = norm2(mouseVec) / norm2(compVec);
      const sideNum = joint.fixedSides[this.n].length;
      if (sideNum === 1 && absang > 135) {
        if (lengthRatio < 0.5) {
          // L to T
          this.newFixedSidesForDisplay = [new FixedSide(compAx, 0), new FixedSide(compAx, 1)];
        } else if (lengthRatio < 2.0) {
          // L to other L
          this.newFixedSidesForDisplay = [new FixedSide(compAx, (1 - compDir) as 0 | 1)];
        }
      }
      if (sideNum === 2) {
        this.newFixedSidesForDisplay =
          absang > 135 ? [new FixedSide(compAx, 1)] : [new FixedSide(compAx, 0)];
      }
    }

    // Check if the direction is blocked
    let blocked = false;
    for (const side of this.newFixedSidesForDisplay!) {
      if (side.unique(joint.fixedSides[this.n]) && side.unique(joint.unblocked)) blocked = true;
    }
    if (blocked) {
      const allSame = this.newFixedSidesForDisplay!.every(
        (side) => !side.unique(joint.fixedSides[this.n!]),
      );
      if (allSame) blocked = false;
    }
    if (!blocked) this.newFixedSides = this.newFixedSidesForDisplay;
  }

  /** Project but return full rotated vec (needs z for screen_dir check). */
  private rotateFull(v: Vec3, project: ScreenProject): Vec3 {
    // project() drops z; recover z via a second probe not possible — instead
    // the caller provides a full-rotation function through projectFull.
    return this.projectFull ? this.projectFull(v) : [project(v)[0], project(v)[1], 0];
  }

  /** Optional full-rotation hook set by the host (returns rotated vec3). */
  projectFull: ((v: Vec3) => Vec3) | null = null;
}
