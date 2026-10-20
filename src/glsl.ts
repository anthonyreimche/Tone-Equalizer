// The GPU side of model.ts, formatted from its constants.
//
// A port of darktable master f52993027d (src/iop/toneequal.c,
// src/common/luminance_mask.h, src/common/fast_guided_filter.h,
// src/common/eigf.h), GPL-3.0-or-later, © Aurélien Pierre and the darktable
// authors.
//
// Passes: the host hands each draw the previous draw's three channels through
// readPrev (the stage's input, in linear Rec.2020, on the first draw) and binds
// the last draw as `stageResult`. uPassIndex maps to (iteration, step): step 0
// converts (RGB to the mask on iteration 0, else the previous iteration's
// filter applied per texel); then the statistics chain (M, M², M_raw), whose
// last level turns E[M²] into the variance; for the guided filter, a
// coefficient draw (a, b, M_raw) and the a/b chain. Levels finer than
// SKIP_SPACING pass their state through. The prepass is binary16 (max 65504),
// so a conversion draw stores the statistics capped (STAT_CAP, CARRY_CAP in
// model.ts) and only the per-pixel finish sees the uncapped mask.

import {
  B3,
  CARRY_CAP,
  CENTERS_OPS,
  EIGF_SIGMA_SCALE,
  GAIN_MAX,
  GAIN_MIN,
  MAX_EV,
  MIN_EV,
  MIN_FLOAT,
  SKIP_SPACING,
  STAT_CAP,
} from "./model";

/** A GLSL float literal that always carries a decimal point. */
export function glslLiteral(v: number): string {
  const s = v.toPrecision(10);
  if (/e/i.test(s)) {
    const [mantissa, exponent] = s.split(/e/i);
    const m = mantissa.includes(".") ? mantissa : `${mantissa}.0`;
    return `${m}e${Number(exponent)}`;
  }
  const trimmed = s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, ".0") : `${s}.0`;
  return trimmed;
}

const lit = glslLiteral;
const MIN = lit(MIN_FLOAT);

/** The mask from RGB (luminance_mask.h) and EIGF's linear blend
 *  (eigf_blending_no_mask). The power norm's 0/0 for black becomes a value the
 *  floor catches, as darktable's MAX turns NaN into MIN_FLOAT. */
const MASK_GLSL = `
float teFloor(float v) { return v > ${MIN} ? v : ${MIN}; }
float teNorm(vec3 p) {
  if (fNorm == 0) return length(p);
  if (fNorm == 1) return (p.r + p.g + p.b) / 3.0;
  if (fNorm == 2) return (max(max(p.r, p.g), p.b) + min(min(p.r, p.g), p.b)) / 2.0;
  if (fNorm == 3) return max(max(p.r, p.g), p.b);
  if (fNorm == 4) return abs(p.r) + abs(p.g) + abs(p.b);
  vec3 q = abs(p);
  if (fNorm == 5) {
    float d2 = dot(q, q);
    return d2 > 0.0 ? dot(q * q, q) / d2 : -1.0e30;
  }
  return pow(q.r * q.g * q.b, 1.0 / 3.0);
}
float teMask(vec3 p) {
  float v = (fExposure * teNorm(p) - fFulcrum) * fContrast + fFulcrum;
  return teFloor(v);
}
float teEigfBlend(float m, float avg, float vari) {
  float v = vari / max(avg * m, 1.0e-6);
  float a = v / (v + fEps);
  float o = a * m + (1.0 - a) * avg;
  return teFloor(o);
}
`;

export const PASS_SHARED_GLSL = `${MASK_GLSL}
float teLongEdge() { return floor(max(1.0 / uTexel.x, 1.0 / uTexel.y) + 0.5); }
float teRadius() { return trunc((fDiameter * teLongEdge() - 1.0) / 2.0); }
vec3 teState(float m) {
  float s = min(m, ${lit(STAT_CAP)});
  return vec3(s, s * s, min(m, ${lit(CARRY_CAP)}));
}
`;

const b3 = (d: number) => lit(B3[d + 2]);

export const EIGF_HELPERS_GLSL = `${PASS_SHARED_GLSL}
float teB3(int d) { d = d < 0 ? -d : d; return d == 0 ? ${b3(0)} : (d == 1 ? ${b3(1)} : ${b3(2)}); }
float teSpacing(int levels) {
  float sigma = ${lit(EIGF_SIGMA_SCALE)} * max(teRadius(), 1.0);
  return sqrt(3.0 * sigma * sigma / (exp2(2.0 * float(levels)) - 1.0));
}
vec3 teBlur(vec3 centre, float spacing) {
  vec2 sum = vec2(0.0);
  for (int dy = -2; dy <= 2; dy++) {
    for (int dx = -2; dx <= 2; dx++) {
      vec3 t = readPrev(vUv + vec2(float(dx), float(dy)) * spacing * uTexel);
      sum += teB3(dx) * teB3(dy) * t.xy;
    }
  }
  return vec3(sum, centre.z);
}
`;

