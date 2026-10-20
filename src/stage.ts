// The two GPU stages. The correction stage builds the mask in its prepasses,
// finishes it per pixel, applies the curve, and publishes the mask through the
// inter-stage variable; the view stage, last in the pipeline, writes the mask
// out only when a capture patch switches it on.

import {
  EIGF_HELPERS_GLSL,
  EIGF_PASS_GLSL,
  GUIDED_HELPERS_GLSL,
  GUIDED_PASS_GLSL,
  INLINE_GLSL,
  INLINE_HELPERS_GLSL,
  VIEW_GLSL,
} from "./glsl";
import { EIGF_MAX_DRAWS, GUIDED_MAX_DRAWS } from "./model";
import { BAND_KEYS, MASK_VARIABLE, STAGE_ID, VIEW_STAGE_ID } from "./params";
import type { ProcessingStageContribution, UniformDeclaration } from "./safelight";

const BAND_LABELS = ["−8 EV", "−7 EV", "−6 EV", "−5 EV", "−4 EV", "−3 EV", "−2 EV", "−1 EV", "+0 EV"];

const float = (key: string, label?: string, range?: UniformDeclaration["range"]): UniformDeclaration => ({
  key,
  glslType: "float",
  default: 0,
  ...(range ? { range } : {}),
  ...(label ? { label } : {}),
});
const int = (key: string, label?: string, range?: UniformDeclaration["range"]): UniformDeclaration => ({
  ...float(key, label, range),
  glslType: "int",
});
const vec4 = (key: string): UniformDeclaration => ({ key, glslType: "vec4", default: [0, 0, 0, 0] });

/** The edit's keys: unused by the GLSL, declared so the param registry and the
 *  preset dialog know them. Ranges are in the stored (offset) units. */
export const EDIT_UNIFORMS: UniformDeclaration[] = [
  ...BAND_KEYS.map((key, i) => float(key, BAND_LABELS[i], { min: -2, max: 2, step: 0.01 })),
  float("smoothing", "curve smoothing", { min: -2.33, max: 1.67, step: 0.01 }),
  float("exposureBoost", "mask exposure compensation", { min: -16, max: 16, step: 0.01 }),
  float("contrastBoost", "mask contrast compensation", { min: -16, max: 16, step: 0.01 }),
  int("details", "preserve details", { min: 0, max: 4, step: 1 }),
  int("estimator", "luminance estimator", { min: 0, max: 6, step: 1 }),
  int("diffusion", "filter diffusion", { min: 0, max: 19, step: 1 }),
  float("diameter", "smoothing diameter", { min: -4.99, max: 95, step: 0.1 }),
  float("feathering", "edges refinement/feathering", { min: -0.99, max: 9999, step: 0.01 }),
];

/** The keys the mask code reads in the passes and in the inline alike; one list, so the two programs cannot drift. */
const MASK_UNIFORMS: UniformDeclaration[] = [
  float("fEps"),
  float("fExposure"),
  float("fFulcrum"),
  float("fContrast"),
  int("fNorm"),
];

/** Read by the inline. */
export const INLINE_UNIFORMS: UniformDeclaration[] = [
  float("on"),
  float("probe"),
  vec4("w0"),
  vec4("w1"),
  float("gDenom"),
  int("fMode"),
  int("fAverage"),
  int("fIterations"),
  ...MASK_UNIFORMS,
];

/** Read by both passes; each pass adds its own draw-count key. */
export const PASS_UNIFORMS: UniformDeclaration[] = [
  int("fLevels"),
  float("fDiameter"),
  ...MASK_UNIFORMS,
];

export function correctionStage(): ProcessingStageContribution {
  return {
    id: STAGE_ID,
    name: "Tone Equalizer",
    phase: "scene-linear",
    priority: 50,
    reads: "current",
    space: { encoding: "linear", primaries: "rec2020" },
    glsl: INLINE_GLSL,
    helpers: INLINE_HELPERS_GLSL,
    uniforms: [...EDIT_UNIFORMS, ...INLINE_UNIFORMS],
    passes: [
      {
        glsl: EIGF_PASS_GLSL,
        helpers: EIGF_HELPERS_GLSL,
        iterations: { key: "fDrawsEigf", max: EIGF_MAX_DRAWS },
        uniforms: [...PASS_UNIFORMS, int("fDrawsEigf")],
      },
      {
        glsl: GUIDED_PASS_GLSL,
        helpers: GUIDED_HELPERS_GLSL,
        iterations: { key: "fDrawsGuided", max: GUIDED_MAX_DRAWS },
        uniforms: [...PASS_UNIFORMS, int("fDrawsGuided")],
      },
    ],
    produces: [{ name: MASK_VARIABLE, glslType: "float", producer: "teMaskOut" }],
    presetScope: "global",
  };
}

export function viewStage(): ProcessingStageContribution {
  return {
    id: VIEW_STAGE_ID,
    name: "Tone Equalizer mask view",
    phase: "output-encode",
    priority: 100000,
    // Declared although it is the display domain's own space: on a version 2 photo the host clips the input of a
    // display stage that declares none (needsClippedInput in stage-injection.ts).
    space: { encoding: "perceptual", primaries: "rec709" },
    glsl: VIEW_GLSL,
    // Set only by capture patches. The host still lists it (api.params.list())
    // and offers the stage under the Save Preset dialog's "Show all"; unlabelled
    // and per-image, it is never offered by default or pre-selected there.
    uniforms: [{ key: "mode", glslType: "int", default: 0 }],
    consumes: [MASK_VARIABLE],
    presetScope: "per-image",
  };
}

export function allStages(): ProcessingStageContribution[] {
  return [correctionStage(), viewStage()];
}
