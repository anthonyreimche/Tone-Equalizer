// The two stages' contracts: ids, phases, the bag-driven draw counts, the
// inter-stage variable, uniform keys matching the bag contract, GLSL formatted
// from the model's constants, and the per-draw fetch budget the GPU watchdogs
// care about.

import { describe, expect, it } from "vitest";
import {
  CARRY_CAP,
  CENTERS_OPS,
  EIGF_MAX_DRAWS,
  EIGF_SIGMA_SCALE,
  GAIN_MAX,
  GAIN_MIN,
  GUIDED_MAX_DRAWS,
  MAX_EV,
  MIN_EV,
  MIN_FLOAT,
  SKIP_SPACING,
  STAT_CAP,
} from "../src/model";
import {
  EIGF_HELPERS_GLSL,
  EIGF_PASS_GLSL,
  GUIDED_HELPERS_GLSL,
  GUIDED_PASS_GLSL,
  INLINE_GLSL,
  INLINE_HELPERS_GLSL,
  VIEW_GLSL,
  glslLiteral,
} from "../src/glsl";
import { DERIVED_KEYS, EDIT_KEYS, MASK_VARIABLE, STAGE_ID, VIEW_MODE_KEY, VIEW_STAGE_ID } from "../src/params";
import { allStages, correctionStage, viewStage } from "../src/stage";
import { fetchBudget, inlineFetches } from "./support/fetch-budget";

describe("glslLiteral", () => {
  it.each([
    [1, "1.0"],
    [0.25, "0.25"],
    [2 ** -16, "0.00001525878906"],
    [-8, "-8.0"],
  ])("formats %s as %s", (v, s) => expect(glslLiteral(v)).toBe(s));
});

