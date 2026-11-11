# Changelog

## Post-port: example joints from the original repo (2026-11-10)

- `public/examples/` — all 17 `.tsu` joints shipped with tsugite-original
  (root + setup/), with a static `index.json` manifest.
- Control panel gains an "Examples" dropdown that fetches and loads any of
  them in place; the status bar reports validity on load.
- Verified by loading every example through the UI: parameters (timbers,
  resolution, sliding axis, angle incl. ±70° A-joints) apply correctly and
  validity matches the original evaluation on all 17 (valid: 3_1, 3_2,
  L_1, L_2, T_1, my_joint; the rest invalid, as in the Python fixtures).



## Post-port: perf HUD, zoom, faster rotation (2026-11-10)

- `src/perf/perfMonitor.ts` — performance HUD (toggle `p`): FPS / avg / max
  frame time over a 90-frame window, three.js draw calls + triangle/line
  counts, and named timings (last + running avg) for geometry rebuild, pick
  mesh build, per-frame GPU pick, milling path generation, and suggestion
  worker round-trip.
- Zoom: mouse wheel and trackpad pinch (ctrl+wheel) zoom the orthographic
  camera (`view.zoom`, clamped 0.2–8), plus two-finger touch pinch.
- Right-drag rotation speed raised 3× (`rotSpeed` 0.001 → 0.003,
  configurable in ViewSettings).

Measured on the default dim-3 joint: 60 fps / 16.7 ms frames, rebuild
4.5 ms, pick build 0.6 ms, pick pass 6.5 ms, suggestions ~250 ms in worker.



## Phase 7 — UI chrome & polish (2026-11-10)

### Added
- `src/ui/controlPanel.ts` — left panel replicating Tsugite.ui:
  - File: New / Open (`.tsu` file input) / Save (download).
  - Design: open/close button, feedback toggle, sliding axis (with
    blocked-direction status message), number of timbers (2–6), resolution
    (2–5), intersection angle, timber X/Y/Z dims with "all same" cube lock,
    randomize/clear.
  - Fabrication: bit diameter, tolerance, speed, spindle speed, alignment
    axis, incremental + arc-interpolation toggles, gcode/nc/sbp format,
    milling-path toggle, export button.
- Status bar: interaction hints, transient status messages, and live
  validity readout (VALID JOINT / list of failed criteria).
- `Joint.reset()` (port of Types.reset) powering New/Open in place.
- `README.md` (usage, structure, commands) and `PARITY.md` (documented
  divergences: unreplicated original bugs, hidden-line approximation,
  picking scheme, libm epsilon handling, thumbnail rendering, no gallery).

### Verified (live browser automation)
Panel renders with all 25 controls; resolution change 3→4 regenerates
height fields; sliding-axis change applies with blocked check; New resets
to defaults; validity readout tracks evaluation. Full suite: 144 tests,
typecheck, production build all green.



## Phase 6 — Fabrication (2026-11-10)

Milling path generation and G-code/SBP/NC export with parity against the
original's shipped machine files.

### Added
- `src/fab/millVertex.ts` — `MillVertex` (arcs, traversal flag,
  `scaleAndSwap` to machine coordinates, z-rotation for axis alignment),
  `RoughPixel`, `connectedArc`, `arcPoints`, Python-style number formatting.
