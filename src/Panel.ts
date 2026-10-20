// The Tone Equalizer panel: darktable's three notebook pages as tabs (simple:
// the nine bands; advanced: the graph, curve smoothing and the two mask
// compensations with their auto buttons; masking: the filter), the preset
// menu, and the Display exposure mask / Adjust on image toggles. Sliders write
// the bag live and commit on release with their own label.

import type { CSSProperties, ReactNode } from "react";
import { ToneGraph, WARN_COLOUR } from "./Graph";
import { autoContrast, autoExposure, type LogHistogram } from "./measure";
import { CENTERS_PARAMS, DEFAULT_PARAMS, type Details, type Estimator, type Params } from "./model";
import { HARD, deriveAll, fitOf, readParams } from "./params";
import { PRESETS } from "./presets";
import { probeSignature, startLiveProbe } from "./readback";
import { api, h } from "./runtime";
import { store, type Probe } from "./store";

export type Tab = "simple" | "advanced" | "masking";
export const TABS: readonly { value: Tab; label: string }[] = [
  { value: "simple", label: "Simple" },
  { value: "advanced", label: "Advanced" },
  { value: "masking", label: "Masking" },
];
export const TAB_SETTING = "tab";

export interface SliderSpec {
  readonly label: string;
  /** darktable's soft range: the slider's span. */
  readonly min: number;
  readonly max: number;
  /** darktable's hard range: how far a value set past the soft range widens it. */
  readonly hardMin: number;
  readonly hardMax: number;
  readonly step: number;
  read(p: Params): number;
  write(p: Params, value: number): Params;
  readonly commitLabel: string;
}

const bandLabel = (ev: number) => (ev === 0 ? "+0 EV" : `−${-ev} EV`);

export const BAND_SLIDERS: readonly SliderSpec[] = CENTERS_PARAMS.map((ev, i) => ({
  label: bandLabel(ev),
  min: HARD.band.min,
  max: HARD.band.max,
  hardMin: HARD.band.min,
  hardMax: HARD.band.max,
  step: 0.01,
  read: (p) => p.bands[i],
  write: (p, value) => ({ ...p, bands: p.bands.map((b, k) => (k === i ? value : b)) }),
  commitLabel: bandLabel(ev),
}));

export const SMOOTHING_SLIDER: SliderSpec = {
  label: "Curve smoothing",
  min: -1,
  max: 1,
  hardMin: HARD.smoothing.min,
  hardMax: HARD.smoothing.max,
  step: 0.01,
  read: (p) => p.curveSmoothing,
  write: (p, curveSmoothing) => ({ ...p, curveSmoothing }),
  commitLabel: "curve smoothing",
};

export const EXPOSURE_SLIDER: SliderSpec = {
  label: "Mask exposure compensation",
  min: -4,
  max: 4,
  hardMin: HARD.boost.min,
  hardMax: HARD.boost.max,
  step: 0.01,
  read: (p) => p.exposureBoost,
  write: (p, exposureBoost) => ({ ...p, exposureBoost }),
  commitLabel: "mask exposure compensation",
};

export const CONTRAST_SLIDER: SliderSpec = {
  label: "Mask contrast compensation",
  min: -2,
  max: 2,
  hardMin: HARD.boost.min,
  hardMax: HARD.boost.max,
  step: 0.01,
  read: (p) => p.contrastBoost,
  write: (p, contrastBoost) => ({ ...p, contrastBoost }),
  commitLabel: "mask contrast compensation",
};

export const DIFFUSION_SLIDER: SliderSpec = {
  label: "Filter diffusion",
  min: 1,
  max: 5,
  hardMin: HARD.iterations.min,
  hardMax: HARD.iterations.max,
  step: 1,
  read: (p) => p.iterations,
  write: (p, value) => ({ ...p, iterations: Math.round(value) }),
  commitLabel: "filter diffusion",
};

export const DIAMETER_SLIDER: SliderSpec = {
  label: "Smoothing diameter",
  min: 1,
  max: 45,
  hardMin: HARD.blending.min,
  hardMax: HARD.blending.max,
  step: 0.1,
  read: (p) => p.blending,
  write: (p, blending) => ({ ...p, blending }),
  commitLabel: "smoothing diameter",
};

export const FEATHERING_SLIDER: SliderSpec = {
  label: "Edges refinement/feathering",
  min: 0.1,
  max: 50,
  hardMin: HARD.feathering.min,
  hardMax: HARD.feathering.max,
  step: 0.01,
  read: (p) => p.feathering,
  write: (p, feathering) => ({ ...p, feathering }),
  commitLabel: "edges refinement/feathering",
};

