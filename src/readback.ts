// The probe: the photo rendered with the view stage encoding the mask exposure
// (renderPhotoFrame, the whole cropped image, as darktable's preview pipe
// sees it), read back at its own size and decoded into EV. The panel runs it
// while mounted; each settled render, photo change or bag change asks for one.

import { logHistogram } from "./measure";
import { probePatch, readParams, STAGE_ID, VIEW_MODE_KEY, type Bag } from "./params";
import { api } from "./runtime";
import type { DevelopParams, DevelopStoreState, StoreApi } from "./safelight";
import { createScheduler } from "./schedule";
import { store, type Probe } from "./store";

export const PROBE_THROTTLE_MS = 150;

export interface Readback {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

/** The view stage's mode 2: 16-bit EV over [−16, +8] in R and G, validity in
 *  B. Decode per pixel: interpolating the split high and low bytes (a resized
 *  readback) would corrupt them. */
export function decodeProbe(data: Uint8ClampedArray, width: number, height: number): Float32Array {
  const ev = new Float32Array(width * height);
  for (let k = 0; k < width * height; k++) {
    const o = 4 * k;
    ev[k] = data[o + 2] < 128 ? Number.NaN : -16 + (24 * (data[o] * 256 + data[o + 1])) / 65535;
  }
  return ev;
}

/** The bag a probe renders with: the photo's, the mask keys as if a band were
 *  set, and the view stage encoding. */
export function probeBag(bag: Bag): Bag {
  return { ...bag, ...probePatch(readParams(bag)), [VIEW_MODE_KEY]: 2 };
}

/** The patch a mask-display capture merges over the photo's bag. */
export function maskViewPatch(bag: Bag): Bag {
  return { ...probePatch(readParams(bag)), [VIEW_MODE_KEY]: 1 };
}

let scratch: OffscreenCanvas | null = null;

/** A rendered frame's bytes at its own size; null for the host's 1×1
 *  "no renderer" bitmap. */
export function readbackBitmap(bitmap: ImageBitmap): Readback | null {
  const { width, height } = bitmap;
  if (width < 2 || height < 2) return null;
  if (!scratch) scratch = new OffscreenCanvas(width, height);
  if (scratch.width !== width) scratch.width = width;
  if (scratch.height !== height) scratch.height = height;
  const ctx = scratch.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0);
  return { data: ctx.getImageData(0, 0, width, height).data, width, height };
}

export function probeOf(r: Readback, signature: string): Probe {
  const ev = decodeProbe(r.data, r.width, r.height);
  return { width: r.width, height: r.height, ev, histogram: logHistogram(ev), signature };
}

export interface ProbeDeps {
  develop: StoreApi<DevelopStoreState>;
  render(photoId: string, params: DevelopParams, bag: Bag): Promise<ImageBitmap | null>;
  readback(bitmap: ImageBitmap): Readback | null;
  publish(probe: Probe | null): void;
  throttleMs?: number;
}

/** The bag the live render draws with: a hover preview's, else the photo's. */
export const effectiveBag = (state: DevelopStoreState): Bag => state.previewParamBag ?? state.paramBag;

/** What this stage's own keys contribute to the mask. Bands, the curve and the
 *  stored derived keys (all zero while no band is set) reach the stage but
 *  cannot change the encoded mask, so only the patch re-derived from the edit
 *  counts. */
const maskSignature = (bag: Bag): string => JSON.stringify(probePatch(readParams(bag)));

/** JSON with every object's keys sorted: equal content gives equal text,
 *  whatever order it was built in. */
function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v !== null && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

/** The core params are replaced, never mutated, so one text per object. */
const paramsText = new WeakMap<DevelopParams, string>();

function paramsKey(params: DevelopParams): string {
  let text = paramsText.get(params);
  if (text === undefined) {
    text = stableStringify(params);
    paramsText.set(params, text);
  }
  return text;
}

const OWN_PREFIX = `${STAGE_ID}.`;

