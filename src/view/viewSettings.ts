/** Port of ViewSettings.py. */

export class ViewSettings {
  // Visibility
  hidden = [false, false, false, false, false, false];
  showHiddenLines = true;
  showFeedback = true;
  showMillingPath = false;
  showSuggestions = true;

  // Joint opening
  openJoint = false;
  private openStartTime: number | null = null;
  private closeStartTime: number | null = null;
  private openStartDist = 0;
  private closeStartDist = 0;
  openRatio = 0;

  // Mouse rotation / zoom
  xrot = 0.8;
  yrot = 0.4;
  /** Rotation speed (the original used 0.001; raised for snappier feel). */
  rotSpeed = 0.003;
  zoom = 1;
  private xrot0 = this.xrot;
  private yrot0 = this.yrot;
  private xstart = 0;
  private ystart = 0;
  dragged = false;

  // Colors of unbridged components (per component: two part colors)
  readonly unbridgeColors: [number, number][] = [
    [0xffff99, 0x99ffff],
    [0xff99ff, 0xffcc99],
    [0xccccff, 0xf2f2f2],
  ];

  /** Port of set_joint_opening_distance (time-based ease). */
  updateOpenRatio(noc: number): void {
    const now = performance.now() / 1000;
    if (this.openJoint) {
      if (this.openStartTime === null) {
        this.openStartTime = now;
        this.closeStartTime = null;
      }
      this.openRatio = this.openStartDist + 1.2 * (now - this.openStartTime);
      const max = 1 + 0.5 * (noc - 2);
      if (this.openRatio >= max) this.openRatio = max;
      this.closeStartDist = this.openRatio;
      return;
    }
    if (this.closeStartTime === null) {
      this.closeStartTime = now;
      this.openStartTime = null;
    }
    this.openRatio = this.closeStartDist - 1.2 * (now - this.closeStartTime);
    if (this.openRatio < 0) this.openRatio = 0;
    this.openStartDist = this.openRatio;
  }

  get fullyOpenRatio(): (noc: number) => number {
    return (noc: number) => 1 + 0.5 * (noc - 2);
  }

  startRotation(x: number, y: number): void {
    this.xstart = x;
    this.ystart = y;
    this.dragged = true;
    this.xrot0 = this.xrot;
    this.yrot0 = this.yrot;
  }

  updateRotation(x: number, y: number): void {
    if (!this.dragged) return;
    this.xrot = this.xrot0 + this.rotSpeed * (y - this.ystart);
    this.yrot = this.yrot0 + this.rotSpeed * (x - this.xstart);
  }

  /** Multiply zoom by a factor, clamped. */
  applyZoom(factor: number): void {
    this.zoom = Math.min(8, Math.max(0.2, this.zoom * factor));
  }

  endRotation(): void {
    this.dragged = false;
  }

  setStandardRotation(): void {
    this.xrot = 0.8;
    this.yrot = 0.4;
  }

  setClosestPlaneRotation(): void {
    const nang = 0.5 * Math.PI;
    this.xrot = Math.round(this.xrot / nang) * nang;
    this.yrot = Math.round(this.yrot / nang) * nang;
  }
}
