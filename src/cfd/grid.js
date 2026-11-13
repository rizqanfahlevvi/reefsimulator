/**
 * Dimensi kisi CFD yang dipakai bersama oleh engine (worker) dan klien (render).
 *
 * Tank 3D: 32×20×16 sel @ 49/32 cm, x ∈ [0.5, 49.5], z ∈ [0.5, 25], y ∈ [0, 30.6].
 * Filter 2D: 98×60 sel @ 0,5 cm pada bidang panjang–tinggi, dirata-rata selebar 10 cm.
 * Semua array memakai satu lapis sel hantu di tiap sisi.
 */
export const T3 = Object.freeze({
  nx: 32,
  ny: 20,
  nz: 16,
  h: 49 / 32,
  NX: 34,
  NY: 22,
  NZ: 18,
  SY: 34,
  SZ: 34 * 22,
  N: 34 * 22 * 18,
  x0: 0.5,
  z0: 0.5,
});

export const F2 = Object.freeze({
  mx: 98,
  my: 60,
  h: 0.5,
  MX: 100,
  N: 100 * 62,
  W: 10,
  x0: 0.5,
});

/** Ukuran tekstur irisan peta kecepatan (RGBA). */
export const SLICE_BYTES = T3.nx * T3.nz * 4;
