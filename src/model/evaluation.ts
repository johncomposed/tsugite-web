/**
 * Port of Evaluation.py — real-time joint validity analysis.
 *
 * Conventions kept from the original: voxel matrices hold -1 for
 * empty/padding and 0..noc-1 for component ids; 2D "layer" matrices are the
 * dim x dim slice perpendicular to an axis.
 */
import { FixedSide } from './fixedSides';
import { RegionVertex } from './regionVertex';
import {
  copyMat3,
  insertAxis,
  makeMat3,
  shape3,
  type Axis,
  type Mat2,
  type Mat3,
  type Vec3,
} from './types';

export interface EvalParams {
  fixedSides: FixedSide[][];
  sax: Axis;
  noc: number;
  dim: number;
}

/** [ax, dir] sliding direction. */
export type Slide = [number, number];

// ---------------------------------------------------------------------------
// Matrix helpers

/** Pad one axis of a 3D matrix (numpy np.pad semantics, sequential). */
function padAxis(mat: Mat3, ax: Axis, before: number, after: number, val: number): Mat3 {
  const [sx, sy, sz] = shape3(mat);
  const dims: Vec3 = [sx, sy, sz];
  dims[ax] += before + after;
  const out: Mat3 = [];
  for (let i = 0; i < dims[0]; i++) {
    out.push([]);
    for (let j = 0; j < dims[1]; j++) {
      out[i].push(Array<number>(dims[2]).fill(val));
    }
  }
  for (let i = 0; i < sx; i++) {
    for (let j = 0; j < sy; j++) {
      for (let k = 0; k < sz; k++) {
        const ind: Vec3 = [i, j, k];
        ind[ax] += before;
        out[ind[0]][ind[1]][ind[2]] = mat[i][j][k];
      }
    }
  }
  return out;
}

/** Port of add_fixed_sides: pad with component ids at fixed sides, -1 elsewhere. */
export function addFixedSides(mat: Mat3, fixedSides: FixedSide[][], add = 0): Mat3 {
  const dim = mat.length;
  const padLoc: [number, number][] = [
    [0, 0],
    [0, 0],
    [0, 0],
  ];
  const padVal: [number, number][] = [
    [-1, -1],
    [-1, -1],
    [-1, -1],
  ];
  for (let n = 0; n < fixedSides.length; n++) {
    for (const side of fixedSides[n]) {
      padLoc[side.ax][side.dir] = 1;
      padVal[side.ax][side.dir] = n + add;
    }
  }
  // numpy pads axis by axis; each axis's new slabs are filled with that
  // axis's constant (overlapping corners end up with the later axis's value,
  // then get fixed below).
  let out = mat;
  for (let ax = 0 as Axis; ax < 3; ax++) {
    if (padLoc[ax][0] === 0 && padLoc[ax][1] === 0) continue;
    // numpy supports distinct before/after constants; emulate by padding
    // each side separately.
    if (padLoc[ax][0] === 1) out = padAxis(out, ax as Axis, 1, 0, padVal[ax][0]);
    if (padLoc[ax][1] === 1) out = padAxis(out, ax as Axis, 0, 1, padVal[ax][1]);
  }
  // Take care of corners (set edges between two fixed-side slabs to -1)
  const outShape = shape3(out);
  for (const fixedSides1 of fixedSides) {
    for (const fixedSides2 of fixedSides) {
      for (const side of fixedSides1) {
        for (const side2 of fixedSides2) {
          if (side.ax === side2.ax) continue;
          for (let i = 0; i < dim + 2; i++) {
            const ind: Vec3 = [i, i, i];
            ind[side.ax] = side.dir * (outShape[side.ax] - 1);
            ind[side2.ax] = side2.dir * (outShape[side2.ax] - 1);
            if (ind[0] >= outShape[0] || ind[1] >= outShape[1] || ind[2] >= outShape[2]) continue;
            out[ind[0]][ind[1]][ind[2]] = -1;
          }
        }
      }
    }
  }
  return out;
}

export function layerMat(mat3d: Mat3, ax: Axis, dim: number, layNum: number): Mat2 {
  const mat2d: Mat2 = [];
  for (let i = 0; i < dim; i++) {
    mat2d.push([]);
    for (let j = 0; j < dim; j++) {
      const [x, y, z] = insertAxis([i, j], ax, layNum);
      mat2d[i].push(Math.trunc(mat3d[x][y][z]));
    }
  }
  return mat2d;
}

