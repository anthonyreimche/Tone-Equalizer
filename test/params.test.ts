// The bag contract: darktable's defaults read as an all-zero bag, the GPU keys
// derive from the edit and stay 0 while every band is 0, and a bag that
// disagrees is re-derived.

import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS, drawCounts, type Params } from "../src/model";
import {
  DERIVED_KEYS,
  EDIT_KEYS,
  HARD,
  MASK_VARIABLE,
  PROBE_KEY,
  STAGE_ID,
  VIEW_MODE_KEY,
  VIEW_STAGE_ID,
  deriveAll,
  editPatch,
  isActive,
  probePatch,
  qualified,
  readParams,
  rederivePatch,
  resetPatch,
  stagePrefix4,
  type Bag,
} from "../src/params";

const with_ = (over: Partial<Params>): Params => ({ ...DEFAULT_PARAMS, ...over });
const SOME: Params = with_({
  bands: [0.5, 0.3, 0, 0, -0.2, -0.4, -0.6, 0, 0.1],
  curveSmoothing: 0.25,
  exposureBoost: -1.57,
  contrastBoost: 0.5,
  details: "guided",
  estimator: "power",
  iterations: 3,
  blending: 12.5,
  feathering: 500,
});

describe("ids", () => {
  it("keeps the two stages' GLSL prefixes apart", () => {
    expect(STAGE_ID).toBe("tone-equalizer.correction");
    expect(VIEW_STAGE_ID).toBe("tone-equalizer.mask-view");
    expect(stagePrefix4(STAGE_ID)).toBe("7xwi");
    expect(stagePrefix4(VIEW_STAGE_ID)).toBe("10z0");
    expect(MASK_VARIABLE).toBe("toneEqualizerMask");
    expect(VIEW_MODE_KEY).toBe("tone-equalizer.mask-view.mode");
    expect(PROBE_KEY).toBe("tone-equalizer.correction.probe");
  });
});

describe("the edit in the bag", () => {
  it("stores darktable's defaults as zeros", () => {
    const patch = editPatch(DEFAULT_PARAMS);
    expect(Object.keys(patch).sort()).toEqual(EDIT_KEYS.map(qualified).sort());
    for (const v of Object.values(patch)) expect(v).toBe(0);
  });

  it("round-trips", () => {
    expect(readParams(editPatch(SOME))).toEqual(SOME);
  });

  it("reads defaults for missing or foreign values and clamps to darktable's hard ranges", () => {
    expect(readParams({})).toEqual(DEFAULT_PARAMS);
    const p = readParams({
      [qualified("b0")]: "3",
      [qualified("b1")]: 9,
      [qualified("feathering")]: 1e9,
      [qualified("diameter")]: -50,
      [qualified("details")]: 7,
      [qualified("diffusion")]: 2.6,
      [qualified("smoothing")]: Number.NaN,
    });
    expect(p.bands[0]).toBe(0);
    expect(p.bands[1]).toBe(2);
    expect(p.feathering).toBe(10000);
    expect(p.blending).toBe(0.01);
    expect(p.details).toBe("eigf");
    expect(p.iterations).toBe(4);
    expect(p.curveSmoothing).toBe(0);
  });

  it("reads the default for infinities, null and arrays", () => {
    for (const junk of [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, null, [1], {}, true]) {
      const bag = Object.fromEntries(EDIT_KEYS.map((key) => [qualified(key), junk]));
      expect(readParams(bag)).toEqual(DEFAULT_PARAMS);
    }
  });
});

