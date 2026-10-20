// @vitest-environment jsdom
// ToneGraph mounted on the fake host: what it draws from the store, how it
// reads the pointer, and when it writes and commits.

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToneGraph, WARN_COLOUR } from "../src/Graph";
import { evToX, graphHeight, plotRect } from "../src/graph-model";
import { logHistogram } from "../src/measure";
import { DEFAULT_PARAMS } from "../src/model";
import { deriveAll, readParams } from "../src/params";
import { h, initRuntime } from "../src/runtime";
import { initStore, store } from "../src/store";
import { fakeApi, type Rig } from "./support/fake-api";
import { recordingContext, type Call } from "./support/recording-context";

// ToneGraph's width until a ResizeObserver reports one; jsdom has none.
const WIDTH = 240;
const HEIGHT = graphHeight(WIDTH);
const r = plotRect(WIDTH, HEIGHT);

let rig: Rig;
let calls: Call[];
let box: { left: number; top: number; width: number; height: number };

const mount = () => {
  const view = render(h(ToneGraph));
  return view.container.querySelector("canvas") as HTMLCanvasElement;
};

const pointer = (x: number, y: number) => ({
  clientX: box.left + (x * box.width) / WIDTH,
  clientY: box.top + (y * box.height) / HEIGHT,
  button: 0,
  pointerId: 1,
});

const bandsOf = () => readParams(rig.develop.getState().paramBag).bands;
const ofOp = (op: string) => calls.filter((c) => c.op === op);

const probe = () => ({
  width: 2,
  height: 2,
  ev: Float32Array.of(-6, -5, -4, -3),
  histogram: logHistogram([-6, -5, -4, -3]),
  signature: "",
});

