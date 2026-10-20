/* darktable's tone equalizer arithmetic, run over fixed inputs and printed as
 * JSON: the reference vectors the Safelight port is checked against.
 *
 * darktable master f52993027d5c13e6f6d41a96e5fd483d8f519297 (2026-10-19),
 * GPL-3.0-or-later, (c) Aurelien Pierre and the darktable authors.
 *   upstream/{luminance_mask,fast_guided_filter,eigf,choleski}.h: verbatim,
 *     includes pointed at shim.h (fetch-upstream.mjs).
 *   upstream/gaussian_cpu.c: the CPU blur of src/common/gaussian.c, verbatim.
 *   Below: src/iop/toneequal.c functions, verbatim unless marked. */

#include "shim.h"
#include "upstream/luminance_mask.h"
#include "upstream/fast_guided_filter.h"
#include "upstream/eigf.h"
#include "upstream/choleski.h"

#define UI_SAMPLES 256
#define CONTRAST_FULCRUM exp2f(-4.0f)
#define CHANNELS 9
#define PIXEL_CHAN 8
#define DT_TONEEQ_MIN_EV (-8.0f)
#define DT_TONEEQ_MAX_EV (0.0f)

typedef enum dt_iop_toneequalizer_filter_t
{
  DT_TONEEQ_NONE = 0,
  DT_TONEEQ_AVG_GUIDED,
  DT_TONEEQ_GUIDED,
  DT_TONEEQ_AVG_EIGF,
  DT_TONEEQ_EIGF
} dt_iop_toneequalizer_filter_t;

static const float centers_ops[PIXEL_CHAN] = { -56.0f / 7.0f, -48.0f / 7.0f, -40.0f / 7.0f, -32.0f / 7.0f,
                                              -24.0f / 7.0f, -16.0f / 7.0f, -8.0f / 7.0f,  0.0f / 7.0f };
static const float centers_params[CHANNELS] = { -8.0f, -7.0f, -6.0f, -5.0f, -4.0f, -3.0f, -2.0f, -1.0f, 0.0f };

/* ── toneequal.c ───────────────────────────────────────────────────────── */

static float gaussian_denom(const float sigma)
{
  return 2.0f * sigma * sigma;
}

static float gaussian_func(const float radius, const float denominator)
{
  return expf(- radius * radius / denominator);
}

static inline float pixel_correction(const float exposure, const float *const restrict factors,
                                     const float sigma)
{
  float result = 0.0f;
  const float gauss_denom = gaussian_denom(sigma);
  const float expo = fast_clamp(exposure, DT_TONEEQ_MIN_EV, DT_TONEEQ_MAX_EV);
  for(int i = 0; i < PIXEL_CHAN; ++i)
    result += gaussian_func(expo - centers_ops[i], gauss_denom) * factors[i];
  return fast_clamp(result, 0.25f, 4.0f);
}

static inline void build_interpolation_matrix(float A[CHANNELS * PIXEL_CHAN], const float sigma)
{
  const float gauss_denom = gaussian_denom(sigma);
  for(int i = 0; i < CHANNELS; ++i)
    for(int j = 0; j < PIXEL_CHAN; ++j)
      A[i * PIXEL_CHAN + j] = gaussian_func(centers_params[i] - centers_ops[j], gauss_denom);
}

static gboolean compute_channels_factors(const float factors[PIXEL_CHAN], float out[CHANNELS], const float sigma)
{
  for(int i = 0; i < CHANNELS; ++i) out[i] = pixel_correction(centers_params[i], factors, sigma);
  return TRUE;
}