describe("deriveAll", () => {
  it("writes every derived key as 0 while every band is 0", () => {
    const patch = deriveAll(with_({ feathering: 20, blending: 10, details: "guided" }));
    for (const key of DERIVED_KEYS) {
      const v = patch[qualified(key)];
      if (Array.isArray(v)) expect(v.every((x) => x === 0)).toBe(true);
      else expect(v).toBe(0);
    }
  });

  it("is all zeros for a reset", () => {
    for (const v of Object.values(resetPatch())) {
      if (Array.isArray(v)) expect(v.every((x) => x === 0)).toBe(true);
      else expect(v).toBe(0);
    }
  });

  it("derives the GPU keys from an active edit", () => {
    const patch = deriveAll(SOME);
    expect(patch[qualified("on")]).toBe(1);
    expect(patch[qualified("fMode")]).toBe(1);
    expect(patch[qualified("fAverage")]).toBe(0);
    expect(patch[qualified("fIterations")]).toBe(3);
    expect(patch[qualified("fDrawsEigf")]).toBe(0);
    expect(patch[qualified("fDrawsGuided")]).toBe(drawCounts(SOME).guided);
    expect(patch[qualified("fDiameter")]).toBeCloseTo(0.125, 12);
    expect(patch[qualified("fEps")]).toBeCloseTo(1 / 500, 12);
    expect(patch[qualified("fExposure")]).toBeCloseTo(2 ** -1.57, 12);
    expect(patch[qualified("fFulcrum")]).toBe(2 ** -4);
    expect(patch[qualified("fContrast")]).toBeCloseTo(2 ** 0.5, 12);
    expect(patch[qualified("fNorm")]).toBe(5);
    expect(patch[qualified("w0")]).toHaveLength(4);
    expect(patch[qualified("w1")]).toHaveLength(4);
    expect(patch[qualified("gDenom")]).toBeGreaterThan(0);
  });

  it("drops the stretch outside the plain guided modes", () => {
    const patch = deriveAll({ ...SOME, details: "avg-eigf" });
    expect(patch[qualified("fMode")]).toBe(2);
    expect(patch[qualified("fAverage")]).toBe(1);
    expect(patch[qualified("fFulcrum")]).toBe(0);
    expect(patch[qualified("fContrast")]).toBe(1);
  });

  it("treats a failed fit as idle", () => {
    expect(isActive(SOME)).toBe(true);
    expect(isActive(SOME, { weights: [], sigma: Math.SQRT2, valid: false })).toBe(false);
  });
});

describe("probePatch", () => {
  it("derives the mask keys as if a band were set, and turns the probe on", () => {
    const patch = probePatch(DEFAULT_PARAMS);
    expect(patch[PROBE_KEY]).toBe(1);
    expect(patch[qualified("fDrawsEigf")]).toBe(drawCounts(DEFAULT_PARAMS).eigf);
    expect(patch[qualified("on")]).toBeUndefined();
  });
});

describe("rederivePatch", () => {
  it("is null for a bag without the stage, or one that agrees", () => {
    expect(rederivePatch({ "other.stage.amount": 1 })).toBeNull();
    expect(rederivePatch(deriveAll(SOME))).toBeNull();
  });

  it("re-derives a bag whose GPU keys disagree with its edit", () => {
    const stale = { ...deriveAll(SOME), [qualified("fDrawsGuided")]: 0, [qualified("on")]: 0 };
    expect(rederivePatch(stale)).toEqual(deriveAll(SOME));
    const partial = { [qualified("b4")]: 1 };
    expect(rederivePatch(partial)).toEqual(deriveAll(with_({ bands: [0, 0, 0, 0, 1, 0, 0, 0, 0] })));
  });
});

