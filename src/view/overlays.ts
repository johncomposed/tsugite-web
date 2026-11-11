/**
 * Interaction overlays — hovered face highlight (Show.selected), pull
 * preview outlines, and component move/rotate preview outline.
 */
import * as THREE from 'three';
import type { Selection } from '../interaction/selection';
import { SelState } from '../interaction/selection';
import type { Joint } from '../model/joint';
import { insertAxis } from '../model/types';
import {
  componentOutlineIndices,
  jointSelectedTopLineIndices,
} from './meshBuilder';
import { lineGeometry, quadGeometry } from './jointRender';
import { getIndex } from './vertexGrid';

export class OverlayManager {
  private readonly hoverMaterial = new THREE.MeshBasicMaterial({
    color: 0x333333,
    transparent: true,
    opacity: 0.55,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  private readonly pullMaterial = new THREE.LineDashedMaterial({
    color: 0x000000,
    dashSize: 0.01,
    gapSize: 0.01,
  });
  private readonly moveMaterial = new THREE.LineDashedMaterial({
    color: 0x000000,
    dashSize: 0.01,
    gapSize: 0.01,
  });

  /** Rebuild overlay objects into the per-component overlay groups. */
  update(
    joint: Joint,
    select: Selection,
    overlayGroups: THREE.Group[],
    jvertsByAxis: Float32Array[],
  ): void {
    for (const g of overlayGroups) {
      g.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) o.geometry.dispose();
      });
      g.clear();
    }
    if (select.n === null) return;
    const n = select.n;
    const group = overlayGroups[n];
    if (!group) return;
    const verts = jvertsByAxis[joint.fixedSides[n][0].ax];

    // Hovered / selected top faces (dark grey)
    if (
      (select.state === SelState.FaceHovered || select.state === SelState.Pulling) &&
      select.x !== null &&
      select.y !== null
    ) {
      const quads: number[] = [];
      for (const [fx, fy] of select.faces) {
        const h = joint.heightFields[n - select.dir][fx][fy];
        const ind = insertAxis([fx, fy], joint.sax, h);
        for (let x = 0; x < 2; x++) {
          for (let y = 0; y < 2; y++) {
            const add = insertAxis([x, Math.abs(y - x)], joint.sax, 0);
            quads.push(getIndex(ind, add, joint.dim));
          }
        }
      }
      const mesh = new THREE.Mesh(quadGeometry(verts, quads), this.hoverMaterial);
      mesh.renderOrder = 3;
      group.add(mesh);
    }

    // Pull preview: dashed outline at each pulled step
    if (select.state === SelState.Pulling && select.x !== null && select.y !== null) {
      const h = joint.heightFields[n - select.dir][select.faces[0][0]][select.faces[0][1]];
      const outline = jointSelectedTopLineIndices(select.faces, h, joint.sax, joint.dim);
      const baseGeo = lineGeometry(verts, outline);
      const absVal = Math.abs(select.val);
      for (let step = 0; step <= absVal; step++) {
        const val = select.val < 0 ? -step : step;
        const lines = new THREE.LineSegments(baseGeo.clone(), this.pullMaterial);
        lines.computeLineDistances();
        const t: [number, number, number] = [0, 0, 0];
        t[joint.sax] = val * joint.voxelSizes[joint.sax];
        lines.position.set(t[0], t[1], t[2]);
        lines.renderOrder = 4;
        group.add(lines);
      }
      baseGeo.dispose();
    }

    // Move/rotate preview: dashed outline of the new component position
    if (select.state === SelState.Moving && select.newFixedSidesForDisplay) {
      const outline = componentOutlineIndices(select.newFixedSidesForDisplay, joint.dim);
      const lines = new THREE.LineSegments(lineGeometry(verts, outline), this.moveMaterial);
      lines.computeLineDistances();
      lines.renderOrder = 4;
      group.add(lines);
    }
  }
}
