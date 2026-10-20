// Regenerates vectors.json from dt_ref.c and the vendored darktable sources
// with gcc. The JSON is what the tests read, so a machine without a compiler
// still runs the suite; run this after touching the C. CC overrides the
// compiler (C:\Strawberry\c\bin\gcc.exe on Anthony's machine).
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const dir = __dirname;
const build = path.join(dir, ".build");
fs.mkdirSync(build, { recursive: true });
const exe = path.join(build, process.platform === "win32" ? "dt_ref.exe" : "dt_ref");
const cc = process.env.CC || "gcc";

const compiled = spawnSync(
  cc,
  ["-O2", "-std=gnu11", `-I${dir}`, "dt_ref.c", "shim.c", "upstream/gaussian_cpu.c", "-lm", "-o", exe],
  { cwd: dir, stdio: "inherit" },
);
if (compiled.error || compiled.status !== 0) {
  console.error(`${cc} is required to regenerate vectors.json (the kept file still serves the tests)`);
  process.exit(2);
}

const run = spawnSync(exe, [], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
if (run.status !== 0) {
  console.error(run.stderr);
  process.exit(run.status ?? 1);
}
JSON.parse(run.stdout);
fs.writeFileSync(path.join(dir, "vectors.json"), run.stdout);
console.log(`wrote ${path.join(dir, "vectors.json")} (${run.stdout.length} bytes)`);