static inline void compute_log_histogram_and_stats(const float *const restrict luminance,
                                                   int histogram[UI_SAMPLES], const size_t num_elem,
                                                   int *max_histogram, float *first_decile, float *last_decile)
{
  memset(histogram, 0, sizeof(int) * UI_SAMPLES);
#define TEMP_SAMPLES 2 * UI_SAMPLES
  int temp_hist[TEMP_SAMPLES];
  memset(temp_hist, 0, sizeof(int) * TEMP_SAMPLES);
  for(size_t k = 0; k < num_elem; k++)
  {
    const int index = CLAMP((int)(((log2f(luminance[k]) + 10.0f) / 16.0f) * (float)TEMP_SAMPLES), 0, TEMP_SAMPLES - 1);
    temp_hist[index] += 1;
  }
  const int first = (int)((float)num_elem * 0.05f);
  const int last = (int)((float)num_elem * (1.0f - 0.95f));
  int population = 0;
  int first_pos = 0;
  int last_pos = 0;
  for(int k = 0; k < TEMP_SAMPLES; ++k)
  {
    const size_t prev_population = population;
    population += temp_hist[k];
    if(prev_population < first && first <= population)
    {
      first_pos = k;
      break;
    }
  }
  population = 0;
  for(int k = TEMP_SAMPLES - 1; k >= 0; --k)
  {
    const size_t prev_population = population;
    population += temp_hist[k];
    if(prev_population < last && last <= population)
    {
      last_pos = k;
      break;
    }
  }
  *first_decile = 16.0 * (float)first_pos / (float)(TEMP_SAMPLES - 1) - 10.0;
  *last_decile = 16.0 * (float)last_pos / (float)(TEMP_SAMPLES - 1) - 10.0;
  *max_histogram = 1;
  for(size_t k = 0; k < TEMP_SAMPLES; ++k)
  {
    const float EV = 16.0 * (float)k / (float)(TEMP_SAMPLES - 1) - 10.0;
    const int i = CLAMP((int)(((EV + 8.0f) / 8.0f) * (float)UI_SAMPLES), 0, UI_SAMPLES - 1);
    histogram[i] += temp_hist[k];
    *max_histogram = histogram[i] > *max_histogram ? histogram[i] : *max_histogram;
  }
}

static const dt_colormatrix_t gauss_kernel =
  { { 0.076555024f, 0.124401914f, 0.076555024f },
    { 0.124401914f, 0.196172249f, 0.124401914f },
    { 0.076555024f, 0.124401914f, 0.076555024f } };

static float get_luminance_from_buffer(const float *const buffer, const size_t width, const size_t height,
                                       const size_t x, const size_t y)
{
  if(y >= height || x >= width) return NAN;
  const size_t y_abs[4] = { MAX(y, 1) - 1, y, MIN(y + 1, height - 1), y };
  float luminance = 0.0f;
  if(x > 1 && x < width - 2)
  {
    for(int i = 0; i < 3; ++i)
    {
      const size_t y_i = y_abs[i];
      for_each_channel(j) luminance += buffer[width * y_i + x - 1 + j] * gauss_kernel[i][j];
    }
    return luminance;
  }
  const size_t x_abs[4] = { MAX(x, 1) - 1, x, MIN(x + 1, width - 1), x };
  for(int i = 0; i < 3; ++i)
  {
    const size_t y_i = y_abs[i];
    for_each_channel(j) luminance += buffer[width * y_i + x_abs[j]] * gauss_kernel[i][j];
  }
  return luminance;
}

/* Marked: set_new_params_interactive with the GUI copy of the linear node
 * gains passed in as `user` (g->temp_user_params) and g->sigma as `sigma`;
 * the logs and the commit are gone. On success `user` holds the fitted gains. */
static gboolean interactive(float user[CHANNELS], const float sigma, const float control_exposure,
                            const float exposure_offset)
{
  const float blending_sigma = sigma * sigma / 2.0f;
  const float std = gaussian_denom(blending_sigma);
  for(int i = 0; i < CHANNELS; ++i)
    user[i] *= exp2f(gaussian_func(centers_params[i] - control_exposure, std) * exposure_offset);
  float A[CHANNELS * PIXEL_CHAN];
  build_interpolation_matrix(A, sigma);
  float factors[CHANNELS];
  memcpy(factors, user, sizeof(factors));
  if(!pseudo_solve(A, factors, CHANNELS, PIXEL_CHAN, FALSE)) return FALSE;
  return compute_channels_factors(factors, user, sigma);
}

