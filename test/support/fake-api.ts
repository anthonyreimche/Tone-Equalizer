// A stand-in Safelight API over real React and zustand: the develop store
// holds a param bag and records commits; renders, captures and registrations
// are recorded; the ui kit and the Slider are plain DOM so Testing Library can
// find controls by their labels.

import * as React from "react";
import { create } from "zustand";
import type {
  ButtonProps,
  CaptureOptions,
  DevelopParams,
  DevelopStoreState,
  OverlayRect,
  PanelContribution,
  ProcessingStageContribution,
  RowProps,
  SafelightAPI,
  SegmentedControlProps,
  SelectProps,
  SliderProps,
  SlotContribution,
  StackProps,
  StateCreator,
  StoreApi,
  ToggleProps,
  UiKit,
} from "../../src/safelight";

const e = React.createElement;

type RenderOptions = NonNullable<Parameters<SafelightAPI["develop"]["renderPhotoFrame"]>[3]>;

const ui: UiKit = {
  Button: ({ variant: _variant, size: _size, active, full: _full, children, ...rest }: ButtonProps) =>
    e("button", { type: "button", "aria-pressed": active, ...rest }, children),
  Select: ({ value, onChange, options, ariaLabel, placeholder, disabled }: SelectProps) =>
    e(
      "select",
      { value, "aria-label": ariaLabel, disabled, onChange: (ev: React.ChangeEvent<HTMLSelectElement>) => onChange(ev.target.value) },
      e("option", { value: "" }, placeholder ?? ""),
      ...(options ?? []).map((o) => e("option", { key: o.value, value: o.value }, o.label)),
    ),
  SegmentedControl: ({ value, onChange, options }: SegmentedControlProps) =>
    e(
      "div",
      { role: "group" },
      ...options.map((o) =>
        e("button", { key: o.value, type: "button", title: o.title, "aria-pressed": o.value === value, onClick: () => onChange(o.value) }, o.label),
      ),
    ),
  Toggle: ({ checked, onChange, label, ariaLabel }: ToggleProps) =>
    e(
      "label",
      null,
      e("input", {
        type: "checkbox",
        checked,
        "aria-label": ariaLabel ?? (typeof label === "string" ? label : undefined),
        onChange: (ev: React.ChangeEvent<HTMLInputElement>) => onChange(ev.target.checked),
      }),
      label,
    ),
  Row: ({ children }: RowProps) => e("div", null, children),
  Stack: ({ children }: StackProps) => e("div", null, children),
  tokens: {
    surface0: "var(--color-surface-0)",
    surface2: "var(--color-surface-2)",
    border: "var(--color-border)",
    textPrimary: "var(--color-text-primary)",
    textSecondary: "var(--color-text-secondary)",
    textMuted: "var(--color-text-muted)",
    accent: "var(--color-accent)",
  },
};

const Slider = ({ label, value, onChange, onCommit, min, max, step }: SliderProps) =>
  e("input", {
    type: "range",
    "aria-label": label,
    value,
    min,
    max,
    step,
    onChange: (ev: React.ChangeEvent<HTMLInputElement>) => onChange(Number(ev.target.value)),
    onMouseUp: onCommit,
    onKeyUp: onCommit,
  });

// The core's develop params are opaque to the extension; any object stands in.
const PARAMS = {} as DevelopParams;

export function fakeBitmap(width = 2, height = 2, close: () => void = () => undefined): ImageBitmap {
  return { width, height, close };
}

export interface Rig {
  api: SafelightAPI;
  develop: StoreApi<DevelopStoreState>;
  ui: UiKit;
  commits: string[];
  /** The paramBag of each renderPhotoFrame call. */
  renders: Record<string, unknown>[];
  /** The options of each renderPhotoFrame call, in step with `renders`; {} where none were passed. */
  renderOptions: RenderOptions[];
  /** The options of each captureFrame call. */
  captures: CaptureOptions[];
  settings: Map<string, unknown>;
  /** What useDevelopOverlay returns; tests change it and re-render. `imageRect`
   *  follows `rect` until a test sets it. */
  overlay: { rect: OverlayRect | null; imageRect?: OverlayRect | null; nonce: number };
  stages: ProcessingStageContribution[];
  panels: PanelContribution[];
  slots: SlotContribution[];
  unregisteredStages: string[];
  unregisteredSlots: string[];
}

/** `frames` answers renderPhotoFrame and captureFrame; without it they never settle.
 *  `renderFrames` answers renderPhotoFrame alone, and may resolve null as the host can. */
export function fakeApi(
  bag: Record<string, unknown> = {},
  frames?: () => Promise<ImageBitmap>,
  renderFrames?: () => Promise<ImageBitmap | null>,
): Rig {
  const commits: string[] = [];
  const renders: Record<string, unknown>[] = [];
  const renderOptions: RenderOptions[] = [];
  const captures: CaptureOptions[] = [];
  const settings = new Map<string, unknown>();
  const overlay: Rig["overlay"] = { rect: null, nonce: 0 };
  const stages: ProcessingStageContribution[] = [];
  const panels: PanelContribution[] = [];
  const slots: SlotContribution[] = [];
  const unregisteredStages: string[] = [];
  const unregisteredSlots: string[] = [];
  const never = () => new Promise<ImageBitmap>(() => undefined);
  const develop: StoreApi<DevelopStoreState> = create<DevelopStoreState>()((set) => ({
    photoId: "p1",
    params: PARAMS,
    previewParams: null,
    previewParamBag: null,
    paramBag: bag,
    histogram: null,
    setDynParams: (patch) => set((s) => ({ paramBag: { ...s.paramBag, ...patch } })),
    commitEdit: async (label) => {
      commits.push(label);
    },
  }));
  const api: SafelightAPI = {
    version: 1,
    extensionId: "tone-equalizer",
    react: React,
    registerProcessingStage: (c) => void stages.push(c),
    unregisterProcessingStage: (id) => void unregisteredStages.push(id),
    registerPanel: (c) => void panels.push(c),
    registerSlot: (c) => void slots.push(c),
    unregisterSlot: (id) => void unregisteredSlots.push(id),
    settings: {
      get: <T,>(key: string, fallback: T): T => (settings.has(key) ? (settings.get(key) as T) : fallback),
      set: (key, value) => void settings.set(key, value),
    },
    components: { Slider },
    ui,
    stores: {
      create: <T,>(init: StateCreator<T>) => create<T>()(init),
      useDevelopStore: develop,
    },
    cursors: { resolve: (token) => token },
    develop: {
      useDevelopOverlay: () => ({ rect: overlay.rect, imageRect: overlay.imageRect === undefined ? overlay.rect : overlay.imageRect, nonce: overlay.nonce }),
      captureFrame: (_params, options) => {
        captures.push(options ?? {});
        return (frames ?? never)();
      },
      renderPhotoFrame: (_photoId, _params, paramBag, options) => {
        renders.push(paramBag ?? {});
        renderOptions.push(options ?? {});
        return (renderFrames ?? frames ?? never)();
      },
    },
  };
  return { api, develop, ui, commits, renders, renderOptions, captures, settings, overlay, stages, panels, slots, unregisteredStages, unregisteredSlots };
}