export function sliderSpan(spec: SliderSpec, value: number): { min: number; max: number } {
  return {
    min: Math.max(spec.hardMin, Math.min(spec.min, value)),
    max: Math.min(spec.hardMax, Math.max(spec.max, value)),
  };
}

const decimals = (step: number) => (String(step).split(".")[1] ?? "").length;

/** The value as the slider shows it: to the step's decimals plus a guard digit,
 *  so a float32 band (0.6499999761581421) reads 0.65. Display only; the bag
 *  keeps the exact value. */
export function shownValue(spec: SliderSpec, value: number): number {
  return Number(value.toFixed(decimals(spec.step) + 1));
}

/** darktable's luminance estimators, in its combobox order. */
export const ESTIMATOR_OPTIONS: readonly { value: Estimator; label: string }[] = [
  { value: "mean", label: "RGB average" },
  { value: "lightness", label: "HSL lightness" },
  { value: "value", label: "HSV value / RGB max" },
  { value: "norm1", label: "RGB sum" },
  { value: "norm2", label: "RGB euclidean norm" },
  { value: "power", label: "RGB power norm" },
  { value: "geomean", label: "RGB geometric mean" },
];

/** darktable's "preserve details" choices, in its combobox order. */
export const DETAILS_OPTIONS: readonly { value: Details; label: string }[] = [
  { value: "none", label: "No" },
  { value: "avg-guided", label: "Averaged guided filter" },
  { value: "guided", label: "Guided filter" },
  { value: "avg-eigf", label: "Averaged EIGF" },
  { value: "eigf", label: "EIGF" },
];

/** show_guiding_controls (te.c:2369-2408). */
export function visibleControls(details: Details): { filter: boolean; contrast: boolean } {
  return { filter: details !== "none", contrast: details === "eigf" || details === "guided" };
}

export const UNSTABLE_MESSAGE = "The interpolation is unstable, decrease the curve smoothing";
export const ADJUST_HINT = "Scroll over the image to change the tone there: Shift for 1 EV steps, Alt for 0.1 EV. Esc stops.";

/** An auto button's result; a non-finite one (the deciles coincide, as
 *  upstream) is null: the click is discarded. deriveAll holds the rest to the
 *  hard range. */
const finite = (v: number): number | null => (Number.isFinite(v) ? v : null);

/** darktable's "wait for the preview to finish recomputing": the probe's
 *  histogram counts only while the probe was rendered from what the develop
 *  state holds now, since the auto buttons undo the current boosts. */
function measuredHistogram(probe: Probe | null, signature: string): LogHistogram | null {
  return probe && probe.signature === signature ? probe.histogram : null;
}

function readTab(): Tab {
  const saved = api().settings.get<string>(TAB_SETTING, "simple");
  return TABS.find((t) => t.value === saved)?.value ?? "simple";
}

