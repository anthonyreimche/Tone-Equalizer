// The mask as the GPU passes compute it: darktable's iteration rules on the
// full-resolution B3 and box chains, then the inline finish.

import { describe, expect, it } from "vitest";
import { applyToneEqualizer } from "../src/apply";
import { fitCurve, gainAt } from "../src/curve";
import { DEFAULT_PARAMS, MAX_EV, MIN_EV, boostOf, maskImage, maskValue, type Details, type Params } from "../src/model";
import { backlit, downsample2, fill, flat, logStats, scaled } from "./support/scenes";

const FILTERED: Details[] = ["eigf", "avg-eigf", "guided", "avg-guided"];
const with_ = (over: Partial<Params>): Params => ({ ...DEFAULT_PARAMS, ...over });

describe("maskImage", () => {
  it("is the plain mask for 'no'", () => {
    const img = backlit(32, 24);
    const p = with_({ details: "none", estimator: "power", exposureBoost: -0.5 });
    const mask = maskImage(img, p);
    const boost = boostOf(p);
    for (let k = 0; k < 32 * 24; k++) {
      const rgb = [img.data[3 * k], img.data[3 * k + 1], img.data[3 * k + 2]] as const;
      expect(mask[k]).toBe(maskValue(rgb, "power", boost));
    }
  });

  it.each(FILTERED)("keeps a flat image flat (%s)", (details) => {
    const mask = maskImage(flat(48, 32, 0.18), with_({ details, blending: 20, iterations: 2 }));
    for (const m of mask) expect(m).toBeCloseTo(0.18 * Math.sqrt(3), 9);
  });

  it.each(FILTERED)("smooths the subject's texture and keeps its edge (%s)", (details) => {
    const w = 160;
    const h = 120;
    const img = backlit(w, h);
    // Default feathering for EIGF; the guided filter needs darktable's 500.
    const p = with_({ details, blending: 10, feathering: details.includes("guided") ? 500 : 1 });
    const plain = maskImage(img, { ...p, details: "none" });
    const mask = maskImage(img, p);
    // EIGF keeps edges on purpose within about 2σ of one, so the region stays clear of the disc's rim.
    const inside = (x: number, y: number) => ((x + 0.5) / w - 0.45) ** 2 + (((y + 0.5) / h - 0.6) * 0.75) ** 2 < 0.15 ** 2;
    const sky = (_x: number, y: number) => (y + 0.5) / h < 0.15;
    // The averaged modes keep half of the unfiltered mask in log space.
    const share = details.startsWith("avg") ? 0.75 : 0.5;
    expect(logStats(mask, w, inside).std).toBeLessThan(share * logStats(plain, w, inside).std);
    expect(logStats(mask, w, sky).mean - logStats(mask, w, inside).mean).toBeGreaterThan(2);
  });

  it("is exposure independent under EIGF", () => {
    const img = backlit(96, 72);
    const p = with_({ details: "eigf", blending: 10, feathering: 20 });
    const a = maskImage(img, p);
    const b = maskImage(scaled(img, 4), p);
    for (let k = 0; k < a.length; k++) expect(b[k] / a[k]).toBeCloseTo(4, 6);
  });

  it.each(["eigf", "guided"] as const)(
    "smooths the same fraction of the frame at twice the size (%s)",
    { timeout: 60_000 },
    (details) => {
      const p = with_({ details, blending: 20, feathering: details === "guided" ? 500 : 1 });
      // The small scene is the large one's 2×2 mean: two independent
      // rasterisations alias hard edges differently, a floor of 0.034 EV
      // even with no filter.
      const scene = backlit(320, 240);
      const small = maskImage(downsample2(scene), p);
      const large = maskImage(scene, p);
      let sum = 0;
      let n = 0;
      for (let y = 6; y < 114; y++) {
        for (let x = 6; x < 154; x++) {
          const fine =
            (large[2 * y * 320 + 2 * x] + large[2 * y * 320 + 2 * x + 1] + large[(2 * y + 1) * 320 + 2 * x] + large[(2 * y + 1) * 320 + 2 * x + 1]) / 4;
          sum += Math.abs(Math.log2(fine) - Math.log2(small[y * 160 + x]));
          n++;
        }
      }
      expect(sum / n).toBeLessThan(0.03);
    },
  );

  it("stays within 0.01 EV of the float64 chain on binary16 state", () => {
    const img = backlit(96, 72);
    for (const details of FILTERED) {
      const p = with_({ details, blending: 10, feathering: 20, iterations: 2 });
      const exact = maskImage(img, p);
      const half = maskImage(img, p, { halfFloat: true });
      for (let k = 0; k < exact.length; k++) expect(Math.abs(Math.log2(half[k] / exact[k]))).toBeLessThan(0.01);
    }
  });

  it("gives diffusion an effect, and the averaged modes a weaker one", () => {
    const img = backlit(96, 72);
    const plain = maskImage(img, with_({ details: "none" }));
    const once = maskImage(img, with_({ details: "eigf", blending: 10 }));
    const thrice = maskImage(img, with_({ details: "eigf", blending: 10, iterations: 3 }));
    const averaged = maskImage(img, with_({ details: "avg-eigf", blending: 10 }));
    const distance = (a: Float64Array, b: Float64Array) => a.reduce((s, v, k) => s + Math.abs(Math.log2(v / b[k])), 0);
    expect(distance(thrice, plain)).toBeGreaterThan(distance(once, plain));
    expect(distance(averaged, plain)).toBeLessThan(distance(once, plain));
  });
});

