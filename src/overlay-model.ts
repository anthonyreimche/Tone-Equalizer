// The on-image cursor's numbers: darktable's wheel steps (te.c:2859-2929), with
// Alt for the fine step because Ctrl/⌘/Space pass a capturing overlay through
// to pan and zoom, and its scroll accumulation (gui/gtk.c
// dt_gui_get_scroll_unit_deltas); the "%+.1f EV" pill; the greys of the
// before/after circles and the correction wedge (gui/draw.h
// dt_draw_correction_cursor, lines 263-345, here at zoom 1); and the pointer →
// image UV map through the UI zoom.

import { gainAt, type Fit } from "./curve";
import type { OverlayRect } from "./safelight";

export const WHEEL_STEP = 0.25;
export const WHEEL_STEP_COARSE = 1;
export const WHEEL_STEP_FINE = 0.1;

export function wheelStep(e: { shiftKey: boolean; altKey: boolean }): number {
  return e.shiftKey ? WHEEL_STEP_COARSE : e.altKey ? WHEEL_STEP_FINE : WHEEL_STEP;
}

/** A wheel event's scroll in pixels, positive scrolling up. Lines count 16 px
 *  and pages 120, as the host's own wheel zoom does. Shift turns a vertical
 *  wheel horizontal on some systems, so deltaX stands in for a missing deltaY. */
export function wheelPixels(e: { deltaX: number; deltaY: number; deltaMode: number }): number {
  const d = e.deltaY !== 0 ? e.deltaY : e.deltaX;
  const px = e.deltaMode === 1 ? d * 16 : e.deltaMode === 2 ? d * 120 : d;
  return px === 0 ? 0 : -px;
}

/** A mouse notch is nominally 100 px: one scroll unit, one step. */
const WHEEL_UNIT_PX = 100;
/** Notch sizes vary with the display scale and touchpads emit small deltas: an
 *  event of this many px or more is a notch, anything smaller accumulates. */
const NOTCH_MIN_PX = 33;

export interface WheelAccumulator {
  /** The whole steps this event completes: positive up, negative down, 0 while
   *  the deltas have not made a unit. */
  push(e: { deltaX: number; deltaY: number; deltaMode: number }): number;
  /** Forget the remainder, as darktable does when a scroll ends. */
  reset(): void;
}

/** dt_gui_get_scroll_unit_deltas for the small deltas: they accumulate, a step
 *  comes per whole unit, and a change of direction drops the remainder so its
 *  first tick is not spent cancelling it. Pixels accumulate, so equal deltas
 *  sum exactly. A notch steps by its size in units, at least one, and clears
 *  the remainder. */
export function createWheelAccumulator(): WheelAccumulator {
  let pending = 0;
  return {
    push(e) {
      const px = wheelPixels(e);
      if (Math.abs(px) >= NOTCH_MIN_PX) {
        pending = 0;
        return Math.sign(px) * Math.max(1, Math.round(Math.abs(px) / WHEEL_UNIT_PX));
      }
      if ((px > 0 && pending < 0) || (px < 0 && pending > 0)) pending = 0;
      pending += px;
      const steps = Math.trunc(pending / WHEEL_UNIT_PX) || 0;
      pending -= steps * WHEEL_UNIT_PX;
      return steps;
    },
    reset() {
      pending = 0;
    },
  };
}

export function formatExposure(ev: number | null): string {
  if (ev === null || !Number.isFinite(ev)) return "? EV";
  const v = Math.round(ev * 10) / 10;
  return `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)} EV`;
}

const encode = (linear: number) => Math.min(Math.max(linear, 0), 1) ** (1 / 2.2);

/** A linear grey drawn through gamma 1/2.2, as darktable fills the circles. */
export function greyCss(linear: number): string {
  const v = Math.round(255 * encode(linear));
  return `rgb(${v}, ${v}, ${v})`;
}

/** Black over a light grey, white over a dark one. */
export function frameInk(linear: number): string {
  return encode(linear) > 0.5 ? "rgb(0, 0, 0)" : "rgb(255, 255, 255)";
}

