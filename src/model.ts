// The tone equalizer's mask as the GPU stage computes it, in float64.
//
// A port of darktable master f52993027d (src/iop/toneequal.c,
// src/common/luminance_mask.h, src/common/fast_guided_filter.h,
// src/common/eigf.h), GPL-3.0-or-later, © Aurélien Pierre and the darktable
// authors. darktable filters a ×4-downscaled copy; the stage framework renders
// every pass at prepass resolution, so the gaussian (EIGF) becomes a dilated
// B3 à trous chain with the same variance and the box (guided filter) a
// dilated 2×2 chain with the same width. See the design spec.

export const CHANNELS = 9;
export const PIXEL_CHAN = 8;
export const MIN_EV = -8;
export const MAX_EV = 0;
/** The user's nodes (te.c:158-160). */
export const CENTERS_PARAMS: readonly number[] = [-8, -7, -6, -5, -4, -3, -2, -1, 0];
/** The RBF gaussians' centres, −8…0 in 8/7 EV steps, in float (te.c:148-156). */
export const CENTERS_OPS: readonly number[] = [-56, -48, -40, -32, -24, -16, -8, 0].map((v) => Math.fround(v / 7));
export const FULCRUM = 2 ** -4;
export const MIN_FLOAT = 2 ** -16;
export const GAIN_MIN = 0.25;
export const GAIN_MAX = 4;
export const UI_SAMPLES = 256;
/** The long edge the draw count is sized for; smaller renders skip fine levels. */
export const DRAW_REFERENCE_EDGE = 16384;
export const SKIP_SPACING = 0.5;
/** The prepass is binary16 (max 65504). The statistics use min(M, STAT_CAP),
 *  which keeps M² ≤ 2^14 and lets the convex blurs stay below the limit; the
 *  carried mask uses min(M, CARRY_CAP). The finish's M is uncapped (float32). */
export const STAT_CAP = 2 ** 7;
export const CARRY_CAP = 2 ** 15;
export const MAX_ITERATIONS = 20;
/** The guided filter needs 14 at 100 % diameter. EIGF's widened σ would need
 *  15 above 97.87 %; chainLevels clamps it, and the spacing is computed from
 *  the clamped count, so σ is unchanged. */
export const MAX_LEVELS = 14;
export const EIGF_MAX_DRAWS = MAX_ITERATIONS * (MAX_LEVELS + 1);
export const GUIDED_MAX_DRAWS = MAX_ITERATIONS * (2 * MAX_LEVELS + 2);
export const B3: readonly number[] = [1 / 16, 4 / 16, 6 / 16, 4 / 16, 1 / 16];
/** darktable's Deriche blur has variance 4/α², α = 1.695/σ (src/common/gaussian.c). */
export const EIGF_SIGMA_SCALE = 2 / 1.695;

/** Stored order: index 0 is darktable's default, so a default bag reads 0. */
export const DETAILS = ["eigf", "avg-eigf", "guided", "avg-guided", "none"] as const;
export type Details = (typeof DETAILS)[number];
export const ESTIMATORS = ["norm2", "mean", "lightness", "value", "norm1", "power", "geomean"] as const;
export type Estimator = (typeof ESTIMATORS)[number];

export interface Params {
  /** EV at −8, −7, …, 0 EV. */
  readonly bands: readonly number[];
  /** darktable's "curve smoothing" slider value v: σ = √2^(1+v). */
  readonly curveSmoothing: number;
  readonly exposureBoost: number;
  readonly contrastBoost: number;
  readonly details: Details;
  readonly estimator: Estimator;
  /** "filter diffusion", 1…20. */
  readonly iterations: number;
  /** "smoothing diameter", % of the long edge. */
  readonly blending: number;
  readonly feathering: number;
}

export const DEFAULT_PARAMS: Params = {
  bands: [0, 0, 0, 0, 0, 0, 0, 0, 0],
  curveSmoothing: 0,
  exposureBoost: 0,
  contrastBoost: 0,
  details: "eigf",
  estimator: "norm2",
  iterations: 1,
  blending: 5,
  feathering: 1,
};

