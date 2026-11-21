// Radeon radeonsi runs mediump as fp16: exp2(2.0 * float(levels)) of a mediump
// int overflows from 8 levels, so the exponent goes through a highp float local.
import { describe, expect, it } from "vitest";
import { EIGF_HELPERS_GLSL, GUIDED_HELPERS_GLSL } from "../src/glsl";

describe("teSpacing precision", () => {
  it("takes exp2 of a highp float local in both filters", () => {
    for (const glsl of [EIGF_HELPERS_GLSL, GUIDED_HELPERS_GLSL]) {
      expect(glsl).not.toMatch(/exp2\([^)]*float\(levels\)/);
      expect(glsl).toContain("float fl = float(levels);");
    }
    expect(EIGF_HELPERS_GLSL).toContain("exp2(2.0 * fl)");
    expect(GUIDED_HELPERS_GLSL).toContain("exp2(fl)");
  });
});
