/**
 * Milling path generation — port of the path functions in Types.py
 * (layer_mat_from_cube, pad_layer_mat_with_fixed_sides, region outlines,
 * rough milling, offsetting with rounded corners, layered z-stepping).
 */
import { FixedSide } from '../model/fixedSides';
import type { Joint } from '../model/joint';
import { RegionVertex } from '../model/regionVertex';
import { insertAxis, type Axis, type Mat2, type Mat3, type Vec3 } from '../model/types';
import { getIndex, getPosVecs, normalize, rotateVectorAroundAxis } from '../view/vertexGrid';
import { arcPoints, angleBetween, connectedArc, MillVertex, RoughPixel } from './millVertex';

export interface MillContext {
  dim: number;
  sax: Axis;
  ang: number;
  voxelSizes: Vec3;
  posVecs: Vec3[];
  realTimDims: Vec3;
  ratio: number;
  vrad: number;
  vdia: number;
  fabDep: number; // milling depth in mm (fab.dep)
  fixedSides: FixedSide[][];
  noc: number;
  fabDirections: number[];
  voxelMatrix: Mat3;
  incremental: boolean;
  jverts: Float32Array; // 8-stride lattice vertices
}

export function buildMillContext(joint: Joint, jverts: Float32Array): MillContext {
  return {
    dim: joint.dim,
    sax: joint.sax,
    ang: joint.ang,
    voxelSizes: joint.voxelSizes,
    posVecs: getPosVecs(joint),
    realTimDims: joint.realTimDims,
    ratio: joint.ratio,
    vrad: joint.vrad,
    vdia: joint.vdia,
    fabDep: 1.5,
    fixedSides: joint.fixedSides,
    noc: joint.noc,
    fabDirections: joint.fabDirections,
    voxelMatrix: joint.voxelMatrix,
    incremental: joint.incremental,
    jverts,
  };
}

const V_STRIDE = 8;

function getVertex(index: number, verts: Float32Array): Vec3 {
  return [verts[V_STRIDE * index], verts[V_STRIDE * index + 1], verts[V_STRIDE * index + 2]];
}

function vAdd(...vs: Vec3[]): Vec3 {
  const out: Vec3 = [0, 0, 0];
  for (const v of vs) {
    out[0] += v[0];
    out[1] += v[1];
    out[2] += v[2];
  }
  return out;
}

function vScale(v: Vec3, s: number): Vec3 {
  return [v[0] * s, v[1] * s, v[2] * s];
}

function vSub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function vNorm(v: Vec3): number {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}

function setVectorLength(vec: Vec3, newNorm: number): Vec3 {
  return vScale(normalize(vec), newNorm);
}

/** Port of layer_mat_from_cube. */
export function layerMatFromCube(ctx: MillContext, layNum: number, n: number): Mat2 {
  const mat: Mat2 = [];
  const fdir = ctx.fabDirections[n];
  for (let i = 0; i < ctx.dim; i++) {
    mat.push([]);
    for (let j = 0; j < ctx.dim; j++) {
      const zval = (ctx.dim - 1) * (1 - fdir) + (2 * fdir - 1) * layNum;
      const ind = insertAxis([i, j], ctx.sax, zval);
      mat[i].push(Math.trunc(ctx.voxelMatrix[ind[0]][ind[1]][ind[2]]));
    }
  }
  return mat;
}

/** 2D numpy-style sequential pad. */
function pad2d(mat: Mat2, padLoc: [number, number][], padVal: [number, number][]): Mat2 {
  let out = mat.map((r) => r.slice());
  // axis 0
  if (padLoc[0][0]) out = [Array(out[0].length).fill(padVal[0][0]), ...out];
  if (padLoc[0][1]) out = [...out, Array(out[0].length).fill(padVal[0][1])];
  // axis 1
  if (padLoc[1][0]) out = out.map((r) => [padVal[1][0], ...r]);
  if (padLoc[1][1]) out = out.map((r) => [...r, padVal[1][1]]);
  return out;
}

