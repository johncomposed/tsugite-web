/**
 * Lightweight performance monitor: FPS / frame time from the render loop,
 * named timings for expensive operations (rebuild, picking, milling, ...),
 * and three.js renderer stats. Rendered as a small HUD, toggle with `p`.
 */

interface Timing {
  last: number;
  avg: number;
  count: number;
}

const FRAME_WINDOW = 90;

export class PerfMonitor {
  readonly element: HTMLDivElement;
  /** Shown by default in dev; hidden in production builds (toggle with `p`). */
  visible = import.meta.env.DEV;

  private frameTimes: number[] = [];
  private lastFrameStart = 0;
  private timings = new Map<string, Timing>();
  private rendererStats = { calls: 0, triangles: 0, lines: 0 };
  private lastHudUpdate = 0;

  constructor(parent: HTMLElement) {
    this.element = document.createElement('div');
    this.element.id = 'perf-hud';
    this.element.style.display = this.visible ? '' : 'none';
    parent.appendChild(this.element);
  }

  toggle(): void {
    this.visible = !this.visible;
    this.element.style.display = this.visible ? '' : 'none';
  }

  /** Call once per animation frame, after rendering. */
  frame(info?: { calls: number; triangles: number; lines: number }): void {
    const now = performance.now();
    if (this.lastFrameStart > 0) {
      this.frameTimes.push(now - this.lastFrameStart);
      if (this.frameTimes.length > FRAME_WINDOW) this.frameTimes.shift();
    }
    this.lastFrameStart = now;
    if (info) this.rendererStats = info;
    if (this.visible && now - this.lastHudUpdate > 250) {
      this.lastHudUpdate = now;
      this.renderHud();
    }
  }

  /** Time a synchronous operation under a name. */
  time<T>(name: string, fn: () => T): T {
    const t0 = performance.now();
    const result = fn();
    this.record(name, performance.now() - t0);
    return result;
  }

  /** Record an externally measured duration (e.g. worker round-trip). */
  record(name: string, ms: number): void {
    const t = this.timings.get(name) ?? { last: 0, avg: 0, count: 0 };
    t.last = ms;
    t.count++;
    t.avg += (ms - t.avg) / Math.min(t.count, 20);
    this.timings.set(name, t);
  }

  private renderHud(): void {
    const n = this.frameTimes.length;
    let fps = 0;
    let avgMs = 0;
    let maxMs = 0;
    if (n > 0) {
      const sum = this.frameTimes.reduce((a, b) => a + b, 0);
      avgMs = sum / n;
      fps = 1000 / avgMs;
      maxMs = Math.max(...this.frameTimes);
    }
    const rows: string[] = [
      `<b>${fps.toFixed(0)} fps</b> ${avgMs.toFixed(1)} ms (max ${maxMs.toFixed(1)})`,
      `draws ${this.rendererStats.calls} · tris ${this.rendererStats.triangles} · lines ${this.rendererStats.lines}`,
    ];
    for (const [name, t] of this.timings) {
      rows.push(`${name}: ${t.last.toFixed(1)} ms (avg ${t.avg.toFixed(1)})`);
    }
    this.element.innerHTML = rows.join('<br>');
  }
}
