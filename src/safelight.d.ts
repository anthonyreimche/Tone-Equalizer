// The slice of Safelight's extension API this extension touches, mirrored from
// the app's src/extensions/types.ts, src/extensions/ui-kit.tsx,
// src/extensions/develop-host.tsx and src/state/develop-store.ts (core 3.0.1).
// Extensions are standalone bundles, so the host's source is not on the type
// path; React types come from @types/react (dev only).

import type { ButtonHTMLAttributes, ComponentType, CSSProperties, ReactNode } from "react";

export interface ActiveIdState {
  activeId: string;
}

export interface StoreApi<T> {
  (): T;
  <U>(selector: (state: T) => U): U;
  getState(): T;
  setState(partial: Partial<T> | ((s: T) => Partial<T>)): void;
  subscribe(listener: (state: T, prev: T) => void): () => void;
}

export type StateCreator<T> = (
  set: (partial: Partial<T> | ((s: T) => Partial<T>)) => void,
  get: () => T,
) => T;

/** A local adjustment mask, as far as an extension reads one: its extension
 *  params by qualified key, which run maskable stages inside it. */
export interface MaskState {
  readonly id: string;
  readonly bag?: Readonly<Record<string, unknown>>;
}

/** Core develop params: opaque here, only ever handed back to core, bar the
 *  masks' extension params. */
export type DevelopParams = Record<string, unknown> & {
  readonly __develop: unique symbol;
  readonly masks: readonly MaskState[];
};

export interface DevelopStoreState {
  photoId: string | null;
  params: DevelopParams;
  previewParams: DevelopParams | null;
  /** Render-only override for the extension param bag, paired with
   *  `previewParams` for the preset hover preview. Holds the preset's
   *  contributed params merged over the live bag. Null when no preview is
   *  active; cleared whenever previewParams is. */
  previewParamBag: Record<string, unknown> | null;
  /** Extension stage params by qualified key. Values are whatever the owning
   *  stage wrote and come back from sidecar JSON — a runtime boundary. */
  paramBag: Record<string, unknown>;
  /** Recomputed by core after every settled render; its identity changing is
   *  the "frame changed" signal. */
  histogram: object | null;
  setDynParams(patch: Record<string, unknown>): void;
  /** Merges into a mask's bag; an undefined value deletes its key. */
  updateMaskBag(maskId: string, patch: Record<string, unknown>): void;
  commitEdit(label: string): Promise<void>;
}

