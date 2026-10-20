// darktable's built-in presets (toneequal.c init_presets, te.c:484-618), in its
// order, with master's names. Every field carries over from one preset to the
// next upstream; each entry here spells its effective values out.
//
// A port of darktable master f52993027d (src/iop/toneequal.c),
// GPL-3.0-or-later, © Aurélien Pierre and the darktable authors.

import { DEFAULT_PARAMS, type Params } from "./model";

const f = Math.fround;

export interface Preset {
  readonly name: string;
  readonly params: Params;
}

/** compress_shadows_highlight_preset_set_exposure_params, in float. */
export function compress(step: number): number[] {
  const s = f(step);
  const k = f(f(5 / 3) * s);
  return [s, k, k, s, 0, -s, -k, -k, -s];
}

/** dilate_shadows_highlight_preset_set_exposure_params, in float. */
export function dilate(step: number): number[] {
  const s = f(step);
  const k = (n: number) => f(f(n / 9) * s);
  return [-k(15), -k(14), -k(12), -k(8), 0, k(8), k(12), k(14), k(15)];
}

const RELIGHT = [0, 0.15, 0.6, 1.15, 1.33, 1.15, 0.6, 0.15, 0];

const preset = (name: string, over: Partial<Params>): Preset => ({ name, params: { ...DEFAULT_PARAMS, ...over } });

const compressed = (details: "eigf" | "guided", blending: number, feathering: number, iterations: number, step: number): Partial<Params> => ({
  details,
  estimator: "norm2",
  exposureBoost: -1.57,
  blending,
  feathering,
  iterations,
  bands: compress(step),
});

const contrast = (step: number): Partial<Params> => ({
  details: "none",
  estimator: "norm2",
  exposureBoost: -1.57,
  blending: 5,
  feathering: 500,
  iterations: 1,
  bands: dilate(step),
});

export const PRESETS: readonly Preset[] = [
  // Upstream's blending is 0 here, unused with no filter.
  preset("Simple tone curve", { details: "none", estimator: "power", exposureBoost: -0.5 }),
  preset("Mask blending | all purposes", { details: "eigf", estimator: "norm2" }),
  preset("Mask blending | people with backlight", { details: "eigf", estimator: "norm2", blending: 1, feathering: 10, iterations: 3 }),
  preset("Compress shadows/highlights | EIGF | strong", compressed("eigf", 2, 20, 5, 0.65)),
  preset("Compress shadows/highlights | GF | strong", compressed("guided", 2, 500, 5, 0.65)),
  preset("Compress shadows/highlights | EIGF | medium", compressed("eigf", 3, 7, 3, 0.45)),
  preset("Compress shadows/highlights | GF | medium", compressed("guided", 3, 500, 3, 0.45)),
  preset("Compress shadows/highlights | EIGF | soft", compressed("eigf", 5, 1, 1, 0.25)),
  preset("Compress shadows/highlights | GF | soft", compressed("guided", 5, 500, 1, 0.25)),
  preset("Contrast tone curve | soft", contrast(0.25)),
  preset("Contrast tone curve | medium", contrast(0.45)),
  preset("Contrast tone curve | strong", contrast(0.65)),
  preset("Relight: fill-in", { details: "eigf", estimator: "norm2", exposureBoost: -0.5, bands: RELIGHT }),
];
