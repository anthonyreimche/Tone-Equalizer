// The advanced tab's graph: darktable's tone equalizer plot (te.c area_draw)
// on the themed surface, with the mask's histogram behind the curve. Dragging
// shapes the curve through the interactive fit, 4 EV per plot height around
// the pointer, one commit per gesture; double-click resets the nine bands.
// The ink follows the resolved surface brightness, so light themes stay legible.

import type { PointerEvent as ReactPointerEvent } from "react";
import { curveSamples, gainAt, interactiveEdit, nodeGains, type Fit } from "./curve";
import {
  cursorLine,
  dragStep,
  evToX,
  gainToY,
  graphHeight,
  histogramHeights,
  influenceRadius,
  nodeAt,
  nodeNear,
  overflowWarnings,
  plotRect,
  xToEv,
  type PlotRect,
} from "./graph-model";
import type { LogHistogram } from "./measure";
import { CENTERS_PARAMS, DEFAULT_PARAMS, sigmaOf } from "./model";
import { deriveAll, fitOf, readParams } from "./params";
import { api, h } from "./runtime";
import { store } from "./store";

/** darktable's warning orange, (0.75, 0.5, 0). */
export const WARN_COLOUR = "rgb(191, 128, 0)";

interface Ink {
  fg: string;
  faint: string;
  fill: string;
}

function inkFor(canvas: HTMLCanvasElement): Ink {
  const m = getComputedStyle(canvas).backgroundColor.match(/\d+(?:\.\d+)?/g);
  const dark = m ? (Number(m[0]) + Number(m[1]) + Number(m[2])) / (3 * 255) < 0.5 : true;
  return dark
    ? { fg: "rgba(235, 235, 235, 0.92)", faint: "rgba(235, 235, 235, 0.2)", fill: "rgba(235, 235, 235, 0.16)" }
    : { fg: "rgba(25, 25, 25, 0.9)", faint: "rgba(25, 25, 25, 0.2)", fill: "rgba(25, 25, 25, 0.14)" };
}

export interface GraphState {
  fit: Fit;
  histogram: LogHistogram | null;
  hoverNode: number | null;
  mouseX: number | null;
  cursorEv: number | null;
  unstable: boolean;
}

const evLabel = (ev: number) => (ev === 0 ? "+0" : `−${-ev}`);
const gainLabel = (g: number) => (g > 0 ? `+${g}` : g < 0 ? `−${-g}` : "0");

function warningMark(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y - 4);
  ctx.lineTo(x + 4, y + 3);
  ctx.lineTo(x - 4, y + 3);
  ctx.closePath();
  ctx.fill();
}

export function drawGraph(ctx: CanvasRenderingContext2D, width: number, height: number, ink: Ink, s: GraphState): void {
  const r: PlotRect = plotRect(width, height);
  const segment = (x0: number, y0: number, x1: number, y1: number) => {
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  };
  ctx.clearRect(0, 0, width, height);
  ctx.font = "9px sans-serif";

  ctx.strokeStyle = ink.faint;
  ctx.lineWidth = 1;
  for (let i = 0; i <= 8; i++) {
    segment(r.x + (i / 8) * r.w, r.y, r.x + (i / 8) * r.w, r.y + r.h);
    segment(r.x, r.y + (i / 8) * r.h, r.x + r.w, r.y + (i / 8) * r.h);
  }

  ctx.fillStyle = ink.fg;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  for (const ev of CENTERS_PARAMS) ctx.fillText(evLabel(ev), evToX(ev, r), r.y - 2);
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  for (const g of [2, 1, 0, -1, -2]) ctx.fillText(gainLabel(g), r.x + r.w + 3, gainToY(g, r));

  if (s.histogram) {
    const heights = histogramHeights(s.histogram, r);
    const floor = r.y + r.h;
    ctx.fillStyle = ink.fill;
    ctx.beginPath();
    ctx.moveTo(r.x, floor);
    heights.forEach((bh, k) => ctx.lineTo(r.x + (k / (heights.length - 1)) * r.w, floor - bh));
    ctx.lineTo(r.x + r.w, floor);
    ctx.closePath();
    ctx.fill();
    const warn = overflowWarnings(s.histogram);
    ctx.fillStyle = WARN_COLOUR;
    if (warn.highlights) warningMark(ctx, r.x + r.w - 8, r.y + 8);
    if (warn.shadows) warningMark(ctx, r.x + 8, r.y + 8);
  }

  ctx.strokeStyle = ink.fg;
  ctx.globalAlpha = 0.5;
  segment(r.x, gainToY(0, r), r.x + r.w, gainToY(0, r));
  ctx.globalAlpha = 1;

  const samples = curveSamples(s.fit);
  ctx.strokeStyle = s.unstable || !s.fit.valid ? WARN_COLOUR : ink.fg;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  samples.forEach((g, k) => {
    const x = r.x + (k / (samples.length - 1)) * r.w;
    if (k === 0) ctx.moveTo(x, gainToY(g, r));
    else ctx.lineTo(x, gainToY(g, r));
  });
  ctx.stroke();

  const lit = s.hoverNode ?? (s.cursorEv !== null ? nodeNear(s.cursorEv) : null);
  ctx.fillStyle = ink.fg;
  ctx.strokeStyle = ink.fg;
  nodeGains(s.fit).forEach((gain, i) => {
    const x = evToX(CENTERS_PARAMS[i], r);
    const y = gainToY(Math.log2(gain), r);
    ctx.lineWidth = 6;
    ctx.globalAlpha = 0.3;
    segment(x, gainToY(0, r), x, y);
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, 2 * Math.PI);
    if (i === lit) ctx.fill();
    else ctx.stroke();
  });

  if (s.mouseX !== null) {
    const ev = xToEv(s.mouseX, r);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(s.mouseX, gainToY(Math.log2(gainAt(ev, s.fit)), r), influenceRadius(s.fit.sigma, r), 0, 2 * Math.PI);
    ctx.stroke();
  }

  if (s.cursorEv !== null) {
    const c = cursorLine(s.cursorEv, r);
    ctx.strokeStyle = c.outside ? WARN_COLOUR : ink.fg;
    ctx.lineWidth = c.outside ? 3 : 1;
    segment(c.x, r.y, c.x, r.y + r.h);
  }
}