describe("maskImage past the binary16 range", () => {
  // Lamps at lin 8 under +4 EV of exposure and +1 EV of contrast give M of about 440, and M² of about 2e5 is
  // beyond binary16 (65504) unless the statistics are capped.
  const lamps = fill(64, 48, (x, y) => {
    const block = x >= 30 && x < 33 && y >= 22 && y < 25;
    return block || (x === 58 && y === 3) ? [8, 8, 8] : [0.01, 0.01, 0.01];
  });
  const curveWindow = (m: number) => Math.min(Math.max(Math.log2(m), MIN_EV), MAX_EV);

  it.each([
    ["eigf", 1],
    ["eigf", 3],
    ["guided", 1],
    ["guided", 3],
  ] as const)("keeps %s finite and in step with float64 at %i iterations", (details, iterations) => {
    const p = with_({ details, blending: 10, feathering: details === "guided" ? 500 : 20, iterations, exposureBoost: 4, contrastBoost: 1 });
    const boost = boostOf(p);
    expect(maskValue([8, 8, 8], p.estimator, boost)).toBeGreaterThan(256);
    const exact = maskImage(lamps, p);
    const half = maskImage(lamps, p, { halfFloat: true });
    for (let k = 0; k < exact.length; k++) {
      expect(Number.isFinite(half[k]) && half[k] > 0).toBe(true);
      expect(Math.abs(curveWindow(half[k]) - curveWindow(exact[k]))).toBeLessThan(0.01);
    }
  });
});

describe("applyToneEqualizer", () => {
  it("returns the image unchanged while every band is 0", () => {
    const img = backlit(32, 24);
    expect(Array.from(applyToneEqualizer(img, with_({ blending: 20 })).data)).toEqual(Array.from(img.data));
  });

  it("multiplies every channel by the curve's gain at the pixel's mask exposure", () => {
    const img = fill(8, 8, () => [0.05, 0.04, 0.03]);
    const p = with_({ details: "none", bands: [0, 0, 0, 0, 1, 1, 0, 0, 0] });
    const out = applyToneEqualizer(img, p);
    const gain = gainAt(Math.log2(maskImage(img, p)[0]), fitCurve(p.bands, Math.SQRT2));
    expect(gain).toBeGreaterThan(1.5);
    for (let k = 0; k < img.data.length; k++) expect(out.data[k]).toBeCloseTo(img.data[k] * gain, 12);
  });
});