/** The wedge's sweep: ±90° at ±2 EV of correction. */
export function wedgeAngle(gainEv: number): number {
  return Math.min(Math.max(0.5 * gainEv, -1), 1) * (Math.PI / 2);
}

const n2 = (v: number) => (Math.abs(v) < 5e-3 ? 0 : v).toFixed(2);

/** The correction in EV the curve gives an exposure: none without a reading
 *  and none from a fit that failed, where darktable draws no correction. */
export function correctionGain(ev: number | null, fit: Fit): number {
  return ev === null || !fit.valid ? 0 : Math.log2(gainAt(ev, fit));
}

export const OUTER_RADIUS = 16;
export const INNER_RADIUS = OUTER_RADIUS / 2;
const PADDING = 4;
const FILL_WIDTH = 4;
/** The wedge's arc radius (draw.h `setting_offset_x`). */
export const WEDGE_RADIUS = OUTER_RADIUS + 4 * PADDING;
/** The wedge is stroked, `2 * fill_width` wide. */
export const WEDGE_WIDTH = 2 * FILL_WIDTH;
/** The crosshair and the ground-level bars. */
export const LINE_WIDTH = 1.5;
export const OUTLINE_WIDTH = 1;
export const CIRCLE_ALPHA = 0.9;
export const PILL_ALPHA = 0.8;

export interface Segment {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

/** The ground-level bars (right 16 to 24 px out, left 16 to 48) and the
 *  crosshair (16 to 36 px above and below), each from its inner end. */
export function cursorBars(x: number, y: number): Segment[] {
  const crosshairEnd = WEDGE_RADIUS + FILL_WIDTH;
  return [
    { x1: x + OUTER_RADIUS, y1: y, x2: x + OUTER_RADIUS + 2 * PADDING, y2: y },
    { x1: x - OUTER_RADIUS, y1: y, x2: x - WEDGE_RADIUS - 4 * PADDING, y2: y },
    { x1: x, y1: y + OUTER_RADIUS, x2: x, y2: y + crosshairEnd },
    { x1: x, y1: y - OUTER_RADIUS, x2: x, y2: y - crosshairEnd },
  ];
}

export interface Pill {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly textX: number;
  readonly textY: number;
}

/** The label's background: 24 px right of the pointer, centred on its row,
 *  with the text inset by the padding. */
export function pillBox(x: number, y: number, textWidth: number, textHeight: number): Pill {
  const left = x + OUTER_RADIUS + 2 * PADDING;
  const height = textHeight + 2 * PADDING;
  return { x: left, y: y - height / 2, width: textWidth + 2 * PADDING, height, textX: left + PADDING, textY: y };
}

/** The wedge as an SVG arc from 9 o'clock, turning up (y-down space) for a
 *  lift and down for a cut; it is stroked, not filled. Empty without a
 *  correction. */
export function wedgePath(cx: number, cy: number, radius: number, angle: number): string {
  if (angle === 0) return "";
  const x1 = cx + radius * Math.cos(Math.PI + angle);
  const y1 = cy + radius * Math.sin(Math.PI + angle);
  return `M ${n2(cx - radius)} ${n2(cy)} A ${radius} ${radius} 0 0 ${angle > 0 ? 1 : 0} ${n2(x1)} ${n2(y1)}`;
}

/** A pointer at (clientX, clientY) in image UV through the overlay's box and
 *  the UI zoom (`scale` = layout px per client px), or null off the image. */
export function pointToUv(
  clientX: number,
  clientY: number,
  box: { left: number; top: number },
  scale: number,
  rect: OverlayRect | null,
): { x: number; y: number } | null {
  if (!rect || rect.w <= 0 || rect.h <= 0) return null;
  const x = ((clientX - box.left) * scale - rect.x) / rect.w;
  const y = ((clientY - box.top) * scale - rect.y) / rect.h;
  if (x < 0 || x >= 1 || y < 0 || y >= 1) return null;
  return { x, y };
}
