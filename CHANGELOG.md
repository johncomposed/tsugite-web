# Changelog

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