export const GUIDED_HELPERS_GLSL = `${PASS_SHARED_GLSL}
float teSpacing(int levels) {
  float r = teRadius();
  float dsr = r < 4.0 ? 1.0 : floor(r / 4.0);
  return 4.0 * (2.0 * dsr + 1.0) / exp2(float(levels));
}
vec3 teBlur(vec3 centre, float spacing) {
  float o = 0.5 * spacing;
  vec2 sum = readPrev(vUv + vec2(-o, -o) * uTexel).xy + readPrev(vUv + vec2(o, -o) * uTexel).xy
           + readPrev(vUv + vec2(-o, o) * uTexel).xy + readPrev(vUv + vec2(o, o) * uTexel).xy;
  return vec3(0.25 * sum, centre.z);
}
`;

const SKIP = lit(SKIP_SPACING);

export const EIGF_PASS_GLSL = `
int levels = fLevels;
int per = levels + 1;
int iteration = uPassIndex / per;
int k = uPassIndex - iteration * per;
if (k == 0) {
  float m = iteration == 0 ? teMask(c) : teEigfBlend(c.z, c.x, c.y);
  c = teState(m);
} else {
  float spacing = teSpacing(levels) * exp2(float(k - 1));
  if (spacing >= ${SKIP}) c = teBlur(c, spacing);
  if (k == levels) c.y = max(c.y - c.x * c.x, 0.0);
}
`;

export const GUIDED_PASS_GLSL = `
int levels = fLevels;
int per = 2 * levels + 2;
int iteration = uPassIndex / per;
int k = uPassIndex - iteration * per;
if (k == 0) {
  float m = iteration == 0 ? teMask(c) : max(c.x * c.z + c.y, ${MIN});
  c = teState(m);
} else if (k == levels + 1) {
  float a = c.y / max(c.y + fEps, 1.0e-15);
  c = vec3(a, c.x - a * c.x, c.z);
} else {
  int level = k <= levels ? k - 1 : k - levels - 2;
  float spacing = teSpacing(levels) * exp2(float(level));
  if (spacing >= ${SKIP}) c = teBlur(c, spacing);
  if (k == levels) c.y = max(c.y - c.x * c.x, 0.0);
}
`;

const gain = CENTERS_OPS.map((centre, j) => `teGauss(e, ${lit(centre)}) * ${j < 4 ? "w0" : "w1"}.${"xyzw"[j % 4]}`).join("\n    + ");

export const INLINE_HELPERS_GLSL = `${MASK_GLSL}
float teGauss(float e, float centre) {
  float d = e - centre;
  return exp(-d * d * gDenom);
}
float teGain(float m) {
  float e = clamp(log2(m), ${lit(MIN_EV)}, ${lit(MAX_EV)});
  float s = ${gain};
  return clamp(s, ${lit(GAIN_MIN)}, ${lit(GAIN_MAX)});
}
`;

/** The filter's finish at the pixel, the published mask, and the gain. No
 *  braces around it: the host assigns the producer `teMaskOut` right after this
 *  code, inside the same block. */
export const INLINE_GLSL = `
float teMaskOut = -1.0;
if (on > 0.5 || probe > 0.5) {
  float m = teMask(lin);
  float mi = m;
  float mp = m;
  if (fMode == 2) {
    mi = fIterations > 1 ? stageResult.z : m;
    mp = teEigfBlend(mi, stageResult.x, stageResult.y);
  } else if (fMode == 1) {
    mp = teFloor(stageResult.x * m + stageResult.y);
  }
  if (fMode != 0 && fAverage == 1) mp = sqrt(mi * mp);
  teMaskOut = mp;
  if (on > 0.5) lin *= teGain(mp);
}
`;

/** mode 1: darktable's mask display (te.c:1020-1061); mode 2: log2 of the mask
 *  over [−16, +8] EV in 16 bits across R and G, validity in B. */
export const VIEW_GLSL = `
float tm = isv_toneEqualizerMask;
if (mode == 1) {
  c = tm > 0.0 ? vec3(sqrt(clamp((tm - 0.00390625) / 0.99609375, 0.0, 1.0))) : vec3(0.5);
} else if (mode == 2) {
  if (tm > 0.0) {
    float q = floor(clamp((log2(tm) + 16.0) / 24.0, 0.0, 1.0) * 65535.0 + 0.5);
    float hi = floor(q / 256.0);
    c = vec3(hi / 255.0, (q - hi * 256.0) / 255.0, 1.0);
  } else {
    c = vec3(0.0);
  }
}
`;
