/**
 * Palet warna kontinu untuk peta kecepatan (aproksimasi polinomial, keluaran sRGB 0..1).
 * Koefisien yang sama dipakai di GLSL (shader) dan JS (legenda), sehingga warnanya identik.
 *
 * - turbo: "rainbow" yang lebih rata persepsinya (Google, 2019) — tampilan CFD klasik.
 * - plasma, viridis: palet matplotlib (aproksimasi polinomial derajat 6), ramah buta warna.
 */

// polinomial derajat 6 per kanal: c0 + t·(c1 + t·(c2 + …))
const POLY = {
  plasma: [
    [0.05873234392399702, 0.02333670892565664, 0.5433401826748754],
    [2.176514634195958, 0.2383834171260182, 0.7539604599784036],
    [-2.689460476458034, -7.455851135738909, 3.110799939717086],
    [6.130348345893603, 42.3461881477227, -28.51885465332158],
    [-11.10743619062271, -82.66631109428045, 60.13984767418263],
    [10.02306557647065, 71.41361770095349, -54.07218655560067],
    [-3.658713842777788, -22.93153465461149, 18.19190778539828],
  ],
  viridis: [
    [0.2777273272234177, 0.005407344544966578, 0.3340998053353061],
    [0.1050930431085774, 1.404613529898575, 1.384590162594685],
    [-0.3308618287255563, 0.214847559468213, 0.09509516302823659],
    [-4.634230498983486, -5.799100973351585, -19.33244095627987],
    [6.228269936347081, 14.17993336680509, 56.69055260068105],
    [4.776384997670288, -13.74514537774601, -65.35303263337234],
    [-5.435455855934631, 4.645852612178535, 26.3124352495832],
  ],
};

// Turbo (Mikhailov, Google AI 2019): polinomial terpisah per kanal
const TURBO = {
  r4: [0.13572138, 4.6153926, -42.66032258, 132.13108234],
  g4: [0.09140261, 2.19418839, 4.84296658, -14.18503333],
  b4: [0.1066733, 12.64194608, -60.58204836, 110.36276771],
  r2: [-152.94239396, 59.28637943],
  g2: [4.27729857, 2.82956604],
  b2: [-89.90310912, 27.34824973],
};

export const COLORMAPS = ['turbo', 'plasma', 'viridis'];
export const COLORMAP_LABELS = {
  turbo: 'Turbo (CFD klasik)',
  plasma: 'Plasma (ungu–kuning)',
  viridis: 'Viridis (ramah buta warna)',
};

const clamp01 = (x) => Math.min(1, Math.max(0, x));

/** Warna sRGB [r,g,b] 0..1 untuk t ∈ [0,1]. */
export function colormap(name, t, out = [0, 0, 0]) {
  t = clamp01(t);
  if (name === 'turbo') {
    const v4 = [1, t, t * t, t * t * t];
    const v2 = [v4[2] * v4[2], v4[3] * v4[2]];
    const dot4 = (k) => k[0] * v4[0] + k[1] * v4[1] + k[2] * v4[2] + k[3] * v4[3];
    out[0] = dot4(TURBO.r4) + TURBO.r2[0] * v2[0] + TURBO.r2[1] * v2[1];
    out[1] = dot4(TURBO.g4) + TURBO.g2[0] * v2[0] + TURBO.g2[1] * v2[1];
    out[2] = dot4(TURBO.b4) + TURBO.b2[0] * v2[0] + TURBO.b2[1] * v2[1];
  } else {
    const c = POLY[name] || POLY.plasma;
    for (let k = 0; k < 3; k++) {
      let v = c[6][k];
      for (let i = 5; i >= 0; i--) v = c[i][k] + t * v;
      out[k] = v;
    }
  }
  out[0] = clamp01(out[0]);
  out[1] = clamp01(out[1]);
  out[2] = clamp01(out[2]);
  return out;
}

const f = (x) => (Number.isInteger(x) ? x.toFixed(1) : String(x));
const v3 = (a) => `vec3(${a.map(f).join(', ')})`;
const v4s = (a) => `vec4(${a.map(f).join(', ')})`;
const v2s = (a) => `vec2(${a.map(f).join(', ')})`;

/** Fungsi GLSL `vec3 cmap(float t, int which)` (0 turbo, 1 plasma, 2 viridis). */
export function colormapGLSL() {
  const poly = (name, fn) => {
    const c = POLY[name];
    return `vec3 ${fn}(float t) {
  return ${v3(c[0])} + t * (${v3(c[1])} + t * (${v3(c[2])} + t * (${v3(c[3])} + t * (${v3(c[4])} + t * (${v3(c[5])} + t * ${v3(c[6])})))));
}`;
  };
  return `
vec3 cmTurbo(float x) {
  vec4 v4 = vec4(1.0, x, x * x, x * x * x);
  vec2 v2 = v4.zw * v4.z;
  return vec3(
    dot(v4, ${v4s(TURBO.r4)}) + dot(v2, ${v2s(TURBO.r2)}),
    dot(v4, ${v4s(TURBO.g4)}) + dot(v2, ${v2s(TURBO.g2)}),
    dot(v4, ${v4s(TURBO.b4)}) + dot(v2, ${v2s(TURBO.b2)}));
}
${poly('plasma', 'cmPlasma')}
${poly('viridis', 'cmViridis')}
vec3 cmap(float t, int which) {
  t = clamp(t, 0.0, 1.0);
  vec3 c = which == 0 ? cmTurbo(t) : which == 1 ? cmPlasma(t) : cmViridis(t);
  return clamp(c, 0.0, 1.0);
}`;
}
