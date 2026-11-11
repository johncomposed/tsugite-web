/** Web Worker: computes joint suggestions off the UI thread. */
import { fixedSidesFromString } from '../model/fixedSides';
import { produceSuggestions } from '../model/suggestions';
import type { Axis, Mat2 } from '../model/types';

export interface SuggestionRequest {
  id: number;
  dim: number;
  sax: Axis;
  fss: string;
  hfs: Mat2[];
}

export interface SuggestionResponse {
  id: number;
  suggestions: Mat2[][];
}

self.onmessage = (e: MessageEvent<SuggestionRequest>) => {
  const { id, dim, sax, fss, hfs } = e.data;
  const fixedSides = fixedSidesFromString(fss);
  const suggestions = produceSuggestions(
    { dim, sax, noc: fixedSides.length, fixedSides },
    hfs,
  );
  (self as unknown as Worker).postMessage({ id, suggestions } satisfies SuggestionResponse);
};
