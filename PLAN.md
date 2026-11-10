# Tsugite Web — Full Porting Plan

Port of the original Python/PyQt5/OpenGL Tsugite (UIST 2020, ~5,000 LOC) to
TypeScript + Vite + three.js. Goal: feature parity for design, real-time
evaluation feedback, and fabrication export — running entirely in the browser.

## Source map (original → web)

| Original file | LOC | Responsibility | Web module |
|---|---|---|---|
| `Misc.py` | 70 | `FixedSide`, `FixedSides` (component attachment) | `src/model/fixedSides.ts` |
| `Geometries.py` | 769 | Height fields → voxel matrix; mesh index building | `src/model/geometry.ts` + `src/view/meshBuilder.ts` |
| `Evaluation.py` | 943 | Validity: connectivity, bridging, interlock, checkerboard, fragility, friction/contact, fab direction | `src/model/evaluation.ts` |
| `Types.py` | 1324 | Root aggregate (joint params), vertex generation, suggestions, `.tsu` save/open, milling-path layer logic | split: `src/model/joint.ts`, `src/model/suggestions.ts`, `src/io/tsu.ts`, `src/fab/millingPath.ts` |
| `Fabrication.py` | 309 | `MillVertex`, arcs, G-code/SBP/NC export | `src/fab/gcode.ts`, `src/fab/millVertex.ts` |
| `Selection.py` | 207 | Hover/pull/move interaction state machine | `src/interaction/selection.ts` |
| `Show.py` + `Buffer.py` + `ViewSettings.py` | 631 | Rendering, shaders, picking, view state | `src/view/*` (three.js replaces most) |
| `Tsugite_app.py` + `_mainWindow.py` + `_GLWidget.py` | 815 | Qt UI, events, main loop | `src/ui/*` + `src/main.ts` |

## Architecture decisions

1. **Height fields are the source of truth**, not the voxel grid. The
   original stores `noc-1` height fields (dim×dim int matrices) and derives
   `voxel_matrix` via `mat_from_fields(hfs, sax)`. Mirror exactly — this is
   what makes push/pull edits, suggestions, and `.tsu` round-tripping work.
   (The current scaffold's `src/model/joint.ts` has this backwards; replace
   its voxel-first API.)
2. **Pure core, no three.js imports in `src/model` or `src/fab`.** All
   geometry/evaluation code operates on plain arrays so it is unit-testable
   (Vitest) and portable. Validate against the original by fixture: load the
   repo's `.tsu` files, compare evaluation results and exported G-code
   line-by-line with the `.sbp`/`.gcode` files checked into tsugite-original.
3. **three.js for rendering** with custom BufferGeometry built from the same
   vertex/index logic as `Geometries.py` (quads → two triangles). Keep the
   original's single shared vertex buffer concept: one position array per
   axis-orientation, index groups per feedback type.
4. **GPU color picking** as in `Show.pick()`: render pick IDs to an
   offscreen render target, read one pixel under the cursor. This matches
   original behavior (per-face picking of dim×dim tops per component per
   side) better than raycasting against merged quads, and ports directly.
5. **State/UI**: no framework — a thin reactive store (plain TS pub/sub) and
   hand-rolled control panel, or lil-gui for sliders during development then
   custom panel in Phase 6. Keep UI strictly separated from core.

## Core data types

```ts
type Axis = 0 | 1 | 2;
interface FixedSide { ax: Axis; dir: 0 | 1 }            // Misc.FixedSide
type HeightField = Int8Array & { dim: number };          // dim×dim
interface JointState {
  sax: Axis;                 // sliding axis
  noc: number;               // 2..6 components
  dim: number;               // 2..5 voxel resolution
  ang: number;               // intersection angle
  realTimDims: [number, number, number];  // timber mm
  fixedSides: FixedSide[][]; // per component
  heightFields: HeightField[];            // noc-1 fields
  fab: FabSettings;          // dia, tol, speed, spindle, ext, alignAx, interp, incremental
}
```

## Phases