/** Port of pad_layer_mat_with_fixed_sides. */
export function padLayerMatWithFixedSides(
  ctx: MillContext,
  mat: Mat2,
): [Mat2, [number, number][]] {
  const padLoc: [number, number][] = [
    [0, 0],
    [0, 0],
  ];
  const padVal: [number, number][] = [
    [-1, -1],
    [-1, -1],
  ];
  for (let n2 = 0; n2 < ctx.fixedSides.length; n2++) {
    for (const oside of ctx.fixedSides[n2]) {
      if (oside.ax === ctx.sax) continue;
      const axes = [0, 0, 0];
      axes[oside.ax] = 1;
      axes.splice(ctx.sax, 1);
      const oax = axes.indexOf(1);
      padLoc[oax][oside.dir] = 1;
      padVal[oax][oside.dir] = n2;
    }
  }
  let out = pad2d(mat, padLoc, padVal);
  // corner -1 pass
  for (const fixedSides1 of ctx.fixedSides) {
    for (const fixedSides2 of ctx.fixedSides) {
      for (const side1 of fixedSides1) {
        if (side1.ax === ctx.sax) continue;
        const axes1 = [0, 0, 0];
        axes1[side1.ax] = 1;
        axes1.splice(ctx.sax, 1);
        const ax1 = axes1.indexOf(1);
        for (const side2 of fixedSides2) {
          if (side2.ax === ctx.sax) continue;
          const axes2 = [0, 0, 0];
          axes2[side2.ax] = 1;
          axes2.splice(ctx.sax, 1);
          const ax2 = axes2.indexOf(1);
          if (ax1 === ax2) continue;
          const ind = [0, 0];
          const shape = [out.length, out[0].length];
          ind[ax1] = side1.dir * (shape[ax1] - 1);
          ind[ax2] = side2.dir * (shape[ax2] - 1);
          out[ind[0]][ind[1]] = -1;
        }
      }
    }
  }
  return [out, padLoc];
}

/** Port of get_diff_neighbors: flood of values != val (and != -1). */
export function getDiffNeighbors(mat2: Mat2, inds: number[][], val: number): number[][] {
  const newInds = inds.map((i) => i.slice());
  for (const ind of newInds) {
    for (let ax = 0; ax < 2; ax++) {
      for (let dir = -1; dir < 2; dir += 2) {
        const ind2 = ind.slice();
        ind2[ax] += dir;
        const limit = ax === 0 ? mat2.length : mat2[0].length;
        if (ind2[ax] < 0 || ind2[ax] >= limit) continue;
        const val2 = mat2[ind2[0]][ind2[1]];
        if (val2 === val || val2 === -1) continue;
        const exists = newInds.some((i3) => i3[0] === ind2[0] && i3[1] === ind2[1]);
        if (!exists) newInds.push(ind2);
      }
    }
  }
  return newInds;
}

/** Port of any_minus_one_neighbor. */
function anyMinusOneNeighbor(ind: number[], layMat: Mat2): boolean {
  for (let add0 = -1; add0 < 1; add0++) {
    for (let add1 = -1; add1 < 1; add1++) {
      const nind = [ind[0] + add0, ind[1] + add1];
      if (nind[0] < 0 || nind[1] < 0 || nind[0] >= layMat.length || nind[1] >= layMat[0].length)
        continue;
      if (layMat[nind[0]][nind[1]] === -1) return true;
    }
  }
  return false;
}

/** Port of Types.get_neighbors_in_out (differs from Evaluation's). */
function getNeighborsInOut(
  ind: number[],
  regInds: number[][],
  layMat: Mat2,
  orgLayMat: Mat2,
): [Mat2, Mat2] {
  const inOut: Mat2 = [];
  const values: Mat2 = [];
  for (let add0 = -1; add0 < 1; add0++) {
    const temp: number[] = [];
    const temp2: number[] = [];
    for (let add1 = -1; add1 < 1; add1++) {
      const nind = [ind[0] + add0, ind[1] + add1];
      let type = -1;
      let val: number | null = null;
      for (const rind of regInds) {
        if (rind[0] === nind[0] && rind[1] === nind[1]) {
          type = 0;
          break;
        }
      }
      if (type !== 0) {
        const oob =
          nind[0] < 0 || nind[1] < 0 || nind[0] >= layMat.length || nind[1] >= layMat[0].length;
        if (oob) {
          type = 2;
          val = -1;
        } else if (layMat[nind[0]][nind[1]] < 0) {
          type = 2;
          val = -2;
        } else {
          type = 1;
        }
      }
      if (val === null) val = orgLayMat[nind[0]][nind[1]];
      temp.push(type);
      temp2.push(val);
    }
    inOut.push(temp);
    values.push(temp2);
  }
  return [inOut, values];
}

