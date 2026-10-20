// @vitest-environment jsdom
// The develop-canvas overlay: Adjust on image reads the mask exposure under
// the pointer from the probe, the wheel shifts the curve there and commits
// once the wheel settles, Ctrl+wheel stays the canvas zoom, Esc leaves; the
// mask display captures with the view stage's mode 1.

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { interactiveEdit } from "../src/curve";
import { DEFAULT_PARAMS } from "../src/model";
import { COMMIT_DELAY_MS, ToneEqualizerOverlay } from "../src/Overlay";
import { VIEW_MODE_KEY, deriveAll, readParams } from "../src/params";
import { maskViewPatch } from "../src/readback";
import { initRuntime } from "../src/runtime";
import type { DevelopParams } from "../src/safelight";
import { initStore, store } from "../src/store";
import { countingParams } from "./support/counting-params";
import { fakeApi, fakeBitmap, type Rig } from "./support/fake-api";

let rig: Rig;

/** A probe whose mask reads −3 EV everywhere. */
function probe() {
  return { width: 4, height: 4, ev: new Float32Array(16).fill(-3), histogram: null, signature: "" };
}

function mount(frames?: () => Promise<ImageBitmap>) {
  rig = fakeApi(deriveAll(DEFAULT_PARAMS), frames);
  rig.overlay.rect = { x: 0, y: 0, w: 200, h: 100 };
  initRuntime(rig.api);
  initStore();
  store().getState().setProbe(probe());
  return render(React.createElement(ToneEqualizerOverlay));
}

/** jsdom has no layout: give the adjust layer a box and a layout width. */
function layout(el: HTMLElement) {
  el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0, toJSON: () => ({}) });
  Object.defineProperty(el, "clientWidth", { value: 200, configurable: true });
}

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = () => null;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Adjust on image", () => {
  it("renders nothing while the toggle is off", () => {
    mount();
    expect(screen.queryByTestId("te-adjust")).toBeNull();
  });

  it("reads the mask exposure under the pointer and draws the readout", () => {
    mount();
    act(() => store().getState().setAdjusting(true));
    const layer = screen.getByTestId("te-adjust");
    layout(layer);
    fireEvent.pointerMove(layer, { clientX: 100, clientY: 50 });
    expect(store().getState().cursor?.ev).toBeCloseTo(-3, 6);
    expect(screen.getByText("−3.0 EV")).toBeTruthy();
  });

  it("shifts the curve at that exposure on the wheel, and commits once it settles", () => {
    vi.useFakeTimers();
    mount();
    act(() => store().getState().setAdjusting(true));
    const layer = screen.getByTestId("te-adjust");
    layout(layer);
    fireEvent.pointerMove(layer, { clientX: 100, clientY: 50 });
    const wheel = new WheelEvent("wheel", { deltaY: -100, cancelable: true, bubbles: true });
    act(() => void layer.dispatchEvent(wheel));
    expect(wheel.defaultPrevented).toBe(true);
    const expected = interactiveEdit(DEFAULT_PARAMS.bands, Math.SQRT2, -3, 0.25)!;
    readParams(rig.develop.getState().paramBag).bands.forEach((b, i) => expect(b).toBeCloseTo(expected[i], 6));
    expect(rig.commits).toEqual([]);
    vi.advanceTimersByTime(COMMIT_DELAY_MS + 10);
    expect(rig.commits).toEqual(["Tone Equalizer scroll"]);
  });

  it("leaves Ctrl+wheel to the canvas", () => {
    mount();
    act(() => store().getState().setAdjusting(true));
    const layer = screen.getByTestId("te-adjust");
    layout(layer);
    fireEvent.pointerMove(layer, { clientX: 100, clientY: 50 });
    const wheel = new WheelEvent("wheel", { deltaY: -100, ctrlKey: true, cancelable: true, bubbles: true });
    act(() => void layer.dispatchEvent(wheel));
    expect(wheel.defaultPrevented).toBe(false);
    expect(readParams(rig.develop.getState().paramBag).bands.every((b) => b === 0)).toBe(true);
  });

  it("stops on Esc", () => {
    mount();
    act(() => store().getState().setAdjusting(true));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(store().getState().adjusting).toBe(false);
  });
});

