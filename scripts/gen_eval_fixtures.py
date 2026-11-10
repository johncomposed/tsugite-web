#!/usr/bin/env python3
"""Generate evaluation parity fixtures by running the ORIGINAL Tsugite
Evaluation code (tsugite-original/setup/Evaluation.py) on every .tsu file.

Output: tests/fixtures/<name>.json with the evaluation results the TS port
must reproduce exactly.

Run with a python that has numpy, e.g.:
  ../tsugite-original/.venv/bin/python scripts/gen_eval_fixtures.py
"""
import json
import os
import sys
import glob

HERE = os.path.dirname(os.path.abspath(__file__))
ORIG = os.path.join(HERE, "..", "..", "tsugite-original")
sys.path.insert(0, os.path.join(ORIG, "setup"))

import numpy as np  # noqa: E402
from Evaluation import Evaluation  # noqa: E402  (imports numpy/Fabrication/Misc only)
from Misc import FixedSide  # noqa: E402


def mat_from_fields(hfs, ax):  # copy of Types.mat_from_fields (OpenGL-free)
    dim = len(hfs[0])
    mat = np.zeros(shape=(dim, dim, dim))
    for i in range(dim):
        for j in range(dim):
            for k in range(dim):
                ind = [i, j]
                ind3d = ind.copy()
                ind3d.insert(ax, k)
                ind3d = tuple(ind3d)
                ind2d = tuple(ind)
                for n, hf in enumerate(hfs):
                    if k < hf[ind2d]:
                        mat[ind3d] = n
                        break
                    else:
                        mat[ind3d] = n + 1
    return np.array(mat)


class FixedStub:
    def __init__(self, sides):
        self.sides = sides


class TypeStub:
    def __init__(self, sax, dim, fs_str):
        self.sax = sax
        self.dim = dim
        sides = []
        for tim_fss in fs_str.split(":"):
            temp = []
            for tim_fs in tim_fss.split("."):
                axdir = tim_fs.split(",")
                temp.append(FixedSide(int(float(axdir[0])), int(float(axdir[1]))))
            sides.append(temp)
        self.fixed = FixedStub(sides)
        self.noc = len(sides)


def parse_tsu(path):
    sax, dim, ang = 2, 3, 0.0
    fs_str = "2,0:2,1"
    hfs = []
    hfi = 10 ** 9
    with open(path) as f:
        lines = f.readlines()
    for i, line in enumerate(lines):
        items = line.split()
        if not items:
            continue
        if items[0] == "SAX":
            sax = int(items[1])
        elif items[0] == "RES":
            dim = int(items[1])
        elif items[0] == "ANG":
            ang = float(items[1])
        elif items[0] == "FSS":
            fs_str = items[1]
        elif items[0] == "HFS":
            hfi = i
        elif i > hfi:
            hf = []
            for row in line.strip().split(":"):
                hf.append([int(float(x)) for x in row.split(",")])
            hfs.append(hf)
    return sax, dim, ang, fs_str, np.array(hfs)


def main():
    out_dir = os.path.join(HERE, "..", "tests", "fixtures")
    os.makedirs(out_dir, exist_ok=True)
    tsu_files = sorted(
        glob.glob(os.path.join(ORIG, "*.tsu"))
        + glob.glob(os.path.join(ORIG, "setup", "*.tsu"))
    )
    count = 0
    for path in tsu_files:
        name = os.path.splitext(os.path.basename(path))[0]
        sax, dim, ang, fs_str, hfs = parse_tsu(path)
        if len(hfs) == 0:
            print("skip (no HFS):", name)
            continue
        type_stub = TypeStub(sax, dim, fs_str)
        voxmat = mat_from_fields(hfs, sax)
        ev = Evaluation(voxmat, type_stub)
        fixture = {
            "file": os.path.relpath(path, os.path.join(HERE, "..")),
            "sax": sax,
            "dim": dim,
            "ang": ang,
            "fss": fs_str,
            "hfs": hfs.tolist(),
            "voxel_matrix": voxmat.astype(int).tolist(),
            "valid": bool(ev.valid),
            "connected": [bool(x) for x in ev.connected],
            "bridged": [bool(x) for x in ev.bridged],
            "checker": [bool(x) for x in ev.checker],
            "checker_vertices": [np.array(v).astype(int).tolist() for v in ev.checker_vertices],
            "interlock": bool(ev.interlock),
            "interlocks": [bool(x) for x in ev.interlocks],
            "slides": [[[int(a), int(d)] for a, d in s] for s in ev.slides],
            "number_of_slides": [int(x) for x in ev.number_of_slides],
            "friction_nums": [int(x) for x in ev.friction_nums],
            "contact_nums": [int(x) for x in ev.contact_nums],
            "breakable": [bool(x) for x in ev.breakable],
            "breakable_voxel_inds": [
                [[int(a) for a in ind] for ind in inds] for inds in ev.breakable_voxel_inds
            ],
            "fab_direction_ok": [bool(x) for x in ev.fab_direction_ok],
            "fab_directions": [int(x) for x in ev.fab_directions],
        }
        with open(os.path.join(out_dir, name + ".json"), "w") as f:
            json.dump(fixture, f, indent=1)
        count += 1
        print("wrote", name, "valid =", ev.valid)
    print(f"{count} fixtures written to {out_dir}")


if __name__ == "__main__":
    main()
