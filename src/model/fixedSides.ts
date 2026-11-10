/** Port of Misc.py — FixedSide / FixedSides. */
import type { Axis, Dir } from './types';

export class FixedSide {
  constructor(
    readonly ax: Axis,
    readonly dir: Dir,
  ) {}

  equals(other: FixedSide): boolean {
    return this.ax === other.ax && this.dir === other.dir;
  }

  /** True if this side is NOT present in `others` (flat or nested list). */
  unique(others: readonly FixedSide[] | readonly FixedSide[][]): boolean {
    for (const item of others) {
      const sides = Array.isArray(item) ? item : [item];
      for (const side of sides) {
        if (this.equals(side)) return false;
      }
    }
    return true;
  }
}

export function defaultFixedSides(): FixedSide[][] {
  return [[new FixedSide(2, 0)], [new FixedSide(2, 1)]];
}

/** Parse "2,0:2,1" / "0,0.1,0:2,1" (":" between timbers, "." between sides). */
export function fixedSidesFromString(sideStr: string): FixedSide[][] {
  return sideStr.split(':').map((timFss) =>
    timFss.split('.').map((timFs) => {
      const [axStr, dirStr] = timFs.split(',');
      const ax = Math.trunc(parseFloat(axStr)) as Axis;
      const dir = Math.trunc(parseFloat(dirStr)) as Dir;
      return new FixedSide(ax, dir);
    }),
  );
}

export function fixedSidesToString(sides: readonly FixedSide[][]): string {
  return sides
    .map((timber) => timber.map((s) => `${s.ax},${s.dir}`).join('.'))
    .join(':');
}

/** List unblocked positions (sides not occupied by any component). */
export function unblockedPositions(sides: readonly FixedSide[][]): FixedSide[] {
  const unblocked: FixedSide[] = [];
  for (let ax = 0; ax < 3; ax++) {
    for (let dir = 0; dir < 2; dir++) {
      const side = new FixedSide(ax as Axis, dir as Dir);
      if (side.unique(sides)) unblocked.push(side);
    }
  }
  return unblocked;
}

/** Rotation is blocked when any component axis aligns with the sliding axis. */
export function rotationAllowed(sides: readonly FixedSide[][], sax: Axis): boolean {
  for (const timber of sides) {
    if (timber[0].ax === sax) return false;
  }
  return true;
}