/* Marked: auto_adjust_exposure_boost's arithmetic, with the histogram's
 * deciles and the params passed in. */
static float auto_exposure(const float first_decile, const float last_decile, const float exposure_boost,
                           const float contrast_boost)
{
  const float fd_new = exp2f(first_decile);
  const float ld_new = exp2f(last_decile);
  const float e = exp2f(exposure_boost);
  const float c = exp2f(contrast_boost);
  const float fd_old = ((fd_new - CONTRAST_FULCRUM) / c + CONTRAST_FULCRUM) / e;
  const float ld_old = ((ld_new - CONTRAST_FULCRUM) / c + CONTRAST_FULCRUM) / e;
  const float s1 = CONTRAST_FULCRUM - exp2f(-7.0);
  const float s2 = exp2f(-1.0) - CONTRAST_FULCRUM;
  const float mix = fd_old * s2 + ld_old * s1;
  return log2f(CONTRAST_FULCRUM * (s1 + s2) / mix);
}

/* Marked: auto_adjust_contrast_boost's arithmetic, likewise. */
static float auto_contrast(const float first_decile, const float last_decile, const float exposure_boost,
                           const float contrast_boost, const int details, const float feathering)
{
  const float fd_new = exp2f(first_decile);
  const float ld_new = exp2f(last_decile);
  const float e = exp2f(exposure_boost);
  float c = exp2f(contrast_boost);
  const float fd_old = ((fd_new - CONTRAST_FULCRUM) / c + CONTRAST_FULCRUM) / e;
  const float ld_old = ((ld_new - CONTRAST_FULCRUM) / c + CONTRAST_FULCRUM) / e;
  const float s1 = CONTRAST_FULCRUM - exp2f(-7.0);
  const float s2 = exp2f(-1.0) - CONTRAST_FULCRUM;
  const float mix = fd_old * s2 + ld_old * s1;
  c = log2f(mix / (CONTRAST_FULCRUM * (ld_old - fd_old)) / c);
  if(details == DT_TONEEQ_EIGF && c > 0.0f)
  {
    const float correction = -0.0276f + 0.01823 * feathering + (0.7566f - 1.0f) * c;
    if(feathering < 5.0f)
      c += correction;
    else if(feathering < 10.0f)
      c += correction * (2.0f - feathering / 5.0f);
  }
  else if(details == DT_TONEEQ_GUIDED && c > 0.0f)
    c = 0.0235f + 1.1225f * c;
  return contrast_boost + c;
}

/* Marked: compute_luminance_mask with dt_iop_toneequalizer_data_t's fields
 * passed in (boosts already exp2'd, feathering already 1/x, quantization 0,
 * which is all the port supports). */
static void compute_luminance_mask(const float *const restrict in, float *const restrict luminance,
                                   const size_t width, const size_t height, const int details, const int method,
                                   const float exposure_boost, const float contrast_boost, const int radius,
                                   const float feathering, const int iterations)
{
  const float quantization = 0.0f;
  const float scale = 0.0f;
  switch(details)
  {
    case(DT_TONEEQ_NONE):
      luminance_mask(in, luminance, width, height, method, exposure_boost, 0.0f, 1.0f);
      break;
    case(DT_TONEEQ_AVG_GUIDED):
      luminance_mask(in, luminance, width, height, method, exposure_boost, 0.0f, 1.0f);
      fast_surface_blur(luminance, width, height, radius, feathering, iterations, DT_GF_BLENDING_GEOMEAN, scale,
                        quantization, exp2f(-14.0f), 4.0f);
      break;
    case(DT_TONEEQ_GUIDED):
      luminance_mask(in, luminance, width, height, method, exposure_boost, CONTRAST_FULCRUM, contrast_boost);
      fast_surface_blur(luminance, width, height, radius, feathering, iterations, DT_GF_BLENDING_LINEAR, scale,
                        quantization, exp2f(-14.0f), 4.0f);
      break;
    case(DT_TONEEQ_AVG_EIGF):
      luminance_mask(in, luminance, width, height, method, exposure_boost, 0.0f, 1.0f);
      fast_eigf_surface_blur(luminance, width, height, radius, feathering, iterations, DT_GF_BLENDING_GEOMEAN,
                             scale, quantization, exp2f(-14.0f), 4.0f);
      break;
    case(DT_TONEEQ_EIGF):
      luminance_mask(in, luminance, width, height, method, exposure_boost, CONTRAST_FULCRUM, contrast_boost);
      fast_eigf_surface_blur(luminance, width, height, radius, feathering, iterations, DT_GF_BLENDING_LINEAR,
                             scale, quantization, exp2f(-14.0f), 4.0f);
      break;
    default:
      luminance_mask(in, luminance, width, height, method, exposure_boost, 0.0f, 1.0f);
      break;
  }
}