interface Drag {
  x: number;
  y: number;
  moved: boolean;
}

export function ToneGraph() {
  const { useEffect, useLayoutEffect, useRef, useState } = api().react;
  const dev = api().stores.useDevelopStore;
  const paramBag = dev((s) => s.paramBag);
  const histogram = store()((s) => s.probe?.histogram ?? null);
  const cursorEv = store()((s) => s.cursor?.ev ?? null);
  const unstable = store()((s) => s.unstable);
  const [width, setWidth] = useState(240);
  const [hoverNode, setHoverNode] = useState<number | null>(null);
  const [mouseX, setMouseX] = useState<number | null>(null);
  const [epoch, setEpoch] = useState(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const inkRef = useRef<{ epoch: number; ink: Ink } | null>(null);
  const height = graphHeight(width);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[0].contentRect.width);
      if (w > 40) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Themes restyle the root's CSS variables in place; watch the root so the
  // ink re-derives without waiting for the next interaction.
  useEffect(() => {
    const bump = () => setEpoch((n) => n + 1);
    const mo = new MutationObserver(bump);
    mo.observe(document.documentElement, { attributes: true });
    mo.observe(document.body, { attributes: true });
    return () => mo.disconnect();
  }, []);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const pixelWidth = Math.round(width * dpr);
    const pixelHeight = Math.round(height * dpr);
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (inkRef.current?.epoch !== epoch) inkRef.current = { epoch, ink: inkFor(canvas) };
    drawGraph(ctx, width, height, inkRef.current.ink, {
      fit: fitOf(readParams(paramBag)),
      histogram,
      hoverNode,
      mouseX,
      cursorEv,
      unstable,
    });
  }, [paramBag, histogram, cursorEv, unstable, hoverNode, mouseX, width, height, epoch]);

  // width is the drawing's CSS width, so zoomed client px map into drawing px; DPR plays no part.
  const local = (e: { clientX: number; clientY: number; currentTarget: HTMLCanvasElement }) => {
    const b = e.currentTarget.getBoundingClientRect();
    return {
      x: b.width > 0 ? ((e.clientX - b.left) * width) / b.width : 0,
      y: b.height > 0 ? ((e.clientY - b.top) * height) / b.height : 0,
    };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragRef.current = { ...local(e), moved: false };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const at = local(e);
    const r = plotRect(width, height);
    setMouseX(at.x);
    setHoverNode(nodeAt(at.x, r));
    const drag = dragRef.current;
    if (!drag) return;
    const step = dragStep(drag, at, r);
    const p = readParams(dev.getState().paramBag);
    const bands = interactiveEdit(p.bands, sigmaOf(p.curveSmoothing), step.x0, step.offset);
    if (bands) dev.getState().setDynParams(deriveAll({ ...p, bands }));
    store().getState().setUnstable(bands === null);
    dragRef.current = { x: at.x, y: at.y, moved: drag.moved || bands !== null };
  };

  const end = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag?.moved) void dev.getState().commitEdit("Tone Equalizer curve");
  };

  const onDoubleClick = () => {
    dev.getState().setDynParams(deriveAll({ ...readParams(dev.getState().paramBag), bands: DEFAULT_PARAMS.bands }));
    store().getState().setUnstable(false);
    void dev.getState().commitEdit("Tone Equalizer reset curve");
  };

  return h(
    "div",
    { ref: wrapRef, style: { width: "100%" } },
    h("canvas", {
      ref: canvasRef,
      role: "img",
      "aria-label": "Tone equalizer curve",
      title: "Drag to shape the curve; double-click to reset it",
      style: {
        width: "100%",
        height,
        display: "block",
        borderRadius: 3,
        background: api().ui.tokens.surface0 ?? "var(--color-surface-0)",
        touchAction: "none",
        cursor: "crosshair",
      },
      onPointerDown,
      onPointerMove,
      onPointerUp: end,
      onLostPointerCapture: end,
      onPointerLeave: () => {
        setMouseX(null);
        setHoverNode(null);
      },
      onDoubleClick,
    }),
  );
}
