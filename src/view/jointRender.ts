/**
 * Joint renderer — three.js equivalent of Show.py's main geometry passes.
 * Faces are white (end faces textured with end grain), edges are black
 * lines, hidden edges are dashed, per-component groups translate apart when
 * the joint opens.
 */
import * as THREE from 'three';
import type { Joint } from '../model/joint';
import { COMPONENT_SIZE } from '../model/joint';
import {
  jointFaceIndices,
  jointLineIndices,
  openLineIndices,
} from './meshBuilder';
import { createJointVertices, VERTEX_STRIDE } from './vertexGrid';
import type { ViewSettings } from './viewSettings';
import type { Axis } from '../model/types';

export function expandQuads(
  verts: Float32Array,
  quadIndices: readonly number[],
): { positions: Float32Array; uvs: Float32Array } {
  const quadCount = Math.floor(quadIndices.length / 4);
  const positions = new Float32Array(quadCount * 6 * 3);
  const uvs = new Float32Array(quadCount * 6 * 2);
  let p = 0;
  let u = 0;
  const emit = (vi: number) => {
    const o = vi * VERTEX_STRIDE;
    positions[p++] = verts[o];
    positions[p++] = verts[o + 1];
    positions[p++] = verts[o + 2];
    uvs[u++] = verts[o + 6];
    uvs[u++] = verts[o + 7];
  };
  for (let q = 0; q < quadCount; q++) {
    const [a, b, c, d] = [
      quadIndices[4 * q],
      quadIndices[4 * q + 1],
      quadIndices[4 * q + 2],
      quadIndices[4 * q + 3],
    ];
    // GL_QUADS a-b-c-d → triangles a-b-c, a-c-d
    emit(a);
    emit(b);
    emit(c);
    emit(a);
    emit(c);
    emit(d);
  }
  return { positions, uvs };
}

export function expandLines(verts: Float32Array, lineIndices: readonly number[]): Float32Array {
  const positions = new Float32Array(lineIndices.length * 3);
  let p = 0;
  for (const vi of lineIndices) {
    const o = vi * VERTEX_STRIDE;
    positions[p++] = verts[o];
    positions[p++] = verts[o + 1];
    positions[p++] = verts[o + 2];
  }
  return positions;
}

export function quadGeometry(verts: Float32Array, quadIndices: readonly number[]): THREE.BufferGeometry {
  const { positions, uvs } = expandQuads(verts, quadIndices);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  return geo;
}

export function lineGeometry(verts: Float32Array, lineIndices: readonly number[]): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(expandLines(verts, lineIndices), 3));
  return geo;
}

function disposeGroup(group: THREE.Group): void {
  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh || obj instanceof THREE.LineSegments) {
      obj.geometry.dispose();
    }
  });
  group.clear();
}

export class JointRenderer {
  readonly root = new THREE.Group();
  private componentGroups: THREE.Group[] = [];
  private openLineGroups: THREE.LineSegments[] = [];
  /** Per-component vertex copies (by that component's first fixed axis). */
  jvertsByAxis: Float32Array[] = [];

  private readonly faceMaterial: THREE.MeshBasicMaterial;
  private readonly endGrainMaterial: THREE.MeshBasicMaterial;
  private readonly lineMaterial: THREE.LineBasicMaterial;
  private readonly warnLineMaterial: THREE.LineBasicMaterial;
  private readonly hiddenLineMaterial: THREE.LineDashedMaterial;
  private readonly openLineMaterial: THREE.LineDashedMaterial;

  constructor(endGrainTexture: THREE.Texture | null) {
    this.faceMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    this.endGrainMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      map: endGrainTexture ?? undefined,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    this.lineMaterial = new THREE.LineBasicMaterial({ color: 0x000000 });
    this.warnLineMaterial = new THREE.LineBasicMaterial({ color: 0xff0000 });
    this.hiddenLineMaterial = new THREE.LineDashedMaterial({
      color: 0x000000,
      dashSize: 0.008,
      gapSize: 0.008,
      depthFunc: THREE.GreaterDepth,
      depthWrite: false,
      transparent: true,
      opacity: 0.4,
    });
    this.openLineMaterial = new THREE.LineDashedMaterial({
      color: 0x000000,
      dashSize: 0.02,
      gapSize: 0.02,
    });
  }

