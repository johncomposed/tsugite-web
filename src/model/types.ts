export type Axis = 0 | 1 | 2;
export type Dir = 0 | 1;
export type Vec3 = [number, number, number];

/** 2D integer matrix (dim x dim unless padded). */
export type Mat2 = number[][];
/** 3D integer voxel matrix. -1 = empty/padding, 0..noc-1 = component. */
export type Mat3 = number[][][];

export const AXES: readonly Axis[] = [0, 1, 2];

export function otherAxes(ax: Axis): [number, number] {
  const axes = [0, 1, 2];
  axes.splice(ax, 1);
  return axes as [number, number];
}

/** Python idiom `ind.insert(ax, k)` on a 2-item index. */
export function insertAxis(ind: readonly [number, number], ax: Axis, k: number): Vec3 {
  const out = [ind[0], ind[1]];
  out.splice(ax, 0, k);
  return out as Vec3;
}

export function makeMat2(rows: number, cols = rows, fill = 0): Mat2 {
  return Array.from({ length: rows }, () => Array<number>(cols).fill(fill));
}

export function makeMat3(dim: number, fill = -1): Mat3 {
  return Array.from({ length: dim }, () =>
    Array.from({ length: dim }, () => Array<number>(dim).fill(fill)),
  );
}

export function copyMat2(mat: Mat2): Mat2 {
  return mat.map((row) => row.slice());
}

export function copyMat3(mat: Mat3): Mat3 {
  return mat.map((plane) => plane.map((row) => row.slice()));
}

export function shape3(mat: Mat3): Vec3 {
  return [mat.length, mat[0].length, mat[0][0].length];
}
