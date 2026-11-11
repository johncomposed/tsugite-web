/**
 * Pruned search for valid joints — web equivalent of the original's offline
 * search that produced the search_results catalog. Built on the machinery
 * from Evaluation.py's search-mode classes (EvaluationOne,
 * is_potentially_connected): height fields are constructed cell by cell in
 * a DFS, invalid subtrees are pruned early, and complete assignments are
 * verified with the (fixture-verified) evaluation functions.
 *
 * Exhaustive when the space fits the eval budget (dim 3), capped otherwise.
 */
import {
  addFixedSides,
  getBreakableVoxels,
  getChessboardVertics,
  getSlidingDirections,
  getSlidingDirectionsOfOneTimber,
  isConnected,
  isFabDirectionOk,
  isPotentiallyConnected,
} from './evaluation';
import type { FixedSide } from './fixedSides';
import { matFromFields, randomHeightFields } from './heightFields';
import { makeMat2, type Axis, type Mat2, type Mat3 } from './types';

export interface SearchParams {
  dim: number;
  sax: Axis;
  fixedSides: FixedSide[][];
  /** Stop after collecting this many valid joints. */
  targetCount: number;
  /** Cap on full leaf evaluations (search reported partial if hit). */
  maxLeafEvals: number;
  /** Current height fields — the first probe explores around them. */
  seedFields?: Mat2[];
  rand?: () => number;
}

export interface SearchOutcome {
  results: Mat2[][];
  /** Number of complete assignments fully evaluated. */
  examined: number;
  /** True when the whole (pruned) space was enumerated. */
  exhausted: boolean;
}

/**
 * Early-exit reimplementation of Evaluation.valid (same criteria, ordered
 * cheap → expensive, no feedback geometry).
 */
export function quickValid(
  mat: Mat3,
  fixedSides: FixedSide[][],
  sax: Axis,
  noc: number,
): boolean {
  // Chessboard
  for (let n = 0; n < noc; n++) {
    const [check] = getChessboardVertics(mat, sax, n);
    if (check) return false;
  }
  // Fabricatable milling direction (middle components)
  for (let n = 1; n < noc - 1; n++) {
    const [ok] = isFabDirectionOk(mat, sax, n);
    if (!ok) return false;
  }
  const matWithSides = addFixedSides(mat, fixedSides);
  // Interlock
  const [, numberOfSlides] = getSlidingDirections(matWithSides, noc);
  for (let n = 0; n < noc; n++) {
    const limitOk = n === 0 || n === noc - 1 ? numberOfSlides[n] <= 1 : numberOfSlides[n] === 0;
    if (!limitOk) return false;
  }
  // Connectivity (implies bridging when it holds for every component)
  for (let n = 0; n < noc; n++) {
    if (!isConnected(matWithSides, n)) return false;
  }
  // Grain-direction fragility (most expensive)
  for (let n = 0; n < noc; n++) {
    const [brk] = getBreakableVoxels(mat, fixedSides[n], sax, n);
    if (brk) return false;
  }
  return true;
}

/**
 * Partial-assignment check after completing height field `level`
 * (components 0..level are final, the rest is lumped as component level+1).
 * Port of the EvaluationOne criteria used by the original search.
 */
export function partialLevelValid(
  fields: Mat2[],
  level: number,
  fixedSides: FixedSide[][],
  sax: Axis,
  dim: number,
): boolean {
  const noc = fixedSides.length;
  const partialMat = matFromFields(fields.slice(0, level + 1), sax);
  const matWithSides = addFixedSides(partialMat, fixedSides);
  // Connectivity + bridging of the finished component
  if (!isConnected(matWithSides, level)) return false;
  // Can the remaining material still connect/bridge the other components?
  const special = addFixedSides(partialMat, fixedSides, 10);
  if (!isPotentiallyConnected(special, dim, noc, level)) return false;
  // Slidability of the finished component (lumped remainder)
  const [, numSlides] = getSlidingDirectionsOfOneTimber(matWithSides, level);
  const interlockOk = level === 0 || level === noc - 1 ? numSlides === 1 : numSlides === 0;
  if (!interlockOk) return false;
  // Grain-direction fragility of the finished component
  const [brk] = getBreakableVoxels(partialMat, fixedSides[level], sax, level);
  if (brk) return false;
  return true;
}

function shuffled(count: number, lo: number, rand: () => number): number[] {
  const vals = Array.from({ length: count }, (_, i) => lo + i);
  for (let i = vals.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [vals[i], vals[j]] = [vals[j], vals[i]];
  }
  return vals;
}

/** Values [lo..dim] ordered by closeness to `anchor` (random tie-break). */
function anchoredOrder(lo: number, dim: number, anchor: number, rand: () => number): number[] {
  return shuffled(dim + 1 - lo, lo, rand).sort(
    (a, b) => Math.abs(a - anchor) - Math.abs(b - anchor),
  );
}

interface ProbeOutcome {
  results: Mat2[][];
  examined: number;
  /** DFS traversed the entire (pruned) space without hitting any cap. */
  coveredAll: boolean;
}

/**
 * One DFS probe over height-field cells (level-major, row-major within a
 * level) with:
 * - monotonic bounds between consecutive fields,
 * - sound local chessboard pruning (exact for 2 components / the last field),
 * - EvaluationOne-style checks when a non-final field completes,
 * - full validity check at leaves,
 * - randomized value ordering (different probes explore different regions).
 */