/* init_presets' band patterns, verbatim arithmetic. */
static void compress(float b[CHANNELS], const float step)
{
  b[0] = step;
  b[1] = 5.f / 3.f * step;
  b[2] = 5.f / 3.f * step;
  b[3] = step;
  b[4] = 0.0f;
  b[5] = -step;
  b[6] = -5.f / 3.f * step;
  b[7] = -5.f / 3.f * step;
  b[8] = -step;
}

static void dilate(float b[CHANNELS], const float step)
{
  b[0] = -15.f / 9.f * step;
  b[1] = -14.f / 9.f * step;
  b[2] = -12.f / 9.f * step;
  b[3] = -8.f / 9.f * step;
  b[4] = 0.f;
  b[5] = 8.f / 9.f * step;
  b[6] = 12.f / 9.f * step;
  b[7] = 14.f / 9.f * step;
  b[8] = 15.f / 9.f * step;
}

/* ── output ─────────────────────────────────────────────────────────────── */

static uint32_t seed = 12345u;
static float rnd(void)
{
  seed = seed * 1664525u + 1013904223u;
  return (float)(seed >> 8) / 16777216.0f;
}

static void floats(const float *v, const size_t n)
{
  putchar('[');
  for(size_t i = 0; i < n; i++) printf(i ? ",%.9g" : "%.9g", v[i]);
  putchar(']');
}

static void ints(const int *v, const size_t n)
{
  putchar('[');
  for(size_t i = 0; i < n; i++) printf(i ? ",%d" : "%d", v[i]);
  putchar(']');
}

static void section(const char *name, const int first)
{
  printf(first ? "\"%s\":[" : "],\"%s\":[", name);
}

static void sep(const int k)
{
  if(k) putchar(',');
}

static const float RELIGHT[CHANNELS] = { 0.0f, 0.15f, 0.6f, 1.15f, 1.33f, 1.15f, 0.6f, 0.15f, 0.0f };

static void norms(void)
{
  static const float RGB[][3] = { { 0.2f, 0.5f, 0.1f },   { 0.0f, 0.0f, 0.0f },   { 1.2f, 0.9f, 0.4f },
                                  { 0.05f, 0.02f, 0.3f }, { -0.02f, 0.1f, 0.05f }, { 0.4f, -0.05f, 0.2f },
                                  { 0.18f, 0.18f, 0.18f }, { 3.0f, 2.0f, 1.0f },   { 1e-5f, 2e-5f, 3e-5f },
                                  { 0.7f, 0.0f, 0.0f },   { 0.0f, 0.0f, 0.6f },   { 0.01f, 0.012f, 0.02f } };
  /* exposure EV, fulcrum, contrast EV */
  static const float BOOST[][3] = { { 0.0f, 0.0f, 0.0f }, { -1.57f, 0.0625f, 0.5f }, { 1.0f, 0.0625f, -1.0f } };
  int k = 0;
  for(size_t r = 0; r < sizeof(RGB) / sizeof(RGB[0]); r++)
    for(int method = 0; method < 7; method++)
      for(size_t b = 0; b < sizeof(BOOST) / sizeof(BOOST[0]); b++)
      {
        const float in[4] = { RGB[r][0], RGB[r][1], RGB[r][2], 1.0f };
        const float e = exp2f(BOOST[b][0]), f = BOOST[b][1], c = exp2f(BOOST[b][2]);
        float out = 0.0f;
        luminance_mask(in, &out, 1, 1, method, e, f, c);
        sep(k++);
        printf("{\"rgb\":");
        floats(RGB[r], 3);
        printf(",\"method\":%d,\"exposure\":%.9g,\"fulcrum\":%.9g,\"contrast\":%.9g,\"value\":%.9g}", method, e, f,
               c, out);
      }
}

