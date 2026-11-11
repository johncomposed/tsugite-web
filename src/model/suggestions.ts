/** Port of Types.produce_suggestions — ±1 edits that make the joint valid. */
import { Evaluation } from './evaluation';
import type { FixedSide } from './fixedSides';
import { matFromFields } from './heightFields';
import type { Axis, Mat2 } from './types';

export interface SuggestionParams {
  dim: number;
  sax: Axis;
  noc: number;
  fixedSides: FixedSide[][];
}

export function produceSuggestions(params: SuggestionParams, hfs: readonly Mat2[]): Mat2[][] {
  const { dim, sax, noc, fixedSides } = params;
  const valid: Mat2[][] = [];
  for (let i = 0; i < hfs.length; i++) {
    for (let j = 0; j < dim; j++) {
      for (let k = 0; k < dim; k++) {
        for (let add = -1; add < 2; add += 2) {
          if (valid.length >= 4) return valid;
          const suggHfs = hfs.map((hf) => hf.map((row) => row.slice()));
          suggHfs[i][j][k] += add;
          const val = suggHfs[i][j][k];
          if (val < 0 || val > dim) continue;
          const voxmat = matFromFields(suggHfs, sax);
          const ev = new Evaluation(voxmat, { fixedSides, sax, noc, dim });
          if (ev.valid) valid.push(suggHfs);
        }
      }
    }
  }
  return valid;
}
