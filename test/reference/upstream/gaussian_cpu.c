/* src/common/gaussian.c @ f52993027d5c13e6f6d41a96e5fd483d8f519297, lines 29-88, 157-196, 199-351, 541-548:
 * the CPU gaussian blur, verbatim. GPL-3.0-or-later, the darktable authors. */

#include "../shim.h"

static void _compute_gauss_params(const float sigma,
                                  dt_gaussian_order_t order,
                                  float *a0,
                                  float *a1,
                                  float *a2,
                                  float *a3,
                                  float *b1,
                                  float *b2,
                                  float *coefp,
                                  float *coefn)
{
  const float alpha = 1.695f / sigma;
  const float ema = expf(-alpha);
  const float ema2 = expf(-2.0f * alpha);
  *b1 = -2.0f * ema;
  *b2 = ema2;
  *a0 = 0.0f;
  *a1 = 0.0f;
  *a2 = 0.0f;
  *a3 = 0.0f;
  *coefp = 0.0f;
  *coefn = 0.0f;

  switch(order)
  {
    default:
    case DT_IOP_GAUSSIAN_ZERO:
    {
      const float k = (1.0f - ema) * (1.0f - ema) / (1.0f + (2.0f * alpha * ema) - ema2);
      *a0 = k;
      *a1 = k * (alpha - 1.0f) * ema;
      *a2 = k * (alpha + 1.0f) * ema;
      *a3 = -k * ema2;
    }
    break;

    case DT_IOP_GAUSSIAN_ONE:
    {
      *a0 = (1.0f - ema) * (1.0f - ema);
      *a1 = 0.0f;
      *a2 = -*a0;
      *a3 = 0.0f;
    }
    break;

    case DT_IOP_GAUSSIAN_TWO:
    {
      const float k = -(ema2 - 1.0f) / (2.0f * alpha * ema);
      float kn = -2.0f * (-1.0f + (3.0f * ema) - (3.0f * ema * ema) + (ema * ema * ema));
      kn /= ((3.0f * ema) + 1.0f + (3.0f * ema * ema) + (ema * ema * ema));
      *a0 = kn;
      *a1 = -kn * (1.0f + (k * alpha)) * ema;
      *a2 = kn * (1.0f - (k * alpha)) * ema;
      *a3 = -kn * ema2;
    }
  }

  *coefp = (*a0 + *a1) / (1.0f + *b1 + *b2);
  *coefn = (*a2 + *a3) / (1.0f + *b1 + *b2);
}

dt_gaussian_t *dt_gaussian_init(const int width,    // width of input image
                                const int height,   // height of input image
                                const int channels, // channels per pixel
                                const float *max,   // maximum allowed values per channel for clamping
                                const float *min,   // minimum allowed values per channel for clamping
                                const float sigma,  // gaussian sigma
                                const int order)    // order of gaussian blur
{
  dt_gaussian_t *g = malloc(sizeof(dt_gaussian_t));
  if(!g) return NULL;

  g->width = width;
  g->height = height;
  g->channels = channels;
  g->sigma = sigma;
  g->order = order;
  g->buf = NULL;
  g->max = calloc(channels, sizeof(float));
  g->min = calloc(channels, sizeof(float));

  if(!g->min || !g->max) goto error;

  for(int k = 0; k < channels; k++)
  {
    g->max[k] = max[k];
    g->min[k] = min[k];
  }

  g->buf = dt_alloc_align_float((size_t)channels * width * height);
  if(!g->buf) goto error;

  return g;

error:
  dt_free_align(g->buf);
  free(g->max);
  free(g->min);
  free(g);
  return NULL;
}

