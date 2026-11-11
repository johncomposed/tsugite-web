import * as THREE from 'three';
import './style.css';

import { Joint } from './model/joint';
import { JointRenderer } from './view/jointRender';
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
const jointRenderer = new JointRenderer(endGrainTexture);
jointRenderer.rebuild(joint, view);
scene.add(jointRenderer.root);

function refresh(): void {
  jointRenderer.rebuild(joint, view);
}

// --- Interaction (original bindings: double-click open/close, right-drag rotate)
let lastClickTime = 0;
renderer.domElement.addEventListener('mousedown', (e) => {
  if (e.button === 0) {
    const now = performance.now();
    if (now - lastClickTime < 200) view.openJoint = !view.openJoint;
    lastClickTime = now;
  }
  if (e.button === 2) view.startRotation(e.clientX, e.clientY);
});
renderer.domElement.addEventListener('mousemove', (e) => {
  view.updateRotation(e.clientX, e.clientY);
});
window.addEventListener('mouseup', (e) => {
  if (e.button === 2) view.endRotation();
});
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());

window.addEventListener('keydown', (e) => {
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
  }
});

window.addEventListener('resize', updateCamera);

renderer.setAnimationLoop(() => {
  jointRenderer.updateTransforms(joint, view);
  renderer.render(scene, camera);
});

// Dev/debug hook (also used by automated visual checks)
declare global {
  interface Window {
    __tsugite?: {
      joint: Joint;
      view: ViewSettings;
      refresh: () => void;
      capture: () => string;
      jointRenderer: JointRenderer;
    };
  }
}
window.__tsugite = {
  joint,
  view,
  refresh,
  jointRenderer,
  capture: () => {
    jointRenderer.updateTransforms(joint, view);
    renderer.render(scene, camera);
    return renderer.domElement.toDataURL('image/png');
  },
};