/** smoothing_callback (te.c:2473): powf(√2, 1 + v) in float. */
export function sigmaOf(curveSmoothing: number): number {
  return Math.fround(Math.fround(Math.SQRT2) ** Math.fround(1 + curveSmoothing));
}

export type Rgb = readonly [number, number, number];

/** luminance_mask.h's pixel_rgb_* norms. The power norm is 0/0 for black, as
 *  upstream, and linearContrast floors it. */
export function norm(rgb: Rgb, estimator: Estimator): number {
  const [r, g, b] = rgb;
  switch (estimator) {
    case "norm2":
      return Math.sqrt(r * r + g * g + b * b);
    case "mean":
      return (r + g + b) / 3;
    case "lightness":
      return (Math.max(r, g, b) + Math.min(r, g, b)) / 2;
    case "value":
      return Math.max(r, g, b);
    case "norm1":
      return Math.abs(r) + Math.abs(g) + Math.abs(b);
    case "power": {
      const a = Math.abs(r);
      const c = Math.abs(g);
      const d = Math.abs(b);
      return (a * a * a + c * c * c + d * d * d) / (a * a + c * c + d * d);
    }
    case "geomean":
      return Math.cbrt(Math.abs(r) * Math.abs(g) * Math.abs(b));
  }
}

export interface Boost {
  readonly exposure: number;
  readonly fulcrum: number;
  readonly contrast: number;
}

/** compute_luminance_mask (te.c:939-1013): the contrast stretch around −4 EV
 *  exists only for the plain guided filter and EIGF. */
export function boostOf(p: Pick<Params, "details" | "exposureBoost" | "contrastBoost">): Boost {
  const stretched = p.details === "eigf" || p.details === "guided";
  return {
    exposure: 2 ** p.exposureBoost,
    fulcrum: stretched ? FULCRUM : 0,
    contrast: stretched ? 2 ** p.contrastBoost : 1,
  };
}

/** linear_contrast; the comparison keeps darktable's MAX semantics for NaN. */
export function linearContrast(v: number, fulcrum: number, contrast: number): number {
  const out = (v - fulcrum) * contrast + fulcrum;
  return out > MIN_FLOAT ? out : MIN_FLOAT;
}

export function maskValue(rgb: Rgb, estimator: Estimator, boost: Boost): number {
  return linearContrast(boost.exposure * norm(rgb, estimator), boost.fulcrum, boost.contrast);
}

export type FilterMode = "none" | "guided" | "eigf";

export function filterMode(details: Details): FilterMode {
  if (details === "none") return "none";
  return details === "guided" || details === "avg-guided" ? "guided" : "eigf";
}

export function isAveraged(details: Details): boolean {
  return details === "avg-eigf" || details === "avg-guided";
}

/** modify_roi_in (te.c:1833-1848) at a render whose long edge is `longEdge`. */
export function radiusAt(blending: number, longEdge: number): number {
  return Math.trunc((Math.fround(Math.fround(blending / 100) * longEdge) - 1) / 2) | 0;
}

/** fast_eigf_surface_blur's effective σ: the radius floored at one pixel, as
 *  its ds_sigma is, then widened to the width darktable's blur really has, so
 *  never below 2/1.695 ≈ 1.18 px. */
export function eigfSigma(radius: number): number {
  return EIGF_SIGMA_SCALE * Math.max(radius, 1);
}

/** fast_surface_blur's box at ×4 downscale, in full-resolution pixels. */
export function guidedWidth(radius: number): number {
  return 4 * (2 * (radius < 4 ? 1 : Math.floor(radius / 4)) + 1);
}

/** Levels per chain at DRAW_REFERENCE_EDGE; 0 for "no". */
export function chainLevels(details: Details, blending: number): number {
  const radius = radiusAt(blending, DRAW_REFERENCE_EDGE);
  switch (filterMode(details)) {
    case "none":
      return 0;
    case "eigf": {
      const sigma = eigfSigma(radius);
      return Math.min(Math.max(1, Math.ceil(Math.log(3 * sigma * sigma + 1) / Math.log(4))), MAX_LEVELS);
    }
    case "guided":
      return Math.min(Math.max(1, Math.ceil(Math.log2(guidedWidth(radius)))), MAX_LEVELS);
  }
}

