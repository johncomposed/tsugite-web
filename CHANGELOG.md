# Changelog

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
