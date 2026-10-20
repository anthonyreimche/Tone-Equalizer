// A 2D context that records every call with the styles in force when it was
// made, so tests can assert what was drawn without a canvas implementation.

export interface Call {
  readonly op: string;
  readonly args: readonly number[];
  readonly fillStyle: string;
  readonly strokeStyle: string;
  readonly lineWidth: number;
}

export function recordingContext(): { ctx: CanvasRenderingContext2D; calls: Call[] } {
  const calls: Call[] = [];
  const state: Record<string, unknown> = { fillStyle: "", strokeStyle: "", lineWidth: 1, globalAlpha: 1 };
  const ctx = new Proxy(state, {
    get: (target, key) => {
      if (typeof key === "string" && key in target) return target[key];
      return (...args: unknown[]) => {
        calls.push({
          op: String(key),
          args: args.filter((a): a is number => typeof a === "number"),
          fillStyle: String(target.fillStyle),
          strokeStyle: String(target.strokeStyle),
          lineWidth: Number(target.lineWidth),
        });
      };
    },
    set: (target, key, value) => {
      target[String(key)] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}
