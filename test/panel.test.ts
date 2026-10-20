// @vitest-environment jsdom
// The panel: darktable's tabs and controls, sliders writing the bag live and
// committing on release, the visibility rules, presets, the auto buttons, the
// toggles, and the probe running only while mounted.

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { autoContrast, autoExposure, logHistogram, type LogHistogram } from "../src/measure";
import { DEFAULT_PARAMS } from "../src/model";
import {
  ADJUST_HINT,
  BAND_SLIDERS,
  CONTRAST_SLIDER,
  DIAMETER_SLIDER,
  DIFFUSION_SLIDER,
  EXPOSURE_SLIDER,
  FEATHERING_SLIDER,
  SMOOTHING_SLIDER,
  TAB_SETTING,
  TonePanel,
  UNSTABLE_MESSAGE,
  shownValue,
  sliderSpan,
  visibleControls,
  type SliderSpec,
} from "../src/Panel";
import { deriveAll, qualified, readParams } from "../src/params";
import { PRESETS } from "../src/presets";
import { probeSignature } from "../src/readback";
import { initRuntime } from "../src/runtime";
import type { DevelopParams, SliderProps } from "../src/safelight";
import { initStore, store, type Probe } from "../src/store";
import { countingParams } from "./support/counting-params";
import { fakeApi, fakeBitmap, type Rig } from "./support/fake-api";

let rig: Rig;

const WAIT = "Wait for the preview to finish recomputing";

function mount(bag: Record<string, unknown> = deriveAll(DEFAULT_PARAMS), frames?: () => Promise<ImageBitmap>) {
  rig = fakeApi(bag, frames);
  initRuntime(rig.api);
  initStore();
  return render(React.createElement(TonePanel));
}

/** Mounts with a Slider that records the value it was handed, by label. */
function mountShowing(bag: Record<string, unknown>) {
  const shown = new Map<string, number>();
  rig = fakeApi(bag);
  rig.api.components = {
    Slider: ({ label, value }: SliderProps) => {
      shown.set(label, value);
      return null;
    },
  };
  initRuntime(rig.api);
  initStore();
  render(React.createElement(TonePanel));
  return shown;
}

/** What the sampler publishes for a frame rendered from the develop state as it is now. */
const probeFor = (histogram: LogHistogram | null): Probe => ({
  width: 1,
  height: 1,
  ev: new Float32Array([-4]),
  histogram,
  signature: probeSignature(rig.develop.getState()),
});

const paramsWith = (values: Record<string, unknown>): DevelopParams => ({ ...values }) as DevelopParams;

