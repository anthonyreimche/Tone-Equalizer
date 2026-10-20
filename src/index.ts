// Tone Equalizer, a Safelight extension (GPL-3.0-or-later).
//
// A port of darktable's tone equalizer (© Aurélien Pierre and the darktable
// authors): relight the photo by exposure octave over an edge-aware exposure
// mask. Registers the scene-linear correction stage and the output-encode
// mask view (stage.ts), the Develop panel (Panel.ts) and the canvas overlay
// (Overlay.ts).

import { ToneEqualizerOverlay } from "./Overlay";
import { TonePanel } from "./Panel";
import { EXT_ID, rederivePatch, resetPatch } from "./params";
import { api, initRuntime } from "./runtime";
import type { DevelopStoreState, SafelightAPI } from "./safelight";
import { allStages } from "./stage";
import { initStore, store } from "./store";

const PANEL_ID = `${EXT_ID}.panel`;
const OVERLAY_ID = `${EXT_ID}.overlay`;

let unsubscribe: (() => void) | null = null;

function reset(): void {
  const dev = api().stores.useDevelopStore.getState();
  dev.setDynParams(resetPatch());
  store().getState().setUnstable(false);
  void dev.commitEdit("Tone Equalizer reset");
}

export function activate(host: SafelightAPI): void {
  initRuntime(host);
  initStore();

  // Every key is zero at rest, so an untouched photo never runs the filter.
  for (const stage of allStages()) host.registerProcessingStage(stage);

  host.registerPanel({
    id: PANEL_ID,
    title: "Tone Equalizer",
    component: TonePanel,
    defaultDock: { module: "develop", direction: "right", order: 6, width: 268 },
    onReset: reset,
  });

  host.registerSlot({ id: OVERLAY_ID, slot: "develop-canvas-overlay", component: ToneEqualizerOverlay, order: 55 });

  unsubscribe?.();
  // A bag whose GPU keys disagree with its edit (a preset that carried only
  // some keys, an edit from another release) is re-derived live.
  unsubscribe = host.stores.useDevelopStore.subscribe((state: DevelopStoreState, prev: DevelopStoreState) => {
    if (state.photoId !== prev.photoId) {
      const ui = store().getState();
      ui.setShowMask(false);
      ui.setAdjusting(false);
      ui.setUnstable(false);
    }
    if (state.paramBag === prev.paramBag) return;
    const patch = rederivePatch(state.paramBag);
    if (patch) state.setDynParams(patch);
  });
}

/** The host sweeps the stages and the slot after every deactivate, and that
 *  sweep is what releases the stages' kept state, so they are not
 *  unregistered here first. */
export function deactivate(): void {
  if (!unsubscribe) return;
  unsubscribe();
  unsubscribe = null;
  const ui = store().getState();
  ui.setAdjusting(false);
  ui.setShowMask(false);
}
