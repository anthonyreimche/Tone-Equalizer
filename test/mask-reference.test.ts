// The port's mask against darktable's own filters on one scene. They are not
// the same filter: darktable blurs a ×4-downscaled copy (a Deriche gaussian for
// EIGF, a clipped box for the guided filter) and upsamples top-left aligned;
// the port blurs at full resolution with a B3 or box chain. The bounds pin how
// close they come, measured once; a regression past them is a bug.

import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS, MAX_EV, MIN_EV, maskImage, type Params } from "../src/model";
import { DT_DETAILS, DT_METHOD, V } from "./support/vectors";

const masks = V.masks!;
const { width, height } = masks.scene;
const scene = { width, height, data: Float64Array.from(masks.scene.rgb) };
const BORDER = 4;

/** The curve reads clamp(log2 M′, −8, 0), so differences outside that window never reach the image. */
const ev = (m: number): number => Math.min(Math.max(Math.log2(m), MIN_EV), MAX_EV);

/** Mean and 99th percentile of |ΔEV| inside the curve's window, away from the border. */
function difference(ours: Float64Array, theirs: number[]): { mean: number; p99: number } {
  const d: number[] = [];
  for (let y = BORDER; y < height - BORDER; y++) {
    for (let x = BORDER; x < width - BORDER; x++) {
      const k = y * width + x;
      d.push(Math.abs(ev(ours[k]) - ev(theirs[k])));
    }
  }
  d.sort((a, b) => a - b);
  return { mean: d.reduce((s, v) => s + v, 0) / d.length, p99: d[Math.floor(0.99 * (d.length - 1))] };
}

/** Pinned per case, in V.masks.cases order: measured, ×1.25, rounded up to two significant figures.
 *  The guided cases' p99 is dominated by darktable's ×4 coefficient grid at strong edges. The last case has no
 *  filter and agrees to float rounding. */
const BOUNDS: { mean: number; p99: number }[] = [
  { mean: 0.061, p99: 0.41 },
  { mean: 0.018, p99: 0.21 },
  { mean: 0.036, p99: 0.4 },
  { mean: 0.031, p99: 0.21 },
  { mean: 0.047, p99: 0.71 },
  { mean: 0.077, p99: 1.3 },
  { mean: 0.033, p99: 0.22 },
  { mean: 1e-6, p99: 1e-6 },
];

describe("maskImage against darktable", () => {
  it.each(masks.cases.map((c, i) => [i, c] as const))("case %i", (i, ref) => {
    const p: Params = {
      ...DEFAULT_PARAMS,
      details: DT_DETAILS[ref.details],
      estimator: DT_METHOD[ref.method],
      exposureBoost: ref.exposureBoost,
      contrastBoost: ref.contrastBoost,
      blending: ref.blending,
      feathering: ref.feathering,
      iterations: ref.iterations,
    };
    const d = difference(maskImage(scene, p), ref.mask);
    console.log(`case ${i} (${p.details}): mean ${d.mean.toFixed(4)} EV, p99 ${d.p99.toFixed(4)} EV`);
    expect(d.mean).toBeLessThanOrEqual(BOUNDS[i].mean);
    expect(d.p99).toBeLessThanOrEqual(BOUNDS[i].p99);
  });
});