// ---------------------------------------------------------------------------
// Connectivity

function getNeighbors3(mat: Mat3, ind: Vec3): [Vec3[], number[]] {
  const indices: Vec3[] = [];
  const values: number[] = [];
  const dims = shape3(mat);
  for (let m = 0; m < 3; m++) {
    for (let step = -1; step < 2; step += 2) {
      const ind0: Vec3 = [...ind];
      ind0[m] = ind[m] + step;
      if (ind0[m] < 0 || ind0[m] >= dims[m]) continue;
      indices.push(ind0);
      values.push(mat[ind0[0]][ind0[1]][ind0[2]]);
    }
  }
  return [indices, values];
}

/** Port of get_all_same_connected (flood fill of equal values). */
function getAllSameConnected(mat: Mat3, start: Vec3): Vec3[] {
  const val = mat[start[0]][start[1]][start[2]];
  const seen = new Set<string>([start.join(',')]);
  const queue: Vec3[] = [start];
  const result: Vec3[] = [start];
  while (queue.length > 0) {
    const ind = queue.pop()!;
    const [nInds, nVals] = getNeighbors3(mat, ind);
    for (let i = 0; i < nInds.length; i++) {
      if (nVals[i] !== val) continue;
      const key = nInds[i].join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push(nInds[i]);
      result.push(nInds[i]);
    }
  }
  return result;
}

/** Port of is_connected: all voxels with value n form one connected set. */
export function isConnected(mat: Mat3, n: number): boolean {
  let allSame = 0;
  let first: Vec3 | null = null;
  const dims = shape3(mat);
  for (let i = 0; i < dims[0]; i++) {
    for (let j = 0; j < dims[1]; j++) {
      for (let k = 0; k < dims[2]; k++) {
        if (mat[i][j][k] !== n) continue;
        allSame++;
        if (!first) first = [i, j, k];
      }
    }
  }
  if (allSame === 0 || !first) return false;
  return getAllSameConnected(mat, first).length === allSame;
}

