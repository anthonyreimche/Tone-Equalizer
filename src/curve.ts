// The radial-basis curve: toneequal.c's interpolation matrix and per-pixel
// correction, and choleski.h's least-squares solve (double precision, as
// master runs it since PR #21888). darktable stores the matrix and the
// weights in float, so every stored value is rounded with Math.fround.
//
// A port of darktable master f52993027d (src/iop/toneequal.c,
// src/common/choleski.h), GPL-3.0-or-later, © Aurélien Pierre and the
// darktable authors.

import { CENTERS_OPS, CENTERS_PARAMS, CHANNELS, GAIN_MAX, GAIN_MIN, MAX_EV, MIN_EV, PIXEL_CHAN, UI_SAMPLES } from "./model";

const f = Math.fround;

/** gaussian_denom: 2σ², in float. */
export function gaussianDenom(sigma: number): number {
  return f(f(2 * f(sigma)) * f(sigma));
}

/** gaussian_func: expf(−r²/denominator). */
export function gaussianFunc(radius: number, denominator: number): number {
  return f(Math.exp(f(-f(f(radius) * f(radius)) / denominator)));
}

export interface Fit {
  /** The 8 gaussians' weights, on linear gain. */
  readonly weights: readonly number[];
  readonly sigma: number;
  /** False when the Cholesky solve met a non-positive pivot or a zero
   *  diagonal, or its solution was not finite (a non-finite band or σ). */
  readonly valid: boolean;
}

/** build_interpolation_matrix: A[i][j] = g(centers_params[i] − centers_ops[j]). */
export function interpolationMatrix(sigma: number): Float32Array {
  const denom = gaussianDenom(sigma);
  const A = new Float32Array(CHANNELS * PIXEL_CHAN);
  for (let i = 0; i < CHANNELS; i++) {
    for (let j = 0; j < PIXEL_CHAN; j++) {
      A[i * PIXEL_CHAN + j] = gaussianFunc(f(CENTERS_PARAMS[i] - CENTERS_OPS[j]), denom);
    }
  }
  return A;
}

/** pseudo_solve: the least-squares solution of A·x ≈ y for the m × n matrix A
 *  (normal equations, Cholesky–Banachiewicz with darktable's validity checks,
 *  triangular descent and ascent), or null where darktable reports failure or
 *  the solution is not finite. Every check fails on NaN, which darktable's
 *  comparisons let through; for finite input they decide as upstream's do. */
export function pseudoSolve(A: Float32Array, y: Float32Array, m: number, n: number): Float32Array | null {
  if (m < n || n < 2 || m < 2) return null;
  const S = new Float64Array(n * n);
  const v = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = 0;
      for (let k = 0; k < m; k++) sum += A[k * n + i] * A[k * n + j];
      S[i * n + j] = sum;
    }
    let sum = 0;
    for (let k = 0; k < m; k++) sum += A[k * n + i] * y[k];
    v[i] = sum;
  }
  if (!(S[0] > 0)) return null;
  // L's diagonal is a square root, never negative, so upstream's `temp == 0`
  // on it is `!(temp > 0)` here.
  const L = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = 0;
      for (let k = 0; k < j; k++) sum += L[i * n + k] * L[j * n + k];
      if (i === j) {
        const temp = S[i * n + i] - sum;
        if (!(temp >= 0)) return null;
        L[i * n + j] = Math.sqrt(temp);
      } else {
        const temp = L[j * n + j];
        if (!(temp > 0)) return null;
        L[i * n + j] = (S[i * n + j] - sum) / temp;
      }
    }
  }
  const b = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = v[i];
    for (let j = 0; j < i; j++) sum -= L[i * n + j] * b[j];
    const temp = L[i * n + i];
    if (!(temp > 0)) return null;
    b[i] = sum / temp;
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let sum = b[i];
    for (let j = n - 1; j > i; j--) sum -= L[j * n + i] * x[j];
    const temp = L[i * n + i];
    if (!(temp > 0)) return null;
    x[i] = sum / temp;
  }
  const out = Float32Array.from(x);
  return out.every(Number.isFinite) ? out : null;
}

/** The curve for nine node EVs: fitted on their linear gains, as upstream. */
export function fitCurve(bands: readonly number[], sigma: number): Fit {
  const y = Float32Array.from(bands, (g) => f(2 ** f(g)));
  const x = pseudoSolve(interpolationMatrix(sigma), y, CHANNELS, PIXEL_CHAN);
  return x
    ? { weights: Array.from(x), sigma, valid: true }
    : { weights: new Array<number>(PIXEL_CHAN).fill(0), sigma, valid: false };
}

/** pixel_correction: the linear gain at an exposure, both clamped as upstream. */
export function gainAt(exposure: number, fit: Pick<Fit, "weights" | "sigma">): number {
  const denom = gaussianDenom(fit.sigma);
  const expo = f(Math.min(Math.max(exposure, MIN_EV), MAX_EV));
  let result = 0;
  for (let i = 0; i < PIXEL_CHAN; i++) {
    result = f(result + f(gaussianFunc(f(expo - CENTERS_OPS[i]), denom) * fit.weights[i]));
  }
  return Math.min(Math.max(result, GAIN_MIN), GAIN_MAX);
}

/** compute_channels_factors: the curve's own linear gains at the nine nodes. */
export function nodeGains(fit: Pick<Fit, "weights" | "sigma">): number[] {
  return CENTERS_PARAMS.map((c) => gainAt(c, fit));
}

/** set_new_params_interactive: add `offset` EV at `controlExposure`, spread
 *  over the nodes by a gaussian of denominator σ⁴/2, refit, and return the
 *  fitted curve's own node values in EV; null where the solve fails. */
export function interactiveEdit(
  bands: readonly number[],
  sigma: number,
  controlExposure: number,
  offset: number,
): number[] | null {
  const spread = gaussianDenom(f(f(f(sigma) * f(sigma)) / 2));
  const y = Float32Array.from(bands, (g, i) =>
    f(f(2 ** f(g)) * f(2 ** f(gaussianFunc(f(CENTERS_PARAMS[i] - f(controlExposure)), spread) * f(offset)))),
  );
  const x = pseudoSolve(interpolationMatrix(sigma), y, CHANNELS, PIXEL_CHAN);
  if (!x) return null;
  const fit = { weights: Array.from(x), sigma };
  return nodeGains(fit).map((g) => f(Math.log2(g)));
}

/** compute_lut_correction's curve in EV at 256 points across [−8, 0] EV. */
export function curveSamples(fit: Pick<Fit, "weights" | "sigma">): Float64Array {
  const out = new Float64Array(UI_SAMPLES);
  for (let k = 0; k < UI_SAMPLES; k++) out[k] = Math.log2(gainAt((8 * k) / (UI_SAMPLES - 1) - 8, fit));
  return out;
}
