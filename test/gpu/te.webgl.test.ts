// The two stages on the real renderer. Run via `npm run test:gpu` (run.cjs
// copies this file into a SafeLight checkout and runs it under its headless
// Chromium + SwiftShader rig). What the CPU suite cannot check:
//  • both stages compile and link with the host's namespacing, the
//    inter-stage variable and the bag-driven draw counts, on both versions;
//  • all-zero bands leave the frame as it was, also with mask settings set;
//  • the passes on half-float targets, with bilinear taps at fractional
//    spacings, match the model for every filter, three of darktable's presets
//    and in a small frame;
//  • every luminance estimator runs the branch the bag's index names;
//  • the probe round-trips the mask exposure and the mask display matches
//    darktable's formula, on both versions;
//  • with an input mask above 2^8, whose square binary16 cannot hold, the
//    frame and the probed mask match the model's capped statistics.

import { describe, expect, it } from "vitest";
import { fitCurve, gainAt } from "@te/curve";
import {
  DEFAULT_PARAMS,
  ESTIMATORS,
  MAX_EV,
  MIN_EV,
  boostOf,
  f16,
  maskImage,
  maskValue,
  sigmaOf,
  type Image,
  type Params,
} from "@te/model";
import { deriveAll, probePatch, VIEW_MODE_KEY } from "@te/params";
import { PRESETS, compress, dilate } from "@te/presets";
import { allStages } from "@te/stage";
import { backlit, fill, scaled } from "@te-test/support/scenes";
import { CURRENT_PROCESS_VERSION, LEGACY_PROCESS_VERSION } from "@/catalog/types";
import type { ResolvedPipeline } from "@/extensions/pipelines";
import { toStageSpace } from "@/rendering/stage-space";
import type { WebGLRenderer } from "@/rendering/webgl/renderer";
import {
  LINEAR_PROBE_PIPELINE,
  builtinStages,
  floatImage,
  identityParams,
  rendererBuildError,
  withRenderer,
  worstDifference,
  type Frame,
} from "@/rendering/webgl/webgl.test-support";

const SPACE = { encoding: "linear", primaries: "rec2020" } as const;
// Values stay under the probe pipeline's 0.85 knee after a +2 EV gain.
const SCENE = scaled(backlit(128, 96), 0.3);

const toFloatImage = (img: Image) =>
  floatImage(img.width, img.height, (x, y) => {
    const i = (y * img.width + x) * 3;
    return [img.data[i], img.data[i + 1], img.data[i + 2]];
  });

/** The source as the GPU holds it (RGBA16F upload), in Rec.709 and as the
 *  stage sees it in Rec.2020. */
function inputs(img: Image): { r709: Image; r2020: Image } {
  const r709 = { ...img, data: img.data.map(f16) };
  const d = new Float64Array(r709.data.length);
  for (let k = 0; k < d.length; k += 3) {
    const [r, g, b] = toStageSpace([r709.data[k], r709.data[k + 1], r709.data[k + 2]], SPACE, "scene");
    d[k] = r;
    d[k + 1] = g;
    d[k + 2] = b;
  }
  return { r709, r2020: { ...r709, data: d } };
}

interface Rig {
  readonly withExtension?: boolean;
  readonly processVersion?: number;
  readonly pipeline?: ResolvedPipeline;
}

// Version 1 passes every frame through the 256-entry tone-curve LUT, whose
// texel-centre lookup maps v to (256v − 0.5)/255 and takes anything under
// 1/512 to 0, so its frame is not the stage's output. Version 2 skips the LUT
// at identity curves and, below the 0.85 knee, is the identity after the stage.
function render(
  img: Image,
  bag: Record<string, unknown>,
  { withExtension = true, processVersion = CURRENT_PROCESS_VERSION, pipeline = LINEAR_PROBE_PIPELINE }: Rig = {},
): Frame {
  const stages = withExtension ? [...builtinStages(), ...allStages()] : builtinStages();
  return withRenderer({ stages, pipeline }, (r: WebGLRenderer) => {
    r.setImage(toFloatImage(img));
    r.setParams(identityParams({ processVersion }));
    r.setContributedParams(bag);
    return r.captureFloatFrame()!;
  });
}