/** Port of is_connected_to_fixed_side (unpadded matrix). */
export function isConnectedToFixedSide(
  startInds: Vec3[],
  mat: Mat3,
  fixedSides: FixedSide[],
): boolean {
  const d = mat.length;
  const val = mat[startInds[0][0]][startInds[0][1]][startInds[0][2]];
  const seen = new Set<string>(startInds.map((i) => i.join(',')));
  const queue = [...startInds];
  const touches = (ind: Vec3): boolean => {
    for (const side of fixedSides) {
      if (ind[side.ax] === 0 && side.dir === 0) return true;
      if (ind[side.ax] === d - 1 && side.dir === 1) return true;
    }
    return false;
  };
  while (queue.length > 0) {
    const ind = queue.pop()!;
    if (touches(ind)) return true;
    for (let ax = 0; ax < 3; ax++) {
      for (let step = -1; step < 2; step += 2) {
        const ind2: Vec3 = [...ind];
        ind2[ax] += step;
        if (ind2[ax] < 0 || ind2[ax] >= d) continue;
        if (mat[ind2[0]][ind2[1]][ind2[2]] !== val) continue;
        const key = ind2.join(',');
        if (seen.has(key)) continue;
        seen.add(key);
        queue.push(ind2);
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Sliding directions

/** Port of get_sliding_directions (on padded matrix). */
export function getSlidingDirections(mat: Mat3, noc: number): [Slide[][], number[]] {
  const slidingDirections: Slide[][] = [];
  const numberOfSlidingDirections: number[] = [];
  const dims = shape3(mat);
  for (let n = 0; n < noc; n++) {
    const matSliding: Slide[] = [];
    for (let ax = 0 as Axis; ax < 3; ax++) {
      const oax = [0, 1, 2].filter((a) => a !== ax);
      for (let dir = 0; dir < 2; dir++) {
        let slides = true;
        outer: for (let i = 0; i < dims[oax[0] as Axis]; i++) {
          for (let j = 0; j < dims[oax[1] as Axis]; j++) {
            let firstSame = false;
            for (let k0 = 0; k0 < dims[ax]; k0++) {
              const k = dir === 0 ? dims[ax] - k0 - 1 : k0;
              const [x, y, z] = insertAxis([i, j], ax as Axis, k);
              const val = mat[x][y][z];
              if (val === n) {
                firstSame = true;
                continue;
              }
              if (firstSame && val !== -1) {
                slides = false;
                break outer;
              }
            }
          }
        }
        if (slides) matSliding.push([ax, dir]);
      }
    }
    slidingDirections.push(matSliding);
    numberOfSlidingDirections.push(matSliding.length);
  }
  return [slidingDirections, numberOfSlidingDirections];
}

// ---------------------------------------------------------------------------
// Friction / contact

export interface AreaFace {
  ax: number;
  ind: number[]; // 3D face index
}

/** Port of get_friction_and_contact_areas. */
export function getFrictionAndContactAreas(
  mat: Mat3,
  slides: Slide[],
  fixedSides: FixedSide[][],
  n: number,
): [number, AreaFace[], number, AreaFace[]] {
  const dim = mat.length;
  if (slides.length === 0) return [-1, [], -1, []];
  let friction = 0;
  let contact = 0;
  const ffaces: AreaFace[] = [];
  const cfaces: AreaFace[] = [];
  const otherFixedSides: FixedSide[] = [];
  for (let n2 = 0; n2 < fixedSides.length; n2++) {
    if (n2 === n) continue;
    otherFixedSides.push(...fixedSides[n2]);
  }
  const badAxes = slides.map((s) => s[0]);
  const frictionAxes = [0, 1, 2].filter((ax) => !badAxes.includes(ax));
  // Browse voxels of n in C order (matches np.argwhere ordering)
  for (let i = 0; i < dim; i++) {
    for (let j = 0; j < dim; j++) {
      for (let k = 0; k < dim; k++) {
        if (mat[i][j][k] !== n) continue;
        const ind: Vec3 = [i, j, k];
        for (let ax = 0; ax < 3; ax++) {
          for (let dir = 0; dir < 2; dir++) {
            const nind: Vec3 = [...ind];
            nind[ax] += 2 * dir - 1;
            let cont = false;
            if (nind[ax] < 0) {
              if (new FixedSide(ax as Axis, 0).unique(otherFixedSides)) cont = true;
            } else if (nind[ax] >= dim) {
              if (new FixedSide(ax as Axis, 1).unique(otherFixedSides)) cont = true;
            } else if (mat[nind[0]][nind[1]][nind[2]] !== n) cont = true;
            if (!cont) continue;
            contact++;
            const find: number[] = [...ind];
            find[ax] += dir;
            cfaces.push({ ax, ind: find });
            if (frictionAxes.includes(ax)) {
              friction++;
              ffaces.push({ ax, ind: find });
            }
          }
        }
      }
    }
  }
  // Faces along each fixed side of this component
  for (const side of fixedSides[n]) {
    for (let i = 0; i < dim; i++) {
      for (let j = 0; j < dim; j++) {
        const axind = side.dir * (dim - 1);
        const nind = insertAxis([i, j], side.ax, axind);
        if (mat[nind[0]][nind[1]][nind[2]] === n) continue;
        contact++;
        const find: number[] = [...nind];
        find[side.ax] += side.dir;
        cfaces.push({ ax: side.ax, ind: find });
        if (frictionAxes.includes(side.ax)) {
          friction++;
          ffaces.push({ ax: side.ax, ind: find });
        }
      }
    }
  }
  return [friction, ffaces, contact, cfaces];
}

// ---------------------------------------------------------------------------
// Chessboard

/** Port of get_chessboard_vertics. */
export function getChessboardVertics(mat: Mat3, ax: Axis, n: number): [boolean, number[][]] {
  let chess = false;
  const dim = mat.length;
  const verts: number[][] = [];
  for (let i = 0; i < dim; i++) {
    for (let j = 0; j < dim; j++) {
      for (let k = 0; k < dim; k++) {
        const ind3d = [i, j, k];
        const ind2d = ind3d.slice();
        ind2d.splice(ax, 1);
        if (ind2d[0] < 1 || ind2d[1] < 1) continue;
        const neighbors: Mat2 = [];
        const flatNeighbors: number[] = [];
        for (let x = -1; x < 1; x++) {
          const temp: number[] = [];
          for (let y = -1; y < 1; y++) {
            const nind2 = [ind2d[0] + x, ind2d[1] + y];
            const nind = insertAxis([nind2[0], nind2[1]], ax, ind3d[ax]);
            const val = mat[nind[0]][nind[1]][nind[2]];
            temp.push(val);
            flatNeighbors.push(val);
          }
          neighbors.push(temp);
        }
        const cnt = flatNeighbors.filter((v) => v === n).length;
        if (cnt !== 2) continue;
        if (neighbors[0][1] === neighbors[1][0] && neighbors[0][0] === neighbors[1][1]) {
          chess = true;
          verts.push(ind3d);
        }
      }
    }
  }
  return [chess, verts];
}

// ---------------------------------------------------------------------------
// Fabricability

/** Port of is_fab_direction_ok. */
export function isFabDirectionOk(mat: Mat3, ax: Axis, n: number): [boolean, number] {
  let fabDir = 1;
  const dim = mat.length;
  for (let dir = 0; dir < 2; dir++) {
    let isOk = true;
    outer: for (let i = 0; i < dim; i++) {
      for (let j = 0; j < dim; j++) {
        let foundFirstSame = false;
        for (let k0 = 0; k0 < dim; k0++) {
          const k = dir === 0 ? dim - k0 - 1 : k0;
          const [x, y, z] = insertAxis([i, j], ax, k);
          const val = mat[x][y][z];
          if (val === n) {
            foundFirstSame = true;
            continue;
          }
          if (foundFirstSame) {
            isOk = false;
            break outer;
          }
        }
      }
    }
    if (isOk) {
      fabDir = dir;
      return [true, fabDir];
    }
  }
  return [false, fabDir];
}

// ---------------------------------------------------------------------------
// Breakable (grain direction) analysis

/** Port of get_same_neighbors_2d (region flood fill in a layer). */
export function getSameNeighbors2d(
  mat2: Mat2,
  inds: number[][],
  val: number,
): number[][] {
  const newInds = inds.map((i) => i.slice());
  for (const ind of newInds) {
    for (let ax = 0; ax < 2; ax++) {
      for (let dir = -1; dir < 2; dir += 2) {
        const ind2 = ind.slice();
        ind2[ax] += dir;
        const limit = ax === 0 ? mat2.length : mat2[0].length;
        if (ind2[ax] < 0 || ind2[ax] >= limit) continue;
        if (mat2[ind2[0]][ind2[1]] !== val) continue;
        const exists = newInds.some((i3) => i3[0] === ind2[0] && i3[1] === ind2[1]);
        if (!exists) newInds.push(ind2);
      }
    }
  }
  return newInds;
}

/** Port of is_connected_to_fixed_side_2d. */
function isConnectedToFixedSide2d(
  inds: number[][],
  fixedSides: FixedSide[],
  ax: Axis,
  dim: number,
): boolean {
  for (const side of fixedSides) {
    const fax3 = [0, 0, 0];
    fax3[side.ax] = 1;
    fax3.splice(ax, 1);
    const fax2d = fax3.indexOf(1);
    if (fax2d === -1) continue; // side axis == layer axis
    for (const ind of inds) {
      if (ind[fax2d] === side.dir * (dim - 1)) return true;
    }
  }
  return false;
}

/** Port of Evaluation.py get_neighbors_2d. */
function getNeighbors2d(
  ind: number[],
  regInds: number[][],
  layMat: Mat2,
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
          type = 0; // in region
          break;
        }
      }
      if (type !== 0) {
        const oob =
          nind[0] < 0 || nind[1] < 0 || nind[0] >= layMat.length || nind[1] >= layMat[0].length;
        if (oob) val = -1;
        type = 1;
      }
      if (val === null) val = layMat[nind[0]][nind[1]];
      temp.push(type);
      temp2.push(val);
    }
    inOut.push(temp);
    values.push(temp2);
  }
  return [inOut, values];
}

