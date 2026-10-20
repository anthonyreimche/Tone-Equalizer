// The on-image cursor's numbers: darktable's wheel steps (Alt for fine, since
// Ctrl/⌘/Space pass the overlay through), the "%+.1f EV" pill, the greys of
// the before/after circles and the correction wedge, and pointer → image UV.

import { describe, expect, it } from "vitest";
import { fitCurve, gainAt, type Fit } from "../src/curve";
import {
  CIRCLE_ALPHA,
  INNER_RADIUS,
  LINE_WIDTH,
  OUTER_RADIUS,
  OUTLINE_WIDTH,
  PILL_ALPHA,
  WEDGE_RADIUS,
  WEDGE_WIDTH,
  correctionGain,
  createWheelAccumulator,
  cursorBars,
  formatExposure,
  frameInk,
  greyCss,
  pillBox,
  pointToUv,
  wedgeAngle,
  wedgePath,
  wheelPixels,
  wheelStep,
} from "../src/overlay-model";

describe("the wheel", () => {
  it("steps 0.25 EV, 1 EV with Shift, 0.1 EV with Alt", () => {
    expect(wheelStep({ shiftKey: false, altKey: false })).toBe(0.25);
    expect(wheelStep({ shiftKey: true, altKey: false })).toBe(1);
    expect(wheelStep({ shiftKey: false, altKey: true })).toBe(0.1);
  });

  it("reads a wheel event in pixels, up positive, also when Shift turns the wheel horizontal", () => {
    expect(wheelPixels({ deltaX: 0, deltaY: -100, deltaMode: 0 })).toBe(100);
    expect(wheelPixels({ deltaX: 0, deltaY: 53, deltaMode: 0 })).toBe(-53);
    expect(wheelPixels({ deltaX: -100, deltaY: 0, deltaMode: 0 })).toBe(100);
    expect(wheelPixels({ deltaX: 0, deltaY: 0, deltaMode: 0 })).toBe(0);
  });

  it("counts a line as 16 px and a page as 120", () => {
    expect(wheelPixels({ deltaX: 0, deltaY: -3, deltaMode: 1 })).toBe(48);
    expect(wheelPixels({ deltaX: 0, deltaY: -1, deltaMode: 2 })).toBe(120);
  });
});

describe("the wheel accumulator", () => {
  const event = (deltaY: number, deltaMode = 0) => ({ deltaX: 0, deltaY, deltaMode });
  const run = (deltas: number[], deltaMode = 0) => {
    const wheel = createWheelAccumulator();
    return deltas.map((d) => wheel.push(event(d, deltaMode)));
  };

  it("steps once for a 100 px notch, up positive and down negative", () => {
    expect(run([-100])).toEqual([1]);
    expect(run([100])).toEqual([-1]);
    expect(run([-100, -100, 100])).toEqual([1, 1, -1]);
  });

  it("takes a lone event of 33 px or more for a notch, however a display scale shrinks it", () => {
    expect(run([-67])).toEqual([1]);
    expect(run([-50])).toEqual([1]);
    expect(run([-33])).toEqual([1]);
    expect(run([-32])).toEqual([0]);
  });

  it("steps by a notch's size in units, rounded, at least one", () => {
    expect(run([-200])).toEqual([2]);
    expect(run([-149, -150])).toEqual([1, 2]);
    expect(run([-130, 240])).toEqual([1, -2]);
  });

  it("holds small deltas until they make a unit: five of -20 are one step", () => {
    expect(run([-20, -20, -20, -20, -20])).toEqual([0, 0, 0, 0, 1]);
  });

  it("starts small deltas from zero after a notch, and a notch clears what they held", () => {
    expect(run([-150, -20, -20, -20, -20])).toEqual([2, 0, 0, 0, 0]);
    expect(run([-20, -20, -100, -20, -20, -20, -20])).toEqual([0, 0, 1, 0, 0, 0, 0]);
  });

  it("drops the remainder when the direction changes", () => {
    expect(run([-30, -30, 30, 30, 30, 30])).toEqual([0, 0, 0, 0, 0, -1]);
  });

  it("counts lines and pages after converting them to pixels", () => {
    expect(run([-1, -1, -1, -1, -1, -1, -1], 1)).toEqual([0, 0, 0, 0, 0, 0, 1]);
    expect(run([-3], 1)).toEqual([1]);
    expect(run([-1, -1], 2)).toEqual([1, 1]);
  });

  it("forgets the remainder on reset", () => {
    const wheel = createWheelAccumulator();
    expect([wheel.push(event(-30)), wheel.push(event(-30))]).toEqual([0, 0]);
    wheel.reset();
    expect([wheel.push(event(-30)), wheel.push(event(-30))]).toEqual([0, 0]);
  });
});

