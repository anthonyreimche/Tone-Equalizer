// The bag contract. The host runs a stage's prepass whenever any of its bag
// values is non-zero, so every edit key is stored so that darktable's defaults
// read 0, and every derived GPU key is 0 while all nine bands are 0 (an
// untouched or reset photo never runs the filter). The draw counts are the
// passes' bag-driven `iterations`: 0 for both makes the stage idle.

import { fitCurve, type Fit } from "./curve";
import {
  DEFAULT_PARAMS,
  DETAILS,
  ESTIMATORS,
  boostOf,
  chainLevels,
  drawCounts,
  filterMode,
  isAveraged,
  sigmaOf,
  type Params,
} from "./model";

export const EXT_ID = "tone-equalizer";
export const STAGE_ID = `${EXT_ID}.correction`;
export const VIEW_STAGE_ID = `${EXT_ID}.mask-view`;
export const MASK_VARIABLE = "toneEqualizerMask";

/** The host prefixes a stage's GLSL names with a 4-char hash of its id
 *  (shader-compiler.ts hashStageId), mirrored for the tests. */
export function stagePrefix4(stageId: string): string {
  let h = 0;
  for (let i = 0; i < stageId.length; i++) h = ((h << 5) - h + stageId.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36).slice(0, 4);
}

export const BAND_KEYS = ["b0", "b1", "b2", "b3", "b4", "b5", "b6", "b7", "b8"] as const;
export const EDIT_KEYS = [
  ...BAND_KEYS,
  "smoothing",
  "exposureBoost",
  "contrastBoost",
  "details",
  "estimator",
  "diffusion",
  "diameter",
  "feathering",
] as const;
export type EditKey = (typeof EDIT_KEYS)[number];

export const DERIVED_KEYS = [
  "on",
  "w0",
  "w1",
  "gDenom",
  "fMode",
  "fAverage",
  "fIterations",
  "fLevels",
  "fDrawsEigf",
  "fDrawsGuided",
  "fDiameter",
  "fEps",
  "fExposure",
  "fFulcrum",
  "fContrast",
  "fNorm",
] as const;
export type DerivedKey = (typeof DERIVED_KEYS)[number];

/** Every key the correction stage keeps in the bag. */
export type StageKey = EditKey | DerivedKey | "probe";

export function qualified(key: StageKey): string {
  return `${STAGE_ID}.${key}`;
}

/** Set only by the probe patch, never by an edit. */
export const PROBE_KEY = qualified("probe");
/** The view stage's switch: 1 shows the mask, 2 encodes it for readback. */
export const VIEW_MODE_KEY = `${VIEW_STAGE_ID}.mode`;

interface Range {
  readonly min: number;
  readonly max: number;
}

/** darktable's hard ranges (te.c:173-193), in the edit's own units. */
export const HARD: Readonly<Record<"band" | "smoothing" | "boost" | "iterations" | "blending" | "feathering", Range>> = {
  band: { min: -2, max: 2 },
  smoothing: { min: -2.33, max: 1.67 },
  boost: { min: -16, max: 16 },
  iterations: { min: 1, max: 20 },
  blending: { min: 0.01, max: 100 },
  feathering: { min: 0.01, max: 10000 },
};

export type Bag = Record<string, unknown>;
export type Patch = Record<string, number | number[]>;

const clamp = (v: number, r: Range) => Math.min(Math.max(v, r.min), r.max);

