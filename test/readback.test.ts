// The probe: its bag patch, the decoding of the view stage's 16-bit encoding
// (never resampled), and the sampler that follows the develop store while the
// panel is mounted.

import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { DEFAULT_PARAMS, drawCounts } from "../src/model";
import { PROBE_KEY, VIEW_MODE_KEY, deriveAll, qualified } from "../src/params";
import { decodeProbe, maskViewPatch, probeBag, probeSignature, startLiveProbe, startProbe, type ProbeDeps, type Readback } from "../src/readback";
import { initRuntime } from "../src/runtime";
import type { DevelopParams, DevelopStoreState } from "../src/safelight";
import { initStore, store, type Probe } from "../src/store";
import { fakeApi, fakeBitmap } from "./support/fake-api";

let warn: MockInstance<typeof console.warn>;

beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

/** A bitmap whose close() can be asserted on. */
function closable() {
  const bitmap = fakeBitmap();
  return { bitmap, close: vi.spyOn(bitmap, "close") };
}

/** The bytes the view stage writes for an exposure, as the GPU stores them. */
function encode(ev: number): [number, number, number, number] {
  const q = Math.floor(Math.min(Math.max((ev + 16) / 24, 0), 1) * 65535 + 0.5);
  return [Math.floor(q / 256), q % 256, 255, 255];
}

describe("decodeProbe", () => {
  it("recovers the exposure to the encoding step, and marks invalid pixels", () => {
    const evs = [-12.3, -4, -0.02, 3.5];
    const bytes = new Uint8ClampedArray([...evs.flatMap(encode), 0, 0, 0, 255]);
    const out = decodeProbe(bytes, 5, 1);
    evs.forEach((ev, k) => expect(Math.abs(out[k] - ev)).toBeLessThanOrEqual(24 / 65535));
    expect(out[4]).toBeNaN();
  });
});

describe("the probe's bag", () => {
  it("keeps the photo's bag, derives the mask keys as if a band were set, and encodes", () => {
    const bag = { ...deriveAll(DEFAULT_PARAMS), "other.stage.amount": 0.5 };
    const out = probeBag(bag);
    expect(out["other.stage.amount"]).toBe(0.5);
    expect(out[PROBE_KEY]).toBe(1);
    expect(out[VIEW_MODE_KEY]).toBe(2);
    expect(out[qualified("fDrawsEigf")]).toBe(drawCounts(DEFAULT_PARAMS).eigf);
    expect(out[qualified("on")]).toBe(0);
  });

  it("asks the view stage for the mask display for a capture", () => {
    const out = maskViewPatch(deriveAll(DEFAULT_PARAMS));
    expect(out[VIEW_MODE_KEY]).toBe(1);
    expect(out[PROBE_KEY]).toBe(1);
  });
});