/** Port of get_region_outline_vertices. */
export function getRegionOutlineVertices(
  regInds: number[][],
  layMat: Mat2,
  orgLayMat: Mat2,
  padLoc: [number, number][],
): RegionVertex[] {
  const regVerts: RegionVertex[] = [];
  for (let i = 0; i < layMat.length + 1; i++) {
    for (let j = 0; j < layMat[0].length + 1; j++) {
      const ind = [i, j];
      const [neighbors, neighborValues] = getNeighborsInOut(ind, regInds, layMat, orgLayMat);
      const flat = neighbors.flat();
      const absInd = ind.slice();
      ind[0] -= padLoc[0][0];
      ind[1] -= padLoc[1][0];
      const someRegion = flat.some((v) => v === 0);
      const allRegion = flat.every((v) => v === 0);
      if (!someRegion || allRegion) continue;
      const dia1 = neighbors[0][1] === neighbors[1][0];
      const dia2 = neighbors[0][0] === neighbors[1][1];
      const zeros = flat.filter((v) => v === 0).length;
      const ones = flat.filter((v) => v === 1).length;
      if (zeros === 2 && ones === 2 && dia1 && dia2) {
        for (let a = 0; a < 2; a++) {
          for (let b = 0; b < 2; b++) {
            if (neighbors[a][b] !== 0) continue;
            const oneighbors = neighbors.map((r) => r.slice());
            oneighbors[a][b] = 1;
            regVerts.push(new RegionVertex(ind, absInd, oneighbors, neighborValues, true));
          }
        }
        continue;
      }
      const mon = anyMinusOneNeighbor(ind, layMat);
      regVerts.push(new RegionVertex(ind, absInd, neighbors, neighborValues, false, mon));
    }
  }
  return regVerts;
}

/** Port of set_starting_vert. */
function setStartingVert(verts: RegionVertex[]): RegionVertex[] {
  let firstI: number | null = null;
  let secondI: number | null = null;
  for (let i = 0; i < verts.length; i++) {
    const rv = verts[i];
    if (rv.blockCount > 0) {
      if (rv.freeCount > 0) firstI = i;
      else secondI = i;
    }
  }
  if (firstI === null) firstI = secondI;
  if (firstI === null) firstI = 0;
  verts.unshift(verts[firstI]);
  verts.splice(firstI + 1, 1);
  return verts;
}

/** Port of get_sublist_of_ordered_verts. */
function getSublistOfOrderedVerts(
  verts: RegionVertex[],
): [RegionVertex[], RegionVertex[], boolean] {
  const ordVerts: RegionVertex[] = [verts[0]];
  verts.splice(0, 1);
  const browseNum = verts.length;
  for (let iter = 0; iter < browseNum; iter++) {
    let foundNext = false;
    for (let vax = 0; vax < 2 && !foundNext; vax++) {
      for (let vdir = -1; vdir < 2 && !foundNext; vdir += 2) {
        const last = ordVerts[ordVerts.length - 1];
        const nextInd = [last.ind[0], last.ind[1]];
        nextInd[vax] += vdir;
        for (const rv of verts) {
          if (rv.ind[0] !== nextInd[0] || rv.ind[1] !== nextInd[1]) continue;
          if (
            ordVerts.length > 1 &&
            rv.ind[0] === ordVerts[ordVerts.length - 2].ind[0] &&
            rv.ind[1] === ordVerts[ordVerts.length - 2].ind[1]
          )
            break;
          const vaxval = Math.trunc(0.5 * (vdir + 1));
          const pNeig = last.neighbors;
          let nind0 = [0, 0];
          nind0[vax] = vaxval;
          let nind1 = [1, 1];
          nind1[vax] = vaxval;
          let ne0 = pNeig[nind0[0]][nind0[1]];
          let ne1 = pNeig[nind1[0]][nind1[1]];
          if (ne0 !== 1 && ne1 !== 1) continue;
          if (Math.trunc(0.5 * (ne0 + 1)) === Math.trunc(0.5 * (ne1 + 1))) continue;
          nind0 = [0, 0];
          nind0[vax] = 1 - vaxval;
          nind1 = [1, 1];
          nind1[vax] = 1 - vaxval;
          ne0 = rv.neighbors[nind0[0]][nind0[1]];
          ne1 = rv.neighbors[nind1[0]][nind1[1]];
          if (ne0 !== 1 && ne1 !== 1) continue;
          if (Math.trunc(0.5 * (ne0 + 1)) === Math.trunc(0.5 * (ne1 + 1))) continue;
          foundNext = true;
          ordVerts.push(rv);
          verts.splice(verts.indexOf(rv), 1);
          break;
        }
      }
    }
  }
  // closed?
  let closed = false;
  if (ordVerts.length > 3) {
    const diff = [
      ordVerts[0].ind[0] - ordVerts[ordVerts.length - 1].ind[0],
      ordVerts[0].ind[1] - ordVerts[ordVerts.length - 1].ind[1],
    ];
    const zeroCount = diff.filter((d) => d === 0).length;
    if (zeroCount === 1) {
      const vax = diff[0] !== 0 ? 0 : 1;
      if (Math.abs(diff[vax]) === 1) {
        const vdir = diff[vax];
        const vaxval = Math.trunc(0.5 * (vdir + 1));
        const pNeig = ordVerts[ordVerts.length - 1].neighbors;
        const nind0 = [0, 0];
        nind0[vax] = vaxval;
        const nind1 = [1, 1];
        nind1[vax] = vaxval;
        const ne0 = pNeig[nind0[0]][nind0[1]];
        const ne1 = pNeig[nind1[0]][nind1[1]];
        if (ne0 === 1 || ne1 === 1) {
          if (Math.trunc(0.5 * (ne0 + 1)) !== Math.trunc(0.5 * (ne1 + 1))) closed = true;
        }
      }
    }
  }
  return [ordVerts, verts, closed];
}

