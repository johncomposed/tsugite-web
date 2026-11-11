/**
 * Gallery worker: randomized search for valid joints of the current
 * configuration (the original shipped precomputed search_results; we
 * generate them on demand with the ported evaluation engine).
 */
import { Evaluation } from '../model/evaluation';
import { fixedSidesFromString } from '../model/fixedSides';
import { matFromFields, randomHeightFields } from '../model/heightFields';
import type { Axis, Mat2 } from '../model/types';

export interface GalleryRequest {
  id: number;
  dim: number;
  sax: Axis;
  fss: string;
  targetCount: number;
  maxAttempts: number;
}

export interface GalleryResponse {
  id: number;
  results: Mat2[][]; // list of height-field sets
  attempts: number;
}

self.onmessage = (e: MessageEvent<GalleryRequest>) => {
  const { id, dim, sax, fss, targetCount, maxAttempts } = e.data;
  const fixedSides = fixedSidesFromString(fss);
  const noc = fixedSides.length;
  const results: Mat2[][] = [];
  const seen = new Set<string>();
  let attempts = 0;
  while (results.length < targetCount && attempts < maxAttempts) {
    attempts++;
    const hfs = randomHeightFields(dim, noc);
    const key = JSON.stringify(hfs);
    if (seen.has(key)) continue;
    seen.add(key);
    const ev = new Evaluation(matFromFields(hfs, sax), { fixedSides, sax, noc, dim });
    if (ev.valid) results.push(hfs);
  }
  (self as unknown as Worker).postMessage({ id, results, attempts } satisfies GalleryResponse);
};