function stored(bag: Bag, key: EditKey): number | null {
  const v = bag[qualified(key)];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function choice<T>(bag: Bag, key: EditKey, options: readonly T[]): T {
  const v = stored(bag, key);
  return v !== null && Number.isInteger(v) && v >= 0 && v < options.length ? options[v] : options[0];
}

/** The edit from a bag; the default for anything missing or foreign. */
export function readParams(bag: Bag): Params {
  const offset = (key: EditKey, base: number, range: Range) => clamp(base + (stored(bag, key) ?? 0), range);
  return {
    bands: BAND_KEYS.map((key) => clamp(stored(bag, key) ?? 0, HARD.band)),
    curveSmoothing: clamp(stored(bag, "smoothing") ?? 0, HARD.smoothing),
    exposureBoost: clamp(stored(bag, "exposureBoost") ?? 0, HARD.boost),
    contrastBoost: clamp(stored(bag, "contrastBoost") ?? 0, HARD.boost),
    details: choice(bag, "details", DETAILS),
    estimator: choice(bag, "estimator", ESTIMATORS),
    iterations: Math.round(offset("diffusion", DEFAULT_PARAMS.iterations, HARD.iterations)),
    blending: offset("diameter", DEFAULT_PARAMS.blending, HARD.blending),
    feathering: offset("feathering", DEFAULT_PARAMS.feathering, HARD.feathering),
  };
}

/** The edit's own keys: offsets from darktable's defaults. */
export function editPatch(p: Params): Patch {
  const patch: Patch = {};
  BAND_KEYS.forEach((key, i) => {
    patch[qualified(key)] = p.bands[i];
  });
  patch[qualified("smoothing")] = p.curveSmoothing;
  patch[qualified("exposureBoost")] = p.exposureBoost;
  patch[qualified("contrastBoost")] = p.contrastBoost;
  patch[qualified("details")] = DETAILS.indexOf(p.details);
  patch[qualified("estimator")] = ESTIMATORS.indexOf(p.estimator);
  patch[qualified("diffusion")] = p.iterations - DEFAULT_PARAMS.iterations;
  patch[qualified("diameter")] = p.blending - DEFAULT_PARAMS.blending;
  patch[qualified("feathering")] = p.feathering - DEFAULT_PARAMS.feathering;
  return patch;
}

/** What the passes and the inline need to build and finish the mask. */
export function maskKeys(p: Params): Patch {
  const mode = filterMode(p.details);
  const boost = boostOf(p);
  const draws = drawCounts(p);
  return {
    [qualified("fMode")]: mode === "none" ? 0 : mode === "guided" ? 1 : 2,
    [qualified("fAverage")]: isAveraged(p.details) ? 1 : 0,
    [qualified("fIterations")]: p.iterations,
    [qualified("fLevels")]: chainLevels(p.details, p.blending),
    [qualified("fDrawsEigf")]: draws.eigf,
    [qualified("fDrawsGuided")]: draws.guided,
    [qualified("fDiameter")]: p.blending / 100,
    [qualified("fEps")]: 1 / p.feathering,
    [qualified("fExposure")]: boost.exposure,
    [qualified("fFulcrum")]: boost.fulcrum,
    [qualified("fContrast")]: boost.contrast,
    [qualified("fNorm")]: ESTIMATORS.indexOf(p.estimator),
  };
}

/** The curve the inline applies: on, the 8 weights, the gaussian's 1/(2σ²). */
export function curveKeys(fit: Fit): Patch {
  return {
    [qualified("on")]: 1,
    [qualified("w0")]: fit.weights.slice(0, 4),
    [qualified("w1")]: fit.weights.slice(4, 8),
    [qualified("gDenom")]: 1 / (2 * fit.sigma * fit.sigma),
  };
}

export function idlePatch(): Patch {
  const patch: Patch = {};
  for (const key of DERIVED_KEYS) patch[qualified(key)] = key === "w0" || key === "w1" ? [0, 0, 0, 0] : 0;
  return patch;
}

export function fitOf(p: Params): Fit {
  return fitCurve(p.bands, sigmaOf(p.curveSmoothing));
}

/** Some band off zero and a curve that fits: the stage has work to do. */
export function isActive(p: Params, fit: Fit = fitOf(p)): boolean {
  return p.bands.some((b) => b !== 0) && fit.valid;
}

/** An edit as the bag keeps it, clamped to the hard ranges, and as it reads
 *  back. base + (v - base) is not always bit-exact, so the GPU keys derive
 *  from the read-back: a bag whose GPU keys came from the unrounded edit would
 *  disagree with its own re-derivation. */
function settled(p: Params): { edit: Patch; read: Params } {
  const edit = editPatch(readParams(editPatch(p)));
  return { edit, read: readParams(edit) };
}

/** Everything to persist and drive the GPU for an edit. The edit keys are
 *  written clamped and sanitised: a value outside its hard range is stored at
 *  the range's end, the iterations as a whole number, and a non-finite value
 *  (NaN, ±Infinity) as its default, not the end of the range. */
export function deriveAll(p: Params): Patch {
  const { edit, read } = settled(p);
  const fit = fitOf(read);
  return { ...edit, ...(isActive(read, fit) ? { ...maskKeys(read), ...curveKeys(fit) } : idlePatch()) };
}

export function resetPatch(): Patch {
  return deriveAll(DEFAULT_PARAMS);
}

const same = (a: unknown, b: number | number[]) =>
  Array.isArray(b) ? Array.isArray(a) && a.length === b.length && a.every((v, i) => v === b[i]) : a === b;

/** The whole patch when a bag holds this stage's edit but other keys disagree
 *  with it (a preset that carried only some keys, an older release's edit);
 *  null when the bag has no edit key or already agrees. */
export function rederivePatch(bag: Bag): Patch | null {
  if (!EDIT_KEYS.some((key) => qualified(key) in bag)) return null;
  const expected = deriveAll(readParams(bag));
  return Object.entries(expected).every(([key, v]) => same(bag[key], v)) ? null : expected;
}

/** The mask keys as if a band were set, and the probe switch: merged over the
 *  bag for a capture, it makes the stage publish its mask with the curve left
 *  as the edit has it. */
export function probePatch(p: Params): Patch {
  return { ...maskKeys(settled(p).read), [PROBE_KEY]: 1 };
}
