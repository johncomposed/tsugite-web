/**
 * Index builders — port of the index-generation functions in Geometries.py.
 * All functions return LOCAL lattice indices (no vertex-copy offset); the
 * renderer picks which axis vertex copy to expand them against.
 */
import { FixedSide } from '../model/fixedSides';
import { insertAxis, type Axis, type Mat3 } from '../model/types';
import { getCornerIndices, getIndex } from './vertexGrid';

/** Port of face_neighbors. */
export function faceNeighbors(
  mat: Mat3,
  ind: readonly number[],
  ax: Axis,
  n: number,
  fixedSides: FixedSide[],
): [number, (number | null)[]] {
  const values: (number | null)[] = [];
  const dim = mat.length;
  for (let i = 0; i < 2; i++) {
    let val: number | null = null;
    const ind2 = [...ind];
    ind2[ax] -= i;
    const inBounds = ind2.every((v) => v >= 0 && v < dim);
    if (inBounds) {
      val = mat[ind2[0]][ind2[1]][ind2[2]];
    } else {
      for (const side of fixedSides) {
        const ind3 = ind2.filter((_, a) => a !== side.ax);
        if (!ind3.every((v) => v >= 0 && v < dim)) continue;
        if (ind2[side.ax] < 0 && side.dir === 0) val = n;
        if (ind2[side.ax] >= dim && side.dir === 1) val = n;
      }
    }
    values.push(val);
  }
  const count = values.filter((v) => v === n).length;
  return [count, values];
}

export interface FaceIndexSets {
  /** Quads not on component ends (shown neutral). */
  notEnds: number[];
  /** Quads on component ends (shown with end-grain texture). */
  ends: number[];
}

/** Port of joint_face_indices (component base emitted once, not d times). */
export function jointFaceIndices(
  mat: Mat3,
  fixedSides: FixedSide[],
  n: number,
  dim: number,
  componentFixedSides: FixedSide[],
): FaceIndexSets {
  const indices: number[] = [];
  const indicesEnds: number[] = [];
  const d = dim + 1;
  for (let i = 0; i < d; i++) {
    for (let j = 0; j < d; j++) {
      for (let k = 0; k < d; k++) {
        const ind = [i, j, k];
        for (let ax = 0 as Axis; ax < 3; ax++) {
          const testInd = ind.filter((_, a) => a !== ax);
          if (testInd.some((v) => v === dim)) continue;
          const [cnt] = faceNeighbors(mat, ind, ax as Axis, n, fixedSides);
          if (cnt !== 1) continue;
          for (let x = 0; x < 2; x++) {
            for (let y = 0; y < 2; y++) {
              const add = insertAxis([x, Math.abs(y - x)], ax as Axis, 0);
              const index = getIndex(ind, add, dim);
              const isEnd = fixedSides.length > 0 && fixedSides[0].ax === ax;
              if (isEnd) indicesEnds.push(index);
              else indices.push(index);
            }
          }
        }
      }
    }
  }
  // Faces of component base
  const start = d * d * d;
  for (const side of fixedSides) {
    const [a1, b1, c1, d1] = getCornerIndices(side.ax, side.dir, dim);
    const step = componentFixedSides.length === 2 ? 1 : 2;
    const off = 24 * side.ax + 12 * side.dir + 4 * step;
    const [a0, b0, c0, d0] = [start + off, start + off + 1, start + off + 2, start + off + 3];
    indicesEnds.push(a0, b0, d0, c0); // bottom face
    indices.push(a0, b0, b1, a1);
    indices.push(b0, d0, d1, b1);
    indices.push(d0, c0, c1, d1);
    indices.push(c0, a0, a1, c1);
  }
  return { notEnds: indices, ends: indicesEnds };
}

/** Port of line_neighbors. */
export function lineNeighbors(
  voxelMatrix: Mat3,
  allFixedSides: FixedSide[][],
  dim: number,
  ind: readonly number[],
  ax: Axis,
  n: number,
): [number, (number | null)[]] {
  const values: (number | null)[] = [];
  for (let i = -1; i < 1; i++) {
    for (let j = -1; j < 1; j++) {
      let val: number | null = null;
      const add = insertAxis([i, j], ax, 0);
      const ind2 = [ind[0] + add[0], ind[1] + add[1], ind[2] + add[2]];
      const inBounds = ind2.every((v) => v >= 0 && v < dim);
      if (inBounds) {
        val = voxelMatrix[ind2[0]][ind2[1]][ind2[2]];
      } else {
        for (let n2 = 0; n2 < allFixedSides.length; n2++) {
          for (const side of allFixedSides[n2]) {
            const ind3 = ind2.filter((_, a) => a !== side.ax);
            if (!ind3.every((v) => v >= 0 && v < dim)) continue;
            if (ind2[side.ax] < 0 && side.dir === 0) val = n2;
            if (ind2[side.ax] >= dim && side.dir === 1) val = n2;
          }
        }
      }
      values.push(val);
    }
  }
  const count = values.filter((v) => v === n).length;
  return [count, values];
}

