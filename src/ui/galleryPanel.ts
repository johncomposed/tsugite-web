/**
 * Gallery mode: a full-screen overlay of valid joints for the current
 * configuration. Results are generated ONLY when the user clicks
 * Generate/Regenerate and are cached — navigating gallery → joint →
 * gallery shows the same results without recomputation.
 */
import { FixedSide, fixedSidesFromString, fixedSidesToString } from '../model/fixedSides';
import { Joint } from '../model/joint';
import type { Axis, Mat2 } from '../model/types';
import { ThumbRenderer } from './thumbRenderer';

export interface GalleryConfig {
  sax: Axis;
  dim: number;
  fss: string;
}

export interface GalleryPick {
  hfs: Mat2[];
  sax: Axis;
  dim: number;
  fixedSides: FixedSide[][];
}

const THUMB_SIZE = 200;

export class GalleryPanel {
  readonly element: HTMLDivElement;
  onPick: ((pick: GalleryPick) => void) | null = null;
  onGenerate: ((config: GalleryConfig) => void) | null = null;

  private readonly thumbs: ThumbRenderer;
  private readonly statusEl: HTMLSpanElement;
  private readonly gridEl: HTMLDivElement;
  private readonly generateBtn: HTMLButtonElement;
  private openToggle!: HTMLInputElement;
  private renderJoint: Joint | null = null;
  private renderRot: [number, number] = [0.8, 0.4];

  /** Cached results + the config they were generated for. */
  private results: Mat2[][] = [];
  private resultConfig: GalleryConfig | null = null;
  private attempts = 0;
  private generating = false;

  constructor(parent: HTMLElement) {
    this.thumbs = new ThumbRenderer(THUMB_SIZE);
    this.element = document.createElement('div');
    this.element.id = 'gallery';
    this.element.style.display = 'none';

    const bar = document.createElement('div');
    bar.className = 'gallery-bar';
    const title = document.createElement('b');
    title.textContent = 'Gallery — valid joints';
    this.generateBtn = document.createElement('button');
    this.generateBtn.textContent = 'Generate';
    this.generateBtn.addEventListener('click', () => {
      if (!this.generating && this.onGenerate && this.pendingConfig) {
        this.onGenerate(this.pendingConfig);
      }
    });
    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', () => this.close());
    const openLabel = document.createElement('label');
    openLabel.className = 'gallery-open-toggle';
    this.openToggle = document.createElement('input');
    this.openToggle.type = 'checkbox';
    this.openToggle.addEventListener('change', () => this.renderGrid());
    openLabel.append(this.openToggle, document.createTextNode(' Open joints'));
    this.statusEl = document.createElement('span');
    this.statusEl.className = 'gallery-status';
    bar.append(title, this.generateBtn, openLabel, closeBtn, this.statusEl);

    this.gridEl = document.createElement('div');
    this.gridEl.className = 'gallery-grid';

    this.element.append(bar, this.gridEl);
    parent.appendChild(this.element);
  }

  get isOpen(): boolean {
    return this.element.style.display !== 'none';
  }

  private pendingConfig: GalleryConfig | null = null;

  /** Open the gallery for the given current configuration (cached view). */
  open(joint: Joint): void {
    this.pendingConfig = {
      sax: joint.sax,
      dim: joint.dim,
      fss: fixedSidesToString(joint.fixedSides),
    };
    this.element.style.display = '';
    this.updateStatus();
  }

  close(): void {
    this.element.style.display = 'none';
  }

  setGenerating(): void {
    this.generating = true;
    this.generateBtn.disabled = true;
    this.statusEl.textContent = 'Generating…';
  }

  /** Store + display generated results (joint provides render parameters). */
  setResults(
    joint: Joint,
    config: GalleryConfig,
    results: Mat2[][],
    attempts: number,
    xrot: number,
    yrot: number,
  ): void {
    void joint;
    this.generating = false;
    this.generateBtn.disabled = false;
    this.results = results;
    this.resultConfig = config;
    this.attempts = attempts;
    this.renderRot = [xrot, yrot];
    // Dedicated render joint pinned to the generated config, so toggling the
    // open view later stays correct even if the main joint changed.
    this.renderJoint =
      results.length > 0
        ? new Joint({
            sax: config.sax,
            dim: config.dim,
            fixedSides: fixedSidesFromString(config.fss),
            heightFields: results[0].map((hf) => hf.map((r) => r.slice())),
          })
        : null;
    this.renderGrid();
    this.updateStatus();
  }

  /** (Re)render cached results — used on new results and open/closed toggle. */
  private renderGrid(): void {
    this.gridEl.innerHTML = '';
    if (!this.renderJoint) return;
    const openRatio = this.openToggle.checked
      ? 1 + 0.5 * (this.renderJoint.noc - 2)
      : 0;
    for (const hfs of this.results) {
      const canvas = document.createElement('canvas');
      canvas.width = THUMB_SIZE;
      canvas.height = THUMB_SIZE;
      canvas.className = 'gallery-thumb';
      this.thumbs.render(
        this.renderJoint,
        hfs,
        canvas,
        this.renderRot[0],
        this.renderRot[1],
        openRatio,
      );
      canvas.addEventListener('click', () => {
        if (!this.onPick || !this.resultConfig) return;
        this.close();
        this.onPick({
          hfs: hfs.map((hf) => hf.map((r) => r.slice())),
          sax: this.resultConfig.sax,
          dim: this.resultConfig.dim,
          fixedSides: fixedSidesFromString(this.resultConfig.fss),
        });
      });
      this.gridEl.appendChild(canvas);
    }
  }

  private updateStatus(): void {
    if (this.generating) return;
    if (!this.resultConfig) {
      this.statusEl.textContent = 'No results yet — click Generate.';
      this.generateBtn.textContent = 'Generate';
      return;
    }
    this.generateBtn.textContent = 'Regenerate';
    const sameConfig =
      this.pendingConfig &&
      this.pendingConfig.sax === this.resultConfig.sax &&
      this.pendingConfig.dim === this.resultConfig.dim &&
      this.pendingConfig.fss === this.resultConfig.fss;
    const base = `${this.results.length} valid joints (${this.attempts} sampled)`;
    this.statusEl.textContent = sameConfig
      ? base
      : `${base} — generated for a different setup; Regenerate for the current one.`;
  }
}
