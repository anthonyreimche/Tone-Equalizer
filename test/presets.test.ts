// darktable's thirteen presets, against init_presets run in the harness.

import { describe, expect, it } from "vitest";
import { PRESETS } from "../src/presets";
import { DT_DETAILS, DT_METHOD, V } from "./support/vectors";

describe("PRESETS", () => {
  it("lists darktable's presets in its order, first letter capitalised", () => {
    expect(PRESETS.map((p) => p.name.toLowerCase())).toEqual(V.presets.map((p) => p.name.toLowerCase()));
    PRESETS.forEach((p, i) => expect(p.name).toBe(V.presets[i].name[0].toUpperCase() + V.presets[i].name.slice(1)));
  });

  it.each(V.presets.map((p, i) => [p.name, i] as const))("%s carries darktable's values", (_name, i) => {
    const ref = V.presets[i];
    const p = PRESETS[i].params;
    expect(p.details).toBe(DT_DETAILS[ref.details]);
    expect(p.estimator).toBe(DT_METHOD[ref.method]);
    expect(p.exposureBoost).toBeCloseTo(ref.exposureBoost, 6);
    expect(p.contrastBoost).toBeCloseTo(ref.contrastBoost, 6);
    expect(p.feathering).toBeCloseTo(ref.feathering, 6);
    expect(p.iterations).toBe(ref.iterations);
    expect(p.curveSmoothing).toBe(0);
    p.bands.forEach((b, k) => expect(b).toBeCloseTo(ref.bands[k], 6));
    // "simple tone curve" has blending 0 upstream, unused with no filter; the
    // port keeps the default 5 % there so a switch to a filter starts sane.
    expect(p.blending).toBeCloseTo(ref.blending === 0 ? 5 : ref.blending, 6);
  });
});