describe("startProbe", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const readback = (): Readback => ({ data: new Uint8ClampedArray([...encode(-4), ...encode(-3)]), width: 2, height: 1 });

  it("probes on start and after each settled render, and publishes the decoded mask", async () => {
    const rig = fakeApi({}, async () => fakeBitmap());
    const published: (Probe | null)[] = [];
    const stop = startProbe({
      develop: rig.develop,
      render: (id, params, bag) => rig.api.develop.renderPhotoFrame(id, params, bag, { lossless: true }),
      readback,
      publish: (p) => published.push(p),
      throttleMs: 150,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(rig.renders).toHaveLength(1);
    expect(rig.renders[0][VIEW_MODE_KEY]).toBe(2);
    expect(published[0]?.ev[0]).toBeCloseTo(-4, 3);
    expect(published[0]?.histogram?.count).toBe(2);
    rig.develop.setState({ histogram: {} } as Partial<DevelopStoreState>);
    await vi.advanceTimersByTimeAsync(200);
    expect(rig.renders).toHaveLength(2);
    stop();
    rig.develop.setState({ histogram: {} } as Partial<DevelopStoreState>);
    await vi.advanceTimersByTimeAsync(500);
    expect(rig.renders).toHaveLength(2);
  });

  it("publishes nothing usable for a blank frame or a failed render, and clears when the photo closes", async () => {
    const rig = fakeApi();
    const published: (Probe | null)[] = [];
    let fail = false;
    startProbe({
      develop: rig.develop,
      render: async () => {
        if (fail) throw new Error("no renderer");
        return null;
      },
      readback,
      publish: (p) => published.push(p),
      throttleMs: 0,
    });
    await vi.advanceTimersByTimeAsync(0);
    fail = true;
    rig.develop.setState({ histogram: {} } as Partial<DevelopStoreState>);
    await vi.advanceTimersByTimeAsync(0);
    rig.develop.setState({ photoId: null });
    await vi.advanceTimersByTimeAsync(0);
    expect(published).toEqual([null, null, null]);
  });

  it("drops a frame whose photo was switched away from mid-flight, and probes the new photo", async () => {
    const rig = fakeApi();
    const late = deferred<ImageBitmap | null>();
    const old = closable();
    const next = closable();
    const render = vi.fn<ProbeDeps["render"]>().mockReturnValueOnce(late.promise).mockResolvedValue(next.bitmap);
    const read = vi.fn((_bitmap: ImageBitmap) => readback());
    const published: (Probe | null)[] = [];
    startProbe({ develop: rig.develop, render, readback: read, publish: (p) => published.push(p), throttleMs: 0 });
    await vi.advanceTimersByTimeAsync(0);
    rig.develop.setState({ photoId: "p2" });
    late.resolve(old.bitmap);
    await vi.advanceTimersByTimeAsync(0);
    expect(old.close).toHaveBeenCalledTimes(1);
    expect(render.mock.calls.map(([id]) => id)).toEqual(["p1", "p2"]);
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith(next.bitmap);
    expect(published.map((p) => p === null)).toEqual([true, false]);
  });

  it("clears the previous photo's settled probe on a photo switch, before the new photo's first frame lands", async () => {
    const rig = fakeApi();
    const second = deferred<ImageBitmap | null>();
    const render = vi.fn<ProbeDeps["render"]>().mockResolvedValueOnce(fakeBitmap()).mockReturnValueOnce(second.promise);
    const published: (Probe | null)[] = [];
    startProbe({ develop: rig.develop, render, readback, publish: (p) => published.push(p), throttleMs: 0 });
    await vi.advanceTimersByTimeAsync(0);
    expect(published.map((p) => p === null)).toEqual([false]);
    rig.develop.setState({ photoId: "p2" });
    await vi.advanceTimersByTimeAsync(0);
    expect(render.mock.calls.map(([id]) => id)).toEqual(["p1", "p2"]);
    expect(published.map((p) => p === null)).toEqual([false, true]);
    second.resolve(fakeBitmap());
    await vi.advanceTimersByTimeAsync(0);
    expect(published.map((p) => p === null)).toEqual([false, true, false]);
  });

  it("drops a frame whose photo was closed mid-flight", async () => {
    const rig = fakeApi();
    const late = deferred<ImageBitmap | null>();
    const old = closable();
    const read = vi.fn((_bitmap: ImageBitmap) => readback());
    const published: (Probe | null)[] = [];
    startProbe({ develop: rig.develop, render: () => late.promise, readback: read, publish: (p) => published.push(p), throttleMs: 0 });
    await vi.advanceTimersByTimeAsync(0);
    rig.develop.setState({ photoId: null });
    late.resolve(old.bitmap);
    await vi.advanceTimersByTimeAsync(0);
    expect(old.close).toHaveBeenCalledTimes(1);
    expect(read).not.toHaveBeenCalled();
    expect(published).toEqual([null]);
  });

  it("closes a frame that lands after stop, and publishes nothing for it", async () => {
    const rig = fakeApi();
    const late = deferred<ImageBitmap | null>();
    const frame = closable();
    const read = vi.fn((_bitmap: ImageBitmap) => readback());
    const published: (Probe | null)[] = [];
    const stop = startProbe({ develop: rig.develop, render: () => late.promise, readback: read, publish: (p) => published.push(p), throttleMs: 0 });
    await vi.advanceTimersByTimeAsync(0);
    stop();
    const publishedAtStop = published.length;
    late.resolve(frame.bitmap);
    await vi.advanceTimersByTimeAsync(0);
    expect(frame.close).toHaveBeenCalledTimes(1);
    expect(read).not.toHaveBeenCalled();
    expect(published).toHaveLength(publishedAtStop);
  });

  it("publishes null on stop, so an unmounted panel leaves no frozen probe", async () => {
    const rig = fakeApi({}, async () => fakeBitmap());
    const published: (Probe | null)[] = [];
    const stop = startProbe({
      develop: rig.develop,
      render: (id, params, bag) => rig.api.develop.renderPhotoFrame(id, params, bag, { lossless: true }),
      readback,
      publish: (p) => published.push(p),
      throttleMs: 0,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(published[published.length - 1]).not.toBeNull();
    stop();
    expect(published[published.length - 1]).toBeNull();
  });

  it("closes the frame when the readback throws, and publishes null", async () => {
    const rig = fakeApi();
    const frame = closable();
    const published: (Probe | null)[] = [];
    startProbe({
      develop: rig.develop,
      render: async () => frame.bitmap,
      readback: () => {
        throw new Error("canvas lost");
      },
      publish: (p) => published.push(p),
      throttleMs: 0,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(frame.close).toHaveBeenCalledTimes(1);
    expect(published).toEqual([null]);
  });

  describe("when the probe cannot read a frame", () => {
    type Outcome = "no frame" | "throws" | "blank" | "readback throws" | "ok";

    function start(initial: Outcome) {
      const rig = fakeApi();
      const state = { outcome: initial };
      startProbe({
        develop: rig.develop,
        render: async () => {
          if (state.outcome === "throws") throw new Error("context lost");
          return state.outcome === "no frame" ? null : fakeBitmap();
        },
        readback: () => {
          if (state.outcome === "readback throws") throw new Error("canvas lost");
          return state.outcome === "blank" ? null : readback();
        },
        publish: () => undefined,
        throttleMs: 0,
      });
      const again = async () => {
        rig.develop.setState({ histogram: {} } as Partial<DevelopStoreState>);
        await vi.advanceTimersByTimeAsync(0);
      };
      return { rig, state, again };
    }

    it.each([
      ["no frame", /no frame/],
      ["throws", /context lost/],
      ["blank", /blank/],
      ["readback throws", /canvas lost/],
    ] as const)("warns once for the photo, naming why, when the outcome is %s", async (outcome, why) => {
      const { again } = start(outcome);
      await vi.advanceTimersByTimeAsync(0);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0]).startsWith("[tone-equalizer] ")).toBe(true);
      expect(String(warn.mock.calls[0][0])).toContain("p1");
      expect(String(warn.mock.calls[0][0])).toMatch(why);
      await again();
      await again();
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it("stays quiet across retries that fail in other ways, and warns again for the next photo", async () => {
      const { rig, state, again } = start("no frame");
      await vi.advanceTimersByTimeAsync(0);
      state.outcome = "throws";
      await again();
      state.outcome = "blank";
      await again();
      expect(warn).toHaveBeenCalledTimes(1);

      rig.develop.setState({ photoId: "p2" });
      await vi.advanceTimersByTimeAsync(0);
      expect(warn).toHaveBeenCalledTimes(2);
      expect(String(warn.mock.calls[1][0])).toContain("p2");
      await again();
      expect(warn).toHaveBeenCalledTimes(2);
    });

    it("warns again on returning to a photo that failed before", async () => {
      const { rig, state, again } = start("no frame");
      await vi.advanceTimersByTimeAsync(0);
      state.outcome = "ok";
      rig.develop.setState({ photoId: "p2" });
      await vi.advanceTimersByTimeAsync(0);
      expect(warn).toHaveBeenCalledTimes(1);
      state.outcome = "no frame";
      rig.develop.setState({ photoId: "p1" });
      await vi.advanceTimersByTimeAsync(0);
      await again();
      expect(warn).toHaveBeenCalledTimes(2);
    });

    it("warns again for a photo whose probe recovered and then failed", async () => {
      const { state, again } = start("no frame");
      await vi.advanceTimersByTimeAsync(0);
      state.outcome = "ok";
      await again();
      state.outcome = "throws";
      await again();
      await again();
      expect(warn).toHaveBeenCalledTimes(2);
      expect(String(warn.mock.calls[1][0])).toMatch(/context lost/);
    });

    it("words a missing frame as expected while a RAW decodes", async () => {
      start("no frame");
      await vi.advanceTimersByTimeAsync(0);
      expect(String(warn.mock.calls[0][0])).toMatch(/no exposure reading yet .*expected while a RAW is still decoding/);
    });

    it("says nothing while the probe works", async () => {
      const { again } = start("ok");
      await vi.advanceTimersByTimeAsync(0);
      await again();
      expect(warn).not.toHaveBeenCalled();
    });

    it("says nothing about a frame dropped because the photo changed or the probe stopped", async () => {
      const rig = fakeApi();
      const first = deferred<ImageBitmap | null>();
      const second = deferred<ImageBitmap | null>();
      const render = vi.fn<ProbeDeps["render"]>().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
      const stop = startProbe({ develop: rig.develop, render, readback: () => null, publish: () => undefined, throttleMs: 0 });
      await vi.advanceTimersByTimeAsync(0);
      rig.develop.setState({ photoId: "p2" });
      first.resolve(null);
      await vi.advanceTimersByTimeAsync(0);
      expect(render.mock.calls.map(([id]) => id)).toEqual(["p1", "p2"]);
      expect(warn).not.toHaveBeenCalled();
      stop();
      second.resolve(null);
      await vi.advanceTimersByTimeAsync(0);
      expect(warn).not.toHaveBeenCalled();
    });
  });

  it("renders the preview params with the preview bag, and the live pair otherwise", async () => {
    const rig = fakeApi({ "other.stage.amount": 0.5 });
    const render = vi.fn<ProbeDeps["render"]>(async () => null);
    startProbe({ develop: rig.develop, render, readback, publish: () => undefined, throttleMs: 0 });
    await vi.advanceTimersByTimeAsync(0);
    const preview = {} as DevelopParams;
    rig.develop.setState({ previewParams: preview, previewParamBag: { "other.stage.amount": 0.9 }, histogram: {} });
    await vi.advanceTimersByTimeAsync(0);
    rig.develop.setState({ previewParams: null, previewParamBag: null, histogram: {} });
    await vi.advanceTimersByTimeAsync(0);
    expect(render).toHaveBeenCalledTimes(3);
    const [, previewParams, previewBag] = render.mock.calls[1];
    expect(previewParams).toBe(preview);
    expect(previewBag["other.stage.amount"]).toBe(0.9);
    const [, liveParams, liveBag] = render.mock.calls[2];
    expect(liveParams).toBe(rig.develop.getState().params);
    expect(liveBag["other.stage.amount"]).toBe(0.5);
  });

  it("stamps each probe with the mask signature of the bag it rendered with, even if the mask changed in flight", async () => {
    const rig = fakeApi(deriveAll(DEFAULT_PARAMS));
    const first = deferred<ImageBitmap | null>();
    const render = vi.fn<ProbeDeps["render"]>().mockReturnValueOnce(first.promise).mockResolvedValue(fakeBitmap());
    const published: (Probe | null)[] = [];
    startProbe({ develop: rig.develop, render, readback, publish: (p) => published.push(p), throttleMs: 0 });
    await vi.advanceTimersByTimeAsync(0);
    const before = probeSignature(rig.develop.getState());
    rig.develop.getState().setDynParams(deriveAll({ ...DEFAULT_PARAMS, exposureBoost: 1 }));
    const after = probeSignature(rig.develop.getState());
    expect(after).not.toBe(before);
    first.resolve(fakeBitmap());
    await vi.advanceTimersByTimeAsync(0);
    expect(published.map((p) => p?.signature)).toEqual([before, after]);
  });

  it("stamps a hover preview's probe with the preview bag's signature", async () => {
    const rig = fakeApi(deriveAll(DEFAULT_PARAMS));
    const published: (Probe | null)[] = [];
    startProbe({ develop: rig.develop, render: async () => fakeBitmap(), readback, publish: (p) => published.push(p), throttleMs: 0 });
    await vi.advanceTimersByTimeAsync(0);
    const live = probeSignature(rig.develop.getState());
    rig.develop.setState({ previewParamBag: deriveAll({ ...DEFAULT_PARAMS, exposureBoost: 2 }) });
    await vi.advanceTimersByTimeAsync(0);
    expect(published[1]?.signature).toBe(probeSignature(rig.develop.getState()));
    expect(published[1]?.signature).not.toBe(live);
  });
});

describe("probeSignature", () => {
  const paramsWith = (values: Record<string, unknown>): DevelopParams => ({ ...values }) as DevelopParams;
  const sign = (over: Partial<DevelopStoreState> = {}) => probeSignature({ ...fakeApi(deriveAll(DEFAULT_PARAMS)).develop.getState(), ...over });
  const base = () => sign();

  it("follows what the probe is rendered from: the boosts and the filter, the core params, the other stages, the photo", () => {
    expect(sign({ paramBag: deriveAll({ ...DEFAULT_PARAMS, exposureBoost: 1 }) })).not.toBe(base());
    expect(sign({ paramBag: deriveAll({ ...DEFAULT_PARAMS, contrastBoost: 1 }) })).not.toBe(base());
    expect(sign({ paramBag: deriveAll({ ...DEFAULT_PARAMS, details: "guided" }) })).not.toBe(base());
    expect(sign({ params: paramsWith({ exposure: 1 }) })).not.toBe(base());
    expect(sign({ paramBag: { ...deriveAll(DEFAULT_PARAMS), "other.stage.amount": 0.5 } })).not.toBe(base());
    expect(sign({ photoId: "p2" })).not.toBe(base());
  });

  it("follows the hover preview, not the photo's own values underneath it", () => {
    const preview = { ...deriveAll(DEFAULT_PARAMS), "other.stage.amount": 1 };
    expect(sign({ previewParamBag: preview })).not.toBe(base());
    expect(sign({ previewParams: paramsWith({ exposure: 1 }) })).not.toBe(base());
    expect(sign({ previewParamBag: preview, paramBag: { ...preview, "other.stage.amount": 2 } })).toBe(sign({ previewParamBag: preview }));
  });

  it("ignores this stage's bands, curve and derived keys, which cannot change the mask, and the view mode the probe sets", () => {
    const bands = DEFAULT_PARAMS.bands.map((b, i) => (i === 3 ? 1 : b));
    expect(sign({ paramBag: deriveAll({ ...DEFAULT_PARAMS, bands, curveSmoothing: 0.5 }) })).toBe(base());
    expect(sign({ paramBag: { ...deriveAll(DEFAULT_PARAMS), [VIEW_MODE_KEY]: 1 } })).toBe(base());
  });

  it("does not depend on key order, at any depth", () => {
    const a = sign({ params: paramsWith({ exposure: 1, nested: { x: 1, y: 2 } }), paramBag: { "b.key": 1, "a.key": 2 } });
    const b = sign({ params: paramsWith({ nested: { y: 2, x: 1 }, exposure: 1 }), paramBag: { "a.key": 2, "b.key": 1 } });
    expect(a).toBe(b);
  });

  it("reads a replaced params object afresh, not from an earlier one", () => {
    const first = paramsWith({ exposure: 1 });
    const before = sign({ params: first });
    expect(sign({ params: paramsWith({ exposure: 2 }) })).not.toBe(before);
    expect(sign({ params: first })).toBe(before);
  });
});

describe("what asks for another probe", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const start = () => {
    const rig = fakeApi();
    const render = vi.fn<ProbeDeps["render"]>(async () => null);
    startProbe({ develop: rig.develop, render, readback: () => null, publish: () => undefined, throttleMs: 150 });
    return { rig, render };
  };

  it("ignores a change to the bands and the curve alone", async () => {
    const { rig, render } = start();
    await vi.advanceTimersByTimeAsync(0);
    expect(render).toHaveBeenCalledTimes(1);
    const bands = DEFAULT_PARAMS.bands.map((b, i) => (i === 3 ? 1 : b));
    rig.develop.getState().setDynParams(deriveAll({ ...DEFAULT_PARAMS, bands, curveSmoothing: 0.5 }));
    await vi.advanceTimersByTimeAsync(500);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["diameter", 10],
    ["feathering", 4],
    ["exposureBoost", 1],
    ["contrastBoost", 1],
    ["details", 1],
    ["estimator", 1],
    ["diffusion", 2],
  ] as const)("asks again when %s changes, even with every band at 0", async (key, value) => {
    const { rig, render } = start();
    await vi.advanceTimersByTimeAsync(0);
    expect(render).toHaveBeenCalledTimes(1);
    rig.develop.getState().setDynParams({ [qualified(key)]: value });
    await vi.advanceTimersByTimeAsync(500);
    expect(render).toHaveBeenCalledTimes(2);
  });
});

describe("readbackBitmap", () => {
  interface Recorded {
    op: string;
    args: unknown[];
    canvas: string;
  }

  class RecordingCanvas {
    static made: RecordingCanvas[] = [];
    width: number;
    height: number;
    readonly pixels = new Uint8ClampedArray(16);
    readonly calls: Recorded[] = [];

    constructor(width: number, height: number) {
      this.width = width;
      this.height = height;
      RecordingCanvas.made.push(this);
    }

    private record(op: string, args: unknown[]): void {
      this.calls.push({ op, args, canvas: `${this.width}x${this.height}` });
    }

    getContext(...args: unknown[]) {
      this.record("getContext", args);
      return {
        clearRect: (...a: unknown[]) => this.record("clearRect", a),
        drawImage: (...a: unknown[]) => this.record("drawImage", a),
        getImageData: (...a: unknown[]) => {
          this.record("getImageData", a);
          return { data: this.pixels };
        },
      };
    }

    of(op: string): Recorded[] {
      return this.calls.filter((c) => c.op === op);
    }
  }

  let readbackBitmap: typeof import("../src/readback").readbackBitmap;

  beforeEach(async () => {
    RecordingCanvas.made = [];
    vi.stubGlobal("OffscreenCanvas", RecordingCanvas);
    vi.resetModules();
    ({ readbackBitmap } = await import("../src/readback"));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("draws a bitmap 1:1 onto a canvas of its own size and reads it back whole", () => {
    const bitmap = fakeBitmap(3, 2);
    const out = readbackBitmap(bitmap);
    expect(RecordingCanvas.made).toHaveLength(1);
    const canvas = RecordingCanvas.made[0];
    expect([canvas.width, canvas.height]).toEqual([3, 2]);
    expect(canvas.calls.map((c) => c.op)).toEqual(["getContext", "clearRect", "drawImage", "getImageData"]);
    expect(canvas.of("drawImage")).toEqual([{ op: "drawImage", args: [bitmap, 0, 0], canvas: "3x2" }]);
    expect(canvas.of("getImageData")).toEqual([{ op: "getImageData", args: [0, 0, 3, 2], canvas: "3x2" }]);
    expect(out).toEqual({ data: canvas.pixels, width: 3, height: 2 });
  });

  it("resizes the canvas before drawing a bitmap of another size", () => {
    readbackBitmap(fakeBitmap(3, 2));
    const wider = readbackBitmap(fakeBitmap(5, 4));
    readbackBitmap(fakeBitmap(5, 7));
    expect(RecordingCanvas.made).toHaveLength(1);
    const canvas = RecordingCanvas.made[0];
    expect(canvas.of("drawImage").map((c) => c.canvas)).toEqual(["3x2", "5x4", "5x7"]);
    expect(canvas.of("getImageData").map((c) => c.args)).toEqual([
      [0, 0, 3, 2],
      [0, 0, 5, 4],
      [0, 0, 5, 7],
    ]);
    expect(wider).toMatchObject({ width: 5, height: 4 });
  });

  it.each([
    [0, 0],
    [1, 1],
    [1, 9],
    [9, 1],
  ])("returns null for a %i x %i bitmap, the host's no-renderer frame or a degenerate one", (width, height) => {
    expect(readbackBitmap(fakeBitmap(width, height))).toBeNull();
    expect(RecordingCanvas.made).toHaveLength(0);
  });
});

describe("startLiveProbe", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("renders every probe frame losslessly, so the 16-bit exposure split across R and G survives", async () => {
    const rig = fakeApi({}, async () => fakeBitmap(1, 1));
    initRuntime(rig.api);
    initStore();
    const stop = startLiveProbe();
    await vi.advanceTimersByTimeAsync(0);
    rig.develop.setState({ histogram: {} } as Partial<DevelopStoreState>);
    await vi.advanceTimersByTimeAsync(200);
    stop();
    expect(rig.renders).toHaveLength(2);
    expect(rig.renderOptions).toEqual([{ lossless: true }, { lossless: true }]);
  });

  it("clears the stored probe when the host cannot render the frame", async () => {
    const rig = fakeApi({}, undefined, async () => null);
    initRuntime(rig.api);
    initStore();
    store().getState().setProbe({ width: 1, height: 1, ev: new Float32Array(1), histogram: null, signature: "" });
    const stop = startLiveProbe();
    await vi.advanceTimersByTimeAsync(0);
    expect(store().getState().probe).toBeNull();
    stop();
  });
});
