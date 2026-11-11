/**
 * Vertex generation — port of Types.create_joint_vertices and helpers.
 *
 * Vertex layout matches the original: 8 floats per vertex
 * [x, y, z, r, g, b, tx, ty].
 */
import type { Joint } from '../model/joint';
import { COMPONENT_SIZE } from '../model/joint';
import type { Axis, Vec3 } from '../model/types';

export const VERTEX_STRIDE = 8;

export function normalize(v: Vec3): Vec3 {
  // sqrt of sum of squares (not Math.hypot) to match numpy bit-for-bit
  const norm = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  if (norm === 0) return v;
  return [v[0] / norm, v[1] / norm, v[2] / norm];
}

/** Port of rotate_vector_around_axis (Rodrigues via quaternion-style matrix). */
export function rotateVectorAroundAxis(vec: Vec3, axis: Vec3, theta: number): Vec3 {
  const [ux, uy, uz] = normalize(axis);
  const a = Math.cos(theta / 2.0);
  const s = Math.sin(theta / 2.0);
  const b = -ux * s;
  const c = -uy * s;
  const d = -uz * s;
  const aa = a * a,
    bb = b * b,
    cc = c * c,
    dd = d * d;
  const bc = b * c,
    ad = a * d,
    ac = a * c,
    ab = a * b,
    bd = b * d,
    cd = c * d;
  const m = [
    [aa + bb - cc - dd, 2 * (bc + ad), 2 * (bd - ac)],
    [2 * (bc - ad), aa + cc - bb - dd, 2 * (cd + ab)],
    [2 * (bd + ac), 2 * (cd - ab), aa + dd - bb - cc],
  ];
  return [
    m[0][0] * vec[0] + m[0][1] * vec[1] + m[0][2] * vec[2],
    m[1][0] * vec[0] + m[1][1] * vec[1] + m[1][2] * vec[2],
    m[2][0] * vec[0] + m[2][1] * vec[1] + m[2][2] * vec[2],
  ];
}

/** Port of Types position vectors (scaled voxel axes, skewed when angled). */
export function getPosVecs(joint: Joint): Vec3[] {
  const vs = joint.voxelSizes;
  const posVecs: Vec3[] = [
    [vs[0], 0, 0],
    [0, vs[1], 0],
    [0, 0, vs[2]],
  ];
  if (joint.rotAllowed) {
    const nonSax = [0, 1, 2].filter((a) => a !== joint.sax);
    for (let i = 0; i < nonSax.length; i++) {
      const ax = nonSax[i];
      let theta = (Math.PI / 180) * (0.5 * joint.ang);
      if (i % 2 === 1) theta = -theta;
      let v = rotateVectorAroundAxis(posVecs[ax], posVecs[joint.sax], theta);
      const cosAng = Math.cos((Math.PI / 180) * Math.abs(joint.ang));
      v = [v[0] / cosAng, v[1] / cosAng, v[2] / cosAng];
      posVecs[ax] = v;
    }
  }
  return posVecs;
}

/** Lattice index — port of get_index. */
export function getIndex(ind: readonly number[], add: readonly number[], dim: number): number {
  const d = dim + 1;
  return (ind[0] + add[0]) * d * d + (ind[1] + add[1]) * d + (ind[2] + add[2]);
}

/** Port of get_corner_indices. */
export function getCornerIndices(ax: Axis, dir: number, dim: number): number[] {
  const otherAxes = [0, 1, 2].filter((a) => a !== ax);
  const ind = [0, 0, 0];
  ind[ax] = dir * dim;
  const corners: number[] = [];
  for (let x = 0; x < 2; x++) {
    for (let y = 0; y < 2; y++) {
      const add = [0, 0, 0];
      add[otherAxes[0]] = x * dim;
      add[otherAxes[1]] = y * dim;
      corners.push(getIndex(ind, add, dim));
    }
  }
  return corners;
}

export function getVertex(index: number, verts: Float32Array): Vec3 {
  return [
    verts[VERTEX_STRIDE * index],
    verts[VERTEX_STRIDE * index + 1],
    verts[VERTEX_STRIDE * index + 2],
  ];
}

/**
 * Port of Types.create_joint_vertices(ax): the (dim+1)^3 lattice with
 * texture coordinates perpendicular to `ax`, followed by component-base
 * vertices (24 per axis, 72 total).
 */
