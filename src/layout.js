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