/** Port of Evaluation.py get_region_outline. */
function getRegionOutline(regInds: number[][], layMat: Mat2): RegionVertex[] {
  const regVerts: RegionVertex[] = [];
  for (let i = 0; i < layMat.length + 1; i++) {
    for (let j = 0; j < layMat[0].length + 1; j++) {
      const ind = [i, j];
      const [neighbors, neighborValues] = getNeighbors2d(ind, regInds, layMat);
      const flat = neighbors.flat();
      const someInRegion = flat.some((v) => v === 0);
      const allInRegion = flat.every((v) => v === 0);
      if (!someInRegion || allInRegion) continue;
      const dia1 = neighbors[0][1] === neighbors[1][0];
      const dia2 = neighbors[0][0] === neighbors[1][1];
      const zeros = flat.filter((v) => v === 0).length;
      const ones = flat.filter((v) => v === 1).length;
      if (zeros === 2 && ones === 2 && dia1 && dia2) {
        // diagonal: emit two vertices with one region-neighbor each blocked
        for (let a = 0; a < 2; a++) {
          for (let b = 0; b < 2; b++) {
            if (neighbors[a][b] !== 0) continue;
            const oneighbors = neighbors.map((row) => row.slice());
            oneighbors[a][b] = 1;
            regVerts.push(new RegionVertex(ind, ind, oneighbors, neighborValues, true));
          }
        }
        continue;
      }
      regVerts.push(new RegionVertex(ind, ind, neighbors, neighborValues));
    }
  }
  return regVerts;
}