/** Everything a probe is rendered from, as one comparable text: the photo, the
 *  effective core params, and the effective bag with this extension's own keys
 *  replaced by their mask patch (the view mode is the probe's to set). Two
 *  states with the same signature render the same mask. The sampler stamps
 *  each probe with the signature of the state it rendered, and the panel
 *  compares it with the live one, so the two cannot drift. */
export function probeSignature(state: DevelopStoreState): string {
  const bag = effectiveBag(state);
  const others: Bag = {};
  for (const [key, value] of Object.entries(bag)) {
    if (!key.startsWith(OWN_PREFIX) && key !== VIEW_MODE_KEY) others[key] = value;
  }
  return JSON.stringify([state.photoId, paramsKey(state.previewParams ?? state.params), stableStringify(others), maskSignature(bag)]);
}

function maskChanged(prev: DevelopStoreState, state: DevelopStoreState): boolean {
  const before = effectiveBag(prev);
  const after = effectiveBag(state);
  return before !== after && maskSignature(before) !== maskSignature(after);
}

const reasonOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Follow the develop store and publish a probe per settled render (the
 *  histogram's identity changing), photo change or mask setting change; null
 *  when the render fails, comes back blank, the photo changes or closes, or
 *  the probe stops. A frame for a photo that is no longer open is dropped.
 *  The panel reads a null as still measuring, so the first failure for each
 *  open photo is also logged, once until a probe for it lands again. Returns
 *  stop. */
export function startProbe(deps: ProbeDeps): () => void {
  let stopped = false;
  let warnedPhoto: string | null = null;
  const warnOnce = (photoId: string, message: string) => {
    if (warnedPhoto === photoId) return;
    warnedPhoto = photoId;
    console.warn(`[tone-equalizer] ${message}`);
  };
  const scheduler = createScheduler(async () => {
    const state = deps.develop.getState();
    const photoId = state.photoId;
    if (!photoId) return;
    const signature = probeSignature(state);
    let bitmap: ImageBitmap | null = null;
    let why: string | null = null;
    try {
      bitmap = await deps.render(photoId, state.previewParams ?? state.params, probeBag(effectiveBag(state)));
      if (!bitmap) why = `no exposure reading yet for photo ${photoId}: the host returned no frame (expected while a RAW is still decoding)`;
    } catch (e) {
      bitmap = null;
      why = `no exposure reading for photo ${photoId}: the render threw: ${reasonOf(e)}`;
    }
    const current = !stopped && deps.develop.getState().photoId === photoId;
    let probe: Probe | null = null;
    try {
      const r = bitmap && current ? deps.readback(bitmap) : null;
      probe = r ? probeOf(r, signature) : null;
      if (bitmap && current && !r) why = `no exposure reading for photo ${photoId}: the frame read back blank`;
    } catch (e) {
      probe = null;
      why = `no exposure reading for photo ${photoId}: reading the frame back threw: ${reasonOf(e)}`;
    } finally {
      bitmap?.close();
    }
    if (!current) return;
    if (probe && warnedPhoto === photoId) warnedPhoto = null;
    if (!probe && why) warnOnce(photoId, why);
    deps.publish(probe);
  }, deps.throttleMs ?? PROBE_THROTTLE_MS);

  const unsubscribe = deps.develop.subscribe((s, prev) => {
    if (!s.photoId) {
      if (prev.photoId) deps.publish(null);
      return;
    }
    if (s.photoId !== prev.photoId) {
      warnedPhoto = null;
      deps.publish(null);
    }
    if (s.photoId !== prev.photoId || s.histogram !== prev.histogram || maskChanged(prev, s)) {
      scheduler.request();
    }
  });
  scheduler.request();

  return () => {
    stopped = true;
    scheduler.stop();
    unsubscribe();
    deps.publish(null);
  };
}

/** The production probe over the live app. The frame is requested lossless:
 *  a JPEG would smear the 16-bit exposure split across the R and G bytes. */
export function startLiveProbe(): () => void {
  const a = api();
  return startProbe({
    develop: a.stores.useDevelopStore,
    render: (photoId, params, bag) => a.develop.renderPhotoFrame(photoId, params, bag, { lossless: true }),
    readback: readbackBitmap,
    publish: (probe) => store().getState().setProbe(probe),
  });
}
