/**
 * Core voxel model ported from the original Tsugite (UIST 2020).
 *
 * The joint lives in a dim x dim x dim integer grid. Each voxel holds a
 * label: 0 = empty, 1 = part A, 2 = part B. Geometry is edited through
 * height fields along an axis ("push and pull on faces"), as in
 * Geometries.mat_from_fields in the Python codebase.
 */

export type VoxelLabel = 0 | 1 | 2;
export const EMPTY: VoxelLabel = 0;
export const PART_A: VoxelLabel = 1;
export const PART_B: VoxelLabel = 2;

export type Axis = 0 | 1 | 2; // x, y, z

export interface Joint {
  dim: number;
  /** Voxel labels in row-major [z][y][x] order (flat index helper below). */
  voxels: Uint8Array;
  /** Number of components (2 for a standard A/B joint). */
  components: 2 | 3;
}

export function voxelIndex(dim: number, x: number, y: number, z: number): number {
  return x + dim * (y + dim * z);
}

export function createJoint(dim: number, components: 2 | 3 = 2): Joint {
  return { dim, voxels: new Uint8Array(dim * dim * dim), components };
}

/** Default joint: two interlocking halves split along the y axis. */
export function createDefaultJoint(dim = 24): Joint {
  const joint = createJoint(dim, 2);
  // Part A occupies y < dim/2, part B occupies y >= dim/2, like the
  // original "Untitled" joint before any push/pull edits.
  for (const [x, y, z] of eachVoxel(dim)) {
    const label = y < dim / 2 ? PART_A : PART_B;
    joint.voxels[voxelIndex(dim, x, y, z)] = label;
  }
  return joint;
}

export function* eachVoxel(dim: number): Generator<[number, number, number]> {
  for (let z = 0; z < dim; z++)
    for (let y = 0; y < dim; y++)
      for (let x = 0; x < dim; x++) yield [x, y, z];
}

/**
 * Height fields describing the material boundaries along `axis`, one per
 * component boundary (components - 1 fields). Entry [u][v] is the number of
 * voxels along the axis belonging to earlier components. Port of
 * mat_from_fields: voxel k along the axis gets label n where n is the first
 * height field with k < hf[u][v], else components - 1... adjusted so that
 * label 0 is empty: heights of 0 mean the component is absent there.
 */
export type HeightField = number[][];

export function heightFieldsFromJoint(joint: Joint, axis: Axis): HeightField[] {
  const { dim, components } = joint;
  const fields: HeightField[] = [];
  for (let c = 0; c < components - 1; c++) {
    fields.push(
      Array.from({ length: dim }, () => Array<number>(dim).fill(0)),
    );
  }
  for (let u = 0; u < dim; u++) {
    for (let v = 0; v < dim; v++) {
      let c = 0;
      let run = 0;
      for (let k = 0; k <= dim; k++) {
        const label = k < dim ? labelAt(joint, axis, u, v, k) : 0;
        const current: VoxelLabel = c >= components - 1 ? EMPTY : ((c + 1) as VoxelLabel);
        if (label === current) {
          run++;
          continue;
        }
        while (c < components - 1 && label !== ((c + 1) as VoxelLabel)) {
          setField(fields[c], axis, u, v, run);
          c++;
          run = 0;
        }
        run = label === ((c + 1) as VoxelLabel) ? 1 : 0;
      }
    }
  }
  return fields;
}

export function jointFromHeightFields(
  dim: number,
  axis: Axis,
  fields: HeightField[],
): Joint {
  const joint = createJoint(dim, (fields.length + 1) as 2 | 3);
  for (let u = 0; u < dim; u++) {
    for (let v = 0; v < dim; v++) {
      for (let k = 0; k < dim; k++) {
        let label: VoxelLabel = EMPTY;
        // Mirrors the Python: first field with k < hf wins; otherwise the
        // last component label.
        let assigned = false;
        for (let n = 0; n < fields.length; n++) {
          if (k < getField(fields[n], axis, u, v)) {
            label = (n + 1) as VoxelLabel;
            assigned = true;
            break;
          }
        }
        if (!assigned) label = fields.length as VoxelLabel;
        // Zero-height runs encode empty space before that field.
        for (let n = 0; n < fields.length; n++) {
          if (getField(fields[n], axis, u, v) === 0 && label === (n + 1)) label = EMPTY;
        }
        setLabelAt(joint, axis, u, v, k, label);
      }
    }
  }
  return joint;
}

function labelAt(joint: Joint, axis: Axis, u: number, v: number, k: number): VoxelLabel {
  const [x, y, z] = coords(axis, u, v, k, joint.dim);
  return joint.voxels[voxelIndex(joint.dim, x, y, z)] as VoxelLabel;
}

function setLabelAt(
  joint: Joint,
  axis: Axis,
  u: number,
  v: number,
  k: number,
  label: VoxelLabel,
): void {
  const [x, y, z] = coords(axis, u, v, k, joint.dim);
  joint.voxels[voxelIndex(joint.dim, x, y, z)] = label;
}

/** Map (u, v, k) on an arbitrary axis to (x, y, z), like Python's ind3d.insert. */
function coords(axis: Axis, u: number, v: number, k: number, dim: number): [number, number, number] {
  const ind: number[] = [u, v];
  ind.splice(axis, 0, k);
  if (ind.length !== 3 || ind.some((n) => n < 0 || n >= dim)) throw new RangeError('bad coords');
  return ind as [number, number, number];
}

function getField(field: HeightField, axis: Axis, u: number, v: number): number {
  void axis;
  return field[u]?.[v] ?? 0;
}

function setField(field: HeightField, axis: Axis, u: number, v: number, value: number): void {
  void axis;
  field[u][v] = value;
}