- `src/fab/millingPath.ts` — full port of the layer pipeline from Types.py:
  `layer_mat_from_cube` → fixed-side padding (with corner fix) → region
  detection (`get_diff_neighbors`) → rough milling lanes → region outline
  vertices (with the original's pad-offset quirks preserved) → vertex
  ordering (`set_starting_vert`, `get_sublist_of_ordered_verts` with
  closed-loop detection) → offsetting with rounded inner-corner arcs and
  corner artifacts → layered z-stepping (`get_layered_vertices`, incremental
  mode, segment proportions) → per-component end points. Oblique-joint edge
  paths included.
- `src/fab/gcode.ts` — port of `export_gcode`: G-code/.nc (G0/G1/G2/G3 with
  R arcs or interpolated points) and ShopBot .sbp (J3/M3/CG) writers,
  component axis-alignment rotation, per-component A/B/… files.
  Coordinate-omission uses an epsilon compare (1e-9): JS and CPython libm
  differ by 1 ulp in cos(π/4), which flipped the original's exact-equality
  behavior.
- Viewer: `m` toggles colored milling-path polylines per component (skipped
  for unfabricatable components, as the original); `g` downloads the
  exported files via Blob.
- Norms in fab code use sqrt-of-squares (not `Math.hypot`) to match numpy
  bit-for-bit.

### Verified
`tests/gcode.test.ts`: full-file comparison against the original's exports —
`my_joint.tsu` → `my_joint_A/B.gcode` and `20241028_test_joint.tsu` →
`20241028_test_joint_A/B.sbp` (T-shaped component, rotated axis alignment,
sax=1). Line-for-line structural equality; numbers within 2e-3 (the shipped
files were written with 3 decimals; we write 5 like the current original).
144 tests green. Milling path display visually verified.



## Phase 5 — Suggestions panel (2026-11-10)

### Added
- `src/model/suggestions.ts` — port of `produce_suggestions`: try ±1 on
  every height-field cell, keep up to 4 whose evaluation is valid. (The
  original can overshoot 4 due to a break-placement bug; capped cleanly.)
- `src/workers/suggestionWorker.ts` — suggestions computed in a Web Worker
  (the original blocks the UI thread), stale responses dropped by id.
- `src/ui/suggestionPanel.ts` — right-hand panel like the original's
  suggestion viewports: thumbnails rendered with a shared offscreen
  three.js renderer (white faces + black lines, current view rotation),
  click to adopt a suggestion.
- Wiring in `main.ts`: recomputed on every geometry change when the joint
  is invalid (port of `update_suggestions`), cleared when valid.

### Verified (live browser automation)
Chessboard-invalid joint → worker returned a valid suggestion, thumbnail
rendered; clicking it adopted the height fields and the joint became valid.



## Phase 4 — Evaluation feedback display (2026-11-10)

Visual feedback for every evaluation result, matching Show.py's passes.

### Added (all in `src/view/jointRender.ts`, gated by `showFeedback`)
- Unconnected voxels: red-orange faces (neutral white when feedback is off).
- Unbridged components: the two fixed-side parts tinted with the original's
  pastel color pairs (yellow/turquoise, pink/orange, purple/grey).
- Breakable (grain-direction) voxels: yellow faces from `breakableVoxmat`.
- Unfabricatable components: transparent orange tint over all faces.
- Chessboard warnings: red-orange lines at checker vertices along the
  sliding axis, depth-cleared like the original (always on top).
- Sliding-direction arrows per component at each fixed side (ported
  `arrow_vertices`/`arrow_indices`), black when interlocked, red otherwise,
  also drawn on top.
- Red component outlines for non-interlocked components (from Phase 2).
- `f` key toggles feedback (checkFEED equivalent).

### Verified (live browser automation)
Chessboard joint (alternating heights): checker=true both components, red
chess lines visible mid-joint, black sliding arrows at both ends. Island
joint: unconnected rendering path exercised. Valid joints show plain look.



## Phase 3 — Interaction (2026-11-10)

Push/pull face editing, component move/rotate, GPU picking — the editing
model of the original app.

### Added
- `src/interaction/selection.ts` — port of `Selection.py`: state machine
  (idle / face hovered / pulling / body hovered / moving), `update_pick`
  with Shift same-height flood select, `start_pull`/`edit`/`end_pull`
  (mouse drag projected onto the screen-space sliding axis → integer height
  delta, clamped), `start_move`/`move`/`end_move` (drag angle vs projected
  component axis chooses rotate vs move; L↔T transitions; blocked-direction
  checks against unblocked positions).
- `src/view/picking.ts` — GPU color picking (equivalent of `Show.pick`):
  pick meshes on a separate three.js layer inside the same component groups
  (inherit open/rotate transforms), unique flat color per top-face cell
  `(n, side, i, j)` + per-component body color, offscreen render target +
  single-pixel readback, id→selection decode.
- `src/view/overlays.ts` — hovered/selected face highlight (dark grey),
  pull preview (dashed outlines stepped along the sliding axis, as the
  original's stippled outlines), move/rotate preview (dashed component
  outline at the proposed position).
- `src/main.ts` — full mouse wiring: hover picking each frame while idle,
  left-press starts pull (face) or move (body), drag edits, release commits
  and rebuilds; Shift multi-select; double-click/space open-close.

### Verified (live browser automation)
- Picking: background → null, bodies → component id, exposed top faces →
  correct `(n, dir, x, y)`; closed joints expose no top faces (matches the
  original's open-to-edit workflow).
- Full pull edit: pick face (0,2) of component 0, drag 2 steps → height
  field 0→2, evaluation re-ran, geometry rebuilt.
- Move/rotate: horizontal drag on a z-fixed component proposes x-axis
  rotation with correct blocked-side handling.



## Phase 2 — Rendering parity (2026-11-10)

three.js rendering that reproduces the original's look: white faces, black
edge lines, dashed hidden lines, end-grain texture, open/close animation.

### Added
- `src/view/vertexGrid.ts` — port of `Types.create_joint_vertices`: the
  (dim+1)³ lattice (one copy per texture axis, 8-float vertex layout kept),
  component-base vertices (72), angled-joint pos_vec rotation (including the
  original's `ax` rebinding quirk, replicated for parity), `arrow_vertices`,
  `get_index` / `get_corner_indices` / `rotate_vector_around_axis`.
- `src/view/meshBuilder.ts` — ports of `joint_face_indices` (end/not-end
  split), `face_neighbors`, `line_neighbors`, `joint_line_indices`,
  `open_line_indices`, `chess_line_indices`, `break_line_indices`,
  `component_outline_indices`, `joint_top_face_indices` (picking layout,
  with -1 placeholders), `joint_selected_top_line_indices`, `arrow_indices`.
  Component base emitted once (the original re-emits it dim+1 times — a
  harmless loop-nesting bug, not replicated).
- `src/view/jointRender.ts` — `JointRenderer`: per-component groups with
  white faces (GL_QUADS → triangle expansion), end-grain textured end faces,
  black edge lines, dashed hidden lines (depthFunc=Greater approximation of
  the original's stencil "excluded area" trick), open-state dashed guide
  lines, red warning lines for non-interlocked components, per-frame opening
  translation `(2n+1-noc)/(noc-1) * openRatio * componentSize`.
- `src/view/viewSettings.ts` — port of `ViewSettings.py` (time-based
  open/close animation, drag rotation, hidden components, rotation snapping).
- `src/main.ts` — orthographic NDC-style camera (the original binds no
  projection uniform, so its view is effectively orthographic), right-drag
  rotate, double-click/space open-close, r/c randomize/clear, `window.__tsugite`
  debug hook used for automated visual checks.
- `public/textures/` — end_grain / friction / contact textures copied from
  the original.

### Verified
Screenshot-checked against the original's appearance: closed joint, opened
joint (components separate along sliding axis, interface end-grain visible,
long dashed opening guides), invalid joint (red outlines). Hidden-line
approximation diverges deliberately: edges occluded by the component itself
also render dashed (original hides those); noted for PARITY.md.



## Phase 1 — Core model, evaluation, .tsu I/O (2026-11-10)

Pure-TypeScript port of the original's model layer; no rendering changes.

### Added
- `src/model/types.ts` — shared types (`Axis`, `Mat2`, `Mat3`), `insertAxis`
  helper replicating Python's `ind.insert(ax, k)` idiom, matrix utilities.
- `src/model/fixedSides.ts` — port of `Misc.py` (`FixedSide.unique`,
  string parse/serialize, unblocked positions, rotation-allowed rule).
- `src/model/heightFields.ts` — `randomHeightFields`, `clearHeightFields`,
  `matFromFields`, `editHeightFields` (monotonic cascade for noc>2),
  `getSameHeightNeighbors` (Shift-select flood fill from `Selection.py`).
- `src/model/evaluation.ts` — full port of `Evaluation.py`: fixed-side
  padding with corner handling (numpy `np.pad` semantics replicated
  axis-sequentially), connectivity, bridging + unbridged separation,
  sliding directions and interlock, friction/contact areas, chessboard
  detection, fabricable-direction check, breakable (grain) analysis with 2D
  region outlines (`RegionVertex`), overall `valid` flag.
- `src/model/joint.ts` — `Joint` aggregate (port of `Types.py` state):
  sax/dim/ang/timber dims/fixed sides/height fields + fab settings, derived
  `voxelMatrix` + `Evaluation`, update methods (sliding direction with
  blocked check, dimension, component count with random unblocked insertion,
  component position, height-field editing). Replaces the provisional
  voxel-first scaffold model.
- `src/io/tsu.ts` — `.tsu` parser/serializer (SAX/NOT/RES/ANG/TD*/DIA/TOL/
  SPE/SPI/INC/FIN/ALN/EXT/FSS/HFS), Python-style float formatting on save.
- `scripts/gen_eval_fixtures.py` — runs the ORIGINAL `Evaluation.py`
  (numpy-only imports) against every `.tsu` in tsugite-original and dumps
  ground-truth JSON.
- `tests/fixtures/*.json` — 17 fixtures (valid and invalid joints).
- `tests/evaluation.test.ts` — parity assertions vs original: voxel matrix,
  connected/bridged, checker (+vertices), slides (+counts, interlocks),
  friction/contact counts, breakable (+voxel indices), fab directions,
  overall validity. `tests/tsu.test.ts` — parse/round-trip/edit-cascade/
  joint-update tests.

### Result
142 tests passing; TS evaluation output is bit-identical to the original
Python on all 17 fixtures. `pnpm typecheck && pnpm test && pnpm build` green.