const spread = (): LogHistogram => ({ bins: new Int32Array(256), max: 1, first: -6, last: -2, count: 1 });

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = () => null;
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the panel's tables", () => {
  it("labels the nine bands as darktable does", () => {
    expect(BAND_SLIDERS.map((s) => s.label)).toEqual(["−8 EV", "−7 EV", "−6 EV", "−5 EV", "−4 EV", "−3 EV", "−2 EV", "−1 EV", "+0 EV"]);
  });

  it("widens a soft range to take a value beyond it, never past the hard range", () => {
    expect(sliderSpan(FEATHERING_SLIDER, 20)).toEqual({ min: 0.1, max: 50 });
    expect(sliderSpan(FEATHERING_SLIDER, 500)).toEqual({ min: 0.1, max: 500 });
    expect(sliderSpan(DIAMETER_SLIDER, 0.01)).toEqual({ min: 0.01, max: 45 });
  });

  it("widens downwards too", () => {
    expect(sliderSpan(EXPOSURE_SLIDER, -10)).toEqual({ min: -10, max: 4 });
    expect(sliderSpan(SMOOTHING_SLIDER, -2.33)).toEqual({ min: -2.33, max: 1 });
  });

  const RANGES: readonly { name: string; specs: readonly SliderSpec[]; soft: [number, number]; hard: [number, number] }[] = [
    { name: "a band", specs: BAND_SLIDERS, soft: [-2, 2], hard: [-2, 2] },
    { name: "curve smoothing", specs: [SMOOTHING_SLIDER], soft: [-1, 1], hard: [-2.33, 1.67] },
    { name: "mask exposure compensation", specs: [EXPOSURE_SLIDER], soft: [-4, 4], hard: [-16, 16] },
    { name: "mask contrast compensation", specs: [CONTRAST_SLIDER], soft: [-2, 2], hard: [-16, 16] },
    { name: "filter diffusion", specs: [DIFFUSION_SLIDER], soft: [1, 5], hard: [1, 20] },
    { name: "smoothing diameter", specs: [DIAMETER_SLIDER], soft: [1, 45], hard: [0.01, 100] },
    { name: "edges refinement/feathering", specs: [FEATHERING_SLIDER], soft: [0.1, 50], hard: [0.01, 10000] },
  ];

  it.each(RANGES)("takes darktable's soft and hard ranges for $name", ({ specs, soft, hard }) => {
    for (const spec of specs) {
      expect([spec.min, spec.max, spec.hardMin, spec.hardMax]).toEqual([...soft, ...hard]);
      const inside = (soft[0] + soft[1]) / 2;
      const above = (soft[1] + hard[1]) / 2;
      const below = (soft[0] + hard[0]) / 2;
      expect(sliderSpan(spec, inside)).toEqual({ min: soft[0], max: soft[1] });
      expect(sliderSpan(spec, above)).toEqual({ min: soft[0], max: above });
      expect(sliderSpan(spec, below)).toEqual({ min: below, max: soft[1] });
      expect(sliderSpan(spec, hard[1] + 5)).toEqual({ min: soft[0], max: hard[1] });
      expect(sliderSpan(spec, hard[0] - 5)).toEqual({ min: hard[0], max: soft[1] });
    }
  });

  it("follows darktable's visibility rules", () => {
    expect(visibleControls("none")).toEqual({ filter: false, contrast: false });
    expect(visibleControls("avg-eigf")).toEqual({ filter: true, contrast: false });
    expect(visibleControls("guided")).toEqual({ filter: true, contrast: true });
  });

  it("shows a value to its step's decimals plus a guard digit, so float noise never reaches the slider", () => {
    expect(shownValue(BAND_SLIDERS[0], Math.fround(0.65))).toBe(0.65);
    expect(shownValue(BAND_SLIDERS[0], Math.fround(Math.fround(5 / 3) * Math.fround(0.65)))).toBe(1.083);
    expect(shownValue(DIAMETER_SLIDER, 1.2000000000000002)).toBe(1.2);
    expect(shownValue(FEATHERING_SLIDER, 0.09999999999999998)).toBe(0.1);
    expect(shownValue(DIFFUSION_SLIDER, 3)).toBe(3);
  });
});