static void fits(void)
{
  static const float SIGMAS[] = { 1.0f, M_SQRT2_F, 2.0f, 2.52f };
  float sets[8][CHANNELS] = { { 0 } };
  compress(sets[1], 0.65f);
  compress(sets[2], 0.45f);
  dilate(sets[3], 0.45f);
  memcpy(sets[4], RELIGHT, sizeof(RELIGHT));
  for(int s = 5; s < 8; s++)
    for(int i = 0; i < CHANNELS; i++) sets[s][i] = 4.0f * rnd() - 2.0f;
  int k = 0;
  for(size_t si = 0; si < sizeof(SIGMAS) / sizeof(SIGMAS[0]); si++)
    for(int s = 0; s < 8; s++)
    {
      const float sigma = SIGMAS[si];
      float A[CHANNELS * PIXEL_CHAN];
      build_interpolation_matrix(A, sigma);
      float factors[CHANNELS];
      for(int i = 0; i < CHANNELS; i++) factors[i] = exp2f(sets[s][i]);
      const gboolean valid = pseudo_solve(A, factors, CHANNELS, PIXEL_CHAN, FALSE);
      float nodes[CHANNELS];
      compute_channels_factors(factors, nodes, sigma);
      float curve[81];
      for(int c = 0; c < 81; c++) curve[c] = pixel_correction(-8.0f + c / 10.0f, factors, sigma);
      sep(k++);
      printf("{\"sigma\":%.9g,\"bands\":", sigma);
      floats(sets[s], CHANNELS);
      printf(",\"valid\":%s,\"weights\":", valid ? "true" : "false");
      floats(factors, PIXEL_CHAN);
      printf(",\"nodes\":");
      floats(nodes, CHANNELS);
      printf(",\"curve\":");
      floats(curve, 81);
      putchar('}');
    }
}

static void interactives(void)
{
  struct
  {
    float sigma;
    float start[CHANNELS];
    int steps;
    float step[4][2];
  } cases[3] = {
    { M_SQRT2_F, { 0 }, 4, { { -4.0f, 0.25f }, { -4.0f, 0.25f }, { -1.3f, -1.0f }, { -7.2f, 0.1f } } },
    { 2.0f, { 0 }, 2, { { -2.5f, 0.5f }, { -6.0f, -0.25f } } },
    { 1.0f, { 0 }, 3, { { -3.3f, 1.0f }, { 0.4f, -1.0f }, { -9.0f, 0.25f } } },
  };
  compress(cases[1].start, 0.45f);
  memcpy(cases[2].start, RELIGHT, sizeof(RELIGHT));
  for(int c = 0; c < 3; c++)
  {
    sep(c);
    printf("{\"sigma\":%.9g,\"start\":", cases[c].sigma);
    floats(cases[c].start, CHANNELS);
    printf(",\"steps\":[");
    float user[CHANNELS];
    for(int i = 0; i < CHANNELS; i++) user[i] = exp2f(cases[c].start[i]);
    for(int s = 0; s < cases[c].steps; s++)
    {
      float before[CHANNELS];
      memcpy(before, user, sizeof(user));
      const gboolean valid = interactive(user, cases[c].sigma, cases[c].step[s][0], cases[c].step[s][1]);
      sep(s);
      printf("{\"x\":%.9g,\"offset\":%.9g,\"bands\":", cases[c].step[s][0], cases[c].step[s][1]);
      if(valid)
      {
        float gains[CHANNELS];
        for(int i = 0; i < CHANNELS; i++) gains[i] = log2f(user[i]);
        floats(gains, CHANNELS);
      }
      else
      {
        printf("null");
        memcpy(user, before, sizeof(user));
      }
      putchar('}');
    }
    printf("]}");
  }
}

