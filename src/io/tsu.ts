/** .tsu file format — port of Types.save / Types.open. */
import { FixedSide, fixedSidesFromString, fixedSidesToString } from '../model/fixedSides';
import { Joint, DEFAULT_FAB, type FabSettings } from '../model/joint';
import type { Axis, Mat2, Vec3 } from '../model/types';

export interface TsuData {
  sax: Axis;
  noc: number;
  dim: number;
  ang: number;
  realTimDims: Vec3;
  fab: FabSettings;
  incremental: boolean;
  fixedSides: FixedSide[][];
  heightFields: Mat2[];
}

export function parseTsu(text: string): TsuData {
  // Defaults mirror Types defaults
  let sax: Axis = 2;
  let noc = 2;
  let dim = 3;
  let ang = 0.0;
  let dx = 44.0;
  let dy = 44.0;
  let dz = 44.0;
  const fab: FabSettings = { ...DEFAULT_FAB };
  let incremental = false;
  let fixedSides: FixedSide[][] | null = null;
  const heightFields: Mat2[] = [];

  let hfi = Number.MAX_SAFE_INTEGER;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const items = lines[i].split(/\s+/).filter((s) => s.length > 0);
    if (items.length === 0) {
      if (i <= hfi) continue;
    }
    const key = items[0];
    switch (key) {
      case 'SAX':
        sax = parseInt(items[1]) as Axis;
        continue;
      case 'NOT':
        noc = parseInt(items[1]);
        continue;
      case 'RES':
        dim = parseInt(items[1]);
        continue;
      case 'ANG':
        ang = parseFloat(items[1]);
        continue;
      case 'TDX':
        dx = parseFloat(items[1]);
        continue;
      case 'TDY':
        dy = parseFloat(items[1]);
        continue;
      case 'TDZ':
        dz = parseFloat(items[1]);
        continue;
      case 'DIA':
        fab.realDia = parseFloat(items[1]);
        continue;
      case 'TOL':
        fab.tol = parseFloat(items[1]);
        continue;
      case 'SPE':
        fab.speed = parseFloat(items[1]);
        continue;
      case 'SPI':
        fab.spindleSpeed = parseFloat(items[1]);
        continue;
      case 'INC':
        incremental = items[1] === 'True' || items[1] === 'true';
        continue;
      case 'FIN':
        fab.interp = items[1] === 'True' || items[1] === 'true';
        continue;
      case 'ALN':
        fab.alignAx = Math.trunc(parseFloat(items[1]));
        continue;
      case 'EXT':
        fab.ext = items[1] as FabSettings['ext'];
        continue;
      case 'FSS':
        fixedSides = fixedSidesFromString(items[1]);
        continue;
      case 'HFS':
        hfi = i;
        continue;
    }
    if (i > hfi && lines[i].trim().length > 0) {
      const hf: Mat2 = lines[i]
        .trim()
        .split(':')
        .map((row) => row.split(',').map((item) => Math.trunc(parseFloat(item))));
      heightFields.push(hf);
    }
  }

  const sides = fixedSides ?? [[new FixedSide(2, 0)], [new FixedSide(2, 1)]];
  return {
    sax,
    noc: sides.length > 0 ? sides.length : noc,
    dim,
    ang,
    realTimDims: [dx, dy, dz],
    fab,
    incremental,
    fixedSides: sides,
    heightFields,
  };
}

export function jointFromTsu(text: string): Joint {
  const data = parseTsu(text);
  return new Joint({
    sax: data.sax,
    dim: data.dim,
    ang: data.ang,
    realTimDims: data.realTimDims,
    fixedSides: data.fixedSides,
    heightFields: data.heightFields,
    incremental: data.incremental,
    fab: data.fab,
  });
}

/** Python-style float repr: integral floats keep a trailing ".0". */
function pyFloat(x: number): string {
  return Number.isInteger(x) ? `${x}.0` : String(x);
}

export function serializeTsu(joint: Joint): string {
  const lines: string[] = [];
  lines.push(`SAX ${joint.sax}`);
  lines.push(`NOT ${joint.noc}`);
  lines.push(`RES ${joint.dim}`);
  lines.push(`ANG ${pyFloat(joint.ang)}`);
  lines.push(`TDX ${pyFloat(joint.realTimDims[0])}`);
  lines.push(`TDY ${pyFloat(joint.realTimDims[1])}`);
  lines.push(`TDZ ${pyFloat(joint.realTimDims[2])}`);
  lines.push(`DIA ${pyFloat(joint.fab.realDia)}`);
  lines.push(`TOL ${pyFloat(joint.fab.tol)}`);
  lines.push(`SPE ${joint.fab.speed}`);
  lines.push(`SPI ${joint.fab.spindleSpeed}`);
  lines.push(`INC ${joint.incremental ? 'True' : 'False'}`);
  lines.push(`FIN ${joint.fab.interp ? 'True' : 'False'}`);
  lines.push(`ALN ${joint.fab.alignAx}`);
  lines.push(`EXT ${joint.fab.ext}`);
  lines.push(`FSS ${fixedSidesToString(joint.fixedSides)}`);
  lines.push('HFS ');
  const hfLines = joint.heightFields.map((hf) =>
    hf.map((row) => row.map((v) => Math.trunc(v)).join(',')).join(':'),
  );
  return lines.join('\n') + '\n' + hfLines.join('\n');
}