describe("TonePanel", () => {
  it("shows the simple tab first and remembers the tab", () => {
    mount();
    expect(screen.getAllByRole("slider")).toHaveLength(9);
    fireEvent.click(screen.getByRole("button", { name: "Masking" }));
    expect(rig.settings.get(TAB_SETTING)).toBe("masking");
    cleanup();
    const again = fakeApi(deriveAll(DEFAULT_PARAMS));
    again.settings.set(TAB_SETTING, "masking");
    initRuntime(again.api);
    initStore();
    render(React.createElement(TonePanel));
    expect(screen.getByLabelText("Luminance estimator")).toBeTruthy();
  });

  it("writes a band live and commits on release with its label", () => {
    mount();
    const band = screen.getByLabelText("−4 EV");
    fireEvent.change(band, { target: { value: "1" } });
    expect(readParams(rig.develop.getState().paramBag).bands[4]).toBe(1);
    expect(rig.develop.getState().paramBag["tone-equalizer.correction.on"]).toBe(1);
    fireEvent.mouseUp(band);
    expect(rig.commits).toEqual(["Tone Equalizer −4 EV"]);
  });

  it("hides the filter controls for 'no' and the contrast compensation for the averaged modes", () => {
    mount(deriveAll({ ...DEFAULT_PARAMS, details: "none" }));
    fireEvent.click(screen.getByRole("button", { name: "Masking" }));
    expect(screen.queryByLabelText("Smoothing diameter")).toBeNull();
    fireEvent.change(screen.getByLabelText("Preserve details"), { target: { value: "avg-eigf" } });
    expect(screen.getByLabelText("Smoothing diameter")).toBeTruthy();
    expect(rig.commits).toEqual(["Tone Equalizer preserve details"]);
    fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
    expect(screen.queryByLabelText("Mask contrast compensation")).toBeNull();
    expect(screen.getByLabelText("Mask exposure compensation")).toBeTruthy();
  });

  it("applies a preset and commits once", () => {
    mount();
    fireEvent.change(screen.getByLabelText("Preset"), { target: { value: "Relight: fill-in" } });
    const p = readParams(rig.develop.getState().paramBag);
    expect(p.bands[4]).toBeCloseTo(1.33, 6);
    expect(p.exposureBoost).toBeCloseTo(-0.5, 6);
    expect(rig.commits).toEqual(["Tone Equalizer preset Relight: fill-in"]);
  });

  it("offers all thirteen presets, in darktable's order", () => {
    mount();
    const menu = screen.getByLabelText("Preset") as HTMLSelectElement;
    const offered = Array.from(menu.options)
      .map((o) => o.value)
      .filter((v) => v !== "");
    expect(offered).toHaveLength(13);
    expect(offered).toEqual(PRESETS.map((preset) => preset.name));
  });

  it("keeps the auto buttons off until a probe lands, then applies darktable's formula", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
    const auto = screen.getByRole("button", { name: "Auto-adjust the mask exposure" });
    expect(auto.hasAttribute("disabled")).toBe(true);
    act(() => store().getState().setProbe(probeFor(spread())));
    fireEvent.click(screen.getByRole("button", { name: "Auto-adjust the mask exposure" }));
    expect(readParams(rig.develop.getState().paramBag).exposureBoost).toBe(autoExposure(-6, -2, 0, 0));
    expect(rig.commits).toEqual(["Tone Equalizer auto mask exposure"]);
  });

  it("drives the two toggles in the session store, and turns them off on unmount", () => {
    const view = mount();
    fireEvent.click(screen.getByLabelText("Display exposure mask"));
    fireEvent.click(screen.getByLabelText("Adjust on image"));
    expect(store().getState().showMask).toBe(true);
    expect(store().getState().adjusting).toBe(true);
    view.unmount();
    expect(store().getState().showMask).toBe(false);
    expect(store().getState().adjusting).toBe(false);
  });

  it("probes while mounted, on a mask change, and not after unmount", async () => {
    vi.useFakeTimers();
    const view = mount(deriveAll(DEFAULT_PARAMS), () => Promise.resolve(fakeBitmap()));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(rig.renders).toHaveLength(1);
    act(() => rig.develop.getState().setDynParams(deriveAll({ ...DEFAULT_PARAMS, exposureBoost: 1 })));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(rig.renders).toHaveLength(2);
    view.unmount();
    rig.develop.getState().setDynParams(deriveAll({ ...DEFAULT_PARAMS, exposureBoost: 2 }));
    await vi.advanceTimersByTimeAsync(500);
    expect(rig.renders).toHaveLength(2);
  });
});

