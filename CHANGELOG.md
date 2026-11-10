# Changelog

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