/** Port of Evaluation.py get_ordered_outline. */
function getOrderedOutline(verts: RegionVertex[]): RegionVertex[] {
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
            break; // prevent going back
          // 1) from the previous point's view
          const vaxval = Math.trunc(0.5 * (vdir + 1));
          const pNeig = last.neighbors;
          const nind0 = [0, 0];
          nind0[vax] = vaxval;
          const nind1 = [1, 1];
          nind1[vax] = vaxval;
          let ne0 = pNeig[nind0[0]][nind0[1]];
          let ne1 = pNeig[nind1[0]][nind1[1]];
          if (ne0 !== 1 && ne1 !== 1) continue; // no block
          if (Math.trunc(0.5 * (ne0 + 1)) === Math.trunc(0.5 * (ne1 + 1))) continue; // crossing blocked material
          // 2) from the tested point's view
          const mind0 = [0, 0];
          mind0[vax] = 1 - vaxval;
          const mind1 = [1, 1];
          mind1[vax] = 1 - vaxval;
          ne0 = rv.neighbors[mind0[0]][mind0[1]];
          ne1 = rv.neighbors[mind1[0]][mind1[1]];
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
  return ordVerts;
}

/** Port of get_breakable_voxels. Returns [breakable, outlineInds, voxelInds]. */
export function getBreakableVoxels(
  mat: Mat3,
  fixedSides: FixedSide[],
  sax: Axis,
  n: number,
): [boolean, number[][], number[][]] {
  let breakable = false;
  const outlineIndices: number[][] = [];
  const voxelIndices: number[][] = [];
  const dim = mat.length;
  const gax = fixedSides[0].ax; // grain axis
  if (gax === sax) return [breakable, outlineIndices, voxelIndices];

  const paxes = [0, 1, 2].filter((a) => a !== gax) as Axis[];

  for (const pax of paxes) {
    const potentiallyFragileRegInds: number[][][][] = [];
    for (let layNum = 0; layNum < dim; layNum++) {
      const temp: number[][][] = [];
      const layMat = layerMat(mat, pax, dim, layNum);
      for (let regNum = 0; regNum < dim * dim; regNum++) {
        // first index with value n (C order)
        let first: number[] | null = null;
        outer: for (let i = 0; i < dim; i++) {
          for (let j = 0; j < dim; j++) {
            if (layMat[i][j] === n) {
              first = [i, j];
              break outer;
            }
          }
        }
        if (!first) break;
        const regInds = getSameNeighbors2d(layMat, [first], n);
        const fixed = isConnectedToFixedSide2d(regInds, fixedSides, pax, dim);
        if (!fixed) temp.push(regInds);
        for (const regInd of regInds) layMat[regInd[0]][regInd[1]] = -1;
      }
      potentiallyFragileRegInds.push(temp);
    }

    for (let layNum = 0; layNum < dim; layNum++) {
      const layMat = layerMat(mat, pax, dim, layNum);
      for (const regInds of potentiallyFragileRegInds[layNum]) {
        const fixedNeighbors = [false, false];
        for (const regInd of regInds) {
          const ind3d = insertAxis([regInd[0], regInd[1]], pax, layNum);
          for (let dir = -1; dir < 2; dir += 2) {
            const ind3dDir: Vec3 = [...ind3d];
            ind3dDir[pax] += dir;
            if (ind3dDir[pax] < 0 || ind3dDir[pax] >= dim) continue;
            const val = mat[ind3dDir[0]][ind3dDir[1]][ind3dDir[2]];
            if (val !== n) continue;
            let attachedToFragile = false;
            const ind2dDir = [...ind3dDir] as number[];
            ind2dDir.splice(pax, 1);
            for (const dirRegInds of potentiallyFragileRegInds[layNum + dir]) {
              for (const dirInd of dirRegInds) {
                if (dirInd[0] === ind2dDir[0] && dirInd[1] === ind2dDir[1]) {
                  attachedToFragile = true;
                  break;
                }
              }
            }
            if (!attachedToFragile) fixedNeighbors[Math.trunc((dir + 1) / 2)] = true;
          }
        }
        if (fixedNeighbors[0] && fixedNeighbors[1]) continue;
        breakable = true;
        for (const ind of regInds) {
          voxelIndices.push(insertAxis([ind[0], ind[1]], pax, layNum));
        }
        let outline = getRegionOutline(regInds, layMat);
        outline = getOrderedOutline(outline);
        outline.push(outline[0]);
        for (let dir = 0; dir < 2; dir++) {
          for (let i = 0; i < outline.length - 1; i++) {
            for (let j = 0; j < 2; j++) {
              const oind = insertAxis(
                [outline[i + j].ind[0], outline[i + j].ind[1]],
                pax,
                layNum,
              ) as number[];
              oind[pax] += dir;
              outlineIndices.push(oind);
            }
          }
        }
      }
    }
  }
  return [breakable, outlineIndices, voxelIndices];
}