describe("Display exposure mask", () => {
  it("captures the view stage's mask display as shown, and draws it over the image", async () => {
    vi.useFakeTimers();
    mount(async () => fakeBitmap(200, 100));
    act(() => store().getState().setShowMask(true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(rig.captures).toHaveLength(1);
    expect(rig.captures[0].asShown).toBe(true);
    expect(rig.captures[0].paramBag?.[VIEW_MODE_KEY]).toBe(1);
    expect(screen.getByTestId("te-mask")).toBeTruthy();
  });

  it("hides the layer when the view changes until the next frame lands", async () => {
    vi.useFakeTimers();
    const view = mount(async () => fakeBitmap(200, 100));
    act(() => store().getState().setShowMask(true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    rig.overlay.nonce = 1;
    view.rerender(React.createElement(ToneEqualizerOverlay));
    expect(screen.queryByTestId("te-mask")).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(screen.getByTestId("te-mask")).toBeTruthy();
  });
});

// Beyond the brief: the pointer, the probe's null, the click-through keys, the
// commit's timing and the hover preview.

function adjustLayer(box = { width: 200, height: 100 }) {
  act(() => store().getState().setAdjusting(true));
  const layer = screen.getByTestId("te-adjust");
  layout(layer);
  layer.getBoundingClientRect = () => ({ left: 0, top: 0, ...box, right: box.width, bottom: box.height, x: 0, y: 0, toJSON: () => ({}) });
  return layer;
}

function scroll(layer: HTMLElement, init: WheelEventInit) {
  const event = new WheelEvent("wheel", { cancelable: true, bubbles: true, ...init });
  act(() => void layer.dispatchEvent(event));
  return event;
}

/** Core params are opaque to the extension; any record with different content stands in. */
const coreParams = (content: Record<string, unknown>) => content as DevelopParams;

const bandsNow = () => readParams(rig.develop.getState().paramBag).bands;

describe("Adjust on image, the details", () => {
  it("scales the pointer by the UI zoom into the layer's layout px", () => {
    mount();
    const layer = adjustLayer({ width: 400, height: 200 });
    fireEvent.pointerMove(layer, { clientX: 200, clientY: 100 });
    expect(store().getState().cursor?.local).toEqual({ x: 100, y: 50 });
    expect(store().getState().cursor?.ev).toBeCloseTo(-3, 6);
  });

  it("reads the probe against the whole image's rect when the view is zoomed", () => {
    const view = mount();
    const columns = 16;
    const ev = Float32Array.from({ length: columns * 4 }, (_, k) => (k % columns < columns / 2 ? -6 : -1));
    act(() => store().getState().setProbe({ width: columns, height: 4, ev, histogram: null, signature: "" }));
    rig.overlay.imageRect = { x: -200, y: 0, w: 800, h: 100 };
    view.rerender(React.createElement(ToneEqualizerOverlay));
    const layer = adjustLayer();
    fireEvent.pointerMove(layer, { clientX: 100, clientY: 50 });
    expect(store().getState().cursor?.ev).toBeCloseTo(-6, 6);
  });

  it("gives no reading before the image has a rect, and leaves the wheel alone", () => {
    const view = mount();
    rig.overlay.imageRect = null;
    view.rerender(React.createElement(ToneEqualizerOverlay));
    const layer = adjustLayer();
    fireEvent.pointerMove(layer, { clientX: 100, clientY: 50 });
    expect(store().getState().cursor?.ev).toBeNull();
    expect(screen.getByText("? EV")).toBeTruthy();
    const event = scroll(layer, { deltaY: -100 });
    expect(event.defaultPrevented).toBe(false);
    expect(bandsNow().every((b) => b === 0)).toBe(true);
  });

  it("draws no cursor off the image", () => {
    mount();
    rig.overlay.imageRect = { x: 50, y: 25, w: 100, h: 50 };
    const layer = adjustLayer();
    fireEvent.pointerMove(layer, { clientX: 100, clientY: 50 });
    expect(store().getState().cursor).not.toBeNull();
    fireEvent.pointerMove(layer, { clientX: 20, clientY: 50 });
    expect(store().getState().cursor).toBeNull();
  });

  it("draws the cursor around the pointer with darktable's geometry", () => {
    mount();
    const bands = DEFAULT_PARAMS.bands.map((b, i) => (i === 5 ? 1 : b));
    act(() => rig.develop.getState().setDynParams(deriveAll({ ...DEFAULT_PARAMS, bands })));
    const layer = adjustLayer();
    fireEvent.pointerMove(layer, { clientX: 100, clientY: 50 });
    const bars = [...layer.querySelectorAll("svg > line")].map((l) => ["x1", "y1", "x2", "y2"].map((a) => l.getAttribute(a)).join(","));
    expect(bars).toEqual(["116,50,124,50", "84,50,52,50", "100,66,100,86", "100,34,100,14"]);
    expect(layer.querySelector("svg > path")?.getAttribute("d")).toMatch(/^M 68\.00 50\.00 A 32 32 0 0 1 /);
    const pill = layer.querySelector("svg > rect");
    expect(Number(pill?.getAttribute("x"))).toBe(124);
    expect(Number(pill?.getAttribute("y")) + Number(pill?.getAttribute("height")) / 2).toBe(50);
    const radii = [...layer.querySelectorAll("svg > circle")].map((c) => c.getAttribute("r"));
    expect(radii.filter((r) => r === "16")).toHaveLength(2);
    expect(radii.filter((r) => r === "8")).toHaveLength(2);
  });

  it("clears the cursor when the pointer leaves the layer", () => {
    mount();
    const layer = adjustLayer();
    fireEvent.pointerMove(layer, { clientX: 100, clientY: 50 });
    expect(store().getState().cursor).not.toBeNull();
    fireEvent.pointerLeave(layer);
    expect(store().getState().cursor).toBeNull();
  });

  it("shows ? EV where the probe has no reading, and leaves the wheel alone", () => {
    mount();
    act(() => store().getState().setProbe(null));
    const layer = adjustLayer();
    fireEvent.pointerMove(layer, { clientX: 100, clientY: 50 });
    expect(store().getState().cursor?.ev).toBeNull();
    expect(screen.getByText("? EV")).toBeTruthy();
    const event = scroll(layer, { deltaY: -100 });
    expect(event.defaultPrevented).toBe(false);
    expect(bandsNow().every((b) => b === 0)).toBe(true);
  });

  it("steps 0.1 EV with Alt, and down when scrolling down", () => {
    mount();
    const layer = adjustLayer();
    fireEvent.pointerMove(layer, { clientX: 100, clientY: 50 });
    scroll(layer, { deltaY: 100, altKey: true });
    const expected = interactiveEdit(DEFAULT_PARAMS.bands, Math.SQRT2, -3, -0.1)!;
    bandsNow().forEach((b, i) => expect(b).toBeCloseTo(expected[i], 6));
  });

  it("commits once for a run of wheel steps, 400 ms after the last", () => {
    vi.useFakeTimers();
    mount();
    const layer = adjustLayer();
    fireEvent.pointerMove(layer, { clientX: 100, clientY: 50 });
    scroll(layer, { deltaY: -100 });
    vi.advanceTimersByTime(COMMIT_DELAY_MS - 50);
    scroll(layer, { deltaY: -100 });
    vi.advanceTimersByTime(COMMIT_DELAY_MS - 50);
    expect(rig.commits).toEqual([]);
    vi.advanceTimersByTime(60);
    expect(rig.commits).toEqual(["Tone Equalizer scroll"]);
  });

  it("holds small wheel deltas until they make a unit, and consumes them meanwhile", () => {
    vi.useFakeTimers();
    mount();
    const layer = adjustLayer();
    fireEvent.pointerMove(layer, { clientX: 100, clientY: 50 });
    for (let i = 0; i < 4; i++) expect(scroll(layer, { deltaY: -20 }).defaultPrevented).toBe(true);
    expect(bandsNow().every((b) => b === 0)).toBe(true);
    scroll(layer, { deltaY: -20 });
    const expected = interactiveEdit(DEFAULT_PARAMS.bands, Math.SQRT2, -3, 0.25)!;
    bandsNow().forEach((b, i) => expect(b).toBeCloseTo(expected[i], 6));
    vi.advanceTimersByTime(COMMIT_DELAY_MS + 10);
    expect(rig.commits).toEqual(["Tone Equalizer scroll"]);
  });

  it("applies a step per whole unit of one event", () => {
    mount();
    const layer = adjustLayer();
    fireEvent.pointerMove(layer, { clientX: 100, clientY: 50 });
    scroll(layer, { deltaY: -200 });
    const once = interactiveEdit(DEFAULT_PARAMS.bands, Math.SQRT2, -3, 0.25)!;
    const twice = interactiveEdit(once, Math.SQRT2, -3, 0.25)!;
    bandsNow().forEach((b, i) => expect(b).toBeCloseTo(twice[i], 5));
  });

  it("drops a partial unit once the wheel has stopped", () => {
    vi.useFakeTimers();
    mount();
    const layer = adjustLayer();
    fireEvent.pointerMove(layer, { clientX: 100, clientY: 50 });
    scroll(layer, { deltaY: -30 });
    scroll(layer, { deltaY: -30 });
    vi.advanceTimersByTime(COMMIT_DELAY_MS + 10);
    scroll(layer, { deltaY: -30 });
    scroll(layer, { deltaY: -30 });
    expect(bandsNow().every((b) => b === 0)).toBe(true);
    expect(rig.commits).toEqual([]);
  });

  it("commits a pending step when the overlay unmounts", () => {
    vi.useFakeTimers();
    const view = mount();
    const layer = adjustLayer();
    fireEvent.pointerMove(layer, { clientX: 100, clientY: 50 });
    scroll(layer, { deltaY: -100 });
    view.unmount();
    expect(rig.commits).toEqual(["Tone Equalizer scroll"]);
    vi.advanceTimersByTime(COMMIT_DELAY_MS * 2);
    expect(rig.commits).toEqual(["Tone Equalizer scroll"]);
  });

  it("discards a step the solve fails on, and flags the curve unstable", () => {
    mount();
    const layer = adjustLayer();
    act(() => store().getState().setCursor({ ev: Number.NaN, local: { x: 100, y: 50 } }));
    const event = scroll(layer, { deltaY: -100 });
    expect(event.defaultPrevented).toBe(true);
    expect(store().getState().unstable).toBe(true);
    expect(bandsNow().every((b) => b === 0)).toBe(true);
    expect(rig.commits).toEqual([]);
  });

  it("goes click-through while Ctrl, ⌘ or Space is held", () => {
    mount();
    const layer = adjustLayer();
    expect(layer.style.pointerEvents).toBe("auto");
    for (const key of ["Control", "Meta", " "]) {
      fireEvent.keyDown(window, { key });
      expect(layer.style.pointerEvents).toBe("none");
      fireEvent.keyUp(window, { key });
      expect(layer.style.pointerEvents).toBe("auto");
    }
    fireEvent.keyDown(window, { key: "Control" });
    fireEvent.blur(window);
    expect(layer.style.pointerEvents).toBe("auto");
  });

  it("removes the layer and the cursor on Esc", () => {
    mount();
    const layer = adjustLayer();
    fireEvent.pointerMove(layer, { clientX: 100, clientY: 50 });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("te-adjust")).toBeNull();
    expect(store().getState().cursor).toBeNull();
  });

  it("keeps adjusting when the host already used the Esc", () => {
    mount();
    adjustLayer();
    const hostUsesEsc = (e: KeyboardEvent) => e.preventDefault();
    window.addEventListener("keydown", hostUsesEsc, true);
    try {
      fireEvent.keyDown(document.body, { key: "Escape" });
    } finally {
      window.removeEventListener("keydown", hostUsesEsc, true);
    }
    expect(store().getState().adjusting).toBe(true);
    expect(screen.getByTestId("te-adjust")).toBeTruthy();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(store().getState().adjusting).toBe(false);
  });

  it("takes the cursor off the image from the host's cursor tokens, and hides it over the image", () => {
    mount();
    rig.api.cursors.resolve = (token) => (token === "crosshair" ? "cell" : token);
    const layer = adjustLayer();
    expect(layer.style.cursor).toBe("cell");
    fireEvent.pointerMove(layer, { clientX: 100, clientY: 50 });
    expect(layer.style.cursor).toBe("none");
  });
});

describe("the overlay with the mask display off", () => {
  it("never reads the core params, and does once the mask display is on", async () => {
    vi.useFakeTimers();
    mount(async () => fakeBitmap(200, 100));
    const watched = countingParams();
    act(() => rig.develop.setState({ params: watched.params }));
    expect(watched.reads()).toBe(0);

    act(() => store().getState().setShowMask(true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(rig.captures).toHaveLength(1);
    expect(watched.reads()).toBeGreaterThan(0);
  });

  it("captures again for a core params change made while the mask display is on", async () => {
    vi.useFakeTimers();
    mount(async () => fakeBitmap(200, 100));
    act(() => store().getState().setShowMask(true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    act(() => rig.develop.setState({ params: coreParams({ exposure: 2 }) }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(rig.captures).toHaveLength(2);
  });
});

describe("Display exposure mask, under a hover preview", () => {
  it("captures a preview's params with its bag, and the edit's again once it ends", async () => {
    vi.useFakeTimers();
    mount(async () => fakeBitmap(200, 100));
    const seen: DevelopParams[] = [];
    const capture = rig.api.develop.captureFrame;
    rig.api.develop.captureFrame = (params, options) => {
      seen.push(params);
      return capture(params, options);
    };
    const settle = () =>
      act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
    const { params: live, paramBag: liveBag } = rig.develop.getState();
    const previewBag = { ...liveBag, ...deriveAll({ ...DEFAULT_PARAMS, exposureBoost: 1.5 }) };
    const previewParams = coreParams({ exposure: 1 });
    expect(maskViewPatch(previewBag)).not.toEqual(maskViewPatch(liveBag));

    act(() => store().getState().setShowMask(true));
    await settle();
    expect(rig.captures).toHaveLength(1);
    expect(seen[0]).toBe(live);
    expect(rig.captures[0].paramBag).toEqual(maskViewPatch(liveBag));

    act(() => rig.develop.setState({ previewParamBag: previewBag }));
    await settle();
    expect(rig.captures).toHaveLength(2);
    expect(seen[1]).toBe(live);
    expect(rig.captures[1].paramBag).toEqual(maskViewPatch(previewBag));

    act(() => rig.develop.setState({ previewParams }));
    await settle();
    expect(rig.captures).toHaveLength(3);
    expect(seen[2]).toBe(previewParams);
    expect(rig.captures[2].paramBag).toEqual(maskViewPatch(previewBag));

    act(() => rig.develop.setState({ previewParams: null, previewParamBag: null }));
    await settle();
    expect(rig.captures).toHaveLength(4);
    expect(seen[3]).toBe(live);
    expect(rig.captures[3].paramBag).toEqual(maskViewPatch(liveBag));
  });
});

describe("Display exposure mask, what re-captures it", () => {
  const settle = () =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

  it("captures again for a mask setting, not for a band or the curve", async () => {
    vi.useFakeTimers();
    mount(async () => fakeBitmap(200, 100));
    act(() => store().getState().setShowMask(true));
    await settle();
    expect(rig.captures).toHaveLength(1);

    const bands = DEFAULT_PARAMS.bands.map((b, i) => (i === 4 ? 0.5 : b));
    act(() => rig.develop.getState().setDynParams(deriveAll({ ...DEFAULT_PARAMS, bands })));
    await settle();
    act(() => rig.develop.getState().setDynParams(deriveAll({ ...DEFAULT_PARAMS, bands, curveSmoothing: 0.5 })));
    await settle();
    expect(rig.captures).toHaveLength(1);

    act(() => rig.develop.getState().setDynParams(deriveAll({ ...DEFAULT_PARAMS, bands, exposureBoost: 1 })));
    await settle();
    expect(rig.captures).toHaveLength(2);
    expect(rig.captures[1].paramBag).toEqual(maskViewPatch(rig.develop.getState().paramBag));
  });

  it("captures again for another extension's setting, which shapes the mask upstream", async () => {
    vi.useFakeTimers();
    mount(async () => fakeBitmap(200, 100));
    act(() => store().getState().setShowMask(true));
    await settle();
    expect(rig.captures).toHaveLength(1);

    act(() => rig.develop.getState().setDynParams({ "other.stage.x": 1 }));
    await settle();
    expect(rig.captures).toHaveLength(2);

    act(() => rig.develop.getState().setDynParams({ "other.stage.x": 1 }));
    await settle();
    expect(rig.captures).toHaveLength(2);
  });

  it("captures again when the core params change", async () => {
    vi.useFakeTimers();
    mount(async () => fakeBitmap(200, 100));
    act(() => store().getState().setShowMask(true));
    await settle();
    act(() => rig.develop.setState({ params: coreParams({ exposure: 1 }) }));
    await settle();
    expect(rig.captures).toHaveLength(2);
  });
});

describe("Display exposure mask, the frames it holds", () => {
  const settle = () =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

  /** Frames that record which of them were closed. */
  function frames() {
    const issued: ImageBitmap[] = [];
    const closed: ImageBitmap[] = [];
    const next = async () => {
      const bitmap: ImageBitmap = fakeBitmap(200, 100, () => void closed.push(bitmap));
      issued.push(bitmap);
      return bitmap;
    };
    return { issued, closed, next };
  }

  it("closes a frame when the next one replaces it", async () => {
    vi.useFakeTimers();
    const f = frames();
    const view = mount(f.next);
    act(() => store().getState().setShowMask(true));
    await settle();
    expect(f.issued).toHaveLength(1);
    expect(f.closed).toEqual([]);
    rig.overlay.nonce = 1;
    view.rerender(React.createElement(ToneEqualizerOverlay));
    await settle();
    expect(f.issued).toHaveLength(2);
    expect(f.closed).toEqual([f.issued[0]]);
  });

  it("closes the held frame when the mask is toggled off", async () => {
    vi.useFakeTimers();
    const f = frames();
    mount(f.next);
    act(() => store().getState().setShowMask(true));
    await settle();
    act(() => store().getState().setShowMask(false));
    expect(f.closed).toEqual([f.issued[0]]);
    expect(screen.queryByTestId("te-mask")).toBeNull();
  });

  it("closes a capture still in flight at toggle-off, and draws only the one started after", async () => {
    vi.useFakeTimers();
    const closed: ImageBitmap[] = [];
    const bitmaps = [1, 2].map(() => {
      const bitmap: ImageBitmap = fakeBitmap(200, 100, () => void closed.push(bitmap));
      return bitmap;
    });
    const lands: ((bitmap: ImageBitmap) => void)[] = [];
    mount(() => new Promise<ImageBitmap>((resolve) => void lands.push(resolve)));
    act(() => store().getState().setShowMask(true));
    await settle();
    expect(lands).toHaveLength(1);

    act(() => store().getState().setShowMask(false));
    act(() => store().getState().setShowMask(true));
    await settle();
    expect(lands).toHaveLength(2);

    await act(async () => {
      lands[0](bitmaps[0]);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(closed).toEqual([bitmaps[0]]);
    expect(screen.queryByTestId("te-mask")).toBeNull();

    await act(async () => {
      lands[1](bitmaps[1]);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId("te-mask")).toBeTruthy();
    expect(closed).toEqual([bitmaps[0]]);
  });
});