function dfsProbe(
  dim: number,
  sax: Axis,
  fixedSides: FixedSide[][],
  targetCount: number,
  leafBudget: number,
  anchor: Mat2[],
  rand: () => number,
): ProbeOutcome {
  const noc = fixedSides.length;
  const nFields = noc - 1;
  const fields: Mat2[] = Array.from({ length: nFields }, () => makeMat2(dim));
  const results: Mat2[][] = [];
  let examined = 0;
  let exhausted = true;
  let stopped = false;

  const totalCells = nFields * dim * dim;

  /** Sound chessboard prune for the 2x2 block completed by (L, i, j). */
  const chessPruned = (L: number, i: number, j: number, val: number): boolean => {
    if (i === 0 || j === 0) return false;
    const f = fields[L];
    const a = f[i - 1][j - 1];
    const b = f[i - 1][j];
    const c = f[i][j - 1];
    const d = val;
    // The prune is exact only when the diagonal voxels are exactly component
    // L and the antidiagonal exactly component L+1 — guaranteed for the
    // last field, with the previous field's heights bounding the diagonal.
    if (L !== nFields - 1) return false;
    const prevDiagMax =
      L > 0 ? Math.max(fields[L - 1][i - 1][j - 1], fields[L - 1][i][j]) : 0;
    const prevAntiMax = L > 0 ? Math.max(fields[L - 1][i - 1][j], fields[L - 1][i][j - 1]) : 0;
    if (Math.min(a, d) > Math.max(b, c, prevDiagMax)) return true;
    if (Math.min(b, c) > Math.max(a, d, prevAntiMax)) return true;
    return false;
  };

  const dfs = (cell: number): void => {
    if (stopped) return;
    if (cell === totalCells) {
      // Complete assignment: full validity check
      examined++;
      const mat = matFromFields(fields, sax);
      if (quickValid(mat, fixedSides, sax, noc)) {
        results.push(fields.map((f) => f.map((r) => r.slice())));
        if (results.length >= targetCount) {
          stopped = true;
          exhausted = false;
        }
      }
      if (examined >= leafBudget) {
        stopped = true;
        exhausted = false;
      }
      return;
    }
    const L = Math.floor(cell / (dim * dim));
    const rem = cell % (dim * dim);
    const i = Math.floor(rem / dim);
    const j = rem % dim;
    const lo = L > 0 ? fields[L - 1][i][j] : 0; // monotonic between fields
    const anchorVal = Math.max(lo, Math.min(dim, anchor[L][i][j]));
    for (const val of anchoredOrder(lo, dim, anchorVal, rand)) {
      if (stopped) return;
      if (chessPruned(L, i, j, val)) continue;
      fields[L][i][j] = val;
      // When a non-final field completes, prune with partial-level checks
      const fieldDone = rem === dim * dim - 1;
      if (fieldDone && L < nFields - 1) {
        if (!partialLevelValid(fields, L, fixedSides, sax, dim)) continue;
      }
      dfs(cell + 1);
    }
    fields[L][i][j] = lo;
  };

  dfs(0);
  return { results, examined, coveredAll: exhausted };
}

/**
 * Randomized-restart pruned search: repeated small DFS probes with fresh
 * random orderings, so the budget spreads across the space instead of
 * sinking into one subtree. If a probe traverses the whole pruned space
 * within budget, the search is exhaustive.
 */
export function searchValidJoints(params: SearchParams): SearchOutcome {
  const { dim, sax, fixedSides, targetCount, maxLeafEvals, seedFields } = params;
  const rand = params.rand ?? Math.random;
  const noc = fixedSides.length;
  const results: Mat2[][] = [];
  const seen = new Set<string>();
  let examined = 0;
  let exhausted = false;
  const probeBudget = Math.min(300, maxLeafEvals);

  const seedOk =
    seedFields &&
    seedFields.length === noc - 1 &&
    seedFields.every((f) => f.length === dim && f.every((r) => r.length === dim));
  let firstProbe = true;

  while (results.length < targetCount && examined < maxLeafEvals) {
    const budget = Math.min(probeBudget, maxLeafEvals - examined);
    // First probe explores around the current design; later probes around
    // random anchors, spreading the budget across the space.
    const anchor =
      firstProbe && seedOk
        ? seedFields.map((f) => f.map((r) => r.slice()))
        : randomHeightFields(dim, noc, rand);
    firstProbe = false;
    // Cap per-probe contributions so the gallery draws from several
    // regions of the space instead of one seed neighborhood.
    const perProbeTarget = Math.min(
      targetCount - results.length,
      Math.max(1, Math.ceil(targetCount / 5)),
    );
    const probe = dfsProbe(dim, sax, fixedSides, perProbeTarget, budget, anchor, rand);
    examined += probe.examined;
    for (const hfs of probe.results) {
      const key = JSON.stringify(hfs);
      if (seen.has(key)) continue;
      seen.add(key);
      results.push(hfs);
    }
    if (probe.coveredAll) {
      // Entire pruned space enumerated in one probe — complete catalog.
      exhausted = true;
      break;
    }
    if (probe.examined === 0) break; // safety: no progress possible
  }
  return { results, examined, exhausted };
}