/** Port of joint_line_indices → GL_LINES pairs. */
export function jointLineIndices(
  voxelMatrix: Mat3,
  allFixedSides: FixedSide[][],
  n: number,
  dim: number,
): number[] {
  const fixedSides = allFixedSides[n];
  const d = dim + 1;
  const indices: number[] = [];
  for (let i = 0; i < d; i++) {
    for (let j = 0; j < d; j++) {
      for (let k = 0; k < d; k++) {
        const ind = [i, j, k];
        for (let ax = 0 as Axis; ax < 3; ax++) {
          if (ind[ax] === dim) continue;
          const [cnt, vals] = lineNeighbors(voxelMatrix, allFixedSides, dim, ind, ax as Axis, n);
          const diagonal = vals[0] === vals[3] || vals[1] === vals[2];
          if (cnt === 1 || cnt === 3 || (cnt === 2 && diagonal)) {
            const add = [0, 0, 0];
            add[ax] = 1;
            indices.push(getIndex(ind, [0, 0, 0], dim), getIndex(ind, add, dim));
          }
        }
      }
    }
  }
  // Outline of component base
  const start = d * d * d;
  for (const side of fixedSides) {
    const [a1, b1, c1, d1] = getCornerIndices(side.ax, side.dir, dim);
    const step = fixedSides.length === 2 ? 1 : 2;
    const off = 24 * side.ax + 12 * side.dir + 4 * step;
    const [a0, b0, c0, d0] = [start + off, start + off + 1, start + off + 2, start + off + 3];
    indices.push(a0, b0, b0, d0, d0, c0, c0, a0);
    indices.push(a0, a1, b0, b1, c0, c1, d0, d1);
  }
  return indices;
}

/** Port of open_line_indices → GL_LINES pairs (shown when joint fully open). */
export function openLineIndices(n: number, noc: number, sax: Axis, dim: number): number[] {
  const indices: number[] = [];
  let dirs = [0, 1];
  if (n === 0) dirs = [0];
  else if (n === noc - 1) dirs = [1];
  const d = dim + 1;
  const start = d * d * d;
  for (const dir of dirs) {
    const [a1, b1, c1, d1] = getCornerIndices(sax, dir, dim);
    const off = 24 * sax + 12 * (1 - dir);
    const [a0, b0, c0, d0] = [start + off, start + off + 1, start + off + 2, start + off + 3];
    indices.push(a0, a1, b0, b1, c0, c1, d0, d1);
  }
  return indices;
}

/** Port of chess_line_indices → GL_LINES pairs. */
export function chessLineIndices(chessVerts: number[][], sax: Axis, dim: number): number[] {
  const indices: number[] = [];
  for (const vert of chessVerts) {
    const add = [0, 0, 0];
    const st = getIndex(vert, add, dim);
    add[sax] = 1;
    const en = getIndex(vert, add, dim);
    indices.push(st, en);
  }
  return indices;
}

/** Port of break_line_indices → GL_LINES (evaluation emits pairs). */
export function breakLineIndices(breakInds: number[][], dim: number): number[] {
  return breakInds.map((ind3d) => getIndex(ind3d, [0, 0, 0], dim));
}

/** Port of component_outline_indices → GL_LINES pairs. */
export function componentOutlineIndices(
  fixedSides: FixedSide[],
  dim: number,
): number[] {
  const d = dim + 1;
  const indices: number[] = [];
  const start = d * d * d;
  const ax = fixedSides[0].ax;
  const dir = fixedSides[0].dir;
  const step = fixedSides.length === 2 ? 1 : 2;
  const off = 24 * ax + 12 * dir + 4 * step;
  const [a0, b0, c0, d0] = [start + off, start + off + 1, start + off + 2, start + off + 3];
  let a1: number, b1: number, c1: number, d1: number;
  if (fixedSides.length === 2) {
    const off2 = 24 * fixedSides[1].ax + 12 * fixedSides[1].dir + 4 * step;
    [a1, b1, c1, d1] = [start + off2, start + off2 + 1, start + off2 + 2, start + off2 + 3];
  } else {
    [a1, b1, c1, d1] = getCornerIndices(ax, 1 - dir, dim);
  }
  indices.push(a0, b0, b0, d0, d0, c0, c0, a0);
  indices.push(a0, a1, b0, b1, c0, c1, d0, d1);
  indices.push(a1, b1, b1, d1, d1, c1, c1, a1);
  return indices;
}