function argwhereFirst(mat: Mat2, val: number): [number, number] | null {
  for (let i = 0; i < mat.length; i++) {
    for (let j = 0; j < mat[0].length; j++) {
      if (mat[i][j] === val) return [i, j];
    }
  }
  return null;
}

/** Port of offset_verts. Returns [outline, cornerArtifacts]. */
function offsetVerts(
  ctx: MillContext,
  neighborVectors: Vec3[][],
  neighborVectorsA: Vec3[][],
  neighborVectorsB: Vec3[][],
  verts: RegionVertex[],
  layNum: number,
  n: number,
): [MillVertex[], MillVertex[][]] {
  const outline: MillVertex[] = [];
  const cornerArtifacts: MillVertex[][] = [];
  const fdir = ctx.fabDirections[n];
  let testFirst = true;

  for (const rv of [...verts]) {
    if (rv.regionCount === 2 && rv.blockCount === 2) continue; // redundant
    if (rv.blockCount === 0) continue; // redundant
    if (rv.ind[0] < 0 || rv.ind[0] > ctx.dim) continue; // out of bounds
    if (rv.ind[1] < 0 || rv.ind[1] > ctx.dim) continue;

    const ind = insertAxis(
      [rv.ind[0], rv.ind[1]],
      ctx.sax,
      (ctx.dim - 1) * (1 - fdir) + (2 * fdir - 1) * layNum,
    );
    const add = [0, 0, 0];
    add[ctx.sax] = 1 - fdir;
    const iPt = getIndex(ind, add, ctx.dim);
    let pt = getVertex(iPt, ctx.jverts);

    // move vertex according to boundary condition
    const offVecs: Vec3[] = [];
    if (rv.blockCount === 1) {
      const nind = argwhereFirst(rv.neighbors, 1)!;
      offVecs.push(vScale(neighborVectors[nind[0]][nind[1]], -1));
    }
    if (rv.regionCount === 1 && rv.freeCount !== 3) {
      const nind = argwhereFirst(rv.neighbors, 0)!;
      offVecs.push(neighborVectors[nind[0]][nind[1]]);
      if (rv.flatNeighborValues.some((v) => v === -2)) {
        const nind2 = argwhereFirst(rv.neighborValues, -2)!;
        offVecs.push(neighborVectors[nind2[0]][nind2[1]]);
      }
    }
    let offVec: Vec3 = [0, 0, 0];
    if (offVecs.length > 0) {
      for (const v of offVecs) offVec = vAdd(offVec, v);
      offVec = vScale(offVec, 1 / offVecs.length);
    }

    // rounded outer corner?
    let rounded = false;
    if (rv.regionCount === 3) {
      for (let n2 = 0; n2 < ctx.noc; n2++) {
        if (n2 === n) continue;
        const cnt = rv.flatNeighborValues.filter((v) => v === n2).length;
        if (cnt === 3) rounded = true;
        if (cnt === 2) {
          const dia1 = rv.neighborValues[0][0] === rv.neighborValues[1][1];
          const dia2 = rv.neighborValues[0][1] === rv.neighborValues[1][0];
          if (dia1 || dia2) rounded = true;
        }
      }
    }

    if (rounded) {
      const nind = argwhereFirst(rv.neighbors, 1)!;
      const offVecA = vScale(neighborVectorsA[nind[0]][nind[1]], -1);
      const offVecB = vScale(neighborVectorsB[nind[0]][nind[1]], -1);
      const le2 =
        Math.sqrt(
          Math.pow(2 * vNorm(vAdd(offVecA, offVecB)), 2) - Math.pow(2 * ctx.vrad, 2),
        ) - vNorm(offVecA);
      const offVecA2 = setVectorLength(offVecA, le2);
      const offVecB2 = setVectorLength(offVecB, le2);

      const pt1 = vAdd(pt, offVecA, vScale(offVecB2, -1));
      const pt2 = vAdd(pt, offVecB, vScale(offVecA2, -1));
      let pts: Vec3[] = [pt1, pt2];
      const ctr = vAdd(pt, vScale(offVecA, -1), vScale(offVecB, -1));

      if (outline.length > 0) {
        const ppt = outline[outline.length - 1].pt;
        const v1 = vSub(pt1, ppt);
        const v2 = vSub(pt2, ppt);
        const ang1 = angleBetween(v1, offVecB);
        const ang2 = angleBetween(v2, offVecB);
        if (ang1 > ang2) pts = [pt2, pt1];
      }
      outline.push(new MillVertex(pts[0], { isArc: true, arcCtr: ctr }));
      outline.push(new MillVertex(pts[1], { isArc: true, arcCtr: ctr }));

      // extreme case: corner very rounded, material left uncut
      const dist = vNorm(vSub(pt, ctr));
      if (dist > ctx.vdia && layNum < ctx.dim - 1) {
        const artifact: MillVertex[] = [];
        const v0 = vScale(normalize(vSub(vAdd(pt, offVec), pts[0])), ctx.vdia);
        const v1 = vScale(normalize(vSub(vAdd(pt, offVec), pts[1])), ctx.vdia);
        let vp = vScale(normalize(vSub(pts[1], pts[0])), ctx.vrad);
        const pts3: Vec3[] = [
          vAdd(pts[0], vScale(vp, -1), v0),
          vAdd(pt, offVec, offVec),
          vAdd(pts[1], vp, v1),
        ];
        while (vNorm(vSub(pts3[2], pts3[0])) > ctx.vdia) {
          pts3[0] = vAdd(pts3[0], vp);
          pts3[1] = vSub(pts3[1], offVec);
          pts3[2] = vSub(pts3[2], vp);
          for (let i = 0; i < 3; i++) artifact.push(new MillVertex(pts3[i]));
          pts3.reverse();
          vp = vScale(vp, -1);
        }
        if (artifact.length > 0) cornerArtifacts.push(artifact);
      }
    } else {
      pt = vAdd(pt, offVec);
      outline.push(new MillVertex(pt));
    }

    if (outline.length > 2 && outline[0].isArc && testFirst) {
      const npt = outline[2].pt;
      const d1 = vNorm(vSub(outline[0].pt, npt));
      const d2 = vNorm(vSub(outline[1].pt, npt));
      if (d1 < d2) {
        const tmp = outline[0];
        outline[0] = outline[1];
        outline[1] = tmp;
      }
      testFirst = false;
    }
  }
  return [outline, cornerArtifacts];
}

