/**
 * Tata letak fisik yang dipakai bersama oleh render 3D dan CFD.
 * Koordinat dalam cm: x = panjang (0..50), y = tinggi dari dasar, z = lebar
 * (tank 0..25, back filter −13..−2).
 */
import { GEO } from './physics/constants.js';

/** Batu hidup sebagai ellipsoid: [cx, cy, cz, rx, ry, rz, seed]. Ikut menghalangi arus. */
export const ROCKS = Object.freeze([
  [18, 5, 14, 6.3, 5, 5.4, 1.3],
  [27, 7, 12, 7.2, 6.8, 5.8, 4.1],
  [35, 4.6, 15, 5.4, 4.3, 4.9, 7.7],
  [22, 3.2, 19.5, 3.9, 2.8, 3.4, 2.2],
  [40, 3, 10.5, 3.3, 2.6, 3, 9.4],
  [30, 3, 19.3, 3.4, 2.6, 2.9, 5.5],
  [26, 13, 12.5, 3.7, 2.9, 3.4, 3.3],
]);

/** Pusat sendi duckbill return. */
export const NOZZLE = Object.freeze([44.5, GEO.ZOUT + 0.3, 3.5]);

/** Posisi dasar wavemaker (kaca kanan). */
export const WAVEMAKER = Object.freeze({ x: 47.2, z: 14 });

/** Posisi U-pipe: sisi tank (z) dan sisi filter (z). */
export const SIPHON = Object.freeze({ zTank: 3.5, zFilter: -7.5, bendR: 1.9 });

/** Arah dari sudut mendatar (yaw, + ke depan) dan naik/turun (pitch, + ke atas), derajat. */
export function dirOf(yaw, pitch) {
  const a = (yaw * Math.PI) / 180;
  const b = (pitch * Math.PI) / 180;
  return [-Math.cos(b) * Math.cos(a), Math.sin(b), Math.cos(b) * Math.sin(a)];
}

/** Posisi x pipa siphon ke-i dari n pipa. */
export const siphonX = (n, i) => (n === 2 ? (i ? 7 : 3) : 5);

/* ======================= back filter (CFD 3D) ======================= */

/**
 * Geometri isi filter (cm). Sekat: x pusat, tebal, dan y mulai padat
 * (sekat 1 & 3 punya celah bawah 3 cm; sekat 2 & 4 adalah weir — dibuat padat penuh,
 * aliran di atas weir dimodelkan sebagai sumur hulu + sumber/jet jatuh di hilir).
 */
export const FILTER = Object.freeze({
  z0: -12.5,
  z1: -2.5,
  zMid: -7.5,
  baffles: [
    { x: 10.75, t: 0.5, yMin: 3 },
    { x: 21.25, t: 0.5, yMin: 0 },
    { x: 36.75, t: 0.5, yMin: 3 },
    { x: 39.25, t: 0.5, yMin: 0 },
  ],
  /** badan protein skimmer: silinder padat */
  skimmer: { x: 16, z: -7.5, r: 4.3, yTop: 24 },
  /** badan pompa return: balok padat; isapan di grill depan */
  pump: { x0: 42, x1: 47, y0: 0.3, y1: 4.6, z0: -10, z1: -5.2, intake: [44.5, 2.4, -3.8] },
  floss: { x1: 10.5, y0: 12, y1: 19 },
  bio: { x0: 21.5, x1: 36.5, y0: 0.8, y1: 12, drag: 2.5 },
  /** rentang x permukaan tiap chamber untuk sumber naik/turun muka air */
  strips: { c1: [0.5, 10.5], c2: [11, 21], c3: [21.5, 39], pump: [39.5, 49.5] },
  /** posisi x baris sel tepat di hulu/hilir weir 2 dan 4 */
  weir2: { up: [19.5, 20.9], down: 22, back: 20 },
  weir4: { up: [37.5, 38.9], down: 40, back: 38 },
  ato: [47.5, 0, -11],
});

const inBaffle = (x, h, b) => Math.abs(x - b.x) < h / 2 + b.t / 2;

/** Penghalang buram (tidak tembus pandang): skimmer dan pompa. */
export function filterOpaque(x, y, z) {
  const { skimmer: s, pump: p } = FILTER;
  if ((x - s.x) ** 2 + (z - s.z) ** 2 < s.r * s.r && y < s.yTop) return true;
  return x > p.x0 - 0.1 && x < p.x1 + 0.1 && y > p.y0 - 0.1 && y < p.y1 + 0.1 && z > p.z0 - 0.1 && z < p.z1 + 0.1;
}

/** Fungsi sel padat statis filter untuk kisi berukuran h. */
export function filterSolid(h) {
  return (x, y, z) => {
    for (const b of FILTER.baffles) if (inBaffle(x, h, b) && y >= b.yMin) return true;
    return filterOpaque(x, y, z);
  };
}

/** Level air kolom di posisi x (pusat sel), L = [H1, H2, H3, HP]. */
export function filterLevelAt(x, L, h) {
  const [b1, b2, b3, b4] = FILTER.baffles;
  if (inBaffle(x, h, b1)) return Math.min(L[0], L[1]); // celah bawah sekat 1
  if (x < b1.x) return L[0];
  if (inBaffle(x, h, b2)) return 0; // weir 2
  if (x < b2.x) return L[1];
  if (inBaffle(x, h, b4)) return 0; // weir 4
  if (x < b4.x) return L[2]; // chamber bio, celah sekat 3, riser
  return L[3];
}
