#include "shim.h"

/* src/common/box_filters.cc's _box_mean: a (2·radius + 1) box, horizontal then
 * vertical, the window clipped at the borders and each output the mean of the
 * samples present. Its Kahan-compensated float sums become double sums. */
void dt_box_mean(float *const buf, const size_t height, const size_t width, const uint32_t ch,
                 const size_t radius, const uint32_t iterations)
{
  const size_t longest = width > height ? width : height;
  double *const line = calloc(longest * ch, sizeof(double));
  const long r = (long)radius;
  for(uint32_t it = 0; it < iterations; it++)
  {
    for(size_t y = 0; y < height; y++)
    {
      for(long x = 0; x < (long)width; x++)
        for(size_t c = 0; c < ch; c++)
        {
          double sum = 0.0;
          long n = 0;
          for(long xx = MAX(0, x - r); xx <= MIN((long)width - 1, x + r); xx++, n++)
            sum += buf[(y * width + (size_t)xx) * ch + c];
          line[(size_t)x * ch + c] = sum / (double)n;
        }
      for(size_t k = 0; k < width * ch; k++) buf[y * width * ch + k] = (float)line[k];
    }
    for(size_t x = 0; x < width; x++)
    {
      for(long y = 0; y < (long)height; y++)
        for(size_t c = 0; c < ch; c++)
        {
          double sum = 0.0;
          long n = 0;
          for(long yy = MAX(0, y - r); yy <= MIN((long)height - 1, y + r); yy++, n++)
            sum += buf[((size_t)yy * width + x) * ch + c];
          line[(size_t)y * ch + c] = sum / (double)n;
        }
      for(size_t y = 0; y < height; y++)
        for(size_t c = 0; c < ch; c++) buf[(y * width + x) * ch + c] = (float)line[y * ch + c];
    }
  }
  free(line);
}

/* Only eigf_variance_analysis (the quantized-guide path, never taken here)
 * calls it; the plain blur already handles four channels. */
void dt_gaussian_blur_4c(dt_gaussian_t *g, const float *const in, float *const out)
{
  dt_gaussian_blur(g, in, out);
}