/** The model's output for `p`: its mask on the Rec.2020 view, the curve's
 *  gain at that mask on the Rec.709 pixels (the gain is neutral, so the
 *  primaries it is applied in don't matter). */
function expected(img: Image, p: Params): Image {
  const { r709, r2020 } = inputs(img);
  const mask = maskImage(r2020, p, { halfFloat: true });
  const fit = fitCurve(p.bands, sigmaOf(p.curveSmoothing));
  const data = r709.data.map((v, k) => v * gainAt(Math.log2(mask[Math.floor(k / 3)]), fit));
  return { ...r709, data };
}

/** |ΔEV| of the rendered change against the model's, on green, over the
 *  pixels `keep` names (all by default). */
function evError(frame: Frame, model: Image, src: Image, keep: (k: number) => boolean = () => true): { max: number; mean: number } {
  let max = 0;
  let sum = 0;
  let n = 0;
  for (let k = 0; k < src.width * src.height; k++) {
    if (!keep(k)) continue;
    const gpu = frame.data[4 * k + 1];
    const ref = model.data[3 * k + 1];
    const d = Math.abs(Math.log2(gpu / ref));
    max = Math.max(max, d);
    sum += d;
    n++;
  }
  return { max, mean: sum / n };
}

const with_ = (over: Partial<Params>): Params => ({ ...DEFAULT_PARAMS, ...over });
const named = (name: string) => PRESETS.find((p) => p.name === name)!.params;

/** |ΔEV| between two model outputs, on green: the most any pixel differs. */
function modelGap(a: Image, b: Image): number {
  let max = 0;
  for (let k = 1; k < a.data.length; k += 3) max = Math.max(max, Math.abs(Math.log2(a.data[k] / b.data[k])));
  return max;
}

/** Luminance over 5.5 EV across, hue around the circle down, saturation 0.9.
 *  The channels vary independently, so every estimator gives its own mask. In
 *  SCENE they keep fixed ratios, and five pairs among the mean, lightness,
 *  power and geometric mean render less than 0.01 EV apart. Values stay under
 *  the 0.85 knee after the dilate(0.45) curve's +0.75 EV. */
const COLOURS = fill(128, 96, (x, y) => {
  const l = 0.004 * 2 ** ((5.5 * (x + 0.5)) / 128);
  const h = (2 * Math.PI * (y + 0.5)) / 96;
  const third = (2 * Math.PI) / 3;
  return [l * (1 + 0.9 * Math.cos(h)), l * (1 + 0.9 * Math.cos(h - third)), l * (1 + 0.9 * Math.cos(h + third))];
});

// The core shoulder runs ahead of the stage and takes a lamp at lin 8 down to
// about 1 under the probe pipeline; a version 2 frame under a transform that
// skips it hands the stage the scene's own values.
const HEADROOM_PIPELINE: ResolvedPipeline = {
  ...LINEAR_PROBE_PIPELINE,
  id: "te.headroom-probe",
  skipToneShoulder: true,
  sig: "te.headroom-probe",
};
const HEADROOM: Rig = { pipeline: HEADROOM_PIPELINE };

const LAMP_SITES: readonly (readonly [number, number])[] = [[20, 30], [64, 48], [100, 20], [90, 80]];
const isLamp = (x: number, y: number) => LAMP_SITES.some(([lx, ly]) => x >= lx && x < lx + 2 && y >= ly && y < ly + 2);

/** A dark textured ground (mask −3.3…−1.2 EV under the boosts below) and four
 *  2×2 lamps at lin 8, whose mask is about 443. */
const LAMPS = fill(128, 96, (x, y) => {
  const v = isLamp(x, y) ? 8 : 0.006 * (1 + 0.5 * Math.sin(0.7 * x) * Math.sin(0.5 * y));
  return [v, v, v];
});
const onGround = (k: number) => !isLamp(k % LAMPS.width, Math.floor(k / LAMPS.width));