export interface TopFaceSets {
  /** All non-top faces (pick: component body). */
  notTops: number[];
  /** Top faces, mos*4 indices per (i,j) cell, -1 placeholders. */
  tops: number[];
  /** Number of pickable sides (1 for first/last component, else 2). */
  mos: number;
}

/** Port of joint_top_face_indices (used for picking/hover). */
export function jointTopFaceIndices(
  voxelMatrix: Mat3,
  fixedSides: FixedSide[],
  n: number,
  noc: number,
  sax: Axis,
  dim: number,
): TopFaceSets {
  let sdirs = [0, 1];
  if (n === 0) sdirs = [0];
  else if (n === noc - 1) sdirs = [1];
  const indices: number[] = [];
  const indicesTops: number[] = [];
  for (let ax = 0 as Axis; ax < 3; ax++) {
    for (let i = 0; i < dim; i++) {
      for (let j = 0; j < dim; j++) {
        let topCnt = 0;
        for (let k0 = 0; k0 < dim + 1; k0++) {
          const k = sdirs[0] === 0 ? dim - k0 : k0;
          const ind = insertAxis([i, j], ax as Axis, k) as number[];
          const [cnt] = faceNeighbors(voxelMatrix, ind, ax as Axis, n, fixedSides);
          let onFreeBase = false;
          if (ax === sax && ax !== fixedSides[0].ax && sdirs.length === 1) {
            const base = sdirs[0] * dim;
            if (ind[ax] === base) onFreeBase = true;
          }
          if (cnt !== 1 && !onFreeBase) continue;
          for (let x = 0; x < 2; x++) {
            for (let y = 0; y < 2; y++) {
              const add = insertAxis([x, Math.abs(y - x)], ax as Axis, 0);
              const index = getIndex(ind, add, dim);
              if (ax === sax && topCnt < 4 * sdirs.length) {
                indicesTops.push(index);
                topCnt++;
              } else {
                indices.push(index);
              }
            }
          }
        }
        if (topCnt < 4 * sdirs.length && ax === sax) {
          for (let k = 0; k < 4 * sdirs.length - topCnt; k++) indicesTops.push(-1);
        }
      }
    }
  }
  // Component base faces → body
  const d = dim + 1;
  const start = d * d * d;
  for (const side of fixedSides) {
    const [a1, b1, c1, d1] = getCornerIndices(side.ax, side.dir, dim);
    const step = fixedSides.length === 2 ? 1 : 2;
    const off = 24 * side.ax + 12 * side.dir + 4 * step;
    const [a0, b0, c0, d0] = [start + off, start + off + 1, start + off + 2, start + off + 3];
    indices.push(a0, b0, d0, c0);
    indices.push(a0, b0, b1, a1);
    indices.push(b0, d0, d1, b1);
    indices.push(d0, c0, c1, d1);
    indices.push(c0, a0, a1, c1);
  }
  return { notTops: indices, tops: indicesTops, mos: sdirs.length };
}

/** Port of arrow_indices: line pairs + triangle indices into arrowVertices. */
export function arrowIndices(slideDirs: [number, number][]): {
  lines: number[];
  faces: number[];
} {
  const lineIndices: number[] = [];
  const faceIndices: number[] = [];
  for (const [ax, dir] of slideDirs) {
    const start = 1 + 10 * ax + 5 * dir;
    lineIndices.push(0, start);
    faceIndices.push(start + 1, start + 2, start + 4);
    faceIndices.push(start + 1, start + 4, start + 3);
    faceIndices.push(start + 1, start + 2, start);
    faceIndices.push(start + 2, start + 4, start);
    faceIndices.push(start + 3, start + 4, start);
    faceIndices.push(start + 1, start + 3, start);
  }
  return { lines: lineIndices, faces: faceIndices };
}

/** Port of joint_selected_top_line_indices (outline of selected faces). */
export function jointSelectedTopLineIndices(
  faces: readonly (readonly [number, number])[],
  h: number,
  sax: Axis,
  dim: number,
): number[] {
  const indices: number[] = [];
  const otherAxes = [0, 1, 2].filter((a) => a !== sax);
  for (const face of faces) {
    const ind = insertAxis([Math.trunc(face[0]), Math.trunc(face[1])], sax, h) as number[];
    for (let i = 0; i < 2; i++) {
      const ax = otherAxes[i];
      for (let j = 0; j < 2; j++) {
        const nface = [face[0], face[1]];
        nface[i] += 2 * j - 1;
        if (nface[0] >= 0 && nface[1] >= 0 && nface[0] < dim && nface[1] < dim) {
          const dup = faces.some((f2) => f2[0] === nface[0] && f2[1] === nface[1]);
          if (dup) continue;
        }
        for (let k = 0; k < 2; k++) {
          const add = [k, k, k];
          add[ax] = j;
          add[sax] = 0;
          indices.push(getIndex(ind, add, dim));
        }
      }
    }
  }
  return indices;
}
