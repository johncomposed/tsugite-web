/** Port of Fabrication.py RegionVertex (shared by evaluation and milling). */
import type { Mat2 } from './types';

export class RegionVertex {
  readonly i: number;
  readonly j: number;
  readonly flatNeighbors: number[];
  readonly regionCount: number;
  readonly blockCount: number;
  readonly freeCount: number;
  readonly flatNeighborValues: number[];

  constructor(
    readonly ind: number[],
    readonly absInd: number[],
    readonly neighbors: Mat2, // 2x2: 0 in region, 1 blocked, 2 free
    readonly neighborValues: Mat2,
    readonly dia = false,
    readonly minusOneNeighbor = false,
  ) {
    this.i = ind[0];
    this.j = ind[1];
    this.flatNeighbors = neighbors.flat();
    this.regionCount = this.flatNeighbors.filter((v) => v === 0).length;
    this.blockCount = this.flatNeighbors.filter((v) => v === 1).length;
    this.freeCount = this.flatNeighbors.filter((v) => v === 2).length;
    this.flatNeighborValues = neighborValues.flat();
  }
}