// ---------------------------------------------------------------------------
// Evaluation

export class Evaluation {
  valid = true;
  slides: Slide[][] = [];
  numberOfSlides: number[] = [];
  interlock = true;
  interlocks: boolean[] = [];
  connected: boolean[] = [];
  bridged: boolean[] = [];
  breakable: boolean[] = [];
  checker: boolean[] = [];
  checkerVertices: number[][][] = [];
  fabDirectionOk: boolean[] = [];
  fabDirections: number[] = [];
  voxelMatrixWithSides: Mat3;
  voxelMatrixConnected: Mat3;
  voxelMatrixUnconnected: Mat3 | null = null;
  voxelMatricesUnbridged: (Mat3[] | null)[] = [];
  breakableOutlineInds: number[][][] = [];
  breakableVoxelInds: number[][][] = [];
  frictionNums: number[] = [];
  frictionFaces: AreaFace[][] = [];
  contactNums: number[] = [];
  contactFaces: AreaFace[][] = [];
  nonBreakableVoxmat: Mat3;
  breakableVoxmat: Mat3;

  constructor(voxelMatrix: Mat3, params: EvalParams) {
    const { fixedSides, sax, noc, dim } = params;
    this.voxelMatrixWithSides = addFixedSides(voxelMatrix, fixedSides);

    // Connectivity
    for (let n = 0; n < noc; n++) {
      this.connected.push(isConnected(this.voxelMatrixWithSides, n));
      this.bridged.push(true);
      this.voxelMatricesUnbridged.push(null);
    }
    this.voxelMatrixConnected = copyMat3(voxelMatrix);
    this.separateUnconnected(voxelMatrix, fixedSides, dim);

    // Bridging
    const connectedWithSides = addFixedSides(this.voxelMatrixConnected, fixedSides);
    for (let n = 0; n < noc; n++) {
      this.bridged[n] = isConnected(connectedWithSides, n);
      if (!this.bridged[n] && fixedSides[n].length >= 2) {
        this.voxelMatricesUnbridged[n] = this.separateUnbridged(
          voxelMatrix,
          fixedSides,
          dim,
          n,
        );
      }
    }

    // Fabricability by direction constraint
    for (let n = 0; n < noc; n++) {
      if (n === 0 || n === noc - 1) {
        this.fabDirectionOk.push(true);
        this.fabDirections.push(n === 0 ? 0 : 1);
        continue;
      }
      const [fabOk, fabDir] = isFabDirectionOk(voxelMatrix, sax, n);
      this.fabDirections.push(fabDir);
      this.fabDirectionOk.push(fabOk);
    }

    // Chessboard
    for (let n = 0; n < noc; n++) {
      const [check, verts] = getChessboardVertics(voxelMatrix, sax, n);
      this.checker.push(check);
      this.checkerVertices.push(verts);
    }

    // Sliding directions / interlock
    [this.slides, this.numberOfSlides] = getSlidingDirections(this.voxelMatrixWithSides, noc);
    for (let n = 0; n < noc; n++) {
      const limitOk =
        n === 0 || n === noc - 1 ? this.numberOfSlides[n] <= 1 : this.numberOfSlides[n] === 0;
      this.interlocks.push(limitOk);
      if (!limitOk) this.interlock = false;
    }

    // Friction / contact
    for (let n = 0; n < noc; n++) {
      const [friction, ffaces, contact, cfaces] = getFrictionAndContactAreas(
        voxelMatrix,
        this.slides[n],
        fixedSides,
        n,
      );
      this.frictionNums.push(friction);
      this.frictionFaces.push(ffaces);
      this.contactNums.push(contact);
      this.contactFaces.push(cfaces);
    }

    // Grain direction / breakability
    for (let n = 0; n < noc; n++) {
      const [brk, brkOinds, brkVinds] = getBreakableVoxels(voxelMatrix, fixedSides[n], sax, n);
      this.breakable.push(brk);
      this.breakableOutlineInds.push(brkOinds);
      this.breakableVoxelInds.push(brkVinds);
    }
    [this.nonBreakableVoxmat, this.breakableVoxmat] = this.separateVoxelMatrix(
      voxelMatrix,
      this.breakableVoxelInds,
    );

    const structuralFail =
      !this.interlock || !this.connected.every(Boolean) || !this.bridged.every(Boolean);
    const qualityFail =
      this.breakable.some(Boolean) ||
      this.checker.some(Boolean) ||
      !this.fabDirectionOk.every(Boolean);
    if (structuralFail || qualityFail) this.valid = false;
  }