/** Port of rough_milling_path. */
function roughMillingPath(
  ctx: MillContext,
  roughPixs: RoughPixel[],
  layNum: number,
  n: number,
): MillVertex[][] {
  const mvertices: MillVertex[][] = [];
  const ax = ctx.sax;
  const dir = ctx.fabDirections[n];
  const axes = [0, 1, 2].filter((a) => a !== ax);
  // NOTE: the original indexes 2D arrays with dir_ax = axes[0] (a 3D axis id
  // that happens to be 0 or 1); replicated as-is.
  const dirAx = axes[0];

  const fabDia = ctx.vdia * ctx.ratio; // effective bit diameter in mm (fab.dia)
  const lanes = 2 + Math.ceil((ctx.realTimDims[axes[1]] / ctx.dim - 2 * fabDia) / fabDia);
  let laneWidth = (ctx.voxelSizes[axes[1]] - ctx.vdia) / (lanes - 1);
  const ratio2 = vNorm(ctx.posVecs[axes[1]]) / ctx.voxelSizes[axes[1]];
  const vVrad = ctx.vrad * ratio2;
  laneWidth = laneWidth * ratio2;

  const dirVec = normalize(ctx.posVecs[axes[0]]);
  const offVec = normalize(ctx.posVecs[axes[1]]);

  for (const pix of roughPixs) {
    const mverts: MillVertex[] = [];
    if (pix.outside) continue;
    if (lanes <= 2) {
      if (pix.neighbors[0][0] === 1 && pix.neighbors[0][1] === 1) continue;
      if (pix.neighbors[1][0] === 1 && pix.neighbors[1][1] === 1) continue;
    }
    let pixEnd = pix;

    // check that there is no previous same
    const prevInd = pix.indAbs.slice();
    prevInd[dirAx] -= 1;
    let found = false;
    for (const pix2 of roughPixs) {
      if (pix2.outside) continue;
      if (pix2.indAbs[0] === prevInd[0] && pix2.indAbs[1] === prevInd[1]) {
        if (
          pix.neighbors[1][0] === pix2.neighbors[1][0] &&
          pix.neighbors[1][1] === pix2.neighbors[1][1]
        ) {
          found = true;
          break;
        }
      }
    }
    if (found) continue;

    // find next same
    for (let i = 0; i < ctx.dim; i++) {
      const nind2 = pix.indAbs.slice();
      nind2[0] += i;
      found = false;
      for (const pix2 of roughPixs) {
        if (pix2.outside) continue;
        if (pix2.indAbs[0] === nind2[0] && pix2.indAbs[1] === nind2[1]) {
          if (
            pix.neighbors[1][0] === pix2.neighbors[1][0] &&
            pix.neighbors[1][1] === pix2.neighbors[1][1]
          ) {
            found = true;
            pixEnd = pix2;
            break;
          }
        }
      }
      if (!found) break;
    }

    // start
    let ind = insertAxis(
      [pix.indAbs[0], pix.indAbs[1]],
      ax,
      (ctx.dim - 1) * (1 - dir) + (2 * dir - 1) * layNum,
    );
    let add = [0, 0, 0];
    add[ax] = 1 - dir;
    let pt1 = getVertex(getIndex(ind, add, ctx.dim), ctx.jverts);
    // end
    ind = insertAxis(
      [pixEnd.indAbs[0], pixEnd.indAbs[1]],
      ax,
      (ctx.dim - 1) * (1 - dir) + (2 * dir - 1) * layNum,
    );
    add = [0, 0, 0];
    add[ax] = 1 - dir;
    add[dirAx] = 1;
    let pt2 = getVertex(getIndex(ind, add, ctx.dim), ctx.jverts);

    const dirAdd1 = vScale(dirVec, pix.neighbors[dirAx][0] * 2.5 * ctx.vrad);
    const dirAdd2 = vScale(dirVec, -pixEnd.neighbors[dirAx][1] * 2.5 * ctx.vrad);

    pt1 = vAdd(pt1, vScale(offVec, vVrad), dirAdd1);
    pt2 = vAdd(pt2, vScale(offVec, vVrad), dirAdd2);
    for (let i = 0; i < lanes; i++) {
      if (pix.neighbors[1][0] === 1 && i === 0) continue;
      if (pix.neighbors[1][1] === 1 && i === lanes - 1) continue;
      const ptA = vAdd(pt1, vScale(offVec, laneWidth * i));
      const ptB = vAdd(pt2, vScale(offVec, laneWidth * i));
      const pts = i % 2 === 1 ? [ptB, ptA] : [ptA, ptB];
      for (const pt of pts) mverts.push(new MillVertex(pt));
    }
    mvertices.push(mverts);
  }
  return mvertices;
}

