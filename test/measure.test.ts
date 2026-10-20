// The graph's histogram and deciles (compute_log_histogram_and_stats), the two
// auto-adjust buttons' arithmetic, and the 3×3 cursor readout
// (get_luminance_from_buffer), against darktable's own code.

import { describe, expect, it } from "vitest";
import { autoContrast, autoExposure, cursorExposure, logHistogram } from "../src/measure";
import { DT_DETAILS, V } from "./support/vectors";

describe("logHistogram against darktable", () => {
  it.each(V.histograms.map((h, i) => [i, h] as const))("set %i", (_i, ref) => {
    const h = logHistogram(ref.ev)!;
    expect(Array.from(h.bins)).toEqual(ref.bins);
    expect(h.max).toBe(ref.max);
    expect(h.first).toBeCloseTo(ref.first, 5);
    expect(h.last).toBeCloseTo(ref.last, 5);
    expect(h.count).toBe(ref.ev.length);
  });

  it("skips invalid samples and is null without any", () => {
    expect(logHistogram([Number.NaN, Number.NaN])).toBeNull();
    expect(logHistogram([Number.NaN, -4, Number.POSITIVE_INFINITY])!.count).toBe(1);
  });
});

describe("auto exposure and contrast against darktable", () => {
  it.each(V.autos.map((a, i) => [i, a] as const))("case %i", (_i, ref) => {
    const p = {
      exposureBoost: ref.exposureBoost,
      contrastBoost: ref.contrastBoost,
      details: DT_DETAILS[ref.details],
      feathering: ref.feathering,
    };
    expect(autoExposure(ref.first, ref.last, ref.exposureBoost, ref.contrastBoost)).toBeCloseTo(ref.exposure, 5);
    expect(autoContrast(ref.first, ref.last, p)).toBeCloseTo(ref.contrast, 5);
  });
});

describe("cursorExposure against darktable", () => {
  const { width, height, ev, points } = V.cursor;
  it.each(points.map((p) => [p.x, p.y, p.value] as const))("at (%i, %i)", (x, y, value) => {
    expect(cursorExposure(ev, width, height, x, y)).toBeCloseTo(value, 5);
  });

  it("is null outside the frame or over an invalid sample", () => {
    expect(cursorExposure(ev, width, height, width, 0)).toBeNull();
    const holed = Float32Array.from(ev);
    holed[5 * width + 7] = Number.NaN;
    expect(cursorExposure(holed, width, height, 7, 5)).toBeNull();
    expect(cursorExposure(holed, width, height, 8, 6)).toBeNull();
  });
});
