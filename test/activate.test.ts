// @vitest-environment jsdom
// Activation: the two stages, the panel and the overlay register under the
// extension; reset writes the all-zero patch and commits once; a bag that
// disagrees with its edit is re-derived live; a new photo turns the toggles
// off; deactivate stops listening and leaves the registrations to the host's sweep.

import { describe, expect, it } from "vitest";
import { activate, deactivate } from "../src/index";
import { DEFAULT_PARAMS } from "../src/model";
import { STAGE_ID, VIEW_STAGE_ID, deriveAll, qualified, resetPatch } from "../src/params";
import { store } from "../src/store";
import { fakeApi } from "./support/fake-api";

describe("activate", () => {
  it("registers the stages, the panel and the overlay", () => {
    const rig = fakeApi();
    activate(rig.api);
    expect(rig.stages.map((s) => s.id)).toEqual([STAGE_ID, VIEW_STAGE_ID]);
    expect(rig.panels.map((p) => [p.id, p.title])).toEqual([["tone-equalizer.panel", "Tone Equalizer"]]);
    expect(rig.panels[0].defaultDock).toMatchObject({ module: "develop", direction: "right" });
    expect(rig.slots.map((s) => [s.id, s.slot])).toEqual([["tone-equalizer.overlay", "develop-canvas-overlay"]]);
    deactivate();
  });

  it("resets to the all-zero patch with one commit", () => {
    const rig = fakeApi(deriveAll({ ...DEFAULT_PARAMS, bands: [1, 0, 0, 0, 0, 0, 0, 0, 0] }));
    activate(rig.api);
    rig.panels[0].onReset?.();
    expect(rig.develop.getState().paramBag).toMatchObject(resetPatch());
    expect(rig.commits).toEqual(["Tone Equalizer reset"]);
    deactivate();
  });

  it("re-derives a bag whose GPU keys disagree with its edit", () => {
    const rig = fakeApi();
    activate(rig.api);
    rig.develop.getState().setDynParams({ [qualified("b4")]: 1 });
    expect(rig.develop.getState().paramBag[qualified("on")]).toBe(1);
    deactivate();
  });

  it("turns the toggles off for a new photo", () => {
    const rig = fakeApi();
    activate(rig.api);
    store().getState().setShowMask(true);
    store().getState().setAdjusting(true);
    rig.develop.setState({ photoId: "p2" });
    expect(store().getState().showMask).toBe(false);
    expect(store().getState().adjusting).toBe(false);
    deactivate();
  });

  it("leaves the registrations to the host's sweep, stops listening and turns the toggles off", () => {
    const rig = fakeApi();
    activate(rig.api);
    store().getState().setShowMask(true);
    store().getState().setAdjusting(true);
    deactivate();
    expect(rig.unregisteredStages).toEqual([]);
    expect(rig.unregisteredSlots).toEqual([]);
    expect(store().getState().showMask).toBe(false);
    expect(store().getState().adjusting).toBe(false);
    rig.develop.getState().setDynParams({ [qualified("b4")]: 1 });
    expect(rig.develop.getState().paramBag[qualified("on")]).toBeUndefined();
  });

  it("does nothing when activate never ran, and when called twice", () => {
    const rig = fakeApi();
    expect(() => deactivate()).not.toThrow();
    activate(rig.api);
    deactivate();
    expect(() => deactivate()).not.toThrow();
  });

  it("drops the earlier subscription when activated again without a deactivate", () => {
    const rig = fakeApi();
    const subscribe = rig.develop.subscribe;
    let live = 0;
    rig.develop.subscribe = (listener) => {
      live++;
      const off = subscribe(listener);
      return () => {
        live--;
        off();
      };
    };
    activate(rig.api);
    activate(rig.api);
    expect(live).toBe(1);
    deactivate();
    expect(live).toBe(0);
  });

  it("clears the unstable flag on reset", () => {
    const rig = fakeApi();
    activate(rig.api);
    store().getState().setUnstable(true);
    rig.panels[0].onReset?.();
    expect(store().getState().unstable).toBe(false);
    deactivate();
  });

  it("clears the unstable flag for a new photo", () => {
    const rig = fakeApi();
    activate(rig.api);
    store().getState().setUnstable(true);
    rig.develop.setState({ photoId: "p2" });
    expect(store().getState().unstable).toBe(false);
    deactivate();
  });

  it("leaves a bag that already agrees with its edit untouched", () => {
    const rig = fakeApi();
    activate(rig.api);
    const agreeing = deriveAll({ ...DEFAULT_PARAMS, bands: [1, 0, 0, 0, 0, 0, 0, 0, 0] });
    let updates = 0;
    rig.develop.subscribe(() => void updates++);
    rig.develop.setState({ paramBag: agreeing });
    expect(rig.develop.getState().paramBag).toBe(agreeing);
    expect(updates).toBe(1);
    deactivate();
  });

  it("settles a bag that disagrees with its edit in one write", () => {
    const rig = fakeApi();
    activate(rig.api);
    let updates = 0;
    rig.develop.subscribe(() => void updates++);
    rig.develop.getState().setDynParams({ [qualified("b4")]: 1 });
    expect(updates).toBe(2);
    const settled = rig.develop.getState().paramBag;
    rig.develop.setState({ photoId: "p1" });
    expect(rig.develop.getState().paramBag).toBe(settled);
    deactivate();
  });
});