/** Port of edge_milling_path (oblique joints). */
function edgeMillingPath(ctx: MillContext, layNum: number, n: number): MillVertex[] {
  let mverts: MillVertex[] = [];
  if (ctx.fixedSides[n].length !== 1 || ctx.fixedSides[n][0].ax === ctx.sax) return mverts;

  const ax = ctx.fixedSides[n][0].ax;
  const dir = ctx.fixedSides[n][0].dir;
  const oax = [0, 1, 2].filter((a) => a !== ctx.sax && a !== ax)[0];
  const fdir = ctx.fabDirections[n];

  // check that the part is not removed anyway
  const ind0 = [0, 0, 0];
  ind0[ax] = (1 - dir) * (ctx.dim - 1);
  ind0[ctx.sax] = fdir * (ctx.dim - 1);
  let free = true;
  for (let i = 0; i < ctx.dim; i++) {
    ind0[oax] = i;
    if (Math.trunc(ctx.voxelMatrix[ind0[0]][ind0[1]][ind0[2]]) === n) {
      free = false;
      break;
    }
  }
  if (free) return mverts;

  const ind = [0, 0, 0];
  const add = [0, 0, 0];
  ind[ax] = (1 - dir) * ctx.dim;
  ind[ctx.sax] = ctx.dim * (1 - fdir) + (2 * fdir - 1) * layNum;
  let pt0 = getVertex(getIndex(ind, add, ctx.dim), ctx.jverts);
  ind[oax] = ctx.dim;
  const pt1raw = getVertex(getIndex(ind, add, ctx.dim), ctx.jverts);

  const dirVec = normalize(vSub(pt0, pt1raw));
  const saxVec: Vec3 = [0, 0, 0];
  saxVec[ctx.sax] = 2 * fdir - 1;
  let offVec = rotateVectorAroundAxis(dirVec, saxVec, Math.PI / 2);
  offVec = vScale(offVec, (2 * dir - 1) * ctx.vrad);
  pt0 = vAdd(pt0, offVec);
  const pt1 = vAdd(pt1raw, offVec);
  mverts = [new MillVertex(pt0), new MillVertex(pt1)];
  return mverts;
}

/** Port of get_segment_proportions. */
function getSegmentProportions(outline: MillVertex[]): number[] {
  let olen = 0;
  const slens: number[] = [];
  for (let i = 1; i < outline.length; i++) {
    const dist = vNorm(vSub(outline[i].pt, outline[i - 1].pt));
    slens.push(dist);
    olen += dist;
  }
  let olen2 = 0;
  const sprops = [0.0];
  for (const slen of slens) {
    olen2 += slen;
    sprops.push(olen2 / olen);
  }
  return sprops;
}

