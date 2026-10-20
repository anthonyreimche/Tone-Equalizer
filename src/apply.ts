// The whole effect on an image: the mask, the fitted curve's gain at each
// pixel's mask exposure, and that gain on every channel. An exact no-op while
// all nine bands are 0 or the fit fails, as the stage's `on` gate is.

import { fitCurve, gainAt } from "./curve";
import { maskImage, sigmaOf, type Image, type MaskOptions, type Params } from "./model";

export function applyToneEqualizer(img: Image, p: Params, options?: MaskOptions): Image {
  const fit = fitCurve(p.bands, sigmaOf(p.curveSmoothing));
  if (!p.bands.some((b) => b !== 0) || !fit.valid) return { ...img, data: img.data.slice() };
  const mask = maskImage(img, p, options);
  const data = new Float64Array(img.data.length);
  for (let k = 0; k < mask.length; k++) {
    const gain = gainAt(Math.log2(mask[k]), fit);
    for (let c = 0; c < 3; c++) data[3 * k + c] = img.data[3 * k + c] * gain;
  }
  return { width: img.width, height: img.height, data };
}
