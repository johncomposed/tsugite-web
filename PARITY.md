# Parity notes — deliberate divergences from the original

The port is literal wherever practical (including several quirks kept for
behavioral parity, e.g. the `create_joint_vertices` texture-axis rebinding
and the milling `dir_ax` 2D-indexing). These are the places where the web
version intentionally differs:

1. **Original bugs not replicated**
   - `is_additional_outer_corner` (Types.py) references an undefined `odir`
     (dead code path) — not ported.
   - `EvaluationOne` calls `get_breakable_voxels` with a stale 2-value
     unpacking — `EvaluationOne`/`EvaluationSlides` (search-mode classes)
     are not ported; suggestions use the full `Evaluation` as the main app
     does.
   - `joint_face_indices` re-emits the component-base faces once per lattice
     row (loop-nesting bug, pure overdraw) — emitted once here.
   - `produce_suggestions` can overshoot 4 suggestions (its `== 4` break
     only exits the innermost loop) — capped at exactly 4 here.

2. **Hidden lines** — the original's stencil trick hides a component's
   occluded edges only behind its *own* faces. We render dashed lines with
   `depthFunc=Greater`, so edges occluded by *any* geometry show dashed
   (classic hidden-line look). Visible-edge rendering is identical.

3. **Picking** — the original encodes pick ids in a 255-step color ramp read
   from the back buffer; we render id-colored meshes into an offscreen
   target with exact integer decode. Same selection semantics
   (component body / top-face cell / side), more robust.

4. **Coordinate-omission in machine files** — the original omits X/Y/Z words
   when the raw doubles are equal. CPython and JS libm differ by 1 ulp for
   some trig values (e.g. cos(π/4)), flipping exact equality after axis
   rotation. We compare with epsilon 1e-9 — same files for all shipped
   fixtures (verified in `tests/gcode.test.ts`).

5. **Numbers in exports** — written with 5 decimals like the current
   original code; some files shipped in the original repo were exported by
   an older build with 3 decimals. Parity tests compare numerically.

6. **Suggestion thumbnails** — rendered once per update (static snapshot of
   the current view rotation) instead of live-rotating sub-viewports; they
   are re-rendered when suggestions change.

7. **Gallery mode** (`search_results/` browsing) is not ported; the
   suggestion provider interface leaves room for it.

8. **Spindle warm-up** — SBP writer emits the same fixed header as the
   original (including `TR,18000`).
