// The radial-basis curve against darktable's own fit (choleski.h pseudo_solve
// over toneequal.c's interpolation matrix), its per-pixel correction and its
// interactive edit. darktable runs these in float with SIMD reductions, so
// results agree to float rounding amplified by the fit's conditioning: tight
// at σ ≤ 2, looser at the 2.52 hard maximum.

import { describe, expect, it } from "vitest";
import { applyToneEqualizer } from "../src/apply";
import { CENTERS_PARAMS, CHANNELS, DEFAULT_PARAMS, GAIN_MAX, GAIN_MIN, PIXEL_CHAN, sigmaOf } from "../src/model";
import {
  curveSamples,
  fitCurve,
  gainAt,
  interactiveEdit,
  interpolationMatrix,
  nodeGains,
  pseudoSolve,
} from "../src/curve";
import { fitOf, isActive } from "../src/params";
import { compress } from "../src/presets";
import { backlit } from "./support/scenes";
import { V } from "./support/vectors";

const tolerance = (sigma: number) => (sigma > 2.1 ? 5e-4 : 1e-5);

// dt_ref.c samples at -8.0f + c / 10.0f in float. Double arithmetic lands up to a
// float step away, and at the ill-conditioned fits (weights in the thousands)
// that step moves the gain by 1e-3.
const sampleAt = (k: number) => Math.fround(-8 + Math.fround(k / 10));

describe("fitCurve and gainAt against darktable", () => {
  it.each(V.fits.map((f, i) => [i, f] as const))("case %i", (_i, ref) => {
    const fit = fitCurve(ref.bands, ref.sigma);
    expect(fit.valid).toBe(ref.valid);
    if (!ref.valid) return;
    const tol = tolerance(ref.sigma);
    nodeGains(fit).forEach((g, i) => expect(Math.abs(g - ref.nodes[i])).toBeLessThanOrEqual(tol));
    ref.curve.forEach((g, k) => expect(Math.abs(gainAt(sampleAt(k), fit) - g)).toBeLessThanOrEqual(tol));
  });

  it("matches darktable's weights at σ ≤ √2", () => {
    for (const ref of V.fits.filter((f) => f.valid && f.sigma < 1.5)) {
      const fit = fitCurve(ref.bands, ref.sigma);
      fit.weights.forEach((w, j) => expect(Math.abs(w - ref.weights[j])).toBeLessThanOrEqual(1e-5 * Math.max(1, Math.abs(w))));
    }
  });
});

describe("gainAt", () => {
  it("clamps the exposure to [−8, 0] EV and the gain to [0.25, 4]", () => {
    const fit = fitCurve([2, 2, 2, 2, 2, 2, 2, 2, 2], Math.SQRT2);
    expect(gainAt(-12, fit)).toBe(gainAt(-8, fit));
    expect(gainAt(3, fit)).toBe(gainAt(0, fit));
    const wild = { weights: [400, -400, 400, -400, 400, -400, 400, -400], sigma: 1 };
    for (const ev of [-8, -5.5, -2, 0]) {
      expect(gainAt(ev, wild)).toBeGreaterThanOrEqual(GAIN_MIN);
      expect(gainAt(ev, wild)).toBeLessThanOrEqual(GAIN_MAX);
    }
  });

  it("samples the graph curve in EV over 256 points", () => {
    const fit = fitCurve([0, 0, 0, 0, 1, 0, 0, 0, 0], Math.SQRT2);
    const samples = curveSamples(fit);
    expect(samples).toHaveLength(256);
    expect(samples[0]).toBeCloseTo(Math.log2(gainAt(-8, fit)), 12);
    expect(samples[255]).toBeCloseTo(Math.log2(gainAt(0, fit)), 12);
  });
});

describe("interactiveEdit against darktable", () => {
  it.each(V.interactive.map((c, i) => [i, c] as const))("sequence %i", (_i, ref) => {
    let bands: readonly number[] = ref.start;
    for (const step of ref.steps) {
      const next = interactiveEdit(bands, ref.sigma, step.x, step.offset);
      if (step.bands === null) {
        expect(next).toBeNull();
        continue;
      }
      expect(next).not.toBeNull();
      next!.forEach((b, i) => expect(Math.abs(b - step.bands![i])).toBeLessThanOrEqual(10 * tolerance(ref.sigma)));
      bands = next!;
    }
  });

  it("returns the fitted curve's own values at the nodes", () => {
    const next = interactiveEdit(CENTERS_PARAMS.map(() => 0), Math.SQRT2, -4, 0.5)!;
    const fit = fitCurve(next, Math.SQRT2);
    nodeGains(fit).forEach((g, i) => expect(Math.log2(g)).toBeCloseTo(next[i], 2));
  });
});

// σ = 4 is past the 2.52 hard maximum, and darktable's solve fails there too.
// Whether it fails depends on σ alone (the matrix), not on the bands.
describe("where the solve fails", () => {
  const BANDS = compress(0.45);
  const ZERO = CENTERS_PARAMS.map(() => 0);

  it("reports σ = 4 as a failed fit and a discarded interactive step", () => {
    const y = Float32Array.from(BANDS, (g) => Math.fround(2 ** g));
    expect(pseudoSolve(interpolationMatrix(4), y, CHANNELS, PIXEL_CHAN)).toBeNull();
    const fit = fitCurve(BANDS, 4);
    expect(fit.valid).toBe(false);
    expect(fit.weights).toEqual(new Array<number>(PIXEL_CHAN).fill(0));
    expect(interactiveEdit(BANDS, 4, -4, 0.25)).toBeNull();
  });

  it("fails on a non-finite input rather than returning NaN", () => {
    expect(interactiveEdit(ZERO, Math.SQRT2, Number.NaN, 0.25)).toBeNull();
    expect(interactiveEdit(ZERO, Math.SQRT2, -4, Number.NaN)).toBeNull();
    expect(interactiveEdit(ZERO, Math.SQRT2, -4, Number.POSITIVE_INFINITY)).toBeNull();
    expect(fitCurve([Number.NaN, 0, 0, 0, 0, 0, 0, 0, 0], Math.SQRT2).valid).toBe(false);
    expect(fitCurve([Number.POSITIVE_INFINITY, 0, 0, 0, 0, 0, 0, 0, 0], Math.SQRT2).valid).toBe(false);
    expect(fitCurve(BANDS, Number.NaN).valid).toBe(false);
  });

  it("leaves the image as it was and the stage idle", () => {
    // σ = √2^(1+v): v = 5 puts σ near 8, where the solve fails as it does at 4.
    const p = { ...DEFAULT_PARAMS, bands: BANDS, curveSmoothing: 5 };
    expect(fitCurve(BANDS, sigmaOf(5)).valid).toBe(false);
    expect(fitOf(p).valid).toBe(false);
    expect(isActive(p)).toBe(false);
    expect(isActive({ ...p, curveSmoothing: 0 }, fitCurve(BANDS, 4))).toBe(false);
    const img = backlit(32, 24);
    expect(Array.from(applyToneEqualizer(img, p).data)).toEqual(Array.from(img.data));
  });
});