beforeEach(() => {
  rig = fakeApi();
  initRuntime(rig.api);
  initStore();
  box = { left: 10, top: 20, width: WIDTH, height: HEIGHT };
  const recorder = recordingContext();
  calls = recorder.calls;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(recorder.ctx as never);
  vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockImplementation(
    () => new DOMRect(box.left, box.top, box.width, box.height),
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ToneGraph drawing", () => {
  it("draws the curve at once, with no histogram while the probe is null", () => {
    mount();
    expect(ofOp("arc")).toHaveLength(9);
    expect(ofOp("fill")).toHaveLength(0);
  });

  it("adds the histogram when a probe arrives and drops it when the probe is cleared", () => {
    mount();
    act(() => store().getState().setProbe(probe()));
    expect(ofOp("fill").filter((c) => c.fillStyle !== WARN_COLOUR)).toHaveLength(1);
    calls.length = 0;
    act(() => store().getState().setProbe(null));
    expect(ofOp("arc")).toHaveLength(9);
    expect(ofOp("fill")).toHaveLength(0);
  });

  it("lights the node nearest the image cursor", () => {
    mount();
    calls.length = 0;
    act(() => store().getState().setCursor({ ev: -2.6, local: { x: 0, y: 0 } }));
    expect(ofOp("fill")).toHaveLength(1);
  });

  it("paints the canvas with the surface token", () => {
    expect(mount().getAttribute("style")).toContain("var(--color-surface-0)");
  });

  it("follows the pointer with the influence circle, in layout px under UI zoom", () => {
    box = { left: 10, top: 20, width: 2 * WIDTH, height: 2 * HEIGHT };
    const canvas = mount();
    calls.length = 0;
    fireEvent.pointerMove(canvas, pointer(100, 50));
    const circles = ofOp("arc");
    expect(circles).toHaveLength(10);
    expect(circles[9].args[0]).toBeCloseTo(100, 9);
    calls.length = 0;
    fireEvent.pointerLeave(canvas);
    expect(ofOp("arc")).toHaveLength(9);
  });
});

describe("ToneGraph canvas", () => {
  const LIGHT_INK = "rgba(25, 25, 25, 0.9)";
  const DARK_INK = "rgba(235, 235, 235, 0.92)";

  it.each([
    ["rgb(244, 244, 244)", LIGHT_INK],
    ["rgb(128, 128, 128)", LIGHT_INK],
    ["rgb(82, 82, 82)", DARK_INK],
    ["rgb(10, 10, 10)", DARK_INK],
  ])("inks a surface of %s with %s", (surface, ink) => {
    vi.spyOn(window, "getComputedStyle").mockReturnValue({ backgroundColor: surface } as CSSStyleDeclaration);
    mount();
    const strokes = ofOp("stroke").map((c) => c.strokeStyle);
    expect(strokes).toContain(ink);
    expect(strokes).not.toContain(ink === LIGHT_INK ? DARK_INK : LIGHT_INK);
  });

  it("re-derives the ink when a theme restyles the root, and not on every redraw", async () => {
    let surface = "rgb(10, 10, 10)";
    const computed = vi
      .spyOn(window, "getComputedStyle")
      .mockImplementation(() => ({ backgroundColor: surface }) as CSSStyleDeclaration);
    const canvas = mount();
    const reads = () => computed.mock.calls.filter(([el]) => el === canvas).length;
    fireEvent.pointerMove(canvas, pointer(100, 50));
    fireEvent.pointerMove(canvas, pointer(120, 60));
    expect(reads()).toBe(1);
    surface = "rgb(244, 244, 244)";
    calls.length = 0;
    await act(async () => {
      document.documentElement.setAttribute("data-theme", "ivory");
    });
    document.documentElement.removeAttribute("data-theme");
    expect(reads()).toBe(2);
    expect(ofOp("stroke").map((c) => c.strokeStyle)).toContain(LIGHT_INK);
  });

  it("sizes the backing store by the device pixel ratio and draws in layout px", () => {
    vi.stubGlobal("devicePixelRatio", 2);
    const canvas = mount();
    expect(canvas.width).toBe(2 * WIDTH);
    expect(canvas.height).toBe(2 * HEIGHT);
    expect(ofOp("setTransform")[0].args).toEqual([2, 0, 0, 2, 0, 0]);
  });

  it("resizes the backing store once, not on every redraw", () => {
    const widthSet = vi.spyOn(HTMLCanvasElement.prototype, "width", "set");
    const heightSet = vi.spyOn(HTMLCanvasElement.prototype, "height", "set");
    const canvas = mount();
    expect([widthSet.mock.calls.length, heightSet.mock.calls.length]).toEqual([1, 1]);
    fireEvent.pointerMove(canvas, pointer(100, 50));
    fireEvent.pointerMove(canvas, pointer(120, 60));
    act(() => store().getState().setCursor({ ev: -3, local: { x: 0, y: 0 } }));
    expect([widthSet.mock.calls.length, heightSet.mock.calls.length]).toEqual([1, 1]);
  });
});

describe("ToneGraph gestures", () => {
  const drag = (canvas: HTMLCanvasElement, upBy: number) => {
    const from = { x: evToX(-4, r), y: r.y + r.h / 2 };
    fireEvent.pointerDown(canvas, pointer(from.x, from.y));
    fireEvent.pointerMove(canvas, pointer(from.x, from.y - upBy));
  };

  it("raises the curve around the pointer while dragging, and commits once on release", () => {
    const canvas = mount();
    drag(canvas, r.h / 8);
    expect(bandsOf()[4]).toBeGreaterThan(0.2);
    expect(rig.commits).toEqual([]);
    fireEvent.pointerUp(canvas);
    fireEvent.lostPointerCapture(canvas);
    expect(rig.commits).toEqual(["Tone Equalizer curve"]);
  });

  it("writes the derived keys with the edit, so the stage follows the drag", () => {
    const canvas = mount();
    drag(canvas, r.h / 8);
    expect(rig.develop.getState().paramBag).toMatchObject(deriveAll({ ...DEFAULT_PARAMS, bands: bandsOf() }));
  });

  it("commits nothing for a click that never moved", () => {
    const canvas = mount();
    fireEvent.pointerDown(canvas, pointer(evToX(-4, r), r.y + r.h / 2));
    fireEvent.pointerUp(canvas);
    expect(rig.commits).toEqual([]);
    expect(bandsOf()).toEqual(DEFAULT_PARAMS.bands);
  });

  it("ignores a drag started with another button", () => {
    const canvas = mount();
    fireEvent.pointerDown(canvas, { ...pointer(evToX(-4, r), r.y + r.h / 2), button: 2 });
    fireEvent.pointerMove(canvas, pointer(evToX(-4, r), r.y));
    fireEvent.pointerUp(canvas);
    expect(rig.commits).toEqual([]);
    expect(bandsOf()).toEqual(DEFAULT_PARAMS.bands);
  });

  it("moves the same distance whatever the UI zoom", () => {
    box = { ...box, width: 2 * WIDTH, height: 2 * HEIGHT };
    const canvas = mount();
    drag(canvas, r.h / 8);
    const zoomed = bandsOf();
    cleanup();
    rig.develop.getState().setDynParams(deriveAll(DEFAULT_PARAMS));
    box = { ...box, width: WIDTH, height: HEIGHT };
    drag(mount(), r.h / 8);
    zoomed.forEach((band, i) => expect(bandsOf()[i]).toBeCloseTo(band, 9));
  });

  it("discards a step the fit cannot take, draws the curve as unstable and commits nothing", () => {
    const canvas = mount();
    fireEvent.pointerDown(canvas, pointer(evToX(-4, r), r.y + r.h / 2));
    const move = pointer(evToX(-4, r), r.y);
    box = { ...box, top: Number.POSITIVE_INFINITY };
    calls.length = 0;
    fireEvent.pointerMove(canvas, move);
    fireEvent.pointerUp(canvas);
    expect(bandsOf()).toEqual(DEFAULT_PARAMS.bands);
    expect(store().getState().unstable).toBe(true);
    expect(ofOp("stroke").some((c) => c.strokeStyle === WARN_COLOUR)).toBe(true);
    expect(rig.commits).toEqual([]);
  });

  it("resets the nine bands on a double-click, clears the warning and commits the reset", () => {
    rig.develop.getState().setDynParams(deriveAll({ ...DEFAULT_PARAMS, bands: [0, 0, 0, 0.5, 1, 0.5, 0, 0, 0] }));
    store().getState().setUnstable(true);
    const canvas = mount();
    fireEvent.doubleClick(canvas);
    expect(bandsOf()).toEqual(DEFAULT_PARAMS.bands);
    expect(store().getState().unstable).toBe(false);
    expect(rig.commits).toEqual(["Tone Equalizer reset curve"]);
  });
});
