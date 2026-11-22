/** Gaya realistis: medan noise prosedural (tileable, pori) dan gradasi air. */
import { describe, it, expect } from 'vitest';
import { noiseField, waterGradient } from '../src/render/realism.js';

describe('noiseField', () => {
  it('nilai 0..1, deterministik untuk seed yang sama', () => {
    const a = noiseField(64, { octaves: 4, base: 4, seed: 3 });
    const b = noiseField(64, { octaves: 4, base: 4, seed: 3 });
    expect(a).toEqual(b);
    for (const v of a) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('bisa diulang tanpa sambungan: tepi kiri ≈ lanjutan tepi kanan', () => {
    const n = 128;
    const f = noiseField(n, { octaves: 4, base: 4, seed: 9 });
    let seam = 0;
    let inner = 0;
    for (let y = 0; y < n; y++) {
      seam += Math.abs(f[y * n] - f[y * n + n - 1]);
      inner += Math.abs(f[y * n + 64] - f[y * n + 63]);
    }
    // loncatan di sambungan sebanding dengan loncatan antar piksel biasa
    expect(seam / n).toBeLessThan(3 * (inner / n) + 0.02);
  });

  it('pori = lubang sempit yang jauh lebih dalam dari permukaan sekitarnya', () => {
    const plain = noiseField(128, { octaves: 5, base: 6, seed: 11, pits: 0 });
    const pits = noiseField(128, { octaves: 5, base: 6, seed: 11, pits: 120 });
    const median = (x) => [...x].sort((a, b) => a - b)[x.length >> 1];
    // setelah dinormalisasi, lubang mengisi ujung bawah rentang → permukaan biasa naik relatif
    expect(median(pits)).toBeGreaterThan(median(plain) + 0.05);
    expect(Math.min(...pits)).toBe(0);
  });
});

it('gradasi air: dasar lebih biru-gelap, permukaan putih (tidak mengubah warna lampu)', () => {
  expect(waterGradient(1)).toEqual([1, 1, 1]);
  const b = waterGradient(0);
  expect(b[0]).toBeLessThan(b[1]);
  expect(b[1]).toBeLessThan(b[2]);
});