static void histograms(void)
{
  static float lum[20000], ev[20000];
  const size_t sizes[3] = { 5000, 19, 20000 };
  for(int h = 0; h < 3; h++)
  {
    for(size_t k = 0; k < sizes[h]; k++)
    {
      const float x = h == 2 ? -4.0f + 3.0f * (rnd() + rnd() + rnd() - 1.5f) : -12.0f + 20.0f * rnd();
      lum[k] = exp2f(x);
      ev[k] = log2f(lum[k]);
    }
    int bins[UI_SAMPLES];
    int max = 0;
    float first = 0.0f, last = 0.0f;
    compute_log_histogram_and_stats(lum, bins, sizes[h], &max, &first, &last);
    sep(h);
    printf("{\"ev\":");
    floats(ev, sizes[h]);
    printf(",\"bins\":");
    ints(bins, UI_SAMPLES);
    printf(",\"max\":%d,\"first\":%.9g,\"last\":%.9g}", max, first, last);
  }
}

static void autos(void)
{
  static const float FIRST[] = { -7.5f, -5.2f }, LAST[] = { -1.1f, -0.3f }, E[] = { 0.0f, -1.57f },
                     C[] = { 0.0f, 0.5f }, FEATHER[] = { 1.0f, 7.0f, 20.0f, 500.0f };
  static const int DETAILS[] = { DT_TONEEQ_EIGF, DT_TONEEQ_GUIDED, DT_TONEEQ_AVG_EIGF };
  int k = 0;
  for(int a = 0; a < 2; a++)
    for(int b = 0; b < 2; b++)
      for(int e = 0; e < 2; e++)
        for(int c = 0; c < 2; c++)
          for(int d = 0; d < 3; d++)
            for(int f = 0; f < 4; f++)
            {
              sep(k++);
              printf("{\"first\":%.9g,\"last\":%.9g,\"exposureBoost\":%.9g,\"contrastBoost\":%.9g,\"details\":%d,"
                     "\"feathering\":%.9g,\"exposure\":%.9g,\"contrast\":%.9g}",
                     FIRST[a], LAST[b], E[e], C[c], DETAILS[d], FEATHER[f],
                     auto_exposure(FIRST[a], LAST[b], E[e], C[c]),
                     auto_contrast(FIRST[a], LAST[b], E[e], C[c], DETAILS[d], FEATHER[f]));
            }
}

static void cursor(void)
{
  enum { W = 16, H = 12 };
  static float lum[W * H], ev[W * H];
  for(int k = 0; k < W * H; k++)
  {
    lum[k] = exp2f(-9.0f + 10.0f * rnd());
    ev[k] = log2f(lum[k]);
  }
  static const int AT[][2] = { { 0, 0 }, { 15, 11 }, { 1, 1 }, { 7, 5 }, { 14, 3 }, { 2, 10 } };
  printf("{\"width\":%d,\"height\":%d,\"ev\":", W, H);
  floats(ev, W * H);
  printf(",\"points\":[");
  for(int p = 0; p < 6; p++)
  {
    sep(p);
    printf("{\"x\":%d,\"y\":%d,\"value\":%.9g}", AT[p][0], AT[p][1],
           log2f(get_luminance_from_buffer(lum, W, H, AT[p][0], AT[p][1])));
  }
  printf("]}");
}

typedef struct
{
  const char *name;
  float bands[CHANNELS];
  float blending, smoothing, feathering, contrast_boost, exposure_boost;
  int details, method, iterations;
} preset_t;

