import * as THREE from 'three';
import './style.css';

import { Selection, SelState } from './interaction/selection';
import { Joint } from './model/joint';
import { fixedSidesToString } from './model/fixedSides';
import type { Mat2, Vec3 } from './model/types';
import { SuggestionPanel } from './ui/suggestionPanel';
import type { SuggestionResponse } from './workers/suggestionWorker';
import { buildMillContext, millingPathVertices } from './fab/millingPath';
import { exportGcode } from './fab/gcode';
import type { MillVertex } from './fab/millVertex';
import { ControlPanel } from './ui/controlPanel';
import { parseTsu, serializeTsu } from './io/tsu';
import { PerfMonitor } from './perf/perfMonitor';
import { matFromFields } from './model/heightFields';
import { Evaluation } from './model/evaluation';
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
const perf = new PerfMonitor(document.body);
scene.add(jointRenderer.root);

// --- Suggestions (worker, port of Types.update_suggestions)
const suggestionPanel = new SuggestionPanel(document.body);
const suggestionWorker = new Worker(new URL('./workers/suggestionWorker.ts', import.meta.url), {
  type: 'module',
});
let suggestionRequestId = 0;
const suggestionSentAt = new Map<number, number>();
suggestionWorker.onmessage = (e: MessageEvent<SuggestionResponse>) => {
  const sent = suggestionSentAt.get(e.data.id);
  suggestionSentAt.delete(e.data.id);
  if (e.data.id !== suggestionRequestId) return; // stale
  if (sent !== undefined) perf.record('suggestions (worker)', performance.now() - sent);
  suggestionPanel.setSuggestions(joint, e.data.suggestions, view.xrot, view.yrot);
};
suggestionPanel.onPick = (hfs: Mat2[]) => {
  joint.heightFields = hfs.map((hf) => hf.map((row) => row.slice()));
  joint.recompute();
  refresh();
};

function updateSuggestions(): void {
  suggestionRequestId++;
  if (joint.eval.valid || !view.showSuggestions) {
    suggestionPanel.clear();
    return;
  }
  suggestionSentAt.set(suggestionRequestId, performance.now());
  suggestionWorker.postMessage({
    id: suggestionRequestId,
    dim: joint.dim,
    sax: joint.sax,
    fss: fixedSidesToString(joint.fixedSides),
    hfs: joint.heightFields,
  });
}

function computeMillingPaths(): { display: Float32Array[]; mill: MillVertex[][] } {
  const ctx = buildMillContext(joint, jointRenderer.jvertsByAxis[0]);
  const display: Float32Array[] = [];
  const mill: MillVertex[][] = [];
  for (let n = 0; n < joint.noc; n++) {
    const { displayPoints, millVertices } = millingPathVertices(ctx, n);
    display.push(displayPoints);
    mill.push(millVertices);
  }
  return { display, mill };
}

function refresh(): void {
  perf.time('rebuild', () => jointRenderer.rebuild(joint, view));
  perf.time('pick build', () =>
    pickPass.build(joint, jointRenderer.componentGroups, jointRenderer.jvertsByAxis),
  );
  if (view.showMillingPath) {
    const display = perf.time('milling path', () => computeMillingPaths().display);
    jointRenderer.addMillingPaths(joint, display);
  }
  updateSuggestions();
  updateValidity();
}

function downloadExports(): void {
  const { mill } = computeMillingPaths();
  for (const file of exportGcode(joint, mill, fileBaseName)) {
    downloadBlob(file.name, file.content);
  }
  statusMessage(`Exported ${joint.noc} ${joint.fab.ext} file(s)`);
}

