# Tone Equalizer for Safelight

A port of [darktable](https://www.darktable.org/)'s **tone equalizer**: relight
a photo by exposure octave. A smoothed exposure mask is built from each
pixel's luminance with an edge-aware filter, so a face, a sky or a backlit wall
sits in one octave and moves as one; nine sliders from −8 EV to 0 EV (or the
curve on the graph, or the wheel over the image) set a gain per octave.

Requires Safelight 3.1.0 or later, and that build must include the lossless
measurement frame (with inter-stage variables and bag-driven pass counts, the
three core hooks it uses). Without it the version check passes but the mask is
measured through a JPEG, and the histogram, the readout and Auto read wrong.

## Using it

- **Simple**: the nine bands, ±2 EV each.
- **Advanced**: the curve over the mask's histogram. Drag it, 4 EV per graph
  height around the pointer; double-click resets it. *Curve smoothing* sets
  how wide each band reaches. *Mask exposure / contrast compensation* spread
  the mask over the bands; **Auto** does it from the histogram, as darktable's
  wand buttons do.
- **Masking**: the luminance estimator, *Preserve details* (EIGF, the guided
  filter, their averaged variants, or no filter), filter diffusion, smoothing
  diameter and edges refinement/feathering.
- **Display exposure mask** shows the mask over the image.
- **Adjust on image**: hover to read the mask exposure under the pointer;
  scroll to brighten or darken everything at that exposure (0.25 EV, Shift 1
  EV, Alt 0.1 EV). Ctrl/⌘/Space still pan and zoom; Esc stops.
- **Presets**: darktable's thirteen, under its names.

The panel measures the mask while it is expanded, after every edit and even on
an untouched photo, so collapse it when you're done.

## Differences from darktable

The maths is darktable's; these are the places the port can't or doesn't
follow it.

- **No mask quantization.** A quantized guide needs four blurred moments and
  a Safelight pass carries three. Its default is 0 and no preset uses it.
- **The blur.** darktable filters a ×4-downscaled copy (a Deriche gaussian for
  EIGF, a box for the guided filter). The port filters at full prepass
  resolution with a dilated B3 chain of the same variance and a dilated box
  chain of the same width. The EIGF chain matches the width darktable's
  Deriche blur really applies, which is 2/1.695 times its nominal σ, rather
  than the nominal σ. Measured against darktable's own code on a test scene,
  with both masks clamped to the curve's −8 to 0 EV window first:

  | Filter | mean \|ΔEV\| | 99th percentile |
  |---|---|---|
  | EIGF | 0.049 | 0.33 |
  | EIGF, feathering 20 | 0.014 | 0.17 |
  | EIGF, diffusion 3, boosted | 0.028 | 0.32 |
  | averaged EIGF | 0.024 | 0.16 |
  | guided filter, feathering 500 | 0.037 | 0.57 |
  | guided filter, diffusion 3, boosted | 0.061 | 1.0 |
  | averaged guided filter | 0.026 | 0.17 |

  The numbers are measured inside the curve's −8 to 0 EV window, which is all
  the curve reads. In the two boosted cases, 37 % (EIGF) and 23 % (guided
  filter) of the test scene's pixels fall below −8 EV, so they count as zero
  difference where both masks are below −8 EV. The guided filter's high
  percentile comes from darktable's own ×4 coefficient grid at strong edges.

- **Where it runs.** After Safelight's core tone block (exposure, highlights,
  shadows) and masks, before the display transform; darktable runs it right
  after exposure. The mask's norm is taken in linear Rec.2020 (darktable:
  camera RGB for raws).
- **All bands at 0 applies no gain**, aside from the Rec.2020 round trip, at
  most one half-float step. darktable still applies its curve fit's ripple of
  up to 0.025 EV.
- **A failed fit leaves the photo alone** and draws the curve orange.
- **Capped filter statistics.** The prepass is half-float, so the filter
  statistics are taken on min(M, 2⁷) and the carried mask on min(M, 2¹⁵). This
  only matters near pixels more than 7 EV above the mask's 0 EV point, at
  extreme boosts, and it keeps the GPU from ever producing NaN or Inf. If the
  prepass can't run at all (no float render targets, no free texture units, a
  pass that fails to compile), the gain still stays within a factor of 0.25
  to 4 (±2 EV), so a wrong mask can misplace the correction but never produces
  NaN or Inf.
- **On the image**, adjusting is a toggle (Safelight's wheel zooms the canvas)
  and the fine step is Alt, since Ctrl pans and zooms. The graph's wheel
  scrolls the panel.

## Development

- `npm test`: the suite, including vectors generated from darktable's own C.
- `npm run test:reference`: regenerate `test/reference/vectors.json` (needs
  gcc; see `test/reference/README.md`).
- `npm run test:gpu`: the stages on Safelight's real renderer under headless
  Chromium + SwiftShader (needs a SafeLight checkout beside this repo, or
  `SAFELIGHT_CORE`). They measured within 0.002 EV of the CPU model there, and
  about 0.004 EV on a scene with lamps far above the mask's 0 EV point.

## Licence

GPL-3.0-or-later. The algorithm and the vendored sources under
`test/reference/upstream/` are darktable's (© Aurélien Pierre and the
darktable authors), at commit `f52993027d5c13e6f6d41a96e5fd483d8f519297`.