describe("the readout", () => {
  it.each([
    [-3.24, "−3.2 EV"],
    [0.04, "+0.0 EV"],
    [-0.04, "+0.0 EV"],
    [1.26, "+1.3 EV"],
  ])("formats %s as %s", (ev, text) => expect(formatExposure(ev)).toBe(text));

  it("shows ? EV without a value", () => {
    expect(formatExposure(null)).toBe("? EV");
    expect(formatExposure(Number.NaN)).toBe("? EV");
  });

  it("draws linear greys through gamma 1/2.2 and picks the frame against them", () => {
    expect(greyCss(0.18)).toBe("rgb(117, 117, 117)");
    expect(greyCss(4)).toBe("rgb(255, 255, 255)");
    expect(frameInk(0.5)).toBe("rgb(0, 0, 0)");
    expect(frameInk(0.05)).toBe("rgb(255, 255, 255)");
  });
});

describe("the wedge", () => {
  it("sweeps ±90° at ±2 EV, clamped", () => {
    expect(wedgeAngle(2)).toBeCloseTo(Math.PI / 2, 12);
    expect(wedgeAngle(-1)).toBeCloseTo(-Math.PI / 4, 12);
    expect(wedgeAngle(5)).toBeCloseTo(Math.PI / 2, 12);
  });

  it("is an arc that starts on the left and turns up for a lift", () => {
    expect(wedgePath(50, 50, 20, 0)).toBe("");
    expect(wedgePath(50, 50, 20, Math.PI / 2)).toBe("M 30.00 50.00 A 20 20 0 0 1 50.00 30.00");
    expect(wedgePath(50, 50, 20, -Math.PI / 2)).toBe("M 30.00 50.00 A 20 20 0 0 0 50.00 70.00");
  });

  it("draws the curve's gain at the exposure, none from a fit that failed", () => {
    const fit = fitCurve([0, 0, 0, 0, 1, 0, 0, 0, 0], Math.SQRT2);
    expect(correctionGain(-4, fit)).toBeCloseTo(Math.log2(gainAt(-4, fit)), 12);
    expect(correctionGain(-4, fit)).toBeGreaterThan(0);
    expect(correctionGain(null, fit)).toBe(0);
    const failed: Fit = { weights: new Array<number>(8).fill(0), sigma: 4, valid: false };
    expect(correctionGain(-4, failed)).toBe(0);
  });
});

describe("the cursor's geometry (gui/draw.h dt_draw_correction_cursor, zoom 1)", () => {
  it("sizes the circles, the wedge, the lines and the alphas as darktable does", () => {
    expect([OUTER_RADIUS, INNER_RADIUS, WEDGE_RADIUS, WEDGE_WIDTH]).toEqual([16, 8, 32, 8]);
    expect([LINE_WIDTH, OUTLINE_WIDTH, CIRCLE_ALPHA, PILL_ALPHA]).toEqual([1.5, 1, 0.9, 0.8]);
  });

  it("runs the crosshair 16 to 36 px out, the right ground bar 16 to 24 and the left 16 to 48", () => {
    expect(cursorBars(100, 50)).toEqual([
      { x1: 116, y1: 50, x2: 124, y2: 50 },
      { x1: 84, y1: 50, x2: 52, y2: 50 },
      { x1: 100, y1: 66, x2: 100, y2: 86 },
      { x1: 100, y1: 34, x2: 100, y2: 14 },
    ]);
  });

  it("centres the pill on the pointer's row, 24 px to its right, 4 px of padding", () => {
    expect(pillBox(100, 50, 40, 10)).toEqual({ x: 124, y: 41, width: 48, height: 18, textX: 128, textY: 50 });
  });
});

describe("pointToUv", () => {
  const rect = { x: 10, y: 20, w: 200, h: 100 };
  const box = { left: 100, top: 50, width: 400, height: 300 };

  it("maps a pointer through the UI zoom to the image rect", () => {
    expect(pointToUv(210, 120, box, 1, rect)).toEqual({ x: 0.5, y: 0.5 });
    expect(pointToUv(160, 95, box, 2, rect)).toEqual({ x: 0.55, y: 0.7 });
  });

  it("is null off the image or without a rect", () => {
    expect(pointToUv(100, 50, box, 1, rect)).toBeNull();
    expect(pointToUv(210, 120, box, 1, null)).toBeNull();
  });
});
