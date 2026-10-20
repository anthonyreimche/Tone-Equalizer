// Fetches the darktable sources the reference harness vendors, at the commit
// the port follows, and writes them to upstream/ with their darktable includes
// pointed at shim.h. Whole headers stay verbatim; gaussian_cpu.c keeps only
// the CPU blur's functions of src/common/gaussian.c. Run once; the fetched
// files are kept in the repo.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const COMMIT = "f52993027d5c13e6f6d41a96e5fd483d8f519297";
const BASE = `https://raw.githubusercontent.com/darktable-org/darktable/${COMMIT}/`;
const OUT = join(dirname(fileURLToPath(import.meta.url)), "upstream");

const WHOLE = {
  "luminance_mask.h": "src/common/luminance_mask.h",
  "fast_guided_filter.h": "src/common/fast_guided_filter.h",
  "eigf.h": "src/common/eigf.h",
  "choleski.h": "src/iop/choleski.h",
};
// _compute_gauss_params, dt_gaussian_init, dt_gaussian_blur, dt_gaussian_free
const GAUSSIAN_LINES = [
  [29, 88],
  [157, 196],
  [199, 351],
  [541, 548],
];

const pointAtShim = (text) =>
  text.replace(/^#include "(?:common|develop)\/[^"]+"\s*$/gm, '#include "../shim.h"');

async function get(path) {
  const res = await fetch(BASE + path);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.text();
}

await mkdir(OUT, { recursive: true });
for (const [name, path] of Object.entries(WHOLE)) {
  await writeFile(join(OUT, name), pointAtShim(await get(path)));
}
const gaussian = (await get("src/common/gaussian.c")).split("\n");
const parts = GAUSSIAN_LINES.map(([from, to]) => gaussian.slice(from - 1, to).join("\n"));
await writeFile(
  join(OUT, "gaussian_cpu.c"),
  `/* src/common/gaussian.c @ ${COMMIT}, lines ${GAUSSIAN_LINES.map((r) => r.join("-")).join(", ")}:\n` +
    ` * the CPU gaussian blur, verbatim. GPL-3.0-or-later, the darktable authors. */\n\n` +
    `#include "../shim.h"\n\n${parts.join("\n\n")}\n`,
);
console.log(`fetched ${Object.keys(WHOLE).length + 1} files into ${OUT}`);
