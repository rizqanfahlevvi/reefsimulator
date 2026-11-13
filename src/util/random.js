/** Generator acak deterministik (Park–Miller) supaya tata letak prosedural selalu sama. */
export function createRng(seed = 11) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

/** Hash 3D → [0,1). */
function h3(x, y, z) {
  const n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return n - Math.floor(n);
}

/** Value noise 3D dengan interpolasi smoothstep. */
export function vnoise(x, y, z) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = x - xi;
  const yf = y - yi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const w = zf * zf * (3 - 2 * zf);
  const l = (a, b, t) => a + (b - a) * t;
  return l(
    l(l(h3(xi, yi, zi), h3(xi + 1, yi, zi), u), l(h3(xi, yi + 1, zi), h3(xi + 1, yi + 1, zi), u), v),
    l(l(h3(xi, yi, zi + 1), h3(xi + 1, yi, zi + 1), u), l(h3(xi, yi + 1, zi + 1), h3(xi + 1, yi + 1, zi + 1), u), v),
    w,
  );
}

/** Fractal Brownian motion, 4 oktaf. */
export function fbm(x, y, z, octaves = 4) {
  let a = 0.5;
  let s = 0;
  let q = 1;
  for (let i = 0; i < octaves; i++) {
    s += a * vnoise(x * q, y * q, z * q);
    a *= 0.5;
    q *= 2.07;
  }
  return s;
}

/** Ridged noise (punggungan tajam) untuk tekstur batu berpori. */
export function ridged(x, y, z, octaves = 3) {
  let a = 0.5;
  let s = 0;
  let q = 1;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(vnoise(x * q, y * q, z * q) * 2 - 1);
    s += a * n * n;
    a *= 0.5;
    q *= 2.13;
  }
  return s;
}
