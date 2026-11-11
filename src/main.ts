import * as THREE from 'three';
import './style.css';

import { Selection, SelState } from './interaction/selection';
import { Joint } from './model/joint';
import type { Vec3 } from './model/types';
import { JointRenderer } from './view/jointRender';
import { OverlayManager } from './view/overlays';
import { PickingPass } from './view/picking';
import { ViewSettings } from './view/viewSettings';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('#app element missing');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xffffff);

// The original renders in NDC with only a model rotation (no projection
// uniform), i.e. effectively orthographic. Match with an ortho camera.
const frustumSize = 1.6;
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 10);
camera.position.set(0, 0, 2);
camera.lookAt(0, 0, 0);

function updateCamera(): void {
  const aspect = window.innerWidth / window.innerHeight;
  camera.left = (-frustumSize * aspect) / 2;
  camera.right = (frustumSize * aspect) / 2;
  camera.top = frustumSize / 2;
  camera.bottom = -frustumSize / 2;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
updateCamera();

const endGrainTexture = new THREE.TextureLoader().load('/textures/end_grain.jpg');
endGrainTexture.wrapS = THREE.RepeatWrapping;
endGrainTexture.wrapT = THREE.RepeatWrapping;
endGrainTexture.colorSpace = THREE.SRGBColorSpace;

const joint = new Joint({ dim: 3 });
const view = new ViewSettings();
const select = new Selection(joint);
const jointRenderer = new JointRenderer(endGrainTexture);
const pickPass = new PickingPass();
const overlays = new OverlayManager();
scene.add(jointRenderer.root);

function refresh(): void {
  jointRenderer.rebuild(joint, view);
  pickPass.build(joint, jointRenderer.componentGroups, jointRenderer.jvertsByAxis);
}
refresh();

// Screen projection helpers for Selection (model rotation → screen plane)
const projEuler = new THREE.Euler(0, 0, 0, 'XYZ');
function projectFull(v: Vec3): Vec3 {
  projEuler.set(view.xrot, view.yrot, 0, 'XYZ');
  const t = new THREE.Vector3(v[0], v[1], v[2]).applyEuler(projEuler);
  return [t.x, t.y, t.z];
}
function project(v: Vec3): [number, number] {
  const [x, y] = projectFull(v);
  return [x, y];
}
select.projectFull = projectFull;

// --- Mouse interaction
const mouse = { x: 0, y: 0 };
let lastClickTime = 0;

function canvasSize(): [number, number] {
  return [renderer.domElement.clientWidth, renderer.domElement.clientHeight];
}

function doPick(): void {
  const res = pickPass.pick(renderer, scene, camera, mouse.x, mouse.y);
  select.suggState = -1;
  if (res && res.x !== null && res.y !== null && res.dir !== null) {
    const changed =
      res.x !== select.x ||
      res.y !== select.y ||
      res.n !== select.n ||
      res.dir !== select.dir ||
      select.refresh;
    if (changed) {
      select.updatePick(res.x, res.y, res.n, res.dir);
      select.refresh = false;
    }
    select.state = SelState.FaceHovered;
    return;
  }
  if (res) {
    select.state = SelState.BodyHovered;
    select.updatePick(null, null, res.n, 0);
    return;
  }
  select.state = SelState.None;
  select.n = null;
}

renderer.domElement.addEventListener('mousedown', (e) => {
  if (e.button === 0) {
    const now = performance.now();
    if (now - lastClickTime < 200) {
      view.openJoint = !view.openJoint;
    } else if (select.state === SelState.FaceHovered) {
      select.startPull([mouse.x, mouse.y]);
    } else if (select.state === SelState.BodyHovered) {
      select.startMove([mouse.x, mouse.y], canvasSize()[1]);
    }
    lastClickTime = now;
  }
  if (e.button === 2) view.startRotation(e.clientX, e.clientY);
});

renderer.domElement.addEventListener('mousemove', (e) => {
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = e.clientX - rect.left;
  mouse.y = e.clientY - rect.top;
  view.updateRotation(e.clientX, e.clientY);
  const [w, h] = canvasSize();
  if (select.state === SelState.Pulling) select.edit([mouse.x, mouse.y], project, w, h);
  if (select.state === SelState.Moving) select.move([mouse.x, mouse.y], project, w, h);
});

window.addEventListener('mouseup', (e) => {
  if (e.button === 0) {
    if (select.state === SelState.Pulling) {
      select.endPull();
      refresh();
    } else if (select.state === SelState.Moving) {
      if (select.endMove()) refresh();
    }
  }
  if (e.button === 2) view.endRotation();
});
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());

window.addEventListener('keydown', (e) => {
  if (e.key === 'Shift') {
    select.shift = true;
    select.refresh = true;
    return;
  }
  switch (e.key) {
    case 'r':
      joint.randomize();
      refresh();
      return;
    case 'c':
      joint.clear();
      refresh();
      return;
    case ' ':
      view.openJoint = !view.openJoint;
      e.preventDefault();
      return;
    case 'h':
      view.showHiddenLines = !view.showHiddenLines;
      refresh();
      return;
    case 'f':
      view.showFeedback = !view.showFeedback;
      refresh();
      return;
  }
});
window.addEventListener('keyup', (e) => {
  if (e.key === 'Shift') {
    select.shift = false;
    select.refresh = true;
  }
});

window.addEventListener('resize', updateCamera);

renderer.setAnimationLoop(() => {
  jointRenderer.updateTransforms(joint, view);
  // Hover picking when not actively editing (original pick pass behavior)
  if (select.state !== SelState.Pulling && select.state !== SelState.Moving) doPick();
  overlays.update(joint, select, jointRenderer.overlayGroups, jointRenderer.jvertsByAxis);
  renderer.render(scene, camera);
});

// Dev/debug hook (also used by automated visual checks)
declare global {
  interface Window {
    __tsugite?: {
      joint: Joint;
      view: ViewSettings;
      select: Selection;
      refresh: () => void;
      capture: () => string;
      jointRenderer: JointRenderer;
      pick: (x: number, y: number) => unknown;
    };
  }
}
window.__tsugite = {
  joint,
  view,
  select,
  refresh,
  jointRenderer,
  pick: (x: number, y: number) => pickPass.pick(renderer, scene, camera, x, y),
  capture: () => {
    jointRenderer.updateTransforms(joint, view);
    overlays.update(joint, select, jointRenderer.overlayGroups, jointRenderer.jvertsByAxis);
    renderer.render(scene, camera);
    return renderer.domElement.toDataURL('image/png');
  },
};
