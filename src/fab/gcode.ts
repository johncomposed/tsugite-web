/** Port of Fabrication.export_gcode — gcode / nc / sbp writers. */
import type { Joint } from '../model/joint';
import type { Vec3 } from '../model/types';
import { getPosVecs } from '../view/vertexGrid';
import { angleBetween, arcPoints, connectedArc, MillVertex, pyRound, pyFloatStr } from './millVertex';

const COMPONENT_NAMES = ['A', 'B', 'C', 'D', 'E', 'F'];

/** Coordinate equality with ulp-noise tolerance (libm differences vs CPython). */
function eq(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-9;
}

export interface ExportedFile {
  name: string; // e.g. "joint_A.gcode"
  content: string;
}

/**
 * Export milling programs for all components.
 * `millVertsPerComponent` comes from millingPathVertices (model space);
 * vertices are mutated (scaled/swapped/rotated) exactly like the original.
 */
export function exportGcode(
  joint: Joint,
  millVertsPerComponent: MillVertex[][],
  baseName: string,
): ExportedFile[] {
  const fab = joint.fab;
  const unitScale = 1.0;
  const fax = joint.sax;
  const coords: number[] = [0, 1];
  coords.splice(fax, 0, 2);
  const d = 5; // decimals
  const files: ExportedFile[] = [];
  const posVecs = getPosVecs(joint);

  for (let n = 0; n < joint.noc; n++) {
    const fdir = joint.fabDirections[n];
    const compAx = joint.fixedSides[n][0].ax;
    const compDir = joint.fixedSides[n][0].dir;
    let compVec: Vec3 = [...posVecs[compAx]];
    if (compDir === 0 && compAx !== joint.sax) compVec = [-compVec[0], -compVec[1], -compVec[2]];
    compVec = [compVec[coords[0]], compVec[coords[1]], compVec[coords[2]]];
    const len = Math.sqrt(compVec[0] * compVec[0] + compVec[1] * compVec[1] + compVec[2] * compVec[2]);
    compVec = [compVec[0] / len, compVec[1] / len, compVec[2] / len];
    const zax: Vec3 = [0, 0, 1];
    const aax: Vec3 = [0, 0, 0];
    aax[Math.trunc(fab.alignAx / 2)] = 2 * (fab.alignAx % 2) - 1;
    let rotAng = angleBetween(aax, compVec, zax);
    if (fdir === 0) rotAng = -rotAng;

    const lines: string[] = [];
    const w = (s: string) => lines.push(s);

    if (fab.ext === 'gcode' || fab.ext === 'nc') {
      w('%');
      w('G90 (Absolute [G91 is incremental])');
      w('G17 (set XY plane for circle path)');
      w('G94 (set unit/minute)');
      w('G21 (set unit[mm])');
      const spistr = String(Math.trunc(fab.spindleSpeed));
      w(`S${spistr} (Spindle ${spistr}rpm)`);
      w('M3 (spindle start)');
      w('G54');
      const spestr = String(Math.trunc(fab.speed));
      w(`F${spestr} (Feed ${spestr}mm/min)`);
    }
    if (fab.ext === 'sbp') {
      w("'%");
      w('SA');
      w('TR,18000');
      w('C6');
      w('PAUSE 2');
      w("'");
      w('MS,6.67,6.67');
      w('');
    }

    const mvs = millVertsPerComponent[n];
    let pmv: MillVertex | null = null;
    for (let i = 0; i < mvs.length; i++) {
      const mv = mvs[i];
      mv.scaleAndSwap(
        fax,
        fdir,
        joint.ratio,
        unitScale,
        joint.realTimDims,
        coords as [number, number, number],
        d,
      );
      if (compAx !== fax) mv.rotate(rotAng, d);
      if (i > 0) pmv = mvs[i - 1];

      let arc = false;
      let clockwise = false;
      if (i > 0 && pmv && connectedArc(mv, pmv)) {
        arc = true;
        let vec1 = [
          mv.pt[0] - mv.arcCtr[0],
          mv.pt[1] - mv.arcCtr[1],
          mv.pt[2] - mv.arcCtr[2],
        ] as Vec3;
        const n1 = Math.sqrt(vec1[0] * vec1[0] + vec1[1] * vec1[1] + vec1[2] * vec1[2]);
        vec1 = [vec1[0] / n1, vec1[1] / n1, vec1[2] / n1];
        const zvec: Vec3 = [0, 0, 1];
        const xvec: Vec3 = [
          vec1[1] * zvec[2] - vec1[2] * zvec[1],
          vec1[2] * zvec[0] - vec1[0] * zvec[2],
          vec1[0] * zvec[1] - vec1[1] * zvec[0],
        ];
        let vec2 = [
          pmv.pt[0] - mv.arcCtr[0],
          pmv.pt[1] - mv.arcCtr[1],
          pmv.pt[2] - mv.arcCtr[2],
        ] as Vec3;
        const n2 = Math.sqrt(vec2[0] * vec2[0] + vec2[1] * vec2[1] + vec2[2] * vec2[2]);
        vec2 = [vec2[0] / n2, vec2[1] / n2, vec2[2] / n2];
        const diffAng = angleBetween(xvec, vec2);
        if (diffAng > 0.5 * Math.PI) clockwise = true;
      }

      if (fab.ext === 'gcode' || fab.ext === 'nc') {
        if (arc && fab.interp && pmv) {
          let line = clockwise ? 'G2' : 'G3';
          line += ` R${pyFloatStr(pyRound(joint.effDia, d))} X${mv.xstr} Y${mv.ystr}`;
          if (!eq(mv.z, pmv.z)) line += ` Z${mv.zstr}`;
          w(line);
        } else if (arc && !fab.interp && pmv) {
          const pts = arcPoints(pmv.pt, mv.pt, pmv.arcCtr, mv.arcCtr, 2, Math.PI / 180);
          for (const pt of pts) {
            let line = 'G1';
            line += ` X${pyFloatStr(pyRound(pt[0], 3))} Y${pyFloatStr(pyRound(pt[1], 3))}`;
            if (!eq(mv.z, pmv.z)) line += ` Z${pyFloatStr(pyRound(pt[2], 3))}`;
            w(line);
          }
        } else if (i === 0 || !pmv || !eq(mv.x, pmv.x) || !eq(mv.y, pmv.y) || !eq(mv.z, pmv.z)) {
          let line = mv.isTra ? 'G0' : 'G1';
          if (i === 0 || !pmv || !eq(mv.x, pmv.x)) line += ` X${mv.xstr}`;
          if (i === 0 || !pmv || !eq(mv.y, pmv.y)) line += ` Y${mv.ystr}`;
          if (i === 0 || !pmv || !eq(mv.z, pmv.z)) line += ` Z${mv.zstr}`;
          w(line);
        }
        continue;
      }
      if (fab.ext === 'sbp') {
        if (arc && pmv && eq(mv.z, pmv.z)) {
          let line = `CG,${pyFloatStr(pyRound(2 * joint.effDia * unitScale, d))},${mv.xstr},${mv.ystr},,,T,`;
          line += clockwise ? '1' : '-1';
          w(line);
        } else if (arc && pmv && !eq(mv.z, pmv.z)) {
          const pts = arcPoints(pmv.pt, mv.pt, pmv.arcCtr, mv.arcCtr, 2, Math.PI / 180);
          for (const pt of pts) {
            w(
              `M3,${pyFloatStr(pyRound(pt[0], 3))},${pyFloatStr(pyRound(pt[1], 3))},${pyFloatStr(pyRound(pt[2], 3))}`,
            );
          }
        } else if (i === 0 || !pmv || !eq(mv.x, pmv.x) || !eq(mv.y, pmv.y) || !eq(mv.z, pmv.z)) {
          let line = mv.isTra ? 'J3,' : 'M3,';
          line += i === 0 || !pmv || !eq(mv.x, pmv.x) ? `${mv.xstr},` : ' ,';
          line += i === 0 || !pmv || !eq(mv.y, pmv.y) ? `${mv.ystr},` : ' ,';
          line += i === 0 || !pmv || !eq(mv.z, pmv.z) ? `${mv.zstr}` : ' ';
          w(line);
        }
      }
    }

    if (fab.ext === 'gcode' || fab.ext === 'nc') {
      w('M5 (Spindle stop)');
      w('M2 (end of program)');
      w('M30 (delete sd file)');
      w('%');
    }
    if (fab.ext === 'sbp') {
      w('SO 1,0');
      w('END');
      w("'%");
    }

    files.push({
      name: `${baseName}_${COMPONENT_NAMES[n]}.${fab.ext}`,
      content: lines.join('\n') + '\n',
    });
  }
  return files;
}
