/**
 * GPU color picking — equivalent of Show.pick(). Pick meshes live on layer 1
 * of the same component groups (so open/rotate transforms apply), each top
 * face cell gets a unique flat color, bodies get a component color.
 */
import * as THREE from 'three';
import type { Joint } from '../model/joint';
import { jointTopFaceIndices } from './meshBuilder';
import { VERTEX_STRIDE } from './vertexGrid';

export const PICK_LAYER = 1;

export interface PickResult {
  n: number;
  dir: number | null; // null → component body
  x: number | null;
  y: number | null;
}

/** id 0 = background. Bodies: 1..noc. Tops: TOP_BASE + (n*2+m)*dim² + cell. */
const TOP_BASE = 16;

function idToColor(id: number): [number, number, number] {
  return [(id & 255) / 255, ((id >> 8) & 255) / 255, 0];
}

export class PickingPass {
  private target: THREE.WebGLRenderTarget;
  private pixel = new Uint8Array(4);
  /** sdirs per component (maps pick m-slot → dir). */
  private sdirs: number[][] = [];
  private dim = 0;

  constructor() {
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
    });
  }

  /** Build pick meshes into the per-component groups (layer 1). */
  build(joint: Joint, componentGroups: THREE.Group[], jvertsByAxis: Float32Array[]): void {
    this.sdirs = [];
    this.dim = joint.dim;
    for (let n = 0; n < joint.noc; n++) {
      const group = componentGroups[n];
      const verts = jvertsByAxis[joint.fixedSides[n][0].ax];
      const { notTops, tops, mos } = jointTopFaceIndices(
        joint.voxelMatrix,
        joint.fixedSides[n],
        n,
        joint.noc,
        joint.sax,
        joint.dim,
      );
      let sdirs = [0, 1];
      if (n === 0) sdirs = [0];
      else if (n === joint.noc - 1) sdirs = [1];
      this.sdirs.push(sdirs);

      // Body mesh (flat component id color)
      const bodyGeo = this.quadsToGeometry(verts, notTops, () => idToColor(1 + n));
      const bodyMesh = new THREE.Mesh(
        bodyGeo,
        new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }),
      );
      bodyMesh.layers.set(PICK_LAYER);
      group.add(bodyMesh);

      // Top-face mesh: tops has mos*4 indices per (i,j) cell; -1 placeholders
      const dim = joint.dim;
      const validTops: number[] = [];
      const colorPerQuad: [number, number, number][] = [];
      for (let cell = 0; cell < dim * dim; cell++) {
        for (let m = 0; m < mos; m++) {
          const base = mos * 4 * cell + 4 * m;
          if (tops[base] < 0) continue;
          validTops.push(tops[base], tops[base + 1], tops[base + 2], tops[base + 3]);
          colorPerQuad.push(idToColor(TOP_BASE + (n * 2 + m) * dim * dim + cell));
        }
      }
      const topGeo = this.quadsToGeometry(verts, validTops, (q) => colorPerQuad[q]);
      const topMesh = new THREE.Mesh(
        topGeo,
        new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }),
      );
      topMesh.layers.set(PICK_LAYER);
      group.add(topMesh);
    }
  }

  private quadsToGeometry(
    verts: Float32Array,
    quadIndices: number[],
    colorForQuad: (q: number) => [number, number, number],
  ): THREE.BufferGeometry {
    const quadCount = Math.floor(quadIndices.length / 4);
    const positions = new Float32Array(quadCount * 6 * 3);
    const colors = new Float32Array(quadCount * 6 * 3);
    let p = 0;
    for (let q = 0; q < quadCount; q++) {
      const [r, g, b] = colorForQuad(q);
      const order = [0, 1, 2, 0, 2, 3];
      for (const o of order) {
        const vi = quadIndices[4 * q + o];
        const off = vi * VERTEX_STRIDE;
        positions[p] = verts[off];
        colors[p++] = r;
        positions[p] = verts[off + 1];
        colors[p++] = g;
        positions[p] = verts[off + 2];
        colors[p++] = b;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return geo;
  }

  /**
   * Render the pick pass and decode the pixel under (cssX, cssY).
   * Equivalent of Show.pick + the pixel-decode block in paintGL.
   */
  /** Pick render scale (faces are large targets; half-res is plenty). */
  scale = 0.5;

  pick(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    cssX: number,
    cssY: number,
  ): PickResult | null {
    const size = renderer.getSize(new THREE.Vector2());
    const pr = renderer.getPixelRatio() * this.scale;
    const w = Math.max(1, Math.floor(size.x * pr));
    const h = Math.max(1, Math.floor(size.y * pr));
    if (this.target.width !== w || this.target.height !== h) this.target.setSize(w, h);

    const prevBg = scene.background;
    const prevMask = camera.layers.mask;
    scene.background = new THREE.Color(0x000000);
    camera.layers.set(PICK_LAYER);
    renderer.setRenderTarget(this.target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    camera.layers.mask = prevMask;
    scene.background = prevBg;

    const px = Math.min(w - 1, Math.max(0, Math.floor(cssX * pr)));
    const py = Math.min(h - 1, Math.max(0, Math.floor((size.y - cssY) * pr)));
    renderer.readRenderTargetPixels(this.target, px, py, 1, 1, this.pixel);
    return this.decode(this.pixel[0] + (this.pixel[1] << 8));
  }

  /**
   * Async variant: renders the pick pass, then reads the pixel back without
   * stalling the GPU pipeline (hover resolves a frame later).
   */
  async pickAsync(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    cssX: number,
    cssY: number,
  ): Promise<PickResult | null> {
    const size = renderer.getSize(new THREE.Vector2());
    const pr = renderer.getPixelRatio() * this.scale;
    const w = Math.max(1, Math.floor(size.x * pr));
    const h = Math.max(1, Math.floor(size.y * pr));
    if (this.target.width !== w || this.target.height !== h) this.target.setSize(w, h);

    const prevBg = scene.background;
    const prevMask = camera.layers.mask;
    scene.background = new THREE.Color(0x000000);
    camera.layers.set(PICK_LAYER);
    renderer.setRenderTarget(this.target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    camera.layers.mask = prevMask;
    scene.background = prevBg;

    const px = Math.min(w - 1, Math.max(0, Math.floor(cssX * pr)));
    const py = Math.min(h - 1, Math.max(0, Math.floor((size.y - cssY) * pr)));
    const buf = new Uint8Array(4);
    await renderer.readRenderTargetPixelsAsync(this.target, px, py, 1, 1, buf);
    return this.decode(buf[0] + (buf[1] << 8));
  }

  private decode(id: number): PickResult | null {
    if (id === 0) return null;
    if (id < TOP_BASE) {
      const n = id - 1;
      return { n, dir: null, x: null, y: null };
    }
    return this.decodeTop(id);
  }

  private decodeTop(id: number): PickResult {
    const rest = id - TOP_BASE;
    const dim = this.dim;
    const nm = Math.floor(rest / (dim * dim));
    const cell = rest % (dim * dim);
    const n = Math.floor(nm / 2);
    const m = nm % 2;
    const dir = this.sdirs[n]?.[m] ?? m;
    // tops were collected per (i,j) row-major
    const x = Math.floor(cell / dim);
    const y = cell % dim;
    return { n, dir, x, y };
  }
}