export function TonePanel() {
  const { useEffect, useState } = api().react;
  const { Slider } = api().components;
  const { Button, SegmentedControl, Select, Stack, Toggle, tokens } = api().ui;
  const dev = api().stores.useDevelopStore;
  const [tab, setTab] = useState<Tab>(readTab);
  const paramBag = dev((s) => s.paramBag);
  const probe = store()((s) => s.probe);
  // Only the Advanced page compares it, and it stringifies the core params.
  const signature = dev((s) => (tab === "advanced" ? probeSignature(s) : ""));
  const showMask = store()((s) => s.showMask);
  const adjusting = store()((s) => s.adjusting);
  const unstable = store()((s) => s.unstable);
  const p = readParams(paramBag);
  const visible = visibleControls(p.details);

  useEffect(() => {
    const stop = startLiveProbe();
    return () => {
      stop();
      const ui = store().getState();
      ui.setShowMask(false);
      ui.setAdjusting(false);
    };
  }, []);

  const live = () => readParams(dev.getState().paramBag);
  const measured = () => measuredHistogram(store().getState().probe, probeSignature(dev.getState()));
  const apply = (next: Params) => {
    store().getState().setUnstable(false);
    dev.getState().setDynParams(deriveAll(next));
  };
  const commit = (what: string) => void dev.getState().commitEdit(`Tone Equalizer ${what}`);

  const slider = (spec: SliderSpec): ReactNode => {
    const value = shownValue(spec, spec.read(p));
    const span = sliderSpan(spec, value);
    return h(Slider, {
      key: spec.label,
      label: spec.label,
      value,
      min: span.min,
      max: span.max,
      step: spec.step,
      defaultValue: spec.read(DEFAULT_PARAMS),
      onChange: (v: number) => apply(spec.write(live(), v)),
      onCommit: () => commit(spec.commitLabel),
    });
  };

  const labelStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 3, fontSize: 11, color: tokens.textSecondary };
  const choose = <T extends string>(label: string, value: T, options: readonly { value: T; label: string }[], set: (v: T) => Params, what: string) =>
    h(
      "label",
      { key: label, style: labelStyle },
      label,
      h(Select, {
        value,
        ariaLabel: label,
        options: options.map((o) => ({ value: o.value, label: o.label })),
        onChange: (v: string) => {
          const picked = options.find((o) => o.value === v);
          if (!picked) return;
          apply(set(picked.value));
          commit(what);
        },
      }),
    );

  const autoButton = (ready: boolean, title: string, what: string, next: (histogram: LogHistogram) => Params | null) =>
    h(
      Button,
      {
        size: "sm",
        disabled: !ready,
        "aria-label": title,
        title: ready ? title : "Wait for the preview to finish recomputing",
        onClick: () => {
          const histogram = measured();
          if (!histogram) return;
          const target = next(histogram);
          if (!target) return;
          apply(target);
          commit(what);
        },
      },
      "Auto",
    );

  const withButton = (control: ReactNode, button: ReactNode) =>
    h("div", { style: { display: "flex", alignItems: "flex-end", gap: 6 } }, h("div", { style: { flex: 1 } }, control), button);

  const advancedPage = (): ReactNode[] => {
    const unstableNote =
      (unstable || (!fitOf(p).valid && p.bands.some((b) => b !== 0))) &&
      h("p", { key: "unstable", style: { margin: 0, fontSize: 10, color: WARN_COLOUR } }, UNSTABLE_MESSAGE);
    const ready = measuredHistogram(probe, signature) !== null;
    const autoExposureButton = autoButton(ready, "Auto-adjust the mask exposure", "auto mask exposure", (histogram) => {
      const cur = live();
      const exposureBoost = finite(autoExposure(histogram.first, histogram.last, cur.exposureBoost, cur.contrastBoost));
      return exposureBoost === null ? null : { ...cur, exposureBoost };
    });
    const autoContrastButton = autoButton(ready, "Auto-adjust the mask contrast", "auto mask contrast", (histogram) => {
      const cur = live();
      const contrastBoost = finite(autoContrast(histogram.first, histogram.last, cur));
      return contrastBoost === null ? null : { ...cur, contrastBoost };
    });
    return [
      h(ToneGraph, { key: "graph" }),
      unstableNote,
      slider(SMOOTHING_SLIDER),
      withButton(slider(EXPOSURE_SLIDER), autoExposureButton),
      visible.contrast ? withButton(slider(CONTRAST_SLIDER), autoContrastButton) : null,
    ];
  };

  const pages: Record<Tab, () => ReactNode[]> = {
    simple: () => BAND_SLIDERS.map(slider),
    advanced: advancedPage,
    masking: () => [
      choose("Luminance estimator", p.estimator, ESTIMATOR_OPTIONS, (estimator) => ({ ...live(), estimator }), "luminance estimator"),
      choose("Preserve details", p.details, DETAILS_OPTIONS, (details) => ({ ...live(), details }), "preserve details"),
      ...(visible.filter ? [slider(DIFFUSION_SLIDER), slider(DIAMETER_SLIDER), slider(FEATHERING_SLIDER)] : []),
    ],
  };

  const presetMenu = h(Select, {
    value: "",
    placeholder: "Preset",
    ariaLabel: "Preset",
    options: PRESETS.map((preset) => ({ value: preset.name, label: preset.name })),
    onChange: (name: string) => {
      const preset = PRESETS.find((x) => x.name === name);
      if (!preset) return;
      apply(preset.params);
      commit(`preset ${preset.name}`);
    },
  });

  const hintStyle: CSSProperties = { margin: 0, fontSize: 10, lineHeight: 1.4, color: tokens.textMuted };

  return h(
    Stack,
    { gap: 8, style: { padding: "6px 8px 8px" } },
    presetMenu,
    h(SegmentedControl, {
      value: tab,
      size: "sm",
      options: TABS.map((t) => ({ value: t.value, label: t.label })),
      onChange: (v: string) => {
        const picked = TABS.find((t) => t.value === v);
        if (!picked) return;
        setTab(picked.value);
        api().settings.set(TAB_SETTING, picked.value);
      },
    }),
    h("div", { style: { display: "flex", flexDirection: "column", gap: 4 } }, ...pages[tab]()),
    h(Toggle, { label: "Display exposure mask", checked: showMask, onChange: (on: boolean) => store().getState().setShowMask(on) }),
    h(Toggle, { label: "Adjust on image", checked: adjusting, onChange: (on: boolean) => store().getState().setAdjusting(on) }),
    adjusting ? h("p", { style: hintStyle }, ADJUST_HINT) : null,
  );
}
