/**
 * Control panel — web equivalent of Tsugite.ui (the Qt side panel):
 * design parameters, fabrication parameters, file actions.
 */
import type { Joint } from '../model/joint';
import type { Axis } from '../model/types';
import type { ViewSettings } from '../view/viewSettings';

export interface PanelCallbacks {
  refresh: () => void;
  statusMessage: (msg: string) => void;
  newFile: () => void;
  openFile: () => void;
  saveFile: () => void;
  exportFiles: () => void;
  loadExample: (name: string) => void;
}

function row(label: string, input: HTMLElement): HTMLDivElement {
  const div = document.createElement('div');
  div.className = 'cp-row';
  const span = document.createElement('label');
  span.textContent = label;
  div.append(span, input);
  return div;
}

function section(title: string): HTMLDivElement {
  const div = document.createElement('div');
  div.className = 'cp-section';
  const h = document.createElement('div');
  h.className = 'cp-heading';
  h.textContent = title;
  div.appendChild(h);
  return div;
}

function numberInput(
  value: number,
  min: number,
  max: number,
  step: number,
  onChange: (v: number) => void,
): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'number';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  input.addEventListener('change', () => {
    const v = parseFloat(input.value);
    if (!Number.isNaN(v)) onChange(Math.min(max, Math.max(min, v)));
  });
  return input;
}

function select(options: string[], index: number, onChange: (i: number) => void): HTMLSelectElement {
  const sel = document.createElement('select');
  for (const opt of options) {
    const o = document.createElement('option');
    o.textContent = opt;
    sel.appendChild(o);
  }
  sel.selectedIndex = index;
  sel.addEventListener('change', () => onChange(sel.selectedIndex));
  return sel;
}

function checkbox(checked: boolean, onChange: (v: boolean) => void): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  return input;
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

export class ControlPanel {
  readonly element: HTMLDivElement;
  private cubeLock = true;
  private dimInputs: HTMLInputElement[] = [];
  private examples: { name: string; valid: boolean }[] = [];

  constructor(
    parent: HTMLElement,
    private readonly joint: Joint,
    private readonly view: ViewSettings,
    private readonly cb: PanelCallbacks,
  ) {
    this.element = document.createElement('div');
    this.element.id = 'control-panel';
    parent.appendChild(this.element);
    this.build();
  }

  /** Rebuild all inputs from current joint state (after open/new). */
  rebuild(): void {
    this.element.innerHTML = '';
    this.build();
  }

  /** Provide the example joints (name + evaluated validity). */
  setExamples(examples: { name: string; valid: boolean }[]): void {
    this.examples = examples;
    this.rebuild();
  }