/** Port of get_layered_vertices. Returns [displayPts, millVerts]. */
function getLayeredVertices(
  ctx: MillContext,
  outline: MillVertex[],
  n: number,
  layNum: number,
  noZ: number,
  dep: number,
): [number[], MillVertex[]] {
  const verts: number[] = [];
  const mverts: MillVertex[] = [];
  const fdir = ctx.fabDirections[n];
  const sax = ctx.sax;

  const startVert: Vec3 = [outline[0].x, outline[0].y, outline[0].z];
  const safeHeight =
    outline[0].pt[sax] - (2 * fdir - 1) * (layNum * ctx.voxelSizes[sax] + 2 * dep);
  startVert[sax] = safeHeight;
  mverts.push(new MillVertex(startVert, { isTra: true }));
  verts.push(...startVert);
  if (layNum !== 0) {
    const startVert2: Vec3 = [outline[0].x, outline[0].y, outline[0].z];
    startVert2[sax] = outline[0].pt[sax] - (2 * fdir - 1) * dep;
    mverts.push(new MillVertex(startVert2, { isTra: true }));
    verts.push(...startVert2);
  }

  const stn = layNum === 0 ? 0 : 1;
  let enn: number;
  if (layNum === ctx.dim - 1 && sax !== ctx.fixedSides[n][0].ax) enn = noZ + 2;
  else enn = noZ + 1;
  let segProps: number[];
  if (ctx.incremental) {
    enn += 1;
    segProps = getSegmentProportions(outline);
  } else {
    segProps = Array(outline.length).fill(1.0);
  }

  for (let num = stn; num < enn; num++) {
    if (ctx.incremental && num === enn - 1) segProps = Array(outline.length).fill(0.0);
    for (let i = 0; i < outline.length; i++) {
      const mv = outline[i];
      const sp = segProps[i];
      const pt: Vec3 = [mv.x, mv.y, mv.z];
      pt[sax] += (2 * fdir - 1) * (num - 1 + sp) * dep;
      let ctr: Vec3 | null = null;
      if (mv.isArc) {
        ctr = [mv.arcCtr[0], mv.arcCtr[1], mv.arcCtr[2]];
        ctr[sax] += (2 * fdir - 1) * (num - 1 + sp) * dep;
        mverts.push(new MillVertex(pt, { isArc: true, arcCtr: ctr }));
      } else {
        mverts.push(new MillVertex(pt));
      }
      const pmv = i > 0 ? outline[i - 1] : null;
      if (pmv && connectedArc(mv, pmv) && ctr) {
        const ppt: Vec3 = [pmv.x, pmv.y, pmv.z];
        ppt[sax] += (2 * fdir - 1) * (num - 1 + sp) * dep;
        const pctr: Vec3 = [pmv.arcCtr[0], pmv.arcCtr[1], pmv.arcCtr[2]];
        pctr[sax] += (2 * fdir - 1) * (num - 1 + sp) * dep;
        const pts = arcPoints(ppt, pt, pctr, ctr, sax, (5 * Math.PI) / 180);
        for (const apt of pts) verts.push(...apt);
      } else {
        verts.push(...pt);
      }
    }
    outline.reverse();
  }

  const endVert: Vec3 = [outline[0].x, outline[0].y, outline[0].z];
  endVert[sax] = safeHeight;
  mverts.push(new MillVertex(endVert, { isTra: true }));
  verts.push(...endVert);
  return [verts, mverts];
}

/** Port of get_milling_end_points. */
function getMillingEndPoints(ctx: MillContext, n: number, lastZ: number): [number[], MillVertex[]] {
  const verts: number[] = [];
  const mverts: MillVertex[] = [];
  const fdir = ctx.fabDirections[n];
  const originVert: Vec3 = [0, 0, 0];
  originVert[ctx.sax] = lastZ;
  const extraZ = 15 / ctx.ratio;
  const aboveOrigin: Vec3 = [0, 0, 0];
  aboveOrigin[ctx.sax] = lastZ - (2 * fdir - 1) * extraZ;
  mverts.push(new MillVertex(originVert, { isTra: true }));
  mverts.push(new MillVertex(aboveOrigin, { isTra: true }));
  verts.push(...originVert, ...aboveOrigin);
  return [verts, mverts];
}