### Phase 1 — Core model (pure TS; no rendering changes)
- `fixedSides.ts`: `FixedSide.unique`, `FixedSides.sidesFromString`,
  `updateUnblocked`, rotation-allowed flag.
- `geometry.ts`: `getRandomHeightFields`, `matFromFields`, `editHeightFields`
  (with the push-down/pull-up cascade for noc>2), `clear/randomize`.
- `evaluation.ts`: full `Evaluation` port —
  `addFixedSides` (padding + corner -1s), `isConnected`,
  `separateUnconnected`, bridging + `separateUnbridged`,
  `isFabDirectionOk`, `getChessboardVertics`, `getSlidingDirections`,
  interlock logic, `getFrictionAndContactAreas`, `getBreakableVoxels`
  (per-layer 2D region analysis), `valid` flag.
- `io/tsu.ts`: parse/serialize the `.tsu` text format (SAX/NOT/RES/ANG/TD*/
  DIA/TOL/SPE/SPI/INC/FIN/ALN/EXT/FSS/HFS keys).
- **Tests**: Vitest fixtures from every `.tsu` in tsugite-original; assert
  round-trip equality and evaluation invariants (the shipped files are valid
  joints).

### Phase 2 — Rendering parity
- `view/vertexGrid.ts`: port `create_joint_vertices` — (dim+1)³ lattice per
  axis with texture coords, component-base vertices, angled-joint rotation
  of position vectors (`ang`, `rot`).
- `view/meshBuilder.ts`: port the index builders from `Geometries.py`
  (`joint_face_indices`, `joint_line_indices`, `joint_top_face_indices`,
  `open_line_indices`, `chess_line_indices`, arrow geometry) emitting
  triangle/line BufferGeometry groups keyed by feedback type.
- `view/scene.ts`: perspective camera matching original feel (fixed-target
  rotation, not full orbit: xrot/yrot drag like `ViewSettings`), white bg,
  end-grain texture on component ends (port `textures/*.jpg`).
- Joint opening animation (`open_ratio`, animated translate along sax,
  double-click / button toggles, dashed lines when fully open).
- Hidden-line rendering: original uses stencil tricks; use three.js
  equivalents (depth-tested dashed `LineSegments` behind faces; polygon
  offset).

### Phase 3 — Interaction
- `interaction/selection.ts`: port the state machine (-1 idle, 0 face
  hovered, 2 pulling, 10 body hovered, 12 moving/rotating).
- GPU picking of top faces (per component, per side, dim×dim cells) via an
  offscreen pick pass; Shift = select all same-height neighbors
  (`getSameHeightNeighbors`).
- Pull editing: mouse-drag vector projected against screen-space sliding
  axis → integer height delta, live dashed preview outline, commit on
  release (`editHeightFields`).
- Component move/rotate: drag component body to change its fixed sides
  (L↔T transitions, rotation mode), blocked-direction checks, dashed
  preview outline.
- Keyboard/menu equivalents: open/close joint, randomize (R), clear (C),
  feedback toggle, hidden lines, show/hide components A–D, axonometric /
  closest-plane rotation snapping.

### Phase 4 — Evaluation feedback display
Per original `Show`/paint loop, all driven by `Evaluation`:
- Red component outline + sliding-direction arrows when not interlocked.
- Unconnected voxels tinted red-orange (hidden geometry lighter).
- Unbridged halves in distinct pastel color pairs.
- Checkerboard (chess) warning lines, thick red-orange.
- Nondurable/breakable voxels in yellow with outline lines.
- Unfabricatable component tinted orange.
- Friction/contact area textures (optional toggle, as original `show_area`).

### Phase 5 — Suggestions panel
- `model/suggestions.ts`: port `produce_suggestions` (±1 on each height
  field cell, evaluate, collect up to 4 valid) — run in a Web Worker to keep
  the UI thread free (original blocks; we can do better with no logic change).
- Right-side panel rendering the 4 suggestion meshes in mini-viewports
  (separate scissored views like the original, or small offscreen canvases);
  click to adopt.
- Skip the file-based gallery (`search_results/`) initially; design the
  suggestion provider interface so a gallery source can be added later.