  private build(): void {
    const { joint, view, cb } = this;

    // --- File
    const file = section('File');
    const fileRow = document.createElement('div');
    fileRow.className = 'cp-row cp-buttons';
    fileRow.append(
      button('New', cb.newFile),
      button('Open', cb.openFile),
      button('Save', cb.saveFile),
    );
    file.appendChild(fileRow);
    this.element.appendChild(file);

    // --- Examples (joints shipped with the original repo)
    if (this.examples.length > 0) {
      const ex = section('Examples');
      const sel = document.createElement('select');
      sel.className = 'cp-wide';
      const placeholder = document.createElement('option');
      placeholder.textContent = `Load example… (${this.examples.length})`;
      placeholder.disabled = true;
      placeholder.selected = true;
      sel.appendChild(placeholder);
      const groups: [string, boolean][] = [
        ['Valid joints', true],
        ['Invalid joints', false],
      ];
      for (const [label, valid] of groups) {
        const items = this.examples.filter((e) => e.valid === valid);
        if (items.length === 0) continue;
        const og = document.createElement('optgroup');
        og.label = `${label} (${items.length})`;
        for (const { name } of items) {
          const o = document.createElement('option');
          o.value = name;
          o.textContent = name.replace(/\.tsu$/, '');
          og.appendChild(o);
        }
        sel.appendChild(og);
      }
      sel.addEventListener('change', () => {
        if (sel.value) cb.loadExample(sel.value);
      });
      ex.appendChild(sel);
      this.element.appendChild(ex);
    }

    // --- Design
    const design = section('Design');
    design.appendChild(
      row(
        '',
        button('Open/close joint', () => {
          view.openJoint = !view.openJoint;
        }),
      ),
    );
    design.appendChild(
      row(
        'Show feedback',
        checkbox(view.showFeedback, (v) => {
          view.showFeedback = v;
          cb.refresh();
        }),
      ),
    );
    design.appendChild(
      row(
        'Sliding axis',
        select(['X', 'Y', 'Z'], joint.sax, (i) => {
          const res = joint.updateSlidingDirection(i as Axis);
          if (!res.ok) cb.statusMessage(res.msg);
          cb.refresh();
          this.rebuild();
        }),
      ),
    );
    design.appendChild(
      row(
        'Timbers',
        numberInput(joint.noc, 2, 6, 1, (v) => {
          joint.updateNumberOfComponents(Math.round(v));
          cb.refresh();
          this.rebuild();
        }),
      ),
    );
    design.appendChild(
      row(
        'Resolution',
        numberInput(joint.dim, 2, 5, 1, (v) => {
          joint.updateDimension(Math.round(v));
          cb.refresh();
        }),
      ),
    );
    design.appendChild(
      row(
        'Angle',
        numberInput(joint.ang, -80, 80, 1, (v) => {
          joint.updateAngle(v);
          joint.recompute();
          cb.refresh();
        }),
      ),
    );
    const axesNames: [string, number][] = [
      ['Timber X (mm)', 0],
      ['Timber Y (mm)', 1],
      ['Timber Z (mm)', 2],
    ];
    this.dimInputs = [];
    for (const [label, i] of axesNames) {
      const input = numberInput(joint.realTimDims[i], 10, 250, 1, (v) => {
        const inds = this.cubeLock ? [0, 1, 2] : [i];
        joint.updateTimberDims(inds, v);
        joint.recompute();
        if (this.cubeLock) {
          for (const inp of this.dimInputs) inp.value = String(v);
        }
        cb.refresh();
      });
      this.dimInputs.push(input);
      design.appendChild(row(label, input));
    }
    design.appendChild(
      row(
        'All same (cube)',
        checkbox(this.cubeLock, (v) => {
          this.cubeLock = v;
          if (v) {
            joint.updateTimberDims([0, 1, 2], joint.realTimDims[0]);
            joint.recompute();
            for (const inp of this.dimInputs) inp.value = String(joint.realTimDims[0]);
            cb.refresh();
          }
        }),
      ),
    );
    const designBtns = document.createElement('div');
    designBtns.className = 'cp-row cp-buttons';
    designBtns.append(
      button('Randomize', () => {
        joint.randomize();
        cb.refresh();
      }),
      button('Clear', () => {
        joint.clear();
        cb.refresh();
      }),
    );
    design.appendChild(designBtns);
    this.element.appendChild(design);

    // --- Fabrication
    const fab = section('Fabrication');
    fab.appendChild(
      row(
        'Bit diameter (mm)',
        numberInput(joint.fab.realDia, 1, 20, 0.05, (v) => {
          joint.fab.realDia = v;
          cb.refresh();
        }),
      ),
    );
    fab.appendChild(
      row(
        'Tolerance (mm)',
        numberInput(joint.fab.tol, 0, 2, 0.01, (v) => {
          joint.fab.tol = v;
          cb.refresh();
        }),
      ),
    );
    fab.appendChild(
      row(
        'Speed (mm/min)',
        numberInput(joint.fab.speed, 50, 5000, 10, (v) => {
          joint.fab.speed = v;
        }),
      ),
    );
    fab.appendChild(
      row(
        'Spindle (rpm)',
        numberInput(joint.fab.spindleSpeed, 1000, 30000, 100, (v) => {
          joint.fab.spindleSpeed = v;
        }),
      ),
    );
    fab.appendChild(
      row(
        'Align axis',
        select(['X+', 'X-', 'Y+', 'Y-'], joint.fab.alignAx, (i) => {
          joint.fab.alignAx = i;
        }),
      ),
    );
    fab.appendChild(
      row(
        'Incremental',
        checkbox(joint.incremental, (v) => {
          joint.incremental = v;
        }),
      ),
    );
    fab.appendChild(
      row(
        'Interpolate arcs',
        checkbox(joint.fab.interp, (v) => {
          joint.fab.interp = v;
        }),
      ),
    );
    fab.appendChild(
      row(
        'Format',
        select(['gcode', 'nc', 'sbp'], ['gcode', 'nc', 'sbp'].indexOf(joint.fab.ext), (i) => {
          joint.fab.ext = (['gcode', 'nc', 'sbp'] as const)[i];
        }),
      ),
    );
    const fabBtns = document.createElement('div');
    fabBtns.className = 'cp-row cp-buttons';
    fabBtns.append(
      button('Milling path', () => {
        view.showMillingPath = !view.showMillingPath;
        cb.refresh();
      }),
      button('Export', cb.exportFiles),
    );
    fab.appendChild(fabBtns);
    this.element.appendChild(fab);
  }
}
