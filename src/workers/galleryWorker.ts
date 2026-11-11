/**
 * Gallery worker: pruned DFS search for valid joints of the current
 * configuration (web equivalent of the original's offline search that
 * produced the search_results catalog — see src/model/search.ts).
 */
import { fixedSidesFromString } from '../model/fixedSides';
import { searchValidJoints } from '../model/search';
import type { Axis, Mat2 } from '../model/types';

export interface GalleryRequest {
  id: number;
  dim: number;
  sax: Axis;
  fss: string;
  targetCount: number;
  maxLeafEvals: number;
  seedFields?: Mat2[];
}

export interface GalleryResponse {
  id: number;
  results: Mat2[][]; // list of height-field sets
  examined: number;
  exhausted: boolean;
}

self.onmessage = (e: MessageEvent<GalleryRequest>) => {
  const { id, dim, sax, fss, targetCount, maxLeafEvals, seedFields } = e.data;
  const fixedSides = fixedSidesFromString(fss);
  const { results, examined, exhausted } = searchValidJoints({
    dim,
    sax,
    fixedSides,
    targetCount,
    maxLeafEvals,
    seedFields,
  });
  (self as unknown as Worker).postMessage({
    id,
    results,
    examined,
    exhausted,
  } satisfies GalleryResponse);
};
