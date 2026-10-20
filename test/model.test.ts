// The mask's per-pixel parts (darktable's luminance_mask.h) and the chain
// schedule that maps darktable's ROI-scaled radius onto full-resolution passes.

import { describe, expect, it } from "vitest";
import {
  DRAW_REFERENCE_EDGE,
  EIGF_MAX_DRAWS,
  ESTIMATORS,
  FULCRUM,
  GUIDED_MAX_DRAWS,
  MAX_LEVELS,
  MIN_FLOAT,
  SKIP_SPACING,
  boostOf,
  chainLevels,
  drawCounts,
  eigfSigma,
  eigfSpacing,
  f16,
  guidedSpacing,
  guidedWidth,
  linearContrast,
  maskValue,
  norm,
  radiusAt,
  sigmaOf,
  type Rgb,
} from "../src/model";
import { DT_METHOD, V } from "./support/vectors";

describe("norm", () => {
  const rgb: Rgb = [0.2, 0.5, 0.1];

  it.each([
    ["norm2", Math.sqrt(0.04 + 0.25 + 0.01)],
    ["mean", 0.8 / 3],
    ["lightness", 0.3],
    ["value", 0.5],
    ["norm1", 0.8],
    ["power", (0.008 + 0.125 + 0.001) / 0.3],
    ["geomean", Math.cbrt(0.01)],
  ] as const)("%s", (estimator, expected) => {
    expect(norm(rgb, estimator)).toBeCloseTo(expected, 12);
  });

  it("takes magnitudes where darktable does, and only there", () => {
    const signed: Rgb = [-0.1, 0.4, 0.2];
    expect(norm(signed, "norm1")).toBeCloseTo(0.7, 12);
    expect(norm(signed, "geomean")).toBeCloseTo(Math.cbrt(0.008), 12);
    expect(norm(signed, "mean")).toBeCloseTo(0.5 / 3, 12);
    expect(norm(signed, "lightness")).toBeCloseTo(0.15, 12);
  });

  it("is 0/0 for black under the power norm, which the mask floors as darktable's MAX does", () => {
    expect(norm([0, 0, 0], "power")).toBeNaN();
    expect(maskValue([0, 0, 0], "power", { exposure: 1, fulcrum: FULCRUM, contrast: 0.5 })).toBe(MIN_FLOAT);
  });
});

// darktable computes in float, so the two agree to within 2^-21 of the larger
// of the value and the fulcrum, the terms its arithmetic rounds and cancels.
// Measured worst: 4.8 × 2^-24, the geometric mean of 1e-5-level channels,
// where darktable's powf(x, 1.0f / 3.0f) differs from cbrt.
describe("the mask from RGB against darktable's luminance_mask", () => {
  const TOLERANCE = 2 ** -21;

  it("has darktable's 252 vectors, 36 per estimator", () => {
    expect(V.norms).toHaveLength(252);
  });

  it.each(ESTIMATORS)("%s", (estimator) => {
    const vectors = V.norms.filter((v) => DT_METHOD[v.method] === estimator);
    expect(vectors).toHaveLength(36);
    let plain = 0;
    for (const v of vectors) {
      const tol = TOLERANCE * Math.max(Math.abs(v.value), v.fulcrum);
      const boost = { exposure: v.exposure, fulcrum: v.fulcrum, contrast: v.contrast };
      expect(Math.abs(maskValue(v.rgb, estimator, boost) - v.value)).toBeLessThanOrEqual(tol);
      const n = norm(v.rgb, estimator);
      if (v.exposure === 1 && v.fulcrum === 0 && v.contrast === 1 && n > MIN_FLOAT) {
        expect(Math.abs(n - v.value)).toBeLessThanOrEqual(tol);
        plain++;
      }
    }
    expect(plain).toBeGreaterThan(0);
  });
});

describe("boosts", () => {
  it("stretches contrast around −4 EV in the plain guided modes only", () => {
    for (const details of ["eigf", "guided"] as const) {
      expect(boostOf({ details, exposureBoost: 1, contrastBoost: 0.5 })).toEqual({
        exposure: 2,
        fulcrum: FULCRUM,
        contrast: 2 ** 0.5,
      });
    }
    for (const details of ["none", "avg-eigf", "avg-guided"] as const) {
      expect(boostOf({ details, exposureBoost: -1, contrastBoost: 0.5 })).toEqual({ exposure: 0.5, fulcrum: 0, contrast: 1 });
    }
  });

  it("keeps the fulcrum fixed and floors at 2^-16", () => {
    expect(linearContrast(FULCRUM, FULCRUM, 3)).toBe(FULCRUM);
    expect(linearContrast(0.5, FULCRUM, 2)).toBeCloseTo(0.9375, 12);
    expect(linearContrast(0.01, FULCRUM, 4)).toBe(MIN_FLOAT);
  });

  it("maps darktable's curve smoothing slider to σ", () => {
    expect(sigmaOf(0)).toBeCloseTo(Math.SQRT2, 6);
    expect(sigmaOf(1)).toBeCloseTo(2, 6);
    expect(sigmaOf(-1)).toBeCloseTo(1, 6);
  });
});

