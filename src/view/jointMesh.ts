import * as THREE from 'three';
import type { Mat3 } from '../model/types';

const PART_COLORS: readonly number[] = [0xd9a066, 0x8c5a2b, 0x6e441f, 0xc9b458, 0x89a0c9, 0xb08cc9];

/**
 * Provisional voxel renderer (Phase 1): one InstancedMesh of unit cubes per
 * component. Replaced by the faithful mesh builder in Phase 2.
 */
export class JointMesh {
  readonly object = new THREE.Group();

  constructor(voxelMatrix: Mat3) {
    this.rebuild(voxelMatrix);
  }

  rebuild(voxelMatrix: Mat3): void {
    for (const child of this.object.children) {
      if (child instanceof THREE.InstancedMesh) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
    }
    this.object.clear();
    const dim = voxelMatrix.length;
    const counts = new Map<number, number>();
    for (let i = 0; i < dim; i++)
      for (let j = 0; j < dim; j++)
        for (let k = 0; k < dim; k++) {
          const v = voxelMatrix[i][j][k];
          if (v < 0) continue;
          counts.set(v, (counts.get(v) ?? 0) + 1);
        }

    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const matrix = new THREE.Matrix4();
    const offset = dim / 2 - 0.5;

    for (const [label, count] of counts) {
      const mesh = new THREE.InstancedMesh(
        geometry,
        new THREE.MeshLambertMaterial({ color: PART_COLORS[label % PART_COLORS.length] }),
        count,
      );
      let idx = 0;
      for (let i = 0; i < dim; i++)
        for (let j = 0; j < dim; j++)
          for (let k = 0; k < dim; k++) {
            if (voxelMatrix[i][j][k] !== label) continue;
            matrix.setPosition(i - offset, j - offset, k - offset);
            mesh.setMatrixAt(idx++, matrix);
          }
      mesh.instanceMatrix.needsUpdate = true;
      this.object.add(mesh);
    }
  }
}
