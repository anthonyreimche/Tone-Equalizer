// drawGraph against a recording 2D context: what is drawn, in which colour,
// with and without a histogram (the probe is null until the first frame).

import { describe, expect, it } from "vitest";
import { WARN_COLOUR, drawGraph, type GraphState } from "../src/Graph";
import { histogramHeights, influenceRadius, plotRect } from "../src/graph-model";
import type { LogHistogram } from "../src/measure";
import { DEFAULT_PARAMS } from "../src/model";
import { fitOf } from "../src/params";
import { recordingContext } from "./support/recording-context";

const INK = { fg: "ink-fg", faint: "ink-faint", fill: "ink-fill" };
const W = 268;
const H = 200;

const state = (over: Partial<GraphState> = {}): GraphState => ({
  fit: fitOf(DEFAULT_PARAMS),
  histogram: null,
  hoverNode: null,
  mouseX: null,
  cursorEv: null,
  unstable: false,
  ...over,
});

const histogram = (first: number, last: number): LogHistogram => ({
  bins: Int32Array.from({ length: 256 }, (_, i) => i % 7),
  max: 6,
  first,
  last,
  count: 256,
});

const final = <T>(items: readonly T[]): T | undefined => items[items.length - 1];

const draw = (over: Partial<GraphState> = {}) => {
  const { ctx, calls } = recordingContext();
  drawGraph(ctx, W, H, INK, state(over));
  return calls;
};

describe("drawGraph", () => {
  it("draws the curve and its nine nodes without a histogram", () => {
    const calls = draw();
    expect(calls.filter((c) => c.op === "fillRect")).toHaveLength(0);
    expect(calls.filter((c) => c.op === "arc")).toHaveLength(9);
    expect(calls.filter((c) => c.op === "lineTo").length).toBeGreaterThanOrEqual(255);
    expect(calls.some((c) => c.fillStyle === WARN_COLOUR)).toBe(false);
  });

  it("draws the histogram as one filled path in the fill ink, from the plot's floor through each bin and back", () => {
    const hist = histogram(-6, -2);
    const calls = draw({ histogram: hist });
    expect(calls.filter((c) => c.op === "fillRect")).toHaveLength(0);
    const fills = calls.filter((c) => c.op === "fill" && c.fillStyle === INK.fill);
    expect(fills).toHaveLength(1);

    const end = calls.indexOf(fills[0]);
    const begin = calls.slice(0, end).map((c) => c.op).lastIndexOf("beginPath");
    const path = calls.slice(begin + 1, end);
    const r = plotRect(W, H);
    const floor = r.y + r.h;
    const heights = histogramHeights(hist, r);
    expect(path.map((c) => c.op)).toEqual(["moveTo", ...heights.map(() => "lineTo"), "lineTo", "closePath"]);
    expect(path[0].args).toEqual([r.x, floor]);
    heights.forEach((bh, k) => {
      expect(path[1 + k].args[0]).toBeCloseTo(r.x + (k / (heights.length - 1)) * r.w, 9);
      expect(path[1 + k].args[1]).toBeCloseTo(floor - bh, 9);
    });
    expect(path[path.length - 2].args).toEqual([r.x + r.w, floor]);
  });

  it("marks the edges the histogram overflows in the warning colour", () => {
    const marks = (first: number, last: number) =>
      draw({ histogram: histogram(first, last) }).filter((c) => c.op === "fill" && c.fillStyle === WARN_COLOUR);
    expect(marks(-6, -2)).toHaveLength(0);
    expect(marks(-6, -0.05)).toHaveLength(1);
    expect(marks(-7.95, -0.05)).toHaveLength(2);
  });

  it("strokes the curve in the warning colour only while the fit is unstable", () => {
    const warned = (unstable: boolean) =>
      draw({ unstable }).filter((c) => c.op === "stroke" && c.strokeStyle === WARN_COLOUR);
    expect(warned(false)).toHaveLength(0);
    expect(warned(true)).toHaveLength(1);
  });

  it("fills the node the pointer is on, or else the one nearest the image cursor", () => {
    const filled = (over: Partial<GraphState>) => draw(over).filter((c) => c.op === "fill");
    expect(filled({})).toHaveLength(0);
    expect(filled({ hoverNode: 4 })).toHaveLength(1);
    expect(filled({ cursorEv: -2.6 })).toHaveLength(1);
    expect(filled({ cursorEv: -2.5 })).toHaveLength(0);
  });

  it("draws the influence circle around the pointer", () => {
    const fit = fitOf(DEFAULT_PARAMS);
    const circles = draw({ mouseX: 100 }).filter((c) => c.op === "arc");
    expect(circles).toHaveLength(10);
    expect(circles[9].args[0]).toBe(100);
    expect(circles[9].args[2]).toBeCloseTo(influenceRadius(fit.sigma, plotRect(W, H)), 12);
  });

  it("draws an image cursor beyond the plot as a thick warning line at the edge", () => {
    const r = plotRect(W, H);
    const line = (ev: number) => final(draw({ cursorEv: ev }).filter((c) => c.op === "stroke"));
    expect(line(-3)).toMatchObject({ strokeStyle: INK.fg, lineWidth: 1 });
    expect(line(1.5)).toMatchObject({ strokeStyle: WARN_COLOUR, lineWidth: 3 });
    const edge = final(draw({ cursorEv: 1.5 }).filter((c) => c.op === "moveTo"));
    expect(edge?.args[0]).toBe(r.x + r.w);
  });
});
