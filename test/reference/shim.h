/* Just enough of darktable's environment for the vendored headers in
 * upstream/ to compile on their own: OpenMP and SIMD macros compile away,
 * allocations are plain calloc, logging is dropped, and the box mean and the
 * gaussian blur's struct are declared here (shim.c, upstream/gaussian_cpu.c). */
#pragma once

#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

typedef int gboolean;
#define TRUE 1
#define FALSE 0

#define DT_OMP_FOR(...)
#define DT_OMP_FOR_SIMD(...)
#define DT_OMP_SIMD(...)
#define DT_OMP_DECLARE_SIMD(...)
#define DT_OMP_PRAGMA(...)
#define __DT_CLONE_TARGETS__
#define DT_ALIGNED_ARRAY
#define DT_ALIGNED_PIXEL

#define MIN(a, b) ((a) < (b) ? (a) : (b))
#define MAX(a, b) ((a) > (b) ? (a) : (b))
#define CLAMP(x, low, high) (((x) > (high)) ? (high) : (((x) < (low)) ? (low) : (x)))
#define CLAMPF(x, low, high) fminf(fmaxf((x), (low)), (high))
#define for_each_channel(c, ...) for(size_t c = 0; c < 4; c++)
#define M_SQRT2_F 1.41421356237309504880f

#define DT_DEBUG_ALWAYS 0
#define DT_DEBUG_PIPE 0
#define dt_print(...) ((void)0)
#define dt_control_log(...) ((void)0)
#define _(s) (s)

typedef float dt_aligned_pixel_t[4];
typedef float dt_colormatrix_t[4][4];

static inline float *dt_alloc_align_float(const size_t n) { return calloc(n, sizeof(float)); }
static inline double *dt_alloc_align_double(const size_t n) { return calloc(n, sizeof(double)); }
static inline void dt_free_align(void *p) { free(p); }
static inline void dt_iop_image_copy(float *const out, const float *const in, const size_t n)
{
  memcpy(out, in, n * sizeof(float));
}

void dt_box_mean(float *const buf, const size_t height, const size_t width, const uint32_t ch,
                 const size_t radius, const uint32_t iterations);

typedef enum dt_gaussian_order_t
{
  DT_IOP_GAUSSIAN_ZERO = 0,
  DT_IOP_GAUSSIAN_ONE = 1,
  DT_IOP_GAUSSIAN_TWO = 2
} dt_gaussian_order_t;

typedef struct dt_gaussian_t
{
  int width, height, channels;
  float sigma;
  int order;
  float *max;
  float *min;
  float *buf;
} dt_gaussian_t;

dt_gaussian_t *dt_gaussian_init(const int width, const int height, const int channels, const float *max,
                                const float *min, const float sigma, const int order);
void dt_gaussian_blur(dt_gaussian_t *g, const float *const in, float *const out);
void dt_gaussian_blur_4c(dt_gaussian_t *g, const float *const in, float *const out);
void dt_gaussian_free(dt_gaussian_t *g);
