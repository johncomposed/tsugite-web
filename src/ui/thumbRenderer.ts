/** Shared offscreen three.js renderer for joint thumbnails. */
import * as THREE from 'three';
import type { Joint } from '../model/joint';
import { COMPONENT_SIZE } from '../model/joint';
import { matFromFields } from '../model/heightFields';
import type { Axis, Mat2 } from '../model/types';
import { lineGeometry, quadGeometry } from '../view/jointRender';
import { jointFaceIndices, jointLineIndices } from '../view/meshBuilder';
import { createJointVertices } from '../view/vertexGrid';

export class ThumbRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly camera: THREE.OrthographicCamera;
  private readonly faceMat: THREE.MeshBasicMaterial;
  private readonly lineMat: THREE.LineBasicMaterial;

  constructor(readonly size: number) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setSize(size, size);
    this.camera = new THREE.OrthographicCamera(-0.4, 0.4, 0.4, -0.4, 0.01, 10);
    this.camera.position.set(0, 0, 2);
    this.camera.lookAt(0, 0, 0);
    this.faceMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    this.lineMat = new THREE.LineBasicMaterial({ color: 0x000000 });
  }

  /** Render `hfs` (with `joint`'s configuration) into a 2D canvas. */
  render(
    joint: Joint,
    hfs: Mat2[],
    canvas: HTMLCanvasElement,
    xrot: number,
    yrot: number,
    openRatio = 0,
  ): void {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf4f4f4);
    const root = new THREE.Group();
    root.rotation.order = 'XYZ';
    root.rotation.x = xrot;
    root.rotation.y = yrot;
    scene.add(root);

    const voxmat = matFromFields(hfs, joint.sax);
    for (let n = 0; n < joint.noc; n++) {
      const compGroup = new THREE.Group();
      if (openRatio > 0 && joint.noc > 1) {
        const f = (2 * n + 1 - joint.noc) / (joint.noc - 1);
        const move: [number, number, number] = [0, 0, 0];
        move[joint.sax] = f * openRatio * COMPONENT_SIZE;
        compGroup.position.set(move[0], move[1], move[2]);
      }
      const ax = joint.fixedSides[n][0].ax as Axis;
      const verts = createJointVertices(joint, ax);
      const sets = jointFaceIndices(voxmat, joint.fixedSides[n], n, joint.dim, joint.fixedSides[n]);
      compGroup.add(
        new THREE.Mesh(quadGeometry(verts, sets.notEnds.concat(sets.ends)), this.faceMat),
      );
      const lineInds = jointLineIndices(voxmat, joint.fixedSides, n, joint.dim);
      compGroup.add(new THREE.LineSegments(lineGeometry(verts, lineInds), this.lineMat));
      root.add(compGroup);
    }
    // widen the view a little when components are separated
    const extent = openRatio > 0 ? 0.55 : 0.4;
    this.camera.left = -extent;
    this.camera.right = extent;
    this.camera.top = extent;
    this.camera.bottom = -extent;
    this.camera.updateProjectionMatrix();
    this.renderer.render(scene, this.camera);
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.drawImage(this.renderer.domElement, 0, 0);
    scene.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) o.geometry.dispose();
    });
  }
}