describe("chain schedule", () => {
  it("takes the radius from darktable's ROI formula", () => {
    expect(radiusAt(5, 4096)).toBe(101);
    expect(radiusAt(5, 960)).toBe(23);
    expect(radiusAt(5, 16384)).toBe(409);
    expect(radiusAt(0.01, 960)).toBe(0);
  });

  it("forms the diameter in float32 as darktable does", () => {
    expect(radiusAt(1, 500)).toBe(2);
  });

  it("gives EIGF a B3 chain whose level variances add up to σ²", () => {
    const levels = chainLevels("eigf", 5);
    expect(levels).toBe(10);
    const sigma = eigfSigma(101);
    const s = eigfSpacing(sigma, levels);
    let variance = 0;
    for (let j = 0; j < levels; j++) variance += (s * 2 ** j) ** 2;
    expect(variance).toBeCloseTo(sigma ** 2, 6);
  });

  it("widens EIGF's σ to what darktable's Deriche blur really applies, from a radius floored at one pixel", () => {
    expect(eigfSigma(0)).toBe(2 / 1.695);
    expect(eigfSigma(101)).toBeCloseTo((101 * 2) / 1.695, 12);
  });

  it("gives the guided filter darktable's box width at ×4 downscale", () => {
    expect(guidedWidth(101)).toBe(204);
    expect(guidedWidth(3)).toBe(12);
    expect(chainLevels("guided", 5)).toBe(10);
    expect(guidedSpacing(204, 10) * 2 ** 10).toBeCloseTo(204, 12);
  });

  it("skips only the levels finer than half a texel", () => {
    const fine = (sigma: number) =>
      Array.from({ length: 10 }, (_, j) => eigfSpacing(sigma, 10) * 2 ** j).filter((s) => s < SKIP_SPACING).length;
    expect(fine(eigfSigma(101))).toBe(2);
    expect(fine(eigfSigma(23))).toBe(4);
  });

  it("clamps EIGF's chain to MAX_LEVELS above 97.87 % diameter, with σ still matched", () => {
    const unclamped = (blending: number) =>
      Math.ceil(Math.log(3 * eigfSigma(radiusAt(blending, DRAW_REFERENCE_EDGE)) ** 2 + 1) / Math.log(4));
    expect(unclamped(97.86)).toBe(MAX_LEVELS);
    expect(unclamped(97.87)).toBe(MAX_LEVELS + 1);
    expect(unclamped(100)).toBe(MAX_LEVELS + 1);
    expect(chainLevels("eigf", 97.86)).toBe(MAX_LEVELS);
    expect(chainLevels("eigf", 100)).toBe(MAX_LEVELS);
    const sigma = eigfSigma(radiusAt(100, DRAW_REFERENCE_EDGE));
    const s = eigfSpacing(sigma, chainLevels("eigf", 100));
    let variance = 0;
    for (let j = 0; j < MAX_LEVELS; j++) variance += (s * 2 ** j) ** 2;
    expect(variance / sigma ** 2).toBeCloseTo(1, 12);
  });

  it("fits the guided filter in MAX_LEVELS over the whole hard range without clamping", () => {
    let most = 0;
    for (let i = 1; i <= 10000; i++) {
      most = Math.max(most, Math.ceil(Math.log2(guidedWidth(radiusAt(i / 100, DRAW_REFERENCE_EDGE)))));
    }
    expect(most).toBe(MAX_LEVELS);
    expect(chainLevels("guided", 100)).toBe(MAX_LEVELS);
  });

  it("clamps both chains past the hard range, and has none without a filter", () => {
    expect(chainLevels("eigf", 200)).toBe(MAX_LEVELS);
    expect(chainLevels("guided", 200)).toBe(MAX_LEVELS);
    expect(chainLevels("none", 50)).toBe(0);
  });

  it("counts the draws each filter's pass takes", () => {
    expect(drawCounts({ details: "eigf", iterations: 1, blending: 5 })).toEqual({ eigf: 11, guided: 0 });
    expect(drawCounts({ details: "avg-guided", iterations: 3, blending: 5 })).toEqual({ eigf: 0, guided: 66 });
    expect(drawCounts({ details: "none", iterations: 5, blending: 5 })).toEqual({ eigf: 0, guided: 0 });
    expect(drawCounts({ details: "eigf", iterations: 20, blending: 100 }).eigf).toBe(EIGF_MAX_DRAWS);
    expect(drawCounts({ details: "guided", iterations: 20, blending: 100 }).guided).toBe(GUIDED_MAX_DRAWS);
  });
});

describe("f16", () => {
  it("rounds to binary16 and overflows as it does", () => {
    expect(f16(65504)).toBe(65504);
    expect(f16(65519)).toBe(65504);
    expect(f16(65520)).toBe(Infinity);
    expect(f16(-65520)).toBe(-Infinity);
    expect(f16(-1e6)).toBe(-Infinity);
    expect(f16(Number.NaN)).toBeNaN();
  });

  it("keeps its rounding below the limit", () => {
    expect(f16(0)).toBe(0);
    expect(f16(1 + 2 ** -11)).toBe(1);
    expect(f16(1 + 3 * 2 ** -11)).toBe(1 + 2 ** -9);
    expect(f16(2 ** -24)).toBe(2 ** -24);
    expect(f16(1000.4)).toBe(1000.5);
  });
});
