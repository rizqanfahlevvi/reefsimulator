/**
 * Dimensi kisi CFD yang dipakai bersama oleh engine (worker) dan klien (render).
 * Keduanya kisi MAC 3D dengan satu lapis sel hantu di tiap sisi; indeks sel
 * c = i + SY·j + SZ·k dengan i ∈ [1, nx], j ∈ [1, ny], k ∈ [1, nz].
 * Pusat sel i berada di x = x0 + (i − 0,5)·h (begitu pula y, z).
 */
function grid(nx, ny, nz, h, x0, y0, z0) {
  const NX = nx + 2;
  const NY = ny + 2;
  const NZ = nz + 2;
  return Object.freeze({ nx, ny, nz, h, NX, NY, NZ, SY: NX, SZ: NX * NY, N: NX * NY * NZ, x0, y0, z0 });
}

/** Tank: 32×20×16 sel @ 49/32 cm; x ∈ [0,5; 49,5], y ∈ [0; 30,6], z ∈ [0,5; 25]. */
export const T3 = grid(32, 20, 16, 49 / 32, 0.5, 0, 0.5);

/** Back filter: 49×30×10 sel @ 1 cm; x ∈ [0,5; 49,5], y ∈ [0; 30], z ∈ [−12,5; −2,5]. */
export const F3 = grid(49, 30, 10, 1, 0.5, 0, -12.5);

/** Indeks sel fluida di (x, y, z) atau −1 bila di luar/padat. */
export function cellIndex(G, sol, x, y, z) {
  const i = Math.floor((x - G.x0) / G.h) + 1;
  const j = Math.floor((y - G.y0) / G.h) + 1;
  const k = Math.floor((z - G.z0) / G.h) + 1;
  if (i < 1 || i > G.nx || j < 1 || j > G.ny || k < 1 || k > G.nz) return -1;
  const c = i + G.SY * j + G.SZ * k;
  return sol[c] ? -1 : c;
}

/** Interpolasi trilinear medan pusat-sel F di (x, y, z). */
export function trilinear(G, F, x, y, z) {
  let gx = (x - G.x0) / G.h + 0.5;
  let gy = (y - G.y0) / G.h + 0.5;
  let gz = (z - G.z0) / G.h + 0.5;
  if (gx < 0.5) gx = 0.5;
  else if (gx > G.nx + 0.5) gx = G.nx + 0.5;
  if (gy < 0.5) gy = 0.5;
  else if (gy > G.ny + 0.5) gy = G.ny + 0.5;
  if (gz < 0.5) gz = 0.5;
  else if (gz > G.nz + 0.5) gz = G.nz + 0.5;
  const i0 = gx | 0;
  const j0 = gy | 0;
  const k0 = gz | 0;
  const s1 = gx - i0;
  const s0 = 1 - s1;
  const t1 = gy - j0;
  const t0 = 1 - t1;
  const r1 = gz - k0;
  const r0 = 1 - r1;
  const { SY, SZ } = G;
  const a = i0 + SY * j0 + SZ * k0;
  const b = a + SZ;
  return (
    r0 * (t0 * (s0 * F[a] + s1 * F[a + 1]) + t1 * (s0 * F[a + SY] + s1 * F[a + SY + 1])) +
    r1 * (t0 * (s0 * F[b] + s1 * F[b + 1]) + t1 * (s0 * F[b + SY] + s1 * F[b + SY + 1]))
  );
}
