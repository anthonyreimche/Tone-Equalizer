// The develop-canvas overlay: Adjust on image (darktable's scroll-on-image and
// correction cursor, te.c:2732-2929) and the Display exposure mask layer.
// While adjusting, the layer captures pointer and wheel; Ctrl/⌘/Space make it
// click-through so pan and zoom keep working, and Esc leaves the mode.

import type { CSSProperties, ReactElement, PointerEvent as ReactPointerEvent } from "react";
import { interactiveEdit } from "./curve";
import { cursorExposure } from "./measure";
import { sigmaOf } from "./model";
import {
  CIRCLE_ALPHA,
  INNER_RADIUS,
  LINE_WIDTH,
  OUTER_RADIUS,
  OUTLINE_WIDTH,
  PILL_ALPHA,
  WEDGE_RADIUS,
  WEDGE_WIDTH,
  correctionGain,
  createWheelAccumulator,
  cursorBars,
  formatExposure,
  frameInk,
  greyCss,
  pillBox,
  pointToUv,
  wedgeAngle,
  wedgePath,
  wheelStep,
} from "./overlay-model";
import { deriveAll, fitOf, readParams, type Bag } from "./params";
import { effectiveBag, maskViewPatch, probeSignature } from "./readback";
import { api, h } from "./runtime";
import { createScheduler, type Scheduler } from "./schedule";
import { store, type ImageCursor } from "./store";

export const COMMIT_DELAY_MS = 400;
export const MASK_THROTTLE_MS = 150;

const COMMIT_LABEL = "Tone Equalizer scroll";
const HATCH_ID = "tone-equalizer-hatch";
const PILL_FONT_SIZE = 10;
/** An estimate of the pill font's advance, to size the pill before it is laid out. */
const PILL_CHAR_WIDTH = 6;

function CorrectionCursor(props: { cursor: ImageCursor; paramBag: Bag }): ReactElement {
  const fit = api().react.useMemo(() => fitOf(readParams(props.paramBag)), [props.paramBag]);
  const { x, y } = props.cursor.local;
  const ev = props.cursor.ev;
  const mask = ev === null ? 0 : 2 ** ev;
  const gainEv = correctionGain(ev, fit);
  const after = mask * 2 ** gainEv;
  const ink = frameInk(after);
  const bar = (s: { x1: number; y1: number; x2: number; y2: number }, key: number) =>
    h("line", { key, ...s, style: { stroke: ink, strokeWidth: LINE_WIDTH } });
  const ring = (r: number, linear: number, key: string) => [
    h("circle", { key, cx: x, cy: y, r, style: { fill: greyCss(linear), fillOpacity: CIRCLE_ALPHA } }),
    linear > 1 ? h("circle", { key: `${key}-hatch`, cx: x, cy: y, r, style: { fill: `url(#${HATCH_ID})` } }) : null,
    h("circle", { key: `${key}-outline`, cx: x, cy: y, r, style: { fill: "none", stroke: ink, strokeWidth: OUTLINE_WIDTH } }),
  ];
  const label = formatExposure(ev);
  const pill = pillBox(x, y, PILL_CHAR_WIDTH * label.length, PILL_FONT_SIZE);
  return h(
    "svg",
    {
      style: { position: "absolute", left: 0, top: 0, width: "100%", height: "100%", overflow: "visible", pointerEvents: "none" },
    },
    h(
      "defs",
      null,
      h(
        "pattern",
        { id: HATCH_ID, width: 4, height: 4, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" },
        h("line", { x1: 0, y1: 0, x2: 0, y2: 4, style: { stroke: ink, strokeWidth: 1 } }),
      ),
    ),
    h("path", { d: wedgePath(x, y, WEDGE_RADIUS, wedgeAngle(gainEv)), style: { fill: "none", stroke: ink, strokeWidth: WEDGE_WIDTH } }),
    ...cursorBars(x, y).map(bar),
    ...ring(OUTER_RADIUS, mask, "before"),
    ...ring(INNER_RADIUS, after, "after"),
    h("rect", { x: pill.x, y: pill.y, width: pill.width, height: pill.height, style: { fill: `rgba(0, 0, 0, ${PILL_ALPHA})` } }),
    h(
      "text",
      { x: pill.textX, y: pill.textY, style: { fill: "rgb(255, 255, 255)", fontSize: PILL_FONT_SIZE, fontFamily: "sans-serif", dominantBaseline: "central" } },
      label,
    ),
  );
}

function AdjustLayer(): ReactElement | null {
  const { useEffect, useRef, useState } = api().react;
  const adjusting = store()((s) => s.adjusting);
  const cursor = store()((s) => s.cursor);
  const dev = api().stores.useDevelopStore;
  const paramBag = dev((s) => s.paramBag);
  const overlay = api().develop.useDevelopOverlay();
  const ref = useRef<HTMLDivElement | null>(null);
  const [passthrough, setPassthrough] = useState(false);
  const [wheel] = useState(createWheelAccumulator);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const edited = useRef(false);

  useEffect(() => {
    if (!adjusting) return;
    const held = new Set<string>();
    const update = () => setPassthrough(held.has("Control") || held.has("Meta") || held.has(" "));
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (!e.defaultPrevented) store().getState().setAdjusting(false);
        return;
      }
      held.add(e.key);
      update();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      held.delete(e.key);
      update();
    };
    const onBlur = () => {
      held.clear();
      update();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      setPassthrough(false);
    };
  }, [adjusting]);

  const settled = () => {
    settleTimer.current = null;
    wheel.reset();
    if (!edited.current) return;
    edited.current = false;
    void dev.getState().commitEdit(COMMIT_LABEL);
  };
  const settleLater = () => {
    if (settleTimer.current !== null) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(settled, COMMIT_DELAY_MS);
  };
  const flush = () => {
    if (settleTimer.current === null) return;
    clearTimeout(settleTimer.current);
    settled();
  };
  useEffect(() => flush, []);

  /** One step of the curve at an exposure; false where the solve failed and
   *  the step was discarded. */
  const nudge = (ev: number, offset: number): boolean => {
    const p = readParams(dev.getState().paramBag);
    const bands = interactiveEdit(p.bands, sigmaOf(p.curveSmoothing), ev, offset);
    store().getState().setUnstable(bands === null);
    if (!bands) return false;
    dev.getState().setDynParams(deriveAll({ ...p, bands }));
    edited.current = true;
    return true;
  };

  // Attached natively and non-passive: React's onWheel can't preventDefault.
  // A bare wheel this layer leaves alone goes nowhere, since the slot is a
  // sibling of the viewport frame, not inside it; darktable swallows the
  // scroll the same way. Ctrl/⌘ still zoom through the host's passthrough.
  useEffect(() => {
    const el = ref.current;
    if (!el || !adjusting) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) return;
      const at = store().getState().cursor;
      if (!at || at.ev === null || (e.deltaX === 0 && e.deltaY === 0)) return;
      e.preventDefault();
      e.stopPropagation();
      settleLater();
      const steps = wheel.push(e);
      const offset = Math.sign(steps) * wheelStep(e);
      for (let i = 0; i < Math.abs(steps); i++) if (!nudge(at.ev, offset)) break;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [adjusting]);

  if (!adjusting) return null;

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const box = el.getBoundingClientRect();
    const scale = box.width > 0 && el.clientWidth > 0 ? el.clientWidth / box.width : 1;
    // The probe renders the whole image; `rect` is only the visible window once zoomed.
    const imageRect = overlay.imageRect;
    const uv = pointToUv(e.clientX, e.clientY, box, scale, imageRect);
    if (imageRect && !uv) {
      store().getState().setCursor(null);
      return;
    }
    const probe = store().getState().probe;
    const ev =
      uv && probe
        ? cursorExposure(probe.ev, probe.width, probe.height, Math.min(probe.width - 1, Math.floor(uv.x * probe.width)), Math.min(probe.height - 1, Math.floor(uv.y * probe.height)))
        : null;
    store().getState().setCursor({ ev, local: { x: (e.clientX - box.left) * scale, y: (e.clientY - box.top) * scale } });
  };

  const style: CSSProperties = {
    position: "absolute",
    inset: 0,
    pointerEvents: passthrough ? "none" : "auto",
    cursor: cursor ? "none" : api().cursors.resolve("crosshair"),
  };

  return h(
    "div",
    {
      ref,
      "data-testid": "te-adjust",
      style,
      onPointerMove,
      onPointerLeave: () => store().getState().setCursor(null),
    },
    cursor ? h(CorrectionCursor, { cursor, paramBag }) : null,
  );
}

