/**
 * Suggestion side panel — equivalent of the original's right-hand suggestion
 * viewports. Thumbnails are rendered with a shared offscreen three.js
 * renderer and adopted on click.
 */
import * as THREE from 'three';
import type { Joint } from '../model/joint';
import { matFromFields } from '../model/heightFields';
import type { Mat2 } from '../model/types';
import { jointFaceIndices, jointLineIndices } from '../view/meshBuilder';
import { lineGeometry, quadGeometry } from '../view/jointRender';
import { createJointVertices } from '../view/vertexGrid';
import type { Axis } from '../model/types';

const THUMB_SIZE = 180;

export class SuggestionPanel {
  readonly element: HTMLDivElement;
  onPick: ((hfs: Mat2[]) => void) | null = null;

  private readonly thumbRenderer: THREE.WebGLRenderer;
  private readonly camera: THREE.OrthographicCamera;
  private suggestions: Mat2[][] = [];

  constructor(parent: HTMLElement) {
    this.element = document.createElement('div');
    this.element.id = 'suggestions';
    parent.appendChild(this.element);
    this.thumbRenderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.thumbRenderer.setSize(THUMB_SIZE, THUMB_SIZE);
    this.camera = new THREE.OrthographicCamera(-0.4, 0.4, 0.4, -0.4, 0.01, 10);
    this.camera.position.set(0, 0, 2);
    this.camera.lookAt(0, 0, 0);
  }

  setSuggestions(joint: Joint, suggestions: Mat2[][], xrot: number, yrot: number): void {
    this.suggestions = suggestions;
    this.element.innerHTML = '';
    if (suggestions.length === 0) return;
    const title = document.createElement('div');
    title.className = 'sugg-title';
    title.textContent = 'Suggestions';
    this.element.appendChild(title);
    suggestions.forEach((hfs, i) => {
      const canvas = document.createElement('canvas');
      canvas.width = THUMB_SIZE;
      canvas.height = THUMB_SIZE;
      canvas.className = 'sugg-thumb';
      canvas.title = `Apply suggestion ${i + 1}`;
      this.renderThumb(joint, hfs, canvas, xrot, yrot);
      canvas.addEventListener('click', () => this.onPick?.(this.suggestions[i]));
      this.element.appendChild(canvas);
    });
  }

  clear(): void {
    this.suggestions = [];
    this.element.innerHTML = '';
  }

  private renderThumb(
    joint: Joint,
    hfs: Mat2[],
    canvas: HTMLCanvasElement,
    xrot: number,
    yrot: number,
  ): void {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf4f4f4);
    const root = new THREE.Group();
    root.rotation.order = 'XYZ';
    root.rotation.x = xrot;
    root.rotation.y = yrot;
    scene.add(root);

    const voxmat = matFromFields(hfs, joint.sax);
    const faceMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    const lineMat = new THREE.LineBasicMaterial({ color: 0x000000 });
    for (let n = 0; n < joint.noc; n++) {
      const ax = joint.fixedSides[n][0].ax as Axis;
      const verts = createJointVertices(joint, ax);
      const sets = jointFaceIndices(voxmat, joint.fixedSides[n], n, joint.dim, joint.fixedSides[n]);
      root.add(new THREE.Mesh(quadGeometry(verts, sets.notEnds.concat(sets.ends)), faceMat));
      const lineInds = jointLineIndices(voxmat, joint.fixedSides, n, joint.dim);
      root.add(new THREE.LineSegments(lineGeometry(verts, lineInds), lineMat));
    }
    this.thumbRenderer.render(scene, this.camera);
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.drawImage(this.thumbRenderer.domElement, 0, 0);
    scene.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) o.geometry.dispose();
    });
  }
}
