/**
 * Gallery mode: a full-screen overlay of valid joints for the current
 * configuration. Results are generated ONLY when the user clicks
 * Generate/Regenerate and are cached — navigating gallery → joint →
 * gallery shows the same results without recomputation.
 */
import { FixedSide, fixedSidesFromString, fixedSidesToString } from '../model/fixedSides';
import type { Joint } from '../model/joint';
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
    this.statusEl = document.createElement('span');
    this.statusEl.className = 'gallery-status';
    bar.append(title, this.generateBtn, closeBtn, this.statusEl);

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
    this.generating = false;
    this.generateBtn.disabled = false;
    this.results = results;
    this.resultConfig = config;
    this.attempts = attempts;
    this.gridEl.innerHTML = '';
    for (const hfs of results) {
      const canvas = document.createElement('canvas');
      canvas.width = THUMB_SIZE;
      canvas.height = THUMB_SIZE;
      canvas.className = 'gallery-thumb';
      this.thumbs.render(joint, hfs, canvas, xrot, yrot);
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
    this.updateStatus();
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