export function createJointVertices(joint: Joint, ax: Axis): Float32Array {
  const dim = joint.dim;
  const vertices: number[] = [];
  const r = 0,
    g = 0,
    b = 0;
  const posVecs = getPosVecs(joint);

  // NOTE: the original rebinds the loop variable `ax` while rotating
  // pos_vecs, so with rot=true all three copies use the last non-sax axis
  // for texture coords. Replicated for parity.
  let texAx: number = ax;
  if (joint.rotAllowed) {
    const nonSax = [0, 1, 2].filter((a) => a !== joint.sax);
    texAx = nonSax[nonSax.length - 1];
  }

  for (let i = 0; i <= dim; i++) {
    for (let j = 0; j <= dim; j++) {
      for (let k = 0; k <= dim; k++) {
        const pos: Vec3 = [0, 0, 0];
        const steps = [i - 0.5 * dim, j - 0.5 * dim, k - 0.5 * dim];
        for (let a = 0; a < 3; a++) {
          pos[0] += steps[a] * posVecs[a][0];
          pos[1] += steps[a] * posVecs[a][1];
          pos[2] += steps[a] * posVecs[a][2];
        }
        const texCoords = [i, j, k];
        texCoords.splice(texAx, 1);
        vertices.push(pos[0], pos[1], pos[2], r, g, b, texCoords[0] / dim, texCoords[1] / dim);
      }
    }
  }

  // Extra length for angled components
  let extraLen = 0;
  if (joint.ang !== 0.0 && joint.rotAllowed) {
    extraLen = 0.1 * COMPONENT_SIZE * Math.tan((Math.PI / 180) * Math.abs(joint.ang));
  }

  // Component base vertices
  for (let bax = 0; bax < 3; bax++) {
    const extraL = bax === joint.sax ? 0 : extraLen;
    for (let dir = -1; dir < 2; dir += 2) {
      for (let stepI = 0; stepI < 3; stepI++) {
        const step = stepI === 0 ? 1 : stepI + 0.5 + extraLen;
        const unit = normalize(posVecs[bax]);
        const scl = dir * step * (COMPONENT_SIZE + extraL);
        const axvec: Vec3 = [scl * unit[0], scl * unit[1], scl * unit[2]];
        for (let x = 0; x < 2; x++) {
          for (let y = 0; y < 2; y++) {
            const otherVecs = posVecs.filter((_, a) => a !== bax);
            const pos: Vec3 = [
              axvec[0] + (x - 0.5) * dim * otherVecs[0][0] + (y - 0.5) * dim * otherVecs[1][0],
              axvec[1] + (x - 0.5) * dim * otherVecs[0][1] + (y - 0.5) * dim * otherVecs[1][1],
              axvec[2] + (x - 0.5) * dim * otherVecs[0][2] + (y - 0.5) * dim * otherVecs[1][2],
            ];
            vertices.push(pos[0], pos[1], pos[2], r, g, b, x, y);
          }
        }
      }
    }
  }
  return new Float32Array(vertices);
}

/** Port of arrow_vertices: origin + 5 vertices per (axis, dir). */
export function arrowVertices(joint: Joint): Float32Array {
  const vertices: number[] = [];
  const r = 0,
    g = 0,
    b = 0,
    tx = 0,
    ty = 0;
  const posVecs = getPosVecs(joint);
  const dim = joint.dim;
  vertices.push(0, 0, 0, r, g, b, tx, ty); // origin
  for (let ax = 0; ax < 3; ax++) {
    for (let dir = -1; dir < 2; dir += 2) {
      const xyz: Vec3 = [
        dir * posVecs[ax][0] * dim * 0.4,
        dir * posVecs[ax][1] * dim * 0.4,
        dir * posVecs[ax][2] * dim * 0.4,
      ];
      vertices.push(xyz[0], xyz[1], xyz[2], r, g, b, tx, ty); // end of line
      for (let i = -1; i < 2; i += 2) {
        for (let j = -1; j < 2; j += 2) {
          const otherAxes = [0, 1, 2].filter((a) => a !== ax);
          const pos: Vec3 = [0, 0, 0];
          for (let c = 0; c < 3; c++) {
            pos[c] =
              dir * posVecs[ax][c] * dim * 0.3 +
              i * posVecs[otherAxes[0]][c] * dim * 0.025 +
              j * posVecs[otherAxes[1]][c] * dim * 0.025;
          }
          vertices.push(pos[0], pos[1], pos[2], r, g, b, tx, ty);
        }
      }
    }
  }
  return new Float32Array(vertices);
}
