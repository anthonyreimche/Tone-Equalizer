// Session state the panel, the graph and the overlay share: the latest probe
// of the mask, the image cursor, the two toggles, and whether the last fit
// failed. Built on the host's zustand `create` so components subscribe like
// core does.

import type { LogHistogram } from "./measure";
import { api } from "./runtime";
import type { StoreApi } from "./safelight";

export interface Probe {
  readonly width: number;
  readonly height: number;
  /** Mask exposure (EV) per pixel, rows top-down; NaN where the mask was invalid. */
  readonly ev: Float32Array;
  readonly histogram: LogHistogram | null;
  /** `probeSignature` of the develop state the frame was rendered from: the
   *  histogram describes the mask only while the state still has that signature. */
  readonly signature: string;
}

export interface ImageCursor {
  /** The mask exposure under the pointer; null where the probe has none. */
  readonly ev: number | null;
  /** The pointer in the overlay's layout px. */
  readonly local: { readonly x: number; readonly y: number };
}

export interface UiState {
  probe: Probe | null;
  cursor: ImageCursor | null;
  adjusting: boolean;
  showMask: boolean;
  unstable: boolean;
  setProbe(probe: Probe | null): void;
  setCursor(cursor: ImageCursor | null): void;
  setAdjusting(adjusting: boolean): void;
  setShowMask(showMask: boolean): void;
  setUnstable(unstable: boolean): void;
}

let current: StoreApi<UiState> | null = null;

export function initStore(): void {
  current = api().stores.create<UiState>((set) => ({
    probe: null,
    cursor: null,
    adjusting: false,
    showMask: false,
    unstable: false,
    setProbe: (probe) => set({ probe }),
    setCursor: (cursor) => set({ cursor }),
    setAdjusting: (adjusting) => set(adjusting ? { adjusting } : { adjusting, cursor: null }),
    setShowMask: (showMask) => set({ showMask }),
    setUnstable: (unstable) => set({ unstable }),
  }));
}

export function store(): StoreApi<UiState> {
  if (!current) throw new Error("[tone-equalizer] store() called before activate()");
  return current;
}