void dt_gaussian_blur(dt_gaussian_t *g, const float *const in, float *const out)
{

  const int width = g->width;
  const int height = g->height;
  const int ch = MIN(4, g->channels); // just to appease zealous compiler warnings about stack usage

  float a0, a1, a2, a3, b1, b2, coefp, coefn;

  _compute_gauss_params(g->sigma, g->order, &a0, &a1, &a2, &a3, &b1, &b2, &coefp, &coefn);

  float *temp = g->buf;

  float *Labmax = g->max;
  float *Labmin = g->min;

// vertical blur column by column
  DT_OMP_FOR()
  for(int i = 0; i < width; i++)
  {
    dt_aligned_pixel_t xp = {0.0f};
    dt_aligned_pixel_t yb = {0.0f};
    dt_aligned_pixel_t yp = {0.0f};

    // forward filter
    for(int k = 0; k < ch; k++)
    {
      xp[k] = CLAMPF(in[(size_t)i * ch + k], Labmin[k], Labmax[k]);
      yb[k] = xp[k] * coefp;
      yp[k] = yb[k];
    }

    dt_aligned_pixel_t xc = {0.0f};
    dt_aligned_pixel_t yc = {0.0f};
    dt_aligned_pixel_t xn = {0.0f};
    dt_aligned_pixel_t xa = {0.0f};
    dt_aligned_pixel_t yn = {0.0f};
    dt_aligned_pixel_t ya = {0.0f};
    for(int j = 0; j < height; j++)
    {
      size_t offset = ((size_t)j * width + i) * ch;

      for(int k = 0; k < ch; k++)
      {
        xc[k] = CLAMPF(in[offset + k], Labmin[k], Labmax[k]);
        yc[k] = (a0 * xc[k]) + (a1 * xp[k]) - (b1 * yp[k]) - (b2 * yb[k]);

        temp[offset + k] = yc[k];

        xp[k] = xc[k];
        yb[k] = yp[k];
        yp[k] = yc[k];
      }
    }

    // backward filter
    for(int k = 0; k < ch; k++)
    {
      xn[k] = CLAMPF(in[((size_t)(height - 1) * width + i) * ch + k], Labmin[k], Labmax[k]);
      xa[k] = xn[k];
      yn[k] = xn[k] * coefn;
      ya[k] = yn[k];
    }

    for(int j = height - 1; j > -1; j--)
    {
      size_t offset = ((size_t)j * width + i) * ch;

      for(int k = 0; k < ch; k++)
      {
        xc[k] = CLAMPF(in[offset + k], Labmin[k], Labmax[k]);

        yc[k] = (a2 * xn[k]) + (a3 * xa[k]) - (b1 * yn[k]) - (b2 * ya[k]);

        xa[k] = xn[k];
        xn[k] = xc[k];
        ya[k] = yn[k];
        yn[k] = yc[k];

        temp[offset + k] += yc[k];
      }
    }
  }

// horizontal blur line by line
  DT_OMP_FOR()
  for(int j = 0; j < height; j++)
  {
    dt_aligned_pixel_t xp = {0.0f};
    dt_aligned_pixel_t yb = {0.0f};
    dt_aligned_pixel_t yp = {0.0f};

    // forward filter
    for(int k = 0; k < ch; k++)
    {
      xp[k] = CLAMPF(temp[(size_t)j * width * ch + k], Labmin[k], Labmax[k]);
      yb[k] = xp[k] * coefp;
      yp[k] = yb[k];
    }

    dt_aligned_pixel_t xc = {0.0f};
    dt_aligned_pixel_t yc = {0.0f};
    dt_aligned_pixel_t xn = {0.0f};
    dt_aligned_pixel_t xa = {0.0f};
    dt_aligned_pixel_t yn = {0.0f};
    dt_aligned_pixel_t ya = {0.0f};

    for(int i = 0; i < width; i++)
    {
      size_t offset = ((size_t)j * width + i) * ch;

      for(int k = 0; k < ch; k++)
      {
        xc[k] = CLAMPF(temp[offset + k], Labmin[k], Labmax[k]);
        yc[k] = (a0 * xc[k]) + (a1 * xp[k]) - (b1 * yp[k]) - (b2 * yb[k]);

        out[offset + k] = yc[k];

        xp[k] = xc[k];
        yb[k] = yp[k];
        yp[k] = yc[k];
      }
    }

    // backward filter
    for(int k = 0; k < ch; k++)
    {
      xn[k] = CLAMPF(temp[((size_t)(j + 1) * width - 1) * ch + k], Labmin[k], Labmax[k]);
      xa[k] = xn[k];
      yn[k] = xn[k] * coefn;
      ya[k] = yn[k];
    }

    for(int i = width - 1; i > -1; i--)
    {
      size_t offset = ((size_t)j * width + i) * ch;

      for(int k = 0; k < ch; k++)
      {
        xc[k] = CLAMPF(temp[offset + k], Labmin[k], Labmax[k]);

        yc[k] = (a2 * xn[k]) + (a3 * xa[k]) - (b1 * yn[k]) - (b2 * ya[k]);

        xa[k] = xn[k];
        xn[k] = xc[k];
        ya[k] = yn[k];
        yn[k] = yc[k];

        out[offset + k] += yc[k];
      }
    }
  }
}

void dt_gaussian_free(dt_gaussian_t *g)
{
  if(!g) return;
  dt_free_align(g->buf);
  free(g->min);
  free(g->max);
  free(g);
}