static void preset(preset_t *p, const char *name, const int k)
{
  sep(k);
  printf("{\"name\":\"%s\",\"details\":%d,\"method\":%d,\"exposureBoost\":%.9g,\"contrastBoost\":%.9g,"
         "\"blending\":%.9g,\"feathering\":%.9g,\"iterations\":%d,\"smoothing\":%.9g,\"bands\":",
         name, p->details, p->method, p->exposure_boost, p->contrast_boost, p->blending, p->feathering,
         p->iterations, p->smoothing);
  floats(p->bands, CHANNELS);
  putchar('}');
}

/* init_presets (te.c:484-618): every field carries over from one preset to
 * the next, as upstream. */
static void presets(void)
{
  preset_t p;
  memset(&p, 0, sizeof(p));
  int k = 0;
  p.method = DT_TONEEQ_NORM_POWER;
  p.contrast_boost = 0.0f;
  p.details = DT_TONEEQ_NONE;
  p.exposure_boost = -0.5f;
  p.feathering = 1.0f;
  p.iterations = 1;
  p.smoothing = M_SQRT2_F;
  preset(&p, "simple tone curve", k++);
  p.details = DT_TONEEQ_EIGF;
  p.method = DT_TONEEQ_NORM_2;
  p.blending = 5.0f;
  p.feathering = 1.0f;
  p.iterations = 1;
  p.exposure_boost = 0.0f;
  p.contrast_boost = 0.0f;
  preset(&p, "mask blending | all purposes", k++);
  p.blending = 1.0f;
  p.feathering = 10.0f;
  p.iterations = 3;
  preset(&p, "mask blending | people with backlight", k++);
  p.exposure_boost = -1.57f;
  p.contrast_boost = 0.0f;
  p.blending = 2.0f;
  p.feathering = 50.0f;
  p.iterations = 5;
  p.details = DT_TONEEQ_EIGF;
  p.feathering = 20.0f;
  compress(p.bands, 0.65f);
  preset(&p, "compress shadows/highlights | EIGF | strong", k++);
  p.details = DT_TONEEQ_GUIDED;
  p.feathering = 500.0f;
  preset(&p, "compress shadows/highlights | GF | strong", k++);
  p.details = DT_TONEEQ_EIGF;
  p.blending = 3.0f;
  p.feathering = 7.0f;
  p.iterations = 3;
  compress(p.bands, 0.45f);
  preset(&p, "compress shadows/highlights | EIGF | medium", k++);
  p.details = DT_TONEEQ_GUIDED;
  p.feathering = 500.0f;
  preset(&p, "compress shadows/highlights | GF | medium", k++);
  p.details = DT_TONEEQ_EIGF;
  p.blending = 5.0f;
  p.feathering = 1.0f;
  p.iterations = 1;
  compress(p.bands, 0.25f);
  preset(&p, "compress shadows/highlights | EIGF | soft", k++);
  p.details = DT_TONEEQ_GUIDED;
  p.feathering = 500.0f;
  preset(&p, "compress shadows/highlights | GF | soft", k++);
  p.details = DT_TONEEQ_NONE;
  dilate(p.bands, 0.25f);
  preset(&p, "contrast tone curve | soft", k++);
  dilate(p.bands, 0.45f);
  preset(&p, "contrast tone curve | medium", k++);
  dilate(p.bands, 0.65f);
  preset(&p, "contrast tone curve | strong", k++);
  p.details = DT_TONEEQ_EIGF;
  p.blending = 5.0f;
  p.feathering = 1.0f;
  p.iterations = 1;
  p.exposure_boost = -0.5f;
  p.contrast_boost = 0.0f;
  memcpy(p.bands, RELIGHT, sizeof(RELIGHT));
  preset(&p, "relight: fill-in", k++);
}

/* One 160×120 scene, the dt pipe's 4-channel layout, and eight filter
 * settings run through compute_luminance_mask with the radius
 * modify_roi_in gives at scale 1. */