/** Port of milling_path_vertices: full path for component n. */
export function millingPathVertices(
  ctx: MillContext,
  n: number,
): { displayPoints: Float32Array; millVertices: MillVertex[] } {
  const vertices: number[] = [];
  const millingVertices: MillVertex[] = [];

  // depth constants
  const noZ = Math.trunc((ctx.ratio * ctx.voxelSizes[ctx.sax]) / ctx.fabDep);
  const dep = ctx.voxelSizes[ctx.sax] / noZ;

  // axes and neighbor vectors
  const axes = [0, 1, 2].filter((a) => a !== ctx.sax);
  const le = ctx.vrad / Math.cos(Math.abs((-ctx.ang * Math.PI) / 180));
  const dirVec = vScale(normalize(ctx.posVecs[axes[0]]), le);
  const offVec = vScale(normalize(ctx.posVecs[axes[1]]), le);
  const neighborVectors: Vec3[][] = [];
  const neighborVectorsA: Vec3[][] = [];
  const neighborVectorsB: Vec3[][] = [];
  for (let x = -1; x < 2; x += 2) {
    const temp: Vec3[] = [];
    const tempa: Vec3[] = [];
    const tempb: Vec3[] = [];
    for (let y = -1; y < 2; y += 2) {
      temp.push(vAdd(vScale(dirVec, x), vScale(offVec, y)));
      tempa.push(vScale(dirVec, x));
      tempb.push(vScale(offVec, y));
    }
    neighborVectors.push(temp);
    neighborVectorsA.push(tempa);
    neighborVectorsB.push(tempb);
  }

  for (let layNum = 0; layNum < ctx.dim; layNum++) {
    let layMat = layerMatFromCube(ctx, layNum, n);
    const [paddedMat, padLoc] = padLayerMatWithFixedSides(ctx, layMat);
    layMat = paddedMat;
    const orgLayMat = layMat.map((r) => r.slice());

    for (let regNum = 0; regNum < ctx.dim * ctx.dim; regNum++) {
      // first index != -1 and != n
      let first: [number, number] | null = null;
      outer: for (let i = 0; i < layMat.length; i++) {
        for (let j = 0; j < layMat[0].length; j++) {
          if (layMat[i][j] !== -1 && layMat[i][j] !== n) {
            first = [i, j];
            break outer;
          }
        }
      }
      if (!first) break;
      const regInds = getDiffNeighbors(layMat, [first], n);

      // oblique edge path
      if (Math.abs(ctx.ang) > 1) {
        const edgePath = edgeMillingPath(ctx, layNum, n);
        if (edgePath.length > 0) {
          const [verts2, mverts2] = getLayeredVertices(ctx, edgePath, n, layNum, noZ, dep);
          vertices.push(...verts2);
          millingVertices.push(...mverts2);
        }
      }

      // rough milling
      const roughInds = regInds.map((ind) => new RoughPixel(ind, layMat, padLoc, ctx.dim, n));
      const roughPaths = roughMillingPath(ctx, roughInds, layNum, n);
      for (const roughPath of roughPaths) {
        if (roughPath.length > 0) {
          const [verts2, mverts2] = getLayeredVertices(ctx, roughPath, n, layNum, noZ, dep);
          vertices.push(...verts2);
          millingVertices.push(...mverts2);
        }
      }

      // overwrite detected region
      for (const regInd of regInds) layMat[regInd[0]][regInd[1]] = n;

      // outline vertices
      let regVerts = getRegionOutlineVertices(regInds, layMat, orgLayMat, padLoc);

      for (let islNum = 0; islNum < 10; islNum++) {
        if (regVerts.length === 0) break;
        regVerts = setStartingVert(regVerts);
        const [regOrdVerts, remaining, closed] = getSublistOfOrderedVerts(regVerts);
        regVerts = remaining;
        const [outline, cornerArtifacts] = offsetVerts(
          ctx,
          neighborVectors,
          neighborVectorsA,
          neighborVectorsB,
          regOrdVerts,
          layNum,
          n,
        );
        if (regOrdVerts.length > 1 && outline.length > 0) {
          if (closed) outline.push(new MillVertex(outline[0].pt));
          const [verts2, mverts2] = getLayeredVertices(ctx, outline, n, layNum, noZ, dep);
          vertices.push(...verts2);
          millingVertices.push(...mverts2);
        }
        for (const artifact of cornerArtifacts) {
          const [verts2, mverts2] = getLayeredVertices(ctx, artifact, n, layNum, noZ, dep);
          vertices.push(...verts2);
          millingVertices.push(...mverts2);
        }
      }
    }
  }

  if (millingVertices.length > 0) {
    const [endVerts, endMverts] = getMillingEndPoints(
      ctx,
      n,
      millingVertices[millingVertices.length - 1].pt[ctx.sax],
    );
    vertices.push(...endVerts);
    millingVertices.push(...endMverts);
  }

  return { displayPoints: new Float32Array(vertices), millVertices: millingVertices };
}