/** The mask exposure the probe frame encodes at pixel k, and whether it marks the mask valid. */
function probeAt(frame: Frame, k: number): { ev: number; valid: number } {
  const hi = Math.round(frame.data[4 * k] * 255);
  const lo = Math.round(frame.data[4 * k + 1] * 255);
  return { ev: -16 + (24 * (hi * 256 + lo)) / 65535, valid: frame.data[4 * k + 2] };
}

const PROBE_TOLERANCE = 0.03 + 24 / 65535;
/** The EV span the probe encodes. */
const PROBE_SPAN = [-16, 8] as const;

/** |ΔEV| between the probe and the model's log2 mask, clamped to the probe's
 *  span, over the pixels whose unclamped model value `keep` accepts. */
function probeError(probe: Frame, mask: Float64Array, keep: (ev: number) => boolean): { max: number; mean: number; compared: number } {
  let max = 0;
  let sum = 0;
  let compared = 0;
  for (let k = 0; k < mask.length; k++) {
    const ref = Math.log2(mask[k]);
    if (!keep(ref)) continue;
    const d = Math.abs(probeAt(probe, k).ev - Math.min(Math.max(ref, PROBE_SPAN[0]), PROBE_SPAN[1]));
    compared++;
    max = Math.max(max, d);
    sum += d;
  }
  return { max, mean: sum / compared, compared };
}

const VERSIONS = [LEGACY_PROCESS_VERSION, CURRENT_PROCESS_VERSION];

