// The graph's arithmetic: darktable's plot (−8…0 EV across, +2…−2 EV up), its
// drag rule, node picking, the influence circle and the histogram's bars.

import { describe, expect, it } from "vitest";
import {
  MARGIN,
  cursorLine,
  dragStep,
  evToX,
  gainToY,
  graphHeight,
  histogramHeights,
  influenceRadius,
  nodeAt,
  nodeNear,
  overflowWarnings,
  plotRect,
  xToEv,
} from "../src/graph-model";
import type { LogHistogram } from "../src/measure";

const r = plotRect(268, 200);

describe("plot geometry", () => {
  it("keeps the height between 160 and 280 px at three quarters of the width", () => {
    expect(graphHeight(100)).toBe(160);
    expect(graphHeight(268)).toBe(201);
    expect(graphHeight(600)).toBe(280);
  });

  it("leaves room for the labels", () => {
    expect(r).toEqual({ x: MARGIN.left, y: MARGIN.top, w: 268 - MARGIN.left - MARGIN.right, h: 200 - MARGIN.top - MARGIN.bottom });
  });

  it("maps −8…0 EV across and back", () => {
    expect(evToX(-8, r)).toBe(r.x);
    expect(evToX(0, r)).toBe(r.x + r.w);
    expect(xToEv(evToX(-3.25, r), r)).toBeCloseTo(-3.25, 12);
  });

  it("puts +2 EV at the top, 0 in the middle and −2 at the bottom", () => {
    expect(gainToY(2, r)).toBe(r.y);
    expect(gainToY(0, r)).toBe(r.y + r.h / 2);
    expect(gainToY(-2, r)).toBe(r.y + r.h);
  });
});

describe("gestures", () => {
  it("adds 4 EV per plot height at the previous pointer's exposure", () => {
    const prev = { x: evToX(-4, r), y: r.y + r.h / 2 };
    const step = dragStep(prev, { x: prev.x + 30, y: prev.y - r.h / 8 }, r);
    expect(step.x0).toBeCloseTo(-4, 12);
    expect(step.offset).toBeCloseTo(0.5, 12);
  });

  it("picks a node within 0.45 of the node spacing, and none between", () => {
    const spacing = r.w / 8;
    expect(nodeAt(evToX(-5, r) + 0.4 * spacing, r)).toBe(3);
    expect(nodeAt(evToX(-5, r) + 0.5 * spacing, r)).toBeNull();
    expect(nodeAt(r.x - 2, r)).toBe(0);
    expect(nodeAt(r.x + r.w + 50, r)).toBeNull();
  });

  it("lights the node within 0.45 EV of the image cursor's exposure", () => {
    expect(nodeNear(-2.6)).toBe(5);
    expect(nodeNear(-2.5)).toBeNull();
    expect(nodeNear(0.3)).toBe(8);
    expect(nodeNear(-9)).toBeNull();
  });

  it("draws the influence circle σ/√2 EV wide", () => {
    expect(influenceRadius(Math.SQRT2, r)).toBeCloseTo(r.w / 8, 12);
  });
});

describe("node indices", () => {
  it("returns a plain 0 for the first node from either side", () => {
    expect(Object.is(nodeAt(r.x - 2, r), 0)).toBe(true);
    expect(Object.is(nodeNear(-8.2), 0)).toBe(true);
  });

  it("finds no node for a pointer or exposure that is not a number", () => {
    expect(nodeAt(Number.NaN, r)).toBeNull();
    expect(nodeNear(Number.NaN)).toBeNull();
  });
});

describe("histogram and cursor", () => {
  const hist = (bins: number[], first: number, last: number): LogHistogram => ({
    bins: Int32Array.from(bins),
    max: Math.max(1, ...bins),
    first,
    last,
    count: bins.reduce((a, b) => a + b, 0),
  });

  it("scales the bars to 96 % of the plot at the busiest bin", () => {
    const heights = histogramHeights(hist([0, 5, 10], -6, -2), r);
    [0, 0.48 * r.h, 0.96 * r.h].forEach((v, i) => expect(heights[i]).toBeCloseTo(v, 9));
  });

  it("warns when the 95 % point passes −0.1 EV or the 5 % point −7.9 EV", () => {
    expect(overflowWarnings(hist([1], -7.95, -0.05))).toEqual({ highlights: true, shadows: true });
    expect(overflowWarnings(hist([1], -7.5, -0.5))).toEqual({ highlights: false, shadows: false });
  });

  it("clamps the cursor's line to the plot and flags it outside [−8, 0] EV", () => {
    expect(cursorLine(-3, r)).toEqual({ x: evToX(-3, r), outside: false });
    expect(cursorLine(1.5, r)).toEqual({ x: r.x + r.w, outside: true });
    expect(cursorLine(-9, r)).toEqual({ x: r.x, outside: true });
  });
});