describe("the correction stage", () => {
  const stage = correctionStage();

  it("is scene-linear, reads the current image in linear Rec.2020 and publishes the mask", () => {
    expect(stage.id).toBe(STAGE_ID);
    expect(stage.phase).toBe("scene-linear");
    expect(stage.priority).toBe(50);
    expect(stage.reads).toBe("current");
    expect(stage.space).toEqual({ encoding: "linear", primaries: "rec2020" });
    expect(stage.presetScope).toBe("global");
    expect(stage.produces).toEqual([{ name: MASK_VARIABLE, glslType: "float", producer: "teMaskOut" }]);
  });

  it("runs an EIGF pass and a guided-filter pass, each counted from the bag", () => {
    expect(stage.passes?.map((p) => p.iterations)).toEqual([
      { key: "fDrawsEigf", max: EIGF_MAX_DRAWS },
      { key: "fDrawsGuided", max: GUIDED_MAX_DRAWS },
    ]);
    for (const pass of stage.passes ?? []) {
      const own = (pass.uniforms ?? []).map((u) => u.key);
      const count = pass.iterations;
      expect(typeof count === "object" && own.includes(count.key)).toBe(true);
    }
  });

  it("declares every edit and derived key, all zero by default", () => {
    const keys = new Set([...stage.uniforms, ...(stage.passes ?? []).flatMap((p) => p.uniforms ?? [])].map((u) => u.key));
    for (const key of [...EDIT_KEYS, ...DERIVED_KEYS, "probe"]) expect(keys.has(key)).toBe(true);
    for (const u of [...stage.uniforms, ...(stage.passes ?? []).flatMap((p) => p.uniforms ?? [])]) {
      if (Array.isArray(u.default)) expect(u.default.every((v) => v === 0)).toBe(true);
      else expect(u.default).toBe(0);
    }
  });

  it("formats the GLSL from the model's constants", () => {
    expect(INLINE_HELPERS_GLSL).toContain(glslLiteral(CENTERS_OPS[1]));
    expect(INLINE_HELPERS_GLSL).toContain(glslLiteral(MIN_FLOAT));
    expect(EIGF_PASS_GLSL).toContain("teBlur(c, spacing)");
  });

  it("formats the sigma scale and the skip spacing from the model", () => {
    expect(EIGF_HELPERS_GLSL).toContain(glslLiteral(EIGF_SIGMA_SCALE));
    expect(EIGF_PASS_GLSL).toContain(`spacing >= ${glslLiteral(SKIP_SPACING)}`);
    expect(GUIDED_PASS_GLSL).toContain(`spacing >= ${glslLiteral(SKIP_SPACING)}`);
  });

  it("caps the stored state at the binary16 limits, the same way in both passes", () => {
    for (const helpers of [EIGF_HELPERS_GLSL, GUIDED_HELPERS_GLSL]) {
      expect(helpers).toContain(`min(m, ${glslLiteral(STAT_CAP)})`);
      expect(helpers).toContain(`min(m, ${glslLiteral(CARRY_CAP)})`);
    }
    expect(EIGF_PASS_GLSL).toContain("c = teState(m);");
    expect(GUIDED_PASS_GLSL).toContain("c = teState(m);");
    expect(INLINE_GLSL).not.toContain(glslLiteral(STAT_CAP));
  });

  it("formats the gain window and clamp from the model", () => {
    expect(INLINE_HELPERS_GLSL).toContain(`clamp(log2(m), ${glslLiteral(MIN_EV)}, ${glslLiteral(MAX_EV)})`);
    expect(INLINE_HELPERS_GLSL).toContain(`clamp(s, ${glslLiteral(GAIN_MIN)}, ${glslLiteral(GAIN_MAX)})`);
  });

  it("floors with the same ternary as the model where it has one", () => {
    const floor = `v > ${glslLiteral(MIN_FLOAT)} ? v : ${glslLiteral(MIN_FLOAT)}`;
    expect(INLINE_HELPERS_GLSL).toContain(floor);
    expect(INLINE_GLSL).toContain("teFloor(stageResult.x * m + stageResult.y)");
    expect(INLINE_GLSL).not.toMatch(/max\(stageResult/);
  });

  it("keeps every float literal decimal and avoids preprocessor gates", () => {
    for (const glsl of [EIGF_HELPERS_GLSL, EIGF_PASS_GLSL, GUIDED_HELPERS_GLSL, GUIDED_PASS_GLSL, INLINE_HELPERS_GLSL, INLINE_GLSL, VIEW_GLSL]) {
      expect(glsl).not.toMatch(/#(define|ifdef|if)\b/);
      expect(glsl).not.toMatch(/[^\w.]\d+\s*\/\s*\d+[^\w.]/);
    }
  });

  it("names no local, parameter or helper like a uniform key", () => {
    const keys = [...stage.uniforms, ...(stage.passes ?? []).flatMap((p) => p.uniforms ?? [])].map((u) => u.key);
    const declared = /\b(?:float|int|vec[234]|bool)\s+(\w+)\s*(?:[=;,)(])/g;
    for (const glsl of [EIGF_HELPERS_GLSL, EIGF_PASS_GLSL, GUIDED_HELPERS_GLSL, GUIDED_PASS_GLSL, INLINE_HELPERS_GLSL, INLINE_GLSL]) {
      for (const m of glsl.matchAll(declared)) expect(keys).not.toContain(m[1]);
    }
  });

  it("stays at 26 fetches per EIGF draw, 5 per guided draw, none inline", () => {
    expect(fetchBudget(EIGF_PASS_GLSL, EIGF_HELPERS_GLSL)).toBe(26);
    expect(fetchBudget(GUIDED_PASS_GLSL, GUIDED_HELPERS_GLSL)).toBe(5);
    expect(inlineFetches(INLINE_GLSL, INLINE_HELPERS_GLSL)).toBe(0);
  });
});

describe("the view stage", () => {
  const stage = viewStage();

  it("runs last, consumes the mask, and only a capture patch switches it", () => {
    expect(stage.id).toBe(VIEW_STAGE_ID);
    expect(stage.phase).toBe("output-encode");
    expect(stage.priority).toBe(100000);
    expect(stage.consumes).toEqual([MASK_VARIABLE]);
    expect(stage.uniforms).toEqual([{ key: "mode", glslType: "int", default: 0 }]);
    expect(VIEW_MODE_KEY).toBe(`${stage.id}.${stage.uniforms[0].key}`);
    expect(stage.passes).toBeUndefined();
    expect(inlineFetches(VIEW_GLSL, "")).toBe(0);
    expect(VIEW_GLSL).toContain(`isv_${MASK_VARIABLE}`);
  });

  it("keeps its switch out of presets: no label, per-image", () => {
    expect(stage.uniforms.every((u) => u.label === undefined)).toBe(true);
    expect(stage.presetScope).toBe("per-image");
  });

  it("declares the display domain's own working space", () => {
    expect(stage.space).toEqual({ encoding: "perceptual", primaries: "rec709" });
  });

  it("names no local like its uniform key", () => {
    const keys = stage.uniforms.map((u) => u.key);
    for (const m of VIEW_GLSL.matchAll(/\b(?:float|int|vec[234]|bool)\s+(\w+)\s*(?:[=;,)(])/g)) expect(keys).not.toContain(m[1]);
  });

  it("registers after the correction stage", () => {
    expect(allStages().map((s) => s.id)).toEqual([STAGE_ID, VIEW_STAGE_ID]);
  });
});