  /** Full geometry rebuild — call whenever the joint changes. */
  rebuild(joint: Joint, view: ViewSettings): void {
    for (const g of this.componentGroups) disposeGroup(g);
    this.root.clear();
    this.componentGroups = [];
    this.openLineGroups = [];

    this.jvertsByAxis = [0, 1, 2].map((ax) => createJointVertices(joint, ax as Axis));
    const ev = joint.eval;

    for (let n = 0; n < joint.noc; n++) {
      const group = new THREE.Group();
      const ax = joint.fixedSides[n][0].ax;
      const verts = this.jvertsByAxis[ax];

      // Faces (connected part; unconnected handled by feedback overlays)
      const faceSets = jointFaceIndices(
        ev.voxelMatrixConnected,
        joint.fixedSides[n],
        n,
        joint.dim,
        joint.fixedSides[n],
      );
      const facesMesh = new THREE.Mesh(quadGeometry(verts, faceSets.notEnds), this.faceMaterial);
      facesMesh.renderOrder = 0;
      group.add(facesMesh);
      const endsMesh = new THREE.Mesh(quadGeometry(verts, faceSets.ends), this.endGrainMaterial);
      endsMesh.renderOrder = 0;
      group.add(endsMesh);

      if (!ev.connected[n] && ev.voxelMatrixUnconnected) {
        const unconSets = jointFaceIndices(
          ev.voxelMatrixUnconnected,
          [],
          n,
          joint.dim,
          joint.fixedSides[n],
        );
        const unconMesh = new THREE.Mesh(
          quadGeometry(verts, unconSets.notEnds.concat(unconSets.ends)),
          this.faceMaterial,
        );
        group.add(unconMesh);
      }

      // Visible lines (red if feedback shows a non-interlocking component)
      const lineInds = jointLineIndices(joint.voxelMatrix, joint.fixedSides, n, joint.dim);
      const warn = view.showFeedback && !ev.interlocks[n];
      const lines = new THREE.LineSegments(
        lineGeometry(verts, lineInds),
        warn ? this.warnLineMaterial : this.lineMaterial,
      );
      lines.renderOrder = 2;
      group.add(lines);

      // Hidden lines (dashed where occluded)
      if (view.showHiddenLines) {
        const hidden = new THREE.LineSegments(lineGeometry(verts, lineInds), this.hiddenLineMaterial);
        hidden.computeLineDistances();
        hidden.renderOrder = 1;
        group.add(hidden);
      }

      // Opening direction dashes (visible only when fully open)
      const openInds = openLineIndices(n, joint.noc, joint.sax, joint.dim);
      const openLines = new THREE.LineSegments(
        lineGeometry(this.jvertsByAxis[ax], openInds),
        this.openLineMaterial,
      );
      openLines.computeLineDistances();
      openLines.renderOrder = 2;
      openLines.visible = false;
      group.add(openLines);
      this.openLineGroups.push(openLines);

      this.componentGroups.push(group);
      this.root.add(group);
    }
  }

  /** Per-frame: rotation, open translation, visibility. */
  updateTransforms(joint: Joint, view: ViewSettings): void {
    view.updateOpenRatio(joint.noc);
    this.root.rotation.order = 'XYZ';
    this.root.rotation.x = view.xrot;
    this.root.rotation.y = view.yrot;

    const moveVec: [number, number, number] = [0, 0, 0];
    moveVec[joint.sax] = view.openRatio * COMPONENT_SIZE;
    const fullyOpen = view.openRatio === 1 + 0.5 * (joint.noc - 2);
    for (let n = 0; n < this.componentGroups.length; n++) {
      const f = joint.noc > 1 ? (2 * n + 1 - joint.noc) / (joint.noc - 1) : 0;
      this.componentGroups[n].position.set(f * moveVec[0], f * moveVec[1], f * moveVec[2]);
      this.componentGroups[n].visible = !view.hidden[n];
      this.openLineGroups[n].visible = fullyOpen && !view.hidden[0] && !view.hidden[1];
    }
  }
}