  private separateUnconnected(voxelMatrix: Mat3, fixedSides: FixedSide[][], dim: number): void {
    const connectedMat = makeMat3(dim, -1);
    const unconnectedMat = makeMat3(dim, -1);
    for (let i = 0; i < dim; i++) {
      for (let j = 0; j < dim; j++) {
        for (let k = 0; k < dim; k++) {
          const val = voxelMatrix[i][j][k];
          const connected = isConnectedToFixedSide(
            [[i, j, k]],
            voxelMatrix,
            fixedSides[Math.trunc(val)],
          );
          if (connected) connectedMat[i][j][k] = val;
          else unconnectedMat[i][j][k] = val;
        }
      }
    }
    this.voxelMatrixConnected = connectedMat;
    this.voxelMatrixUnconnected = unconnectedMat;
  }

  private separateVoxelMatrix(voxmat: Mat3, inds: number[][][]): [Mat3, Mat3] {
    const dim = voxmat.length;
    const voxmatA = copyMat3(voxmat);
    const voxmatB = makeMat3(dim, -1);
    for (const compInds of inds) {
      for (const ind of compInds) {
        const val = voxmat[ind[0]][ind[1]][ind[2]];
        voxmatA[ind[0]][ind[1]][ind[2]] = -1;
        voxmatB[ind[0]][ind[1]][ind[2]] = val;
      }
    }
    return [voxmatA, voxmatB];
  }

  private separateUnbridged(
    voxelMatrix: Mat3,
    fixedSides: FixedSide[][],
    dim: number,
    n: number,
  ): [Mat3, Mat3] {
    const unbridged1 = makeMat3(dim, -1);
    const unbridged2 = makeMat3(dim, -1);
    for (let i = 0; i < dim; i++) {
      for (let j = 0; j < dim; j++) {
        for (let k = 0; k < dim; k++) {
          const val = voxelMatrix[i][j][k];
          if (val !== n) continue;
          const conn1 = isConnectedToFixedSide([[i, j, k]], voxelMatrix, [fixedSides[n][0]]);
          const conn2 = isConnectedToFixedSide([[i, j, k]], voxelMatrix, [fixedSides[n][1]]);
          if (conn1) unbridged1[i][j][k] = val;
          if (conn2) unbridged2[i][j][k] = val;
        }
      }
    }
    return [unbridged1, unbridged2];
  }
}
