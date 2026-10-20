// The advanced tab's graph, as arithmetic: the plot area in CSS px, the EV ↔ x
// and correction ↔ y maps of darktable's plot (te.c area_draw), its drag rule,
// node picking, the influence circle and the histogram's bars.

import type { LogHistogram } from "./measure";
import { CENTERS_PARAMS, MAX_EV, MIN_EV } from "./model";

export interface PlotRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Room for the EV labels across the top and the correction labels at the right. */
export const MARGIN = { left: 6, right: 22, top: 14, bottom: 6 } as const;

const SPAN = MAX_EV - MIN_EV;

export function graphHeight(width: number): number {
  return Math.round(Math.min(Math.max(0.75 * width, 160), 280));
}

export function plotRect(width: number, height: number): PlotRect {
  return {
    x: MARGIN.left,
    y: MARGIN.top,
    w: Math.max(1, width - MARGIN.left - MARGIN.right),
    h: Math.max(1, height - MARGIN.top - MARGIN.bottom),
  };
}

export function evToX(ev: number, r: PlotRect): number {
  return r.x + ((ev - MIN_EV) / SPAN) * r.w;
}

export function xToEv(x: number, r: PlotRect): number {
  return MIN_EV + ((x - r.x) / r.w) * SPAN;
}

/** A correction in EV: +2 at the top, −2 at the bottom. */
export function gainToY(gainEv: number, r: PlotRect): number {
  return r.y + (0.5 - gainEv / 4) * r.h;
}

/** darktable's drag (te.c:3599-3615), measured from the previous pointer
 *  position: 4 EV per plot height, centred on the previous x. */
export function dragStep(
  prev: { readonly x: number; readonly y: number },
  next: { readonly x: number; readonly y: number },
  r: PlotRect,
): { x0: number; offset: number } {
  return { x0: xToEv(prev.x, r), offset: ((prev.y - next.y) / r.h) * 4 };
}

/** The node under x, within 0.45 × the node spacing (te.c:3622-3635). The
 *  `+ 0` keeps the index a plain 0 where Math.round(−0.3) gives −0. */
export function nodeAt(x: number, r: PlotRect): number | null {
  const spacing = r.w / (CENTERS_PARAMS.length - 1);
  const i = Math.round((x - r.x) / spacing) + 0;
  if (i < 0 || i >= CENTERS_PARAMS.length) return null;
  return Math.abs(x - (r.x + i * spacing)) <= 0.45 * spacing ? i : null;
}

/** The node within 0.45 EV of an exposure: the image cursor's highlight. */
export function nodeNear(ev: number): number | null {
  const i = Math.round(ev - MIN_EV) + 0;
  if (i < 0 || i >= CENTERS_PARAMS.length) return null;
  return Math.abs(ev - CENTERS_PARAMS[i]) <= 0.45 ? i : null;
}

/** The influence circle: σ/√2 EV (te.c:3458-3468). */
export function influenceRadius(sigma: number, r: PlotRect): number {
  return (sigma / Math.SQRT2 / SPAN) * r.w;
}

/** count/max × 0.96 of the plot height per bin (te.c:3359-3376). */
export function histogramHeights(h: LogHistogram, r: PlotRect): number[] {
  return Array.from(h.bins, (n) => (n / h.max) * 0.96 * r.h);
}

/** darktable's overflow marks (te.c:3378-3400). */
export function overflowWarnings(h: LogHistogram): { highlights: boolean; shadows: boolean } {
  return { highlights: h.last > -0.1, shadows: h.first < -7.9 };
}

/** The image cursor's line, clamped to the plot and flagged outside [−8, 0] EV. */
export function cursorLine(ev: number, r: PlotRect): { x: number; outside: boolean } {
  return { x: evToX(Math.min(Math.max(ev, MIN_EV), MAX_EV), r), outside: ev < MIN_EV || ev > MAX_EV };
}