static void masks(void)
{
  enum { W = 160, H = 120 };
  static float rgba[W * H * 4], rgb[W * H * 3], mask[W * H];
  for(int y = 0; y < H; y++)
    for(int x = 0; x < W; x++)
    {
      const float u = (x + 0.5f) / W, v = (y + 0.5f) / H;
      float base = 0.6f * (0.8f + 0.2f * v);
      if((u - 0.45f) * (u - 0.45f) + (v - 0.6f) * 0.75f * (v - 0.6f) * 0.75f < 0.28f * 0.28f)
        base = 0.02f * (1.0f + 0.6f * sinf(40.0f * u) * sinf(33.0f * v));
      else if(u > 0.8f && u < 0.86f)
        base = 0.15f;
      base *= exp2f(0.3f * (rnd() - 0.5f));
      const float px[3] = { base * 1.1f, base, base * 0.85f };
      for(int c = 0; c < 3; c++)
      {
        rgba[(y * W + x) * 4 + c] = px[c];
        rgb[(y * W + x) * 3 + c] = px[c];
      }
      rgba[(y * W + x) * 4 + 3] = 1.0f;
    }
  printf("{\"scene\":{\"width\":%d,\"height\":%d,\"rgb\":", W, H);
  floats(rgb, W * H * 3);
  printf("},\"cases\":[");
  /* details, method, exposure EV, contrast EV, blending %, feathering, iterations */
  static const struct
  {
    int details, method;
    float exposure, contrast, blending, feathering;
    int iterations;
  } CASES[] = {
    { DT_TONEEQ_EIGF, DT_TONEEQ_NORM_2, 0.0f, 0.0f, 10.0f, 1.0f, 1 },
    { DT_TONEEQ_EIGF, DT_TONEEQ_NORM_2, 0.0f, 0.0f, 10.0f, 20.0f, 1 },
    { DT_TONEEQ_EIGF, DT_TONEEQ_NORM_2, -1.57f, 0.5f, 10.0f, 7.0f, 3 },
    { DT_TONEEQ_AVG_EIGF, DT_TONEEQ_NORM_2, 0.0f, 0.0f, 10.0f, 1.0f, 1 },
    { DT_TONEEQ_GUIDED, DT_TONEEQ_NORM_2, 0.0f, 0.0f, 10.0f, 500.0f, 1 },
    { DT_TONEEQ_GUIDED, DT_TONEEQ_NORM_2, -1.57f, 0.5f, 10.0f, 500.0f, 3 },
    { DT_TONEEQ_AVG_GUIDED, DT_TONEEQ_NORM_2, 0.0f, 0.0f, 10.0f, 10.0f, 1 },
    { DT_TONEEQ_NONE, DT_TONEEQ_NORM_POWER, -0.5f, 0.0f, 10.0f, 1.0f, 1 },
  };
  for(size_t k = 0; k < sizeof(CASES) / sizeof(CASES[0]); k++)
  {
    const float diameter = CASES[k].blending / 100.0f * (float)MAX(W, H) * 1.0f;
    const int radius = (int)((diameter - 1.0f) / 2.0f);
    compute_luminance_mask(rgba, mask, W, H, CASES[k].details, CASES[k].method, exp2f(CASES[k].exposure),
                           exp2f(CASES[k].contrast), radius, 1.0f / CASES[k].feathering, CASES[k].iterations);
    sep((int)k);
    printf("{\"details\":%d,\"method\":%d,\"exposureBoost\":%.9g,\"contrastBoost\":%.9g,\"blending\":%.9g,"
           "\"feathering\":%.9g,\"iterations\":%d,\"mask\":",
           CASES[k].details, CASES[k].method, CASES[k].exposure, CASES[k].contrast, CASES[k].blending,
           CASES[k].feathering, CASES[k].iterations);
    floats(mask, W * H);
    putchar('}');
  }
  printf("]}");
}

int main(void)
{
  putchar('{');
  section("norms", 1);
  norms();
  section("fits", 0);
  fits();
  section("interactive", 0);
  interactives();
  section("histograms", 0);
  histograms();
  section("autos", 0);
  autos();
  printf("],\"cursor\":");
  cursor();
  printf(",\"presets\":[");
  presets();
  printf("],\"masks\":");
  masks();
  printf("}\n");
  return 0;
}
