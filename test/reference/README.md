# Reference vectors

`dt_ref.c` runs darktable's tone equalizer arithmetic over fixed inputs and
prints JSON. darktable master `f52993027d5c13e6f6d41a96e5fd483d8f519297`
(2026-10-19), GPL-3.0-or-later, © Aurélien Pierre and the darktable authors.

- `upstream/luminance_mask.h`, `fast_guided_filter.h`, `eigf.h`, `choleski.h`
  are verbatim, with their darktable includes pointed at `shim.h`
  (`fetch-upstream.mjs` writes them).
- `upstream/gaussian_cpu.c` holds the CPU gaussian blur of
  `src/common/gaussian.c`, verbatim.
- `dt_ref.c` holds `src/iop/toneequal.c`'s functions verbatim, except four
  marked ones that take arguments in place of the GUI or pipe structs:
  `interactive` (set_new_params_interactive), `auto_exposure` and
  `auto_contrast` (the two auto-adjust buttons' arithmetic), and
  `compute_luminance_mask`.
- `shim.c` stands in for `dt_box_mean` (a clipped box mean in double).

`build.cjs` compiles it with gcc and writes `vectors.json`; the tests read the
JSON, so a machine without a compiler still runs the suite. Regenerate with
`npm run test:reference` (set `CC` if gcc isn't on the path).
