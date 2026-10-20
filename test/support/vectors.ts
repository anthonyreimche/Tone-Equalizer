// The reference vectors test/reference/build.cjs generates from darktable's own
// code, typed for the suites.

import raw from "../reference/vectors.json";
import type { Details, Estimator } from "../../src/model";

export type Triple = [number, number, number];

export interface Vectors {
  norms: { rgb: Triple; method: number; exposure: number; fulcrum: number; contrast: number; value: number }[];
  fits: { sigma: number; bands: number[]; valid: boolean; weights: number[]; nodes: number[]; curve: number[] }[];
  interactive: { sigma: number; start: number[]; steps: { x: number; offset: number; bands: number[] | null }[] }[];
  histograms: { ev: number[]; bins: number[]; max: number; first: number; last: number }[];
  autos: {
    first: number;
    last: number;
    exposureBoost: number;
    contrastBoost: number;
    details: number;
    feathering: number;
    exposure: number;
    contrast: number;
  }[];
  cursor: { width: number; height: number; ev: number[]; points: { x: number; y: number; value: number }[] };
  presets: {
    name: string;
    details: number;
    method: number;
    exposureBoost: number;
    contrastBoost: number;
    blending: number;
    feathering: number;
    iterations: number;
    smoothing: number;
    bands: number[];
  }[];
  masks?: {
    scene: { width: number; height: number; rgb: number[] };
    cases: {
      details: number;
      method: number;
      exposureBoost: number;
      contrastBoost: number;
      blending: number;
      feathering: number;
      iterations: number;
      mask: number[];
    }[];
  };
}

// The JSON is darktable's output; its shape is this file's to describe.
export const V = raw as unknown as Vectors;

/** darktable's dt_iop_toneequalizer_filter_t → the port's names. */
export const DT_DETAILS: Readonly<Record<number, Details>> = {
  0: "none",
  1: "avg-guided",
  2: "guided",
  3: "avg-eigf",
  4: "eigf",
};

/** darktable's dt_iop_luminance_mask_method_t → the port's names. */
export const DT_METHOD: Readonly<Record<number, Estimator>> = {
  0: "mean",
  1: "lightness",
  2: "value",
  3: "norm1",
  4: "norm2",
  5: "power",
  6: "geomean",
};
