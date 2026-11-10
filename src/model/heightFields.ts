/** Height-field operations — port of Geometries.py supporting functions. */
import { insertAxis, makeMat2, type Axis, type Mat2, type Mat3 } from './types';

/** Port of get_random_height_fields. */
export function randomHeightFields(
  dim: number,
  noc: number,
  rand: () => number = Math.random,
): Mat2[] {
  const hfs: Mat2[] = [];
  let phf = makeMat2(dim);
  for (let n = 0; n < noc - 1; n++) {
    const hf = makeMat2(dim);
    for (let i = 0; i < dim; i++) {
      for (let j = 0; j < dim; j++) {
        const lo = Math.trunc(phf[i][j]);
        hf[i][j] = lo + Math.floor(rand() * (dim - lo + 1));
      }
    }
    hfs.push(hf);
    phf = hf.map((row) => row.slice());
  }
  return hfs;
}

export function clearHeightFields(dim: number, noc: number): Mat2[] {
  return Array.from({ length: noc - 1 }, () => makeMat2(dim));
}

/** Port of mat_from_fields (Types.py / Geometries.py). */
export function matFromFields(hfs: readonly Mat2[], ax: Axis): Mat3 {
  const dim = hfs[0].length;
  const mat: Mat3 = [];
  for (let x = 0; x < dim; x++) {
    mat.push([]);
    for (let y = 0; y < dim; y++) mat[x].push(Array<number>(dim).fill(0));
  }
  for (let i = 0; i < dim; i++) {
    for (let j = 0; j < dim; j++) {
      for (let k = 0; k < dim; k++) {
        const [x, y, z] = insertAxis([i, j], ax, k);
        let val = hfs.length; // defaults to last component
        for (let n = 0; n < hfs.length; n++) {
          if (k < hfs[n][i][j]) {
            val = n;
            break;
          }
        }
        mat[x][y][z] = val;
      }
    }
  }
  return mat;
}

/**
 * Port of Geometries.edit_height_fields (mutates hfs): set faces to height h
 * for boundary n-dir, cascading so fields stay monotonic.
 */
export function editHeightFields(
  hfs: Mat2[],
  faces: readonly (readonly [number, number])[],
  h: number,
  n: number,
  dir: number,
  noc: number,
): void {
  for (const [i, j] of faces) {
    hfs[n - dir][i][j] = h;
    if (dir === 0) {
      // Editing top: push later boundaries up to at least h
      for (let m = n - dir + 1; m < noc - 1; m++) {
        if (h > hfs[m][i][j]) hfs[m][i][j] = h;
      }
    }
    if (dir === 1) {
      // Editing bottom: push earlier boundaries down to at most h
      for (let m = 0; m < n - dir; m++) {
        if (h < hfs[m][i][j]) hfs[m][i][j] = h;
      }
    }
  }
}

/** Port of Selection.get_same_height_neighbors (flood fill on equal height). */
export function getSameHeightNeighbors(
  hfield: Mat2,
  inds: readonly (readonly [number, number])[],
): [number, number][] {
  const dim = hfield.length;
  const val = hfield[inds[0][0]][inds[0][1]];
  const newInds: [number, number][] = inds.map((i) => [i[0], i[1]]);
  for (const ind of newInds) {
    for (let ax = 0; ax < 2; ax++) {
      for (let dir = -1; dir < 2; dir += 2) {
        const ind2: [number, number] = [ind[0], ind[1]];
        ind2[ax] += dir;
        if (ind2[0] < 0 || ind2[0] >= dim || ind2[1] < 0 || ind2[1] >= dim) continue;
        if (hfield[ind2[0]][ind2[1]] !== val) continue;
        const exists = newInds.some((i3) => i3[0] === ind2[0] && i3[1] === ind2[1]);
        if (!exists) newInds.push(ind2);
      }
    }
  }
  return newInds;
}