export interface OverlayRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface OverlayRect2 {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** An extension's on-image tool that takes the canvas over while it is held. */
export interface CanvasTool {
  /** Drawn over the image, inside the view: `rect` is the box the frame
   *  shows. Reads the canvas mapping with api.develop.useDevelopOverlay. */
  overlay: ComponentType<{
    rect: OverlayRect2;
  }>;
  /** Whether zoom and pan still reach the canvas under the overlay. */
  zoomable?: boolean;
  /** The params the live view draws while the tool is held, from the edit's
   *  (crop mode draws the whole image past the crop). View-only: the edit is
   *  untouched. */
  viewParams?(params: DevelopParams): DevelopParams;
  /** Escape was pressed: core lets the tool go after this. */
  onEscape?(): void;
  /** A shortcut's action (keybinding id, e.g. "brush.larger") pressed while
   *  the tool is held: whether the tool took it. Core acts on one it didn't. */
  onAction?(action: string): boolean;
  /** Whether the tool would take `action` now, without acting: a key another
   *  handler also binds (Delete) is left to the tool when it would. */
  wants?(action: string): boolean;
}

export interface DevelopOverlayState {
  rect: OverlayRect | null;
  /** Where the full image sits; extends past the frame when zoomed. Null until
   *  the first layout. */
  imageRect: OverlayRect | null;
  nonce: number;
}

export type GlslType = "float" | "int" | "bool" | "vec2" | "vec3" | "vec4" | "sampler2D";

export interface UniformDeclaration {
  key: string;
  glslType: GlslType;
  default: number | number[] | boolean;
  range?: { min: number; max: number; step?: number };
  label?: string;
}

export interface PassDrawCount {
  key: string;
  max: number;
}

export interface StagePass {
  glsl: string;
  helpers?: string;
  iterations?: number | PassDrawCount;
  uniforms?: UniformDeclaration[];
}

export interface InterStageVariable {
  name: string;
  glslType: "float" | "vec2" | "vec3" | "vec4";
  producer?: string;
}

export interface StageSpace {
  encoding: "linear" | "perceptual";
  primaries?: "rec709" | "rec2020";
}

export type ProcessingPhase =
  | "geometry"
  | "decode"
  | "noise-reduction"
  | "scene-linear"
  | "tone-map"
  | "display-adjust"
  | "effects"
  | "output-encode";

export interface ProcessingStageContribution {
  id: string;
  name: string;
  phase: ProcessingPhase;
  priority?: number;
  glsl: string;
  helpers?: string;
  uniforms: UniformDeclaration[];
  passes?: StagePass[];
  produces?: InterStageVariable[];
  consumes?: string[];
  presetScope?: "global" | "per-image";
  space?: StageSpace;
  reads?: "source" | "current";
  /** Runs the stage again inside each mask whose bag holds its keys, with that
   *  mask's values and its own passes, blended by its coverage (core 3.1.0,
   *  process version 2 photos). */
  mask?: { maskable: true };
}

export interface PanelContribution {
  id: string;
  title: string;
  component: ComponentType;
  defaultDock?: {
    module: "library" | "develop";
    direction: "left" | "right" | "bottom";
    order?: number;
    width?: number;
    height?: number;
  };
  /** The modules the panel may be docked in; omitted, every module (Safelight 3.2.8). */
  modules?: readonly string[];
  onReset?: () => void;
  /** Offers the panel in a mask's Adjust tab: each mask that adds it renders
   *  `component`, which edits that mask's values through useParamScope. `owns`
   *  lists every qualified key it writes, seeded on add and cleared on remove. */
  mask?: { component: ComponentType; order?: number; owns: readonly string[] };
}

/** The params a panel edits: the photo's bag, or one mask's (maskId set).
 *  Reads see the store as it is now, not as the render was handed it. */
export interface ParamScope {
  maskId: string | null;
  getParam(key: string): unknown;
  /** The stored values by qualified key, without defaults. */
  getParams(): Readonly<Record<string, unknown>>;
  setParams(patch: Record<string, unknown>): void;
  commit(label: string): void;
}

export interface SlotContribution {
  id: string;
  slot: "develop-canvas-overlay" | "develop-toolbar";
  component: ComponentType;
  order?: number;
}

export interface SliderProps {
  label: string;
  value: number;
  onChange(value: number): void;
  onCommit?(): void;
  min?: number;
  max?: number;
  step?: number;
  defaultValue?: number;
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  active?: boolean;
  full?: boolean;
}

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps {
  value: string;
  onChange(value: string): void;
  options?: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
  title?: string;
}

export interface SegmentedOption {
  value: string;
  label: ReactNode;
  title?: string;
}

export interface SegmentedControlProps {
  value: string;
  onChange(value: string): void;
  options: SegmentedOption[];
  size?: "sm" | "md";
}

export interface ToggleProps {
  checked: boolean;
  onChange(checked: boolean): void;
  label?: ReactNode;
  ariaLabel?: string;
}

export interface RowProps {
  children?: ReactNode;
  gap?: number;
  align?: CSSProperties["alignItems"];
  justify?: CSSProperties["justifyContent"];
  wrap?: boolean;
  style?: CSSProperties;
}

export interface StackProps {
  children?: ReactNode;
  gap?: number;
  style?: CSSProperties;
}

export interface UiKit {
  Button: ComponentType<ButtonProps>;
  Select: ComponentType<SelectProps>;
  SegmentedControl: ComponentType<SegmentedControlProps>;
  Toggle: ComponentType<ToggleProps>;
  Row: ComponentType<RowProps>;
  Stack: ComponentType<StackProps>;
  tokens: Readonly<
    Record<"surface0" | "surface2" | "border" | "textPrimary" | "textSecondary" | "textMuted" | "accent", string>
  >;
}

export interface CaptureOptions {
  asShown?: boolean;
  paramBag?: Record<string, unknown>;
}

export interface SafelightAPI {
  version: 1;
  extensionId: string;
  react: typeof import("react");
  registerProcessingStage(c: ProcessingStageContribution): void;
  unregisterProcessingStage(id: string): void;
  registerPanel(c: PanelContribution): void;
  registerSlot(c: SlotContribution): void;
  unregisterSlot(id: string): void;
  settings: {
    get<T>(key: string, fallback: T): T;
    set(key: string, value: unknown): void;
  };
  components: {
    Slider: ComponentType<SliderProps>;
  };
  ui: UiKit;
  stores: {
    create<T>(init: StateCreator<T>): StoreApi<T>;
    useDevelopStore: StoreApi<DevelopStoreState>;
    useThemeStore: StoreApi<ActiveIdState>;
  };
  cursors: {
    resolve(token: string): string;
  };
  develop: {
    useDevelopOverlay(): DevelopOverlayState;
    captureFrame(params: DevelopParams, options?: CaptureOptions): Promise<ImageBitmap>;
    /** The frame is a JPEG by default; `lossless: true` returns it from a PNG so every channel byte the pipeline wrote survives (core 3.0.1), and is null where only the grid's camera preview could stand in. */
    renderPhotoFrame(
      photoId: string,
      params: DevelopParams,
      paramBag?: Record<string, unknown>,
      options?: { lossless?: boolean },
    ): Promise<ImageBitmap | null>;
    /** Hold the develop canvas with an on-image tool (canvas-tool.ts), or with
     *  null let go of it. While it's held, its `overlay` is drawn over the
     *  image inside the view, core's own canvas gestures stand aside (zoom
     *  too, unless `zoomable`), and the live view draws `viewParams` of the
     *  edit if given. Escape calls `onEscape` and lets it go. One extension
     *  holds it at a time: the last to set it. It is let go when the
     *  extension stops. Needs Safelight 3.2.0. */
    setCanvasTool(tool: CanvasTool | null): void;
    /** React hook: whether this extension holds the canvas tool. */
    useCanvasToolHeld(): boolean;
    /** The pointer in `el`'s layout px: the space an overlay's `rect`, the
     *  mapping helpers and CSS left/top use. Interface scale zooms the page,
     *  so clientX minus the element's left is off by the zoom. Needs Safelight
     *  3.2.7. */
    framePoint(el: Element, clientX: number, clientY: number): {
      x: number;
      y: number;
    };
    /** The mask's scope inside a mask's Adjust tab, the photo's anywhere else. */
    useParamScope(): ParamScope;
  };
}

export interface ExtensionModule {
  activate(api: SafelightAPI): void;
  deactivate?(): void;
}
