import * as THREE from 'three';
import { EMPTY, eachVoxel, type Joint, voxelIndex } from '../model/joint';

const PART_COLORS: readonly number[] = [0x000000, 0xd9a066, 0x8c5a2b, 0x6e441f];

/** Renders voxel occupancy as one InstancedMesh of unit cubes per update. */
export class JointMesh {
  readonly object = new THREE.Group();
  private joint: Joint;

  constructor(joint: Joint) {
    this.joint = joint;
    this.rebuild();
  }

  setJoint(joint: Joint): void {
    this.joint = joint;
    this.rebuild();
  }

  rebuild(): void {
    this.object.clear();
    const { dim } = this.joint;
    const counts = [0, 0, 0, 0];
    for (const v of this.joint.voxels) counts[v]++;

    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const matrix = new THREE.Matrix4();
    const offset = dim / 2 - 0.5;

    for (let label = 1; label <= 3; label++) {
      if (counts[label] === 0) continue;
      const mesh = new THREE.InstancedMesh(
        geometry,
        new THREE.MeshLambertMaterial({ color: PART_COLORS[label] }),
        counts[label],
      );
      let i = 0;
      for (const [x, y, z] of eachVoxel(dim)) {
        if (this.joint.voxels[voxelIndex(dim, x, y, z)] !== label) continue;
        matrix.setPosition(x - offset, y - offset, z - offset);
        mesh.setMatrixAt(i++, matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      this.object.add(mesh);
    }
  }
}

void EMPTY; // re-export placeholder for future selection helpers