/** The base spacing of a B3 chain whose level variances (s·2^j)² sum to σ². */
export function eigfSpacing(sigma: number, levels: number): number {
  return Math.sqrt((3 * sigma * sigma) / (4 ** levels - 1));
}

/** The base spacing of a 2×2 chain that builds a box `width` texels wide. */
export function guidedSpacing(width: number, levels: number): number {
  return width / 2 ** levels;
}

/** Draws per frame of the EIGF pass and the guided-filter pass: per iteration
 *  one conversion draw plus the chain (EIGF), or a conversion draw, the
 *  statistics chain, a coefficient draw and the a/b chain (guided filter). */
export function drawCounts(p: Pick<Params, "details" | "iterations" | "blending">): { eigf: number; guided: number } {
  const levels = chainLevels(p.details, p.blending);
  switch (filterMode(p.details)) {
    case "none":
      return { eigf: 0, guided: 0 };
    case "eigf":
      return { eigf: p.iterations * (levels + 1), guided: 0 };
    case "guided":
      return { eigf: 0, guided: p.iterations * (2 * levels + 2) };
  }
}

/** RGB, 3 values per pixel, rows top-down. */
export interface Image {
  readonly width: number;
  readonly height: number;
  readonly data: Float64Array;
}

export interface MaskOptions {
  /** Round the filter state to binary16 after every draw, as the RGBA16F
   *  ping-pong targets do. */
  readonly halfFloat?: boolean;
}

const F16_MAX = 65504;

/** float64 → binary16 → float64, round to nearest even; a magnitude that rounds
 *  past 65504 (from 65520 up) is infinite, as in the render target. */
export function f16(v: number): number {
  if (v === 0 || !Number.isFinite(v)) return v;
  const sign = v < 0 ? -1 : 1;
  const a = Math.abs(v);
  const e = Math.floor(Math.log2(a));
  const stepSize = 2 ** (Math.max(e, -14) - 10);
  const q = a / stepSize;
  const fl = Math.floor(q);
  const frac = q - fl;
  const r = frac > 0.5 || (frac === 0.5 && fl % 2 === 1) ? fl + 1 : fl;
  const out = r * stepSize;
  return out > F16_MAX ? sign * Infinity : sign * out;
}

/** Three channels per texel, as a pass carries them. */
type State = readonly [Float64Array, Float64Array, Float64Array];

/** A LINEAR, CLAMP_TO_EDGE texture read at texel coordinate (x, y), where
 *  integer coordinates are texel centres. */
function sample(plane: Float64Array, w: number, h: number, x: number, y: number): number {
  const cx = Math.min(Math.max(x, 0), w - 1);
  const cy = Math.min(Math.max(y, 0), h - 1);
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const x1 = Math.min(x0 + 1, w - 1);
  const y1 = Math.min(y0 + 1, h - 1);
  const fx = cx - x0;
  const fy = cy - y0;
  const top = plane[y0 * w + x0] * (1 - fx) + plane[y0 * w + x1] * fx;
  const bottom = plane[y1 * w + x0] * (1 - fx) + plane[y1 * w + x1] * fx;
  return top * (1 - fy) + bottom * fy;
}

/** One 5×5 B3 level at `spacing` texels, blurring the first two channels. */
function b3Level(s: State, w: number, h: number, spacing: number): State {
  const a = new Float64Array(w * h);
  const b = new Float64Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sa = 0;
      let sb = 0;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const wt = B3[dx + 2] * B3[dy + 2];
          sa += wt * sample(s[0], w, h, x + dx * spacing, y + dy * spacing);
          sb += wt * sample(s[1], w, h, x + dx * spacing, y + dy * spacing);
        }
      }
      a[y * w + x] = sa;
      b[y * w + x] = sb;
    }
  }
  return [a, b, s[2]];
}

