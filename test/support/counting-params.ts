// A stand-in for the core's params that counts how often it is enumerated.
// Stringifying a params object (what probeSignature does, once per new object)
// enumerates its keys, so a count of zero means nobody read it.

import type { DevelopParams } from "../../src/safelight";

export function countingParams(content: Record<string, unknown> = {}): { params: DevelopParams; reads(): number } {
  let reads = 0;
  const params = new Proxy(content, {
    ownKeys(target) {
      reads++;
      return Reflect.ownKeys(target);
    },
  }) as DevelopParams;
  return { params, reads: () => reads };
}
