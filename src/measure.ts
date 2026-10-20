// What darktable's GUI measures on the preview mask: the extended log
// histogram and its 5 %/95 % points (toneequal.c compute_log_histogram_and_
// stats), the auto-adjust buttons (auto_adjust_exposure_boost /
// auto_adjust_contrast_boost) and the 3×3 cursor sample (get_luminance_
// from_buffer). Float arithmetic as upstream, through Math.fround; the cursor
// readout is a display value and stays in double.
//
// A port of darktable master f52993027d (src/iop/toneequal.c),
// GPL-3.0-or-later, © Aurélien Pierre and the darktable authors.

import { FULCRUM, UI_SAMPLES, type Details } from "./model";

const f = Math.fround;
const TEMP_SAMPLES = 2 * UI_SAMPLES;

export interface LogHistogram {
  /** 256 bins over [−8, 0] EV, out-of-range values in the end bins. */
  readonly bins: Int32Array;
  readonly max: number;
  /** EV of the 5 % point (darktable's "first decile"). */
  readonly first: number;
  /** EV of the 95 % point. */
  readonly last: number;
  /** Valid samples counted. */
  readonly count: number;
}

/** The EV of one of the 512 fine bins, as darktable stores it in a float. */
const fineBinEv = (k: number) => f((16 * f(k)) / f(TEMP_SAMPLES - 1) - 10);

/** The histogram of mask exposures; non-finite samples are skipped, and with
 *  none left it is null. */
export function logHistogram(ev: ArrayLike<number>): LogHistogram | null {
  const temp = new Int32Array(TEMP_SAMPLES);
  let count = 0;
  for (let k = 0; k < ev.length; k++) {
    const e = ev[k];
    if (!Number.isFinite(e)) continue;
    const index = Math.trunc(f(f(f(e + 10) / 16) * TEMP_SAMPLES));
    temp[Math.min(Math.max(index, 0), TEMP_SAMPLES - 1)]++;
    count++;
  }
  if (count === 0) return null;
  const first = Math.trunc(f(f(count) * f(0.05)));
  const last = Math.trunc(f(f(count) * f(1 - f(0.95))));
  let population = 0;
  let firstPos = 0;
  for (let k = 0; k < TEMP_SAMPLES; k++) {
    const prev = population;
    population += temp[k];
    if (prev < first && first <= population) {
      firstPos = k;
      break;
    }
  }
  population = 0;
  let lastPos = 0;
  for (let k = TEMP_SAMPLES - 1; k >= 0; k--) {
    const prev = population;
    population += temp[k];
    if (prev < last && last <= population) {
      lastPos = k;
      break;
    }
  }
  const bins = new Int32Array(UI_SAMPLES);
  let max = 1;
  for (let k = 0; k < TEMP_SAMPLES; k++) {
    const level = fineBinEv(k);
    const i = Math.min(Math.max(Math.trunc(f(f(f(level + 8) / 8) * UI_SAMPLES)), 0), UI_SAMPLES - 1);
    bins[i] += temp[k];
    if (bins[i] > max) max = bins[i];
  }
  return { bins, max, first: fineBinEv(firstPos), last: fineBinEv(lastPos), count };
}

/** The deciles back on the un-boosted norm, and darktable's mix of them. */
function unboosted(first: number, last: number, exposureBoost: number, contrastBoost: number) {
  const e = f(2 ** f(exposureBoost));
  const c = f(2 ** f(contrastBoost));
  const undo = (ev: number) => f(f(f(f(f(2 ** f(ev)) - FULCRUM) / c) + FULCRUM) / e);
  const fd = undo(first);
  const ld = undo(last);
  const s1 = f(FULCRUM - f(2 ** -7));
  const s2 = f(f(2 ** -1) - FULCRUM);
  return { fd, ld, s1, s2, c, mix: f(f(fd * s2) + f(ld * s1)) };
}

/** auto_adjust_exposure_boost: the new mask exposure compensation, EV.
 *  May return a non-finite value, as upstream; callers guard. */
export function autoExposure(first: number, last: number, exposureBoost: number, contrastBoost: number): number {
  const { s1, s2, mix } = unboosted(first, last, exposureBoost, contrastBoost);
  return f(Math.log2(f(f(FULCRUM * f(s1 + s2)) / mix)));
}

/** auto_adjust_contrast_boost: the new mask contrast compensation, EV, with
 *  darktable's regression correction for the plain EIGF and guided filter.
 *  May return a non-finite value, as upstream; callers guard. */
export function autoContrast(
  first: number,
  last: number,
  p: { exposureBoost: number; contrastBoost: number; details: Details; feathering: number },
): number {
  const { fd, ld, c: linear, mix } = unboosted(first, last, p.exposureBoost, p.contrastBoost);
  let c = f(Math.log2(f(f(mix / f(FULCRUM * f(ld - fd))) / linear)));
  const feathering = f(p.feathering);
  if (p.details === "eigf" && c > 0) {
    // 0.01823 is a double literal upstream, so the sum runs in double.
    const correction = f(f(-0.0276) + 0.01823 * feathering + f(f(f(0.7566) - 1) * c));
    if (feathering < 5) c = f(c + correction);
    else if (feathering < 10) c = f(c + f(correction * f(2 - f(feathering / 5))));
  } else if (p.details === "guided" && c > 0) {
    c = f(f(0.0235) + f(f(1.1225) * c));
  }
  return f(f(p.contrastBoost) + c);
}

/** toneequal.c's gauss_kernel. */
export const CURSOR_KERNEL: readonly (readonly number[])[] = [
  [0.076555024, 0.124401914, 0.076555024],
  [0.124401914, 0.196172249, 0.124401914],
  [0.076555024, 0.124401914, 0.076555024],
];

/** The mask exposure under pixel (x, y): the kernel-weighted mean of the 3×3
 *  linear mask values around it, clamped at the borders; null outside the
 *  frame or where a sample in the window is invalid. */
export function cursorExposure(ev: ArrayLike<number>, width: number, height: number, x: number, y: number): number | null {
  if (x < 0 || y < 0 || x >= width || y >= height) return null;
  let luminance = 0;
  for (let i = 0; i < 3; i++) {
    const yi = Math.min(Math.max(y - 1 + i, 0), height - 1);
    for (let j = 0; j < 3; j++) {
      const xj = Math.min(Math.max(x - 1 + j, 0), width - 1);
      const e = ev[yi * width + xj];
      if (!Number.isFinite(e)) return null;
      luminance += 2 ** e * CURSOR_KERNEL[i][j];
    }
  }
  return Math.log2(luminance);
}