/** One 2×2 box level: the mean of four taps at ±spacing/2. */
function boxLevel(s: State, w: number, h: number, spacing: number): State {
  const a = new Float64Array(w * h);
  const b = new Float64Array(w * h);
  const o = spacing / 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sa = 0;
      let sb = 0;
      for (const [dx, dy] of [[-o, -o], [o, -o], [-o, o], [o, o]] as const) {
        sa += sample(s[0], w, h, x + dx, y + dy);
        sb += sample(s[1], w, h, x + dx, y + dy);
      }
      a[y * w + x] = sa / 4;
      b[y * w + x] = sb / 4;
    }
  }
  return [a, b, s[2]];
}

/** The statistics chain's last level: E[M²] becomes the variance. */
function toVariance(s: State): State {
  return [s[0], s[1].map((e2, k) => Math.max(e2 - s[0][k] * s[0][k], 0)), s[2]];
}

/** eigf_blending_no_mask, linear blend. */
function eigfBlend(m: number, avg: number, variance: number, eps: number): number {
  const v = variance / Math.max(avg * m, 1e-6);
  const a = v / (v + eps);
  const out = a * m + (1 - a) * avg;
  return out > MIN_FLOAT ? out : MIN_FLOAT;
}

/** variance_analyse with guide = mask: a = var/max(var + ε, 1e-15), b = mean·(1 − a). */
function guidedCoefficients(s: State, eps: number): State {
  const a = s[1].map((variance) => variance / Math.max(variance + eps, 1e-15));
  return [a, s[0].map((mean, k) => mean - a[k] * mean), s[2]];
}

/** The tone equalizer's mask M′ per pixel, as the stage computes it with the
 *  prepass at the image's own size: per iteration a conversion draw, the
 *  statistics chain (variance on its last level) and, for the guided filter,
 *  a coefficient draw and the a/b chain; then the inline finish. */
export function maskImage(img: Image, p: Params, options: MaskOptions = {}): Float64Array {
  const { width: w, height: h, data } = img;
  const n = w * h;
  const boost = boostOf(p);
  const M = new Float64Array(n);
  for (let k = 0; k < n; k++) M[k] = maskValue([data[3 * k], data[3 * k + 1], data[3 * k + 2]], p.estimator, boost);
  const mode = filterMode(p.details);
  if (mode === "none") return M;

  const store = options.halfFloat ? (s: State): State => [s[0].map(f16), s[1].map(f16), s[2].map(f16)] : (s: State) => s;
  const levels = chainLevels(p.details, p.blending);
  const radius = radiusAt(p.blending, Math.max(w, h));
  const base = mode === "eigf" ? eigfSpacing(eigfSigma(radius), levels) : guidedSpacing(guidedWidth(radius), levels);
  const eps = 1 / p.feathering;
  const level = (s: State, j: number): State => {
    const spacing = base * 2 ** j;
    if (spacing < SKIP_SPACING) return s;
    return mode === "eigf" ? b3Level(s, w, h, spacing) : boxLevel(s, w, h, spacing);
  };

  let state: State = [M, M, M];
  for (let it = 0; it < p.iterations; it++) {
    const m =
      it === 0
        ? M
        : mode === "eigf"
          ? state[2].map((mc, k) => eigfBlend(mc, state[0][k], state[1][k], eps))
          : state[2].map((mc, k) => Math.max(state[0][k] * mc + state[1][k], MIN_FLOAT));
    const capped = m.map((v) => Math.min(v, STAT_CAP));
    state = store([capped, capped.map((v) => v * v), m.map((v) => Math.min(v, CARRY_CAP))]);
    for (let j = 0; j < levels; j++) {
      const next = level(state, j);
      state = store(j === levels - 1 ? toVariance(next) : next);
    }
    if (mode === "guided") {
      state = store(guidedCoefficients(state, eps));
      for (let j = 0; j < levels; j++) state = store(level(state, j));
    }
  }

  const out = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    let mi = M[k];
    let mp: number;
    if (mode === "eigf") {
      mi = p.iterations > 1 ? state[2][k] : M[k];
      mp = eigfBlend(mi, state[0][k], state[1][k], eps);
    } else {
      const v = state[0][k] * M[k] + state[1][k];
      mp = v > MIN_FLOAT ? v : MIN_FLOAT;
    }
    out[k] = isAveraged(p.details) ? Math.sqrt(mi * mp) : mp;
  }
  return out;
}
