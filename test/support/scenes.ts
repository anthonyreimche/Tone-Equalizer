// Test scenes for the mask: functions of normalised position, so one scene
// renders at any size.

import type { Image } from "../../src/model";

export function fill(width: number, height: number, texel: (x: number, y: number) => readonly [number, number, number]): Image {
  const data = new Float64Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = texel(x, y);
      const o = (y * width + x) * 3;
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
    }
  }
  return { width, height, data };
}

export function flat(width: number, height: number, v: number): Image {
  return fill(width, height, () => [v, v, v]);
}

/** A bright sky over a dark textured subject (a disc) and a mid-grey bar: the
 *  backlit case the tone equalizer exists for. */
export function backlit(width: number, height: number): Image {
  return fill(width, height, (x, y) => {
    const u = (x + 0.5) / width;
    const v = (y + 0.5) / height;
    let base = 0.6 * (0.8 + 0.2 * v);
    if ((u - 0.45) ** 2 + ((v - 0.6) * 0.75) ** 2 < 0.28 ** 2) {
      base = 0.02 * (1 + 0.6 * Math.sin(40 * u) * Math.sin(33 * v));
    } else if (u > 0.8 && u < 0.86) {
      base = 0.15;
    }
    return [base * 1.1, base, base * 0.85];
  });
}

export function scaled(img: Image, k: number): Image {
  return { ...img, data: img.data.map((v) => v * k) };
}

/** Each output pixel is the mean of a 2×2 block; odd trailing rows and columns drop. */
export function downsample2(img: Image): Image {
  const width = Math.floor(img.width / 2);
  const height = Math.floor(img.height / 2);
  const data = new Float64Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let dy = 0; dy < 2; dy++) {
          for (let dx = 0; dx < 2; dx++) sum += img.data[((2 * y + dy) * img.width + 2 * x + dx) * 3 + c];
        }
        data[(y * width + x) * 3 + c] = sum / 4;
      }
    }
  }
  return { width, height, data };
}

/** Mean and standard deviation of log2 over the pixels `pick` keeps. */
export function logStats(values: Float64Array, width: number, pick: (x: number, y: number) => boolean): { mean: number; std: number } {
  let n = 0;
  let sum = 0;
  let sq = 0;
  for (let k = 0; k < values.length; k++) {
    if (!pick(k % width, Math.floor(k / width))) continue;
    const e = Math.log2(values[k]);
    n++;
    sum += e;
    sq += e * e;
  }
  const mean = sum / n;
  return { mean, std: Math.sqrt(Math.max(sq / n - mean * mean, 0)) };
}
