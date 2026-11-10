import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import './style.css';

import { Joint } from './model/joint';
import { JointMesh } from './view/jointMesh';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('#app element missing');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xffffff);

const camera = new THREE.PerspectiveCamera(
  45,
  window.innerWidth / window.innerHeight,
  0.1,
  500,
);
camera.position.set(8, 6, 8);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.2);
sun.position.set(50, 80, 30);
scene.add(sun);

const joint = new Joint({ dim: 3 });
const jointMesh = new JointMesh(joint.voxelMatrix);
scene.add(jointMesh.object);

// Temporary dev helpers (replaced by real UI in later phases)
window.addEventListener('keydown', (e) => {
  if (e.key === 'r') {
    joint.randomize();
    jointMesh.rebuild(joint.voxelMatrix);
  }
  if (e.key === 'c') {
    joint.clear();
    jointMesh.rebuild(joint.voxelMatrix);
  }
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});