// The edit is stored as offsets from darktable's defaults, and base + (v - base)
// is not always bit-exact; the GPU keys must come from what the bag reads back,
// or the writer's own bag looks stale to rederivePatch.
describe("a bag agrees with the edit that wrote it", () => {
  const BLENDINGS = [HARD.blending.min, ...Array.from({ length: 1000 }, (_, i) => (i + 1) / 10)];
  const FEATHERINGS = [
    ...Array.from({ length: 30000 }, (_, i) => (i + 1) / 100),
    HARD.feathering.min,
    500,
    1000,
    2500,
    9999.99,
    HARD.feathering.max,
  ];
  const ACTIVE = SOME.bands;

  it("is not re-derived, for blending in 0.1 steps over its whole range", () => {
    const stale = BLENDINGS.filter((blending) => rederivePatch(deriveAll({ ...SOME, bands: ACTIVE, blending })) !== null);
    expect(stale).toEqual([]);
  });

  it("is not re-derived, for feathering in 0.01 steps from its minimum", () => {
    const stale = FEATHERINGS.filter((feathering) => rederivePatch(deriveAll({ ...SOME, bands: ACTIVE, feathering })) !== null);
    expect(stale).toEqual([]);
  });

  it("keeps the edit the user set, to the bit", () => {
    const moved = [
      ...BLENDINGS.map((blending) => ({ ...SOME, blending })),
      ...FEATHERINGS.map((feathering) => ({ ...SOME, feathering })),
    ].filter((p) => {
      const written = deriveAll(p);
      const set = editPatch(p);
      return EDIT_KEYS.some((key) => !Object.is(written[qualified(key)], set[qualified(key)]));
    });
    expect(moved).toEqual([]);
  });

  it("is not re-derived at the hard minimums and maximums", () => {
    for (const over of [
      { feathering: HARD.feathering.min },
      { blending: HARD.blending.min },
      { feathering: HARD.feathering.min, blending: HARD.blending.min },
      { feathering: HARD.feathering.max, blending: HARD.blending.max },
      { iterations: HARD.iterations.max },
      { iterations: HARD.iterations.min },
    ]) {
      expect(rederivePatch(deriveAll({ ...SOME, ...over }))).toBeNull();
    }
  });

  it("is not re-derived for an edit outside the hard ranges, which is stored clamped", () => {
    const wild = { ...SOME, feathering: -1e9, blending: -1e9, iterations: 99, exposureBoost: 99, bands: SOME.bands.map((b) => b * 40) };
    const patch = deriveAll(wild);
    expect(rederivePatch(patch)).toBeNull();
    expect(readParams(patch)).toEqual(readParams(editPatch(readParams(patch))));
    expect(readParams(patch).feathering).toBeCloseTo(HARD.feathering.min, 12);
    expect(readParams(patch).blending).toBeCloseTo(HARD.blending.min, 12);
  });

  it("stores each edit key at a fixpoint of reading it back", () => {
    const stored = (p: Params) => editPatch(readParams(editPatch(p)));
    const drifting = [
      with_({ feathering: -1e9 }),
      with_({ blending: -1e9 }),
      with_({ feathering: 1e9, blending: 1e9 }),
      with_({ feathering: HARD.feathering.min, blending: HARD.blending.min }),
      with_({ iterations: 2.6 }),
      ...BLENDINGS.map((blending) => with_({ blending })),
      ...FEATHERINGS.map((feathering) => with_({ feathering })),
    ].filter((p) => {
      const once = stored(p);
      const twice = editPatch(readParams(once));
      return Object.keys(once).some((key) => !Object.is(twice[key], once[key]));
    });
    expect(drifting).toEqual([]);
  });

  const settles = (bag: Bag) => {
    const first = rederivePatch(bag);
    return first === null || rederivePatch({ ...bag, ...first }) === null;
  };

  it("settles after one write, for bags outside the hard ranges", () => {
    const bags: Bag[] = [
      { ...deriveAll(SOME), [qualified("feathering")]: -1e9, [qualified("diameter")]: -1e9 },
      { [qualified("b4")]: 1, [qualified("feathering")]: -1e9 },
      { [qualified("b4")]: 1, [qualified("diameter")]: -1e9 },
      { [qualified("b4")]: 1, [qualified("feathering")]: 1e9, [qualified("diameter")]: 1e9 },
      { [qualified("b4")]: 1, [qualified("diffusion")]: 2.6 },
      { [qualified("b4")]: 1, [qualified("diffusion")]: 1e9 },
      { [qualified("b4")]: 1, [qualified("feathering")]: HARD.feathering.min - 1 },
      { [qualified("b4")]: 1, [qualified("diameter")]: HARD.blending.min - 5 },
    ];
    for (const bag of bags) {
      expect(rederivePatch(bag)).not.toBeNull();
      expect(settles(bag)).toBe(true);
    }
  });

  it("settles after one write, for bags of mixed junk", () => {
    let seed = 0x9e3779b9;
    const next = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const junk = ["3", null, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1e9, -1e9, 2.6, 7, 0, -0.99, [1]];
    const value = (): unknown => (next() < 0.5 ? junk[Math.floor(next() * junk.length)] : (next() - 0.5) * 6);
    const unsettled: Bag[] = [];
    for (let n = 0; n < 4000; n++) {
      const bag: Bag = {};
      for (const key of EDIT_KEYS) if (next() < 0.5) bag[qualified(key)] = value();
      for (const key of DERIVED_KEYS) if (next() < 0.3) bag[qualified(key)] = value();
      if (!settles(bag)) unsettled.push(bag);
    }
    expect(unsettled).toEqual([]);
  });
});

describe("the keys a patch carries", () => {
  it("are exactly the edit keys and the derived keys, active or idle", () => {
    const all = [...EDIT_KEYS, ...DERIVED_KEYS].map(qualified).sort();
    expect(Object.keys(deriveAll(SOME)).sort()).toEqual(all);
    expect(Object.keys(deriveAll(DEFAULT_PARAMS)).sort()).toEqual(all);
  });
});
