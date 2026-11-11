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
  arrowIndices,
  chessLineIndices,
  jointFaceIndices,
  jointLineIndices,
  openLineIndices,
} from './meshBuilder';
import { arrowVertices, createJointVertices, getPosVecs, VERTEX_STRIDE } from './vertexGrid';
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

/** Unbridged part colors per component (ViewSettings.unbridge_colors). */
const UNBRIDGE_COLORS: [number, number][] = [
  [0xffff99, 0x99ffff],
  [0xff99ff, 0xffcc99],
  [0xccccff, 0xf2f2f2],
];

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
  componentGroups: THREE.Group[] = [];
  overlayGroups: THREE.Group[] = [];
  private openLineGroups: THREE.LineSegments[] = [];
  /** Per-component vertex copies (by that component's first fixed axis). */
  jvertsByAxis: Float32Array[] = [];

  private readonly faceMaterial: THREE.MeshBasicMaterial;
  private readonly endGrainMaterial: THREE.MeshBasicMaterial;
  private readonly lineMaterial: THREE.LineBasicMaterial;
  private readonly warnLineMaterial: THREE.LineBasicMaterial;
  private readonly hiddenLineMaterial: THREE.LineDashedMaterial;
  private readonly openLineMaterial: THREE.LineDashedMaterial;
  private readonly unconnectedMaterial: THREE.MeshBasicMaterial;
  private readonly breakableMaterial: THREE.MeshBasicMaterial;
  private readonly unfabricatableMaterial: THREE.MeshBasicMaterial;
  private readonly chessLineMaterial: THREE.LineBasicMaterial;
  private readonly arrowMaterial: THREE.LineBasicMaterial;
  private readonly arrowWarnMaterial: THREE.LineBasicMaterial;
  private readonly arrowFaceMaterial: THREE.MeshBasicMaterial;
  private readonly arrowFaceWarnMaterial: THREE.MeshBasicMaterial;

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
    const faceOpts = {
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    } as const;
    this.unconnectedMaterial = new THREE.MeshBasicMaterial({ color: 0xff3300, ...faceOpts });
    this.breakableMaterial = new THREE.MeshBasicMaterial({ color: 0xffff66, ...faceOpts });
    this.unfabricatableMaterial = new THREE.MeshBasicMaterial({
      color: 0xffcc80,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    // The original clears the depth buffer before chess lines and arrows
    // (draw_geometries defaults) — they always render on top.
    this.chessLineMaterial = new THREE.LineBasicMaterial({ color: 0xff3300, depthTest: false });
    this.arrowMaterial = new THREE.LineBasicMaterial({ color: 0x000000, depthTest: false });
    this.arrowWarnMaterial = new THREE.LineBasicMaterial({ color: 0xff0000, depthTest: false });
    this.arrowFaceMaterial = new THREE.MeshBasicMaterial({
      color: 0x000000,
      side: THREE.DoubleSide,
      depthTest: false,
    });
    this.arrowFaceWarnMaterial = new THREE.MeshBasicMaterial({
      color: 0xff0000,
      side: THREE.DoubleSide,
      depthTest: false,
    });
  }

  /** Full geometry rebuild — call whenever the joint changes. */
  rebuild(joint: Joint, view: ViewSettings): void {
    for (const g of this.componentGroups) disposeGroup(g);
    this.root.clear();
    this.componentGroups = [];
    this.overlayGroups = [];
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

      // Unconnected voxels: red-orange with feedback on, neutral otherwise
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
          view.showFeedback ? this.unconnectedMaterial : this.faceMaterial,
        );
        group.add(unconMesh);
      }

      if (view.showFeedback) this.buildFeedback(joint, n, group, verts);

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

      const overlay = new THREE.Group();
      group.add(overlay);
      this.overlayGroups.push(overlay);

      this.componentGroups.push(group);
      this.root.add(group);
    }
  }

  /** Feedback overlays — ports of Show.unbridged/nondurable/unfabricatable/checker/arrows. */
  private buildFeedback(joint: Joint, n: number, group: THREE.Group, verts: Float32Array): void {
    const ev = joint.eval;

    // Unbridged halves in pastel color pairs (Show.unbridged)
    const unbridgedMats = ev.voxelMatricesUnbridged[n];
    if (!ev.bridged[n] && unbridgedMats) {
      const colors = UNBRIDGE_COLORS[n % UNBRIDGE_COLORS.length];
      for (let m = 0; m < 2; m++) {
        const sets = jointFaceIndices(
          unbridgedMats[m],
          [joint.fixedSides[n][m]],
          n,
          joint.dim,
          joint.fixedSides[n],
        );
        const mat = new THREE.MeshBasicMaterial({
          color: colors[m],
          side: THREE.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: 0,
          polygonOffsetUnits: 0,
        });
        group.add(new THREE.Mesh(quadGeometry(verts, sets.notEnds.concat(sets.ends)), mat));
      }
    }

    // Breakable voxels in yellow (Show.nondurable)
    if (ev.breakable[n]) {
      const sets = jointFaceIndices(ev.breakableVoxmat, [], n, joint.dim, joint.fixedSides[n]);
      const mesh = new THREE.Mesh(
        quadGeometry(verts, sets.notEnds.concat(sets.ends)),
        this.breakableMaterial,
      );
      mesh.renderOrder = 1;
      group.add(mesh);
    }

    // Unfabricatable component tinted orange (Show.unfabricatable)
    if (!ev.fabDirectionOk[n]) {
      const sets = jointFaceIndices(
        ev.voxelMatrixConnected,
        joint.fixedSides[n],
        n,
        joint.dim,
        joint.fixedSides[n],
      );
      const mesh = new THREE.Mesh(
        quadGeometry(verts, sets.notEnds.concat(sets.ends)),
        this.unfabricatableMaterial,
      );
      mesh.renderOrder = 2;
      group.add(mesh);
    }

    // Chessboard warning lines (Show.checker)
    if (ev.checker[n]) {
      const inds = chessLineIndices(ev.checkerVertices[n], joint.sax, joint.dim);
      const lines = new THREE.LineSegments(lineGeometry(verts, inds), this.chessLineMaterial);
      lines.renderOrder = 10;
      group.add(lines);
    }

    // Sliding direction arrows (Show.arrows)
    const slides = ev.slides[n];
    if (slides.length > 0) {
      const av = arrowVertices(joint);
      const { lines, faces } = arrowIndices(slides);
      const warn = !ev.interlocks[n];
      const posVecs = getPosVecs(joint);
      const d =
        joint.fixedSides[n].length === 2 ? 1.55 * COMPONENT_SIZE : 2.55 * COMPONENT_SIZE;
      for (const side of joint.fixedSides[n]) {
        const u = posVecs[side.ax];
        const len = Math.hypot(u[0], u[1], u[2]);
        const t: [number, number, number] = [
          (d * (2 * side.dir - 1) * u[0]) / len,
          (d * (2 * side.dir - 1) * u[1]) / len,
          (d * (2 * side.dir - 1) * u[2]) / len,
        ];
        const arrowGroup = new THREE.Group();
        arrowGroup.position.set(t[0], t[1], t[2]);
        const lineObj = new THREE.LineSegments(
          lineGeometry(av, lines),
          warn ? this.arrowWarnMaterial : this.arrowMaterial,
        );
        const triGeo = new THREE.BufferGeometry();
        triGeo.setAttribute('position', new THREE.BufferAttribute(expandLines(av, faces), 3));
        const triObj = new THREE.Mesh(
          triGeo,
          warn ? this.arrowFaceWarnMaterial : this.arrowFaceMaterial,
        );
        lineObj.renderOrder = 10;
        triObj.renderOrder = 10;
        arrowGroup.add(lineObj, triObj);
        group.add(arrowGroup);
      }
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