describe("the auto buttons wait for a probe of the mask they act on", () => {
  const advanced = () => fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
  const exposureAuto = () => screen.getByRole("button", { name: "Auto-adjust the mask exposure" });
  const contrastAuto = () => screen.getByRole("button", { name: "Auto-adjust the mask contrast" });
  const bag = () => readParams(rig.develop.getState().paramBag);

  it("acts once on a probe: the mask it changes makes the probe stale until the next one lands", () => {
    mount();
    advanced();
    act(() => store().getState().setProbe(probeFor(spread())));
    fireEvent.click(exposureAuto());
    const once = autoExposure(-6, -2, 0, 0);
    expect(bag().exposureBoost).toBe(once);
    expect(exposureAuto().hasAttribute("disabled")).toBe(true);
    expect(exposureAuto().getAttribute("title")).toBe(WAIT);
    expect(contrastAuto().hasAttribute("disabled")).toBe(true);
    fireEvent.click(exposureAuto());
    expect(bag().exposureBoost).toBe(once);
    expect(rig.commits).toEqual(["Tone Equalizer auto mask exposure"]);
    act(() => store().getState().setProbe(probeFor(spread())));
    expect(exposureAuto().hasAttribute("disabled")).toBe(false);
    expect(contrastAuto().hasAttribute("disabled")).toBe(false);
  });

  it("holds the same way after the contrast button", () => {
    mount();
    advanced();
    act(() => store().getState().setProbe(probeFor(spread())));
    fireEvent.click(contrastAuto());
    expect(bag().contrastBoost).toBe(autoContrast(-6, -2, DEFAULT_PARAMS));
    expect(rig.commits).toEqual(["Tone Equalizer auto mask contrast"]);
    expect(contrastAuto().hasAttribute("disabled")).toBe(true);
    expect(exposureAuto().hasAttribute("disabled")).toBe(true);
  });

  it("does not take a probe that was measured under an earlier mask", () => {
    mount();
    advanced();
    const stale = probeFor(spread());
    act(() => rig.develop.getState().setDynParams(deriveAll({ ...DEFAULT_PARAMS, exposureBoost: 1 })));
    act(() => store().getState().setProbe(stale));
    expect(exposureAuto().hasAttribute("disabled")).toBe(true);
    expect(exposureAuto().getAttribute("title")).toBe(WAIT);
  });

  it("stays on while only the bands and the curve move, which do not change the mask", () => {
    mount();
    act(() => store().getState().setProbe(probeFor(spread())));
    fireEvent.change(screen.getByLabelText("−4 EV"), { target: { value: "1" } });
    advanced();
    fireEvent.change(screen.getByLabelText("Curve smoothing"), { target: { value: "0.5" } });
    expect(exposureAuto().hasAttribute("disabled")).toBe(false);
  });

  const CHANGES: readonly [string, () => void][] = [
    ["a core param", () => rig.develop.setState({ params: paramsWith({ exposure: 1 }) })],
    ["a hover preview's core params", () => rig.develop.setState({ previewParams: paramsWith({ exposure: 1 }) })],
    ["another stage's key", () => rig.develop.getState().setDynParams({ "other.stage.amount": 0.5 })],
    ["a hover preview's bag", () => rig.develop.setState({ previewParamBag: { "other.stage.amount": 1 } })],
    ["the photo", () => rig.develop.setState({ photoId: "p2" })],
  ];

  it.each(CHANGES)("waits for the next probe after %s changes", (_name, change) => {
    mount();
    advanced();
    const stale = probeFor(spread());
    act(() => store().getState().setProbe(stale));
    expect(exposureAuto().hasAttribute("disabled")).toBe(false);
    act(change);
    expect(exposureAuto().hasAttribute("disabled")).toBe(true);
    expect(exposureAuto().getAttribute("title")).toBe(WAIT);
    expect(contrastAuto().hasAttribute("disabled")).toBe(true);
    fireEvent.click(exposureAuto());
    expect(rig.commits).toEqual([]);
    act(() => store().getState().setProbe(null));
    act(() => store().getState().setProbe(stale));
    expect(exposureAuto().hasAttribute("disabled")).toBe(true);
    act(() => store().getState().setProbe(probeFor(spread())));
    expect(exposureAuto().hasAttribute("disabled")).toBe(false);
    expect(contrastAuto().hasAttribute("disabled")).toBe(false);
  });
});

describe("the auto buttons on a degenerate histogram", () => {
  // One valid pixel puts both deciles on the histogram's first fine bin.
  const onePixel = (): LogHistogram => {
    const histogram = logHistogram([-4]);
    if (!histogram) throw new Error("expected a histogram");
    return histogram;
  };

  it("discards an auto exposure that comes out non-finite", () => {
    const start = { ...DEFAULT_PARAMS, exposureBoost: 0.5, contrastBoost: -1 };
    mount(deriveAll(start));
    const histogram = onePixel();
    expect(Number.isFinite(autoExposure(histogram.first, histogram.last, 0.5, -1))).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
    act(() => store().getState().setProbe(probeFor(histogram)));
    const before = rig.develop.getState().paramBag;
    fireEvent.click(screen.getByRole("button", { name: "Auto-adjust the mask exposure" }));
    expect(rig.develop.getState().paramBag).toBe(before);
    expect(readParams(rig.develop.getState().paramBag).exposureBoost).toBeCloseTo(0.5, 6);
    expect(rig.commits).toEqual([]);
  });

  it.each(["eigf", "guided"] as const)("discards an auto contrast that comes out non-finite (%s)", (details) => {
    const start = { ...DEFAULT_PARAMS, details, contrastBoost: 1.5 };
    mount(deriveAll(start));
    const histogram = onePixel();
    expect(Number.isFinite(autoContrast(histogram.first, histogram.last, start))).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
    act(() => store().getState().setProbe(probeFor(histogram)));
    const before = rig.develop.getState().paramBag;
    fireEvent.click(screen.getByRole("button", { name: "Auto-adjust the mask contrast" }));
    expect(rig.develop.getState().paramBag).toBe(before);
    expect(readParams(rig.develop.getState().paramBag).contrastBoost).toBeCloseTo(1.5, 6);
    expect(rig.commits).toEqual([]);
  });
});