describe("Tone Equalizer on the real renderer", () => {
  it("compiles and links on both process versions", () => {
    expect(rendererBuildError({ stages: [...builtinStages(), ...allStages()], pipeline: LINEAR_PROBE_PIPELINE })).toBeNull();
  });

  it.each(VERSIONS)(
    "leaves the frame as it was while every band is 0, also with mask settings set (version %i)",
    (processVersion) => {
      const plain = render(SCENE, {}, { withExtension: false, processVersion });
      for (const p of [DEFAULT_PARAMS, with_({ details: "guided", feathering: 500, blending: 12, iterations: 3 })]) {
        const worst = worstDifference(render(SCENE, deriveAll(p), { processVersion }), plain);
        console.log(`all bands 0, version ${processVersion}, ${p.details}: worst ${worst.toExponential(2)}`);
        // The Rec.2020 round trip may move a value by one half-float step.
        expect(worst).toBeLessThanOrEqual(2e-4);
      }
    },
  );

  const CASES: [string, Params, number, number][] = [
    ["EIGF, compress medium", with_({ bands: compress(0.45), exposureBoost: -1.57, blending: 8 }), 0.03, 0.005],
    ["averaged EIGF, relight", with_({ details: "avg-eigf", bands: named("Relight: fill-in").bands, blending: 8 }), 0.03, 0.005],
    ["EIGF, diffusion 3, contrast +0.5", with_({ bands: compress(0.45), iterations: 3, feathering: 7, contrastBoost: 0.5 }), 0.03, 0.005],
    ["guided filter, feathering 500", with_({ details: "guided", feathering: 500, blending: 6, bands: compress(0.45), exposureBoost: -1.57 }), 0.03, 0.005],
    ["averaged guided filter, diffusion 3", with_({ details: "avg-guided", feathering: 10, iterations: 3, bands: compress(0.25) }), 0.03, 0.005],
    ["no filter, power norm", with_({ details: "none", estimator: "power", bands: dilate(0.45) }), 0.01, 0.002],
    ["preset: mask blending | people with backlight", { ...named("Mask blending | people with backlight"), bands: compress(0.45) }, 0.03, 0.005],
    ["preset: compress shadows/highlights | GF | strong", named("Compress shadows/highlights | GF | strong"), 0.03, 0.005],
    ["preset: contrast tone curve | strong", named("Contrast tone curve | strong"), 0.01, 0.002],
  ];

  it.each(CASES)("matches the model: %s", (_name, p, maxEv, meanEv) => {
    const frame = render(SCENE, deriveAll(p));
    const err = evError(frame, expected(SCENE, p), inputs(SCENE).r709);
    console.log(`${_name}: max ${err.max.toFixed(4)} EV, mean ${err.mean.toFixed(4)} EV`);
    expect(err.max).toBeLessThanOrEqual(maxEv);
    expect(err.mean).toBeLessThanOrEqual(meanEv);
  });

  const ESTIMATOR_CASES: [string, Params, number, number][] = [
    ["RGB average", with_({ details: "none", estimator: "mean", bands: dilate(0.45) }), 0.01, 0.002],
    ["HSL lightness", with_({ details: "none", estimator: "lightness", bands: dilate(0.45) }), 0.01, 0.002],
    ["HSV value", with_({ details: "none", estimator: "value", bands: dilate(0.45) }), 0.01, 0.002],
    ["RGB sum", with_({ details: "none", estimator: "norm1", bands: dilate(0.45) }), 0.01, 0.002],
    ["RGB geometric mean", with_({ details: "none", estimator: "geomean", bands: dilate(0.45) }), 0.01, 0.002],
  ];

  it.each(ESTIMATOR_CASES)("matches the model with the luminance estimator: %s", (name, p, maxEv, meanEv) => {
    const model = expected(COLOURS, p);
    const others = ESTIMATORS.filter((e) => e !== p.estimator);
    const nearest = Math.min(...others.map((estimator) => modelGap(model, expected(COLOURS, { ...p, estimator }))));
    const err = evError(render(COLOURS, deriveAll(p)), model, inputs(COLOURS).r709);
    console.log(`${name}: max ${err.max.toFixed(4)} EV, mean ${err.mean.toFixed(4)} EV; nearest other estimator ${nearest.toFixed(4)} EV`);
    expect(nearest).toBeGreaterThan(2 * maxEv);
    expect(err.max).toBeLessThanOrEqual(maxEv);
    expect(err.mean).toBeLessThanOrEqual(meanEv);
  });

  it("matches the model in a thumbnail-sized frame", () => {
    const small = scaled(backlit(64, 48), 0.3);
    const p = with_({ bands: compress(0.45), exposureBoost: -1.57 });
    const err = evError(render(small, deriveAll(p)), expected(small, p), inputs(small).r709);
    console.log(`thumbnail: max ${err.max.toFixed(4)} EV, mean ${err.mean.toFixed(4)} EV`);
    expect(err.max).toBeLessThanOrEqual(0.03);
  });

  it.each(VERSIONS)("round-trips the mask exposure through the probe (version %i)", (processVersion) => {
    const p = with_({ blending: 8 });
    const frame = render(SCENE, { ...deriveAll(p), ...probePatch(p), [VIEW_MODE_KEY]: 2 }, { processVersion });
    const mask = maskImage(inputs(SCENE).r2020, p, { halfFloat: true });
    let worst = 0;
    for (let k = 0; k < mask.length; k += 97) {
      const { ev, valid } = probeAt(frame, k);
      expect(valid).toBeCloseTo(1, 3);
      const d = Math.abs(ev - Math.log2(mask[k]));
      worst = Math.max(worst, d);
      expect(d).toBeLessThanOrEqual(PROBE_TOLERANCE);
    }
    console.log(`probe, version ${processVersion}: max ${worst.toFixed(4)} EV`);
  });

  it.each(VERSIONS)("shows the mask as darktable does (version %i)", (processVersion) => {
    const p = with_({ blending: 8 });
    const frame = render(SCENE, { ...deriveAll(p), ...probePatch(p), [VIEW_MODE_KEY]: 1 }, { processVersion });
    const mask = maskImage(inputs(SCENE).r2020, p, { halfFloat: true });
    let worst = 0;
    for (let k = 0; k < mask.length; k += 97) {
      const grey = Math.sqrt(Math.min(Math.max((mask[k] - 2 ** -8) / (1 - 2 ** -8), 0), 1));
      worst = Math.max(worst, Math.abs(frame.data[4 * k + 1] - grey));
      expect(frame.data[4 * k + 1]).toBeCloseTo(grey, 2);
    }
    console.log(`mask display, version ${processVersion}: max ${worst.toFixed(4)}`);
  });

  it.each(VERSIONS)("reports no mask without a band or the probe (version %i)", (processVersion) => {
    const frame = render(SCENE, { ...deriveAll(DEFAULT_PARAMS), [VIEW_MODE_KEY]: 2 }, { processVersion });
    for (let k = 0; k < frame.width * frame.height; k += 97) expect(frame.data[4 * k + 2]).toBe(0);
  });

  const LAMP_CASES: [string, Params][] = [
    ["EIGF", with_({ bands: compress(0.45), exposureBoost: 4, contrastBoost: 1 })],
    ["guided filter", with_({ details: "guided", bands: compress(0.45), exposureBoost: 4, contrastBoost: 1 })],
  ];

  it.each(LAMP_CASES)("matches the model with an input mask above 2^8: %s", (name, p) => {
    const { r709, r2020 } = inputs(LAMPS);
    const boost = boostOf(p);
    let peak = 0;
    for (let k = 0; k < r2020.data.length; k += 3) {
      peak = Math.max(peak, maskValue([r2020.data[k], r2020.data[k + 1], r2020.data[k + 2]], p.estimator, boost));
    }
    expect(peak).toBeGreaterThan(2 ** 8);

    const model = expected(LAMPS, p);
    let groundPeak = 0;
    for (let k = 0; k < LAMPS.width * LAMPS.height; k++) {
      if (onGround(k)) groundPeak = Math.max(groundPeak, model.data[3 * k], model.data[3 * k + 1], model.data[3 * k + 2]);
    }
    // HEADROOM_PIPELINE skips the shoulder, so the only limit on the frame is
    // the output clip at 1.0; the ground stays under it, with a margin.
    expect(groundPeak).toBeLessThan(0.85);
    const ground = evError(render(LAMPS, deriveAll(p), HEADROOM), model, r709, onGround);

    const mask = maskImage(r2020, p, { halfFloat: true });
    const probe = render(LAMPS, { ...deriveAll(p), ...probePatch(p), [VIEW_MODE_KEY]: 2 }, HEADROOM);
    let invalid = 0;
    for (let k = 0; k < mask.length; k++) if (!(Math.abs(probeAt(probe, k).valid - 1) <= 1e-3)) invalid++;
    const inRange = probeError(probe, mask, (ev) => ev >= MIN_EV && ev <= MAX_EV);
    const fullSpan = probeError(probe, mask, () => true);

    console.log(
      [
        `lamps, ${name}: input mask peak ${peak.toFixed(1)}, ${invalid} invalid`,
        `  frame on the ground (peak ${groundPeak.toFixed(4)}): max ${ground.max.toFixed(4)} EV, mean ${ground.mean.toFixed(4)} EV`,
        `  probe in [${MIN_EV}, ${MAX_EV}] EV: ${inRange.compared} px, max ${inRange.max.toFixed(4)} EV, mean ${inRange.mean.toFixed(4)} EV`,
        `  probe over [${PROBE_SPAN[0]}, ${PROBE_SPAN[1]}] EV: ${fullSpan.compared} px, max ${fullSpan.max.toFixed(4)} EV, mean ${fullSpan.mean.toFixed(4)} EV`,
      ].join("\n"),
    );
    expect(ground.max).toBeLessThanOrEqual(0.03);
    expect(ground.mean).toBeLessThanOrEqual(0.005);
    expect(invalid).toBe(0);
    expect(inRange.compared).toBeGreaterThan(0.9 * mask.length);
    expect(inRange.max).toBeLessThanOrEqual(PROBE_TOLERANCE);
    expect(fullSpan.max).toBeLessThanOrEqual(PROBE_TOLERANCE);
  });
});