interface MaskFrame {
  bitmap: ImageBitmap;
  nonce: number;
}

function MaskLayer(): ReactElement | null {
  const { useEffect, useRef, useState } = api().react;
  const showMask = store()((s) => s.showMask);
  const overlay = api().develop.useDevelopOverlay();
  const dev = api().stores.useDevelopStore;
  const signature = dev((s) => (showMask ? probeSignature(s) : ""));
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const scheduler = useRef<Scheduler | null>(null);
  const nonce = useRef(overlay.nonce);
  const held = useRef<ImageBitmap | null>(null);
  const [frame, setFrame] = useState<MaskFrame | null>(null);
  nonce.current = overlay.nonce;

  useEffect(() => {
    if (!showMask) {
      held.current?.close();
      held.current = null;
      setFrame(null);
      return;
    }
    let live = true;
    const s = createScheduler(async () => {
      const at = nonce.current;
      const state = dev.getState();
      const bitmap = await api().develop.captureFrame(state.previewParams ?? state.params, {
        asShown: true,
        paramBag: maskViewPatch(effectiveBag(state)),
      });
      if (!live) {
        bitmap.close();
        return;
      }
      held.current?.close();
      held.current = bitmap;
      setFrame({ bitmap, nonce: at });
    }, MASK_THROTTLE_MS);
    scheduler.current = s;
    s.request();
    return () => {
      live = false;
      s.stop();
      scheduler.current = null;
    };
  }, [showMask]);

  // The bands and the curve don't reach the mask display; the photo, the core
  // params, other extensions' settings and the mask's own settings do.
  useEffect(() => {
    scheduler.current?.request();
  }, [signature, overlay.nonce]);

  useEffect(
    () => () => {
      held.current?.close();
      held.current = null;
    },
    [],
  );

  const visible = showMask && frame !== null && frame.nonce === overlay.nonce && overlay.rect !== null;

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !frame || !visible) return;
    c.width = frame.bitmap.width;
    c.height = frame.bitmap.height;
    c.getContext("2d")?.drawImage(frame.bitmap, 0, 0);
  }, [frame, visible]);

  if (!visible || !overlay.rect) return null;
  return h("canvas", {
    ref: canvasRef,
    "data-testid": "te-mask",
    style: {
      position: "absolute",
      left: overlay.rect.x,
      top: overlay.rect.y,
      width: overlay.rect.w,
      height: overlay.rect.h,
      pointerEvents: "none",
    },
  });
}

export function ToneEqualizerOverlay(): ReactElement {
  return h(
    "div",
    { style: { position: "absolute", inset: 0, pointerEvents: "none" } },
    h(MaskLayer, null),
    h(AdjustLayer, null),
  );
}