### Phase 6 — Fabrication
- `fab/millVertex.ts`: `MillVertex` with arcs, `scaleAndSwap`, `rotate`.
- `fab/millingPath.ts`: port the layer pipeline from `Types.py`:
  `layer_mat_from_cube` → `pad_layer_mat_with_fixed_sides` → region
  detection (`get_diff_neighbors`) → `RoughPixel` rough paths → region
  outline (`RegionVertex`, ordering, offsetting with rounded inner-corner
  arcs + corner artifacts) → `get_layered_vertices` (depth stepping,
  incremental option) → edge paths for oblique joints.
- `fab/gcode.ts`: G-code / .nc / .sbp writers (G2/G3 arcs vs interpolated,
  axis alignment rotation, per-component A/B/C files). Browser download via
  Blob; zip when noc > 1 (fflate).
- Milling path visualization: colored polylines per component (toggle).
- **Tests**: byte-compare (modulo float formatting) against the original's
  exported `.sbp`/`.gcode` files for the checked-in `.tsu` fixtures —
  `test_joint.tsu` → `test_joint_A/B.sbp`, `my_joint.tsu` → `.gcode`, etc.

### Phase 7 — UI chrome & polish
- Control panel replicating `Tsugite.ui`: sliding axis dropdown, number of
  timbers (2–6), resolution (2–5), angle, timber XYZ dims (+cube lock),
  randomize/clear; fabrication: bit diameter, tolerance, speed, spindle,
  alignment axis, incremental & arc-interpolation checkboxes,
  gcode/nc/sbp radio, milling path toggle, export button.
- File handling: New / Open / Save / Save As via File System Access API
  (fallback: file input + download), window-title filename, `.tsu` only.
- Feedback legend, status hints, splash-free fast load, responsive layout,
  touch support (pinch rotate, tap-hold pull) as stretch.

## Porting gotchas (found during source read)

- `mat_from_fields` is duplicated in `Types.py` and `Geometries.py`; port
  once. Several functions have known bugs kept for parity decisions:
  `is_additional_outer_corner` references undefined `odir` (dead code path),
  `EvaluationOne` calls `get_breakable_voxels` with 4 args but it returns 3.
  Don't replicate; note divergences in a `PARITY.md`.
- Indexing idiom `ind.insert(ax, k)` appears everywhere — implement one
  `insertAxis(u, v, ax, k)` helper and use it consistently.
- `-1` sentinel = empty/padding in matrices; keep `Int8Array` with -1 rather
  than 0 so ports stay literal.
- Original renders quads (`GL_QUADS`); three.js needs triangles — do the
  split in one place in `meshBuilder`.
- Angled joints (`ang ≠ 0`) skew `pos_vecs`; vertex generation, milling
  offsets (`le = vrad / cos(ang)`), and edge trimming all depend on it.
  Port after the orthogonal case works end-to-end.
- `.tsu` HFS values are written as ints but parsed via `int(float(x))` —
  accept both.
- Suggestion evaluation constructs full `Evaluation` objects (expensive);
  the worker port should reuse one scratch buffer set.

## Milestones / sequencing

| # | Deliverable | Depends on |
|---|---|---|
| M1 | Core model + `.tsu` I/O + tests green on all fixtures | — |
| M2 | Static joint rendered with end-grain texture, open/close animation | M1 |
| M3 | Push/pull editing + component move/rotate | M2 |
| M4 | Full feedback display (valid/invalid states visible) | M1+M2 |
| M5 | Suggestions panel (worker) | M4 |
| M6 | Milling paths + G-code/SBP/NC export matching original output | M1 |
| M7 | Complete control panel, file menu, polish | M3–M6 |

M6 is independent of M3–M5 and can proceed in parallel after M1.

## Tooling to add

- `vitest` (unit tests, fixtures from tsugite-original)
- `fflate` (zip export), File System Access API types
- optional dev-only: `lil-gui`, `stats.js`
- CI: `pnpm typecheck && pnpm test && pnpm build`