describe("the values the sliders show", () => {
  it("shows a float32 preset's bands short, while the bag keeps the exact value", () => {
    const shown = mountShowing(deriveAll(DEFAULT_PARAMS));
    fireEvent.change(screen.getByLabelText("Preset"), { target: { value: "Compress shadows/highlights | EIGF | strong" } });
    expect(BAND_SLIDERS.map((s) => shown.get(s.label))).toEqual([0.65, 1.083, 1.083, 0.65, 0, -0.65, -1.083, -1.083, -0.65]);
    expect(rig.develop.getState().paramBag[qualified("b0")]).toBe(Math.fround(0.65));
  });

  it("shows the offset-encoded diameter and feathering without their last-digit noise", () => {
    const bag = deriveAll({ ...DEFAULT_PARAMS, blending: 1.2, feathering: 0.1 });
    expect(readParams(bag).blending).not.toBe(1.2);
    expect(readParams(bag).feathering).not.toBe(0.1);
    const shown = mountShowing(bag);
    fireEvent.click(screen.getByRole("button", { name: "Masking" }));
    expect(shown.get("Smoothing diameter")).toBe(1.2);
    expect(shown.get("Edges refinement/feathering")).toBe(0.1);
  });
});

describe("what the panel says", () => {
  it("reads a missing probe as still measuring, never as a failure", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
    const auto = () => screen.getByRole("button", { name: "Auto-adjust the mask exposure" });
    expect(auto().getAttribute("title")).toBe(WAIT);
    expect(screen.queryByText(UNSTABLE_MESSAGE)).toBeNull();
    act(() => store().getState().setProbe(probeFor(logHistogram([-6, -2]))));
    expect(auto().hasAttribute("disabled")).toBe(false);
    expect(auto().getAttribute("title")).toBe("Auto-adjust the mask exposure");
    act(() => store().getState().setProbe(null));
    expect(auto().hasAttribute("disabled")).toBe(true);
    expect(auto().getAttribute("title")).toBe(WAIT);
    expect(screen.queryByText(UNSTABLE_MESSAGE)).toBeNull();
  });

  it("shows the unstable note while the last drag failed, and clears it on the next write", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
    act(() => store().getState().setUnstable(true));
    expect(screen.getByText(UNSTABLE_MESSAGE)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Curve smoothing"), { target: { value: "0.5" } });
    expect(screen.queryByText(UNSTABLE_MESSAGE)).toBeNull();
  });

  it("shows the wheel hint only while adjusting on the image", () => {
    mount();
    expect(screen.queryByText(ADJUST_HINT)).toBeNull();
    fireEvent.click(screen.getByLabelText("Adjust on image"));
    expect(screen.getByText(ADJUST_HINT)).toBeTruthy();
  });
});

describe("the panel off the Advanced tab", () => {
  it("never reads the core params on a develop update, and does once Advanced shows", () => {
    mount();
    const simple = countingParams();
    act(() => rig.develop.setState({ params: simple.params }));
    expect(simple.reads()).toBe(0);

    fireEvent.click(screen.getByRole("button", { name: "Masking" }));
    const masking = countingParams();
    act(() => rig.develop.setState({ params: masking.params }));
    expect(masking.reads()).toBe(0);

    fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
    expect(masking.reads()).toBeGreaterThan(0);
  });

  it("reads a probe taken earlier as current the moment Advanced opens", () => {
    mount();
    act(() => store().getState().setProbe(probeFor(spread())));
    fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
    expect(screen.getByRole("button", { name: "Auto-adjust the mask exposure" }).hasAttribute("disabled")).toBe(false);
  });

  it("keeps Auto waiting for a new probe after a core change on the Advanced tab", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
    act(() => store().getState().setProbe(probeFor(spread())));
    act(() => rig.develop.setState({ params: paramsWith({ exposure: 1 }) }));
    expect(screen.getByRole("button", { name: "Auto-adjust the mask exposure" }).hasAttribute("disabled")).toBe(true);
  });
});
