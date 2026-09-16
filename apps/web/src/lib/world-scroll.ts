/** Display-only queue of accepted tile steps. Logical positions and transport stay in World. */
export class WorldScroll {
  private steps: { x: number; y: number }[] = [];
  private lastFrame = 0;
  private startAt = 0;
  private lastStep: number | null = null;
  private speed = 32 / 170;

  get offset() {
    return this.steps.reduce((sum, step) => ({ x: sum.x + step.x, y: sum.y + step.y }), { x: 0, y: 0 });
  }
  get distance() { return this.steps.reduce((sum, step) => sum + Math.hypot(step.x, step.y), 0); }
  get moving() { return this.steps.length > 0; }

  clear() { this.steps = []; this.lastStep = null; }

  add(dx: number, dy: number, now: number) {
    this.advance(now);
    const continuous = this.lastStep !== null && now - this.lastStep <= 200;
    const interval = this.lastStep === null ? 170 : now - this.lastStep;
    // OS key repeat/turns may be faster than the stick's 170ms. Never slow down
    // after a pause, or use a near-zero event interval as an infinite velocity.
    this.speed = 32 / (continuous && interval < 120 ? Math.max(16, interval) : 170);
    if (!this.moving) {
      this.lastFrame = now;
      // One initial frame of slack, not a delay added on every tile boundary.
      this.startAt = now + (continuous ? 0 : 16);
    }
    this.lastStep = now;
    this.steps.push({ x: dx * 32, y: dy * 32 });
  }

  advance(now: number) {
    let distance = Math.max(0, now - Math.max(this.lastFrame, this.startAt)) * this.speed;
    this.lastFrame = Math.max(this.lastFrame, now);
    while (this.steps.length && distance > 0) {
      const step = this.steps[0]!;
      const length = Math.hypot(step.x, step.y);
      if (distance >= length) { distance -= length; this.steps.shift(); }
      else { const remaining = 1 - distance / length; step.x *= remaining; step.y *= remaining; break; }
    }
    return this.offset;
  }
}