function downloadBlob(name: string, content: string): void {
  const blob = new Blob([content], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

// --- Status bar
const statusBar = document.createElement('div');
statusBar.id = 'status-bar';
const statusText = document.createElement('span');
statusText.textContent =
  "Open/close the joint by double-clicking. Pull faces to edit. Right-drag rotates.";
const validityText = document.createElement('span');
statusBar.append(statusText, validityText);
document.body.appendChild(statusBar);

let statusTimer = 0;
function statusMessage(msg: string): void {
  statusText.textContent = msg;
  window.clearTimeout(statusTimer);
  statusTimer = window.setTimeout(() => {
    statusText.textContent =
      "Open/close the joint by double-clicking. Pull faces to edit. Right-drag rotates.";
  }, 4000);
}

function updateValidity(): void {
  if (joint.eval.valid) {
    validityText.textContent = 'VALID JOINT';
    validityText.className = 'valid';
    return;
  }
  const issues: string[] = [];
  if (!joint.eval.interlock) issues.push('not interlocking');
  if (!joint.eval.connected.every(Boolean)) issues.push('unconnected voxels');
  if (!joint.eval.bridged.every(Boolean)) issues.push('unbridged');
  if (joint.eval.checker.some(Boolean)) issues.push('checkerboard');
  if (joint.eval.breakable.some(Boolean)) issues.push('fragile grain');
  if (!joint.eval.fabDirectionOk.every(Boolean)) issues.push('unfabricatable');
  validityText.textContent = `INVALID: ${issues.join(', ')}`;
  validityText.className = 'invalid';
}

// --- File handling
let fileBaseName = 'Untitled';

function newFile(): void {
  joint.reset();
  fileBaseName = 'Untitled';
  refresh();
  controlPanel.rebuild();
  statusMessage('New joint');
}

function openFile(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.tsu';
  input.addEventListener('change', async () => {
    const f = input.files?.[0];
    if (!f) return;
    const data = parseTsu(await f.text());
    joint.reset({
      sax: data.sax,
      dim: data.dim,
      ang: data.ang,
      realTimDims: data.realTimDims,
      fixedSides: data.fixedSides,
      heightFields: data.heightFields,
      incremental: data.incremental,
      fab: data.fab,
    });
    fileBaseName = f.name.replace(/\.tsu$/i, '');
    refresh();
    controlPanel.rebuild();
    statusMessage(`Opened ${f.name}`);
  });
  input.click();
}

function saveFile(): void {
  downloadBlob(`${fileBaseName}.tsu`, serializeTsu(joint));
  statusMessage(`Saved ${fileBaseName}.tsu`);
}

async function loadExample(name: string): Promise<void> {
  try {
    const res = await fetch(`/examples/${name}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = parseTsu(await res.text());
    joint.reset({
      sax: data.sax,
      dim: data.dim,
      ang: data.ang,
      realTimDims: data.realTimDims,
      fixedSides: data.fixedSides,
      heightFields: data.heightFields,
      incremental: data.incremental,
      fab: data.fab,
    });
    fileBaseName = name.replace(/\.tsu$/i, '');
    refresh();
    controlPanel.rebuild();
    statusMessage(
      `Loaded ${name} — ${joint.eval.valid ? 'valid joint' : 'INVALID joint (see feedback)'}`,
    );
  } catch (err) {
    statusMessage(`Failed to load ${name}: ${String(err)}`);
  }
}

const controlPanel = new ControlPanel(document.body, joint, view, {
  refresh,
  statusMessage,
  newFile,
  openFile,
  saveFile,
  exportFiles: downloadExports,
  loadExample: (name) => void loadExample(name),
});
refresh();

// Populate the examples dropdown: fetch each example and evaluate it with
// the ported engine so the dropdown groups valid vs invalid joints.
async function loadExampleIndex(): Promise<void> {
  const res = await fetch('/examples/index.json');
  if (!res.ok) return;
  const names: string[] = await res.json();
  if (!Array.isArray(names) || names.length === 0) return;
  const examples = await Promise.all(
    names.map(async (name) => {
      try {
        const text = await (await fetch(`/examples/${name}`)).text();
        const data = parseTsu(text);
        const voxmat = matFromFields(data.heightFields, data.sax);
        const ev = new Evaluation(voxmat, {
          fixedSides: data.fixedSides,
          sax: data.sax,
          noc: data.fixedSides.length,
          dim: data.dim,
        });
        return { name, valid: ev.valid };
      } catch {
        return { name, valid: false };
      }
    }),
  );
  controlPanel.setExamples(examples);
}
void loadExampleIndex();

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
  const res = perf.time('pick', () => pickPass.pick(renderer, scene, camera, mouse.x, mouse.y));
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

// --- Zoom: mouse wheel and trackpad pinch (ctrl+wheel), touch pinch
renderer.domElement.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const sensitivity = e.ctrlKey ? 0.01 : 0.0015; // pinch gestures send ctrlKey
    view.applyZoom(Math.exp(-e.deltaY * sensitivity));
  },
  { passive: false },
);

let pinchDist: number | null = null;
renderer.domElement.addEventListener(
  'touchstart',
  (e) => {
    if (e.touches.length === 2) {
      pinchDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY,
      );
    }
  },
  { passive: true },
);
renderer.domElement.addEventListener(
  'touchmove',
  (e) => {
    if (e.touches.length !== 2 || pinchDist === null) return;
    e.preventDefault();
    const dist = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY,
    );
    if (pinchDist > 0) view.applyZoom(dist / pinchDist);
    pinchDist = dist;
  },
  { passive: false },
);
renderer.domElement.addEventListener('touchend', () => {
  pinchDist = null;
});

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
    case 'm':
      view.showMillingPath = !view.showMillingPath;
      refresh();
      return;
    case 'g':
      downloadExports();
      return;
    case 'p':
      perf.toggle();
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
  if (camera.zoom !== view.zoom) {
    camera.zoom = view.zoom;
    camera.updateProjectionMatrix();
  }
  jointRenderer.updateTransforms(joint, view);
  // Hover picking when not actively editing (original pick pass behavior)
  if (select.state !== SelState.Pulling && select.state !== SelState.Moving) doPick();
  overlays.update(joint, select, jointRenderer.overlayGroups, jointRenderer.jvertsByAxis);
  renderer.render(scene, camera);
  perf.frame({
    calls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    lines: renderer.info.render.lines,
  });
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
