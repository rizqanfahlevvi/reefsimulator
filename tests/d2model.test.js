/** Desain 2: kalkulator untuk overflow box sisir persis desain asli (ukuran final). */
import { describe, it, expect } from 'vitest';
import { FINAL, levels, warnings, glassSF, glassMin, sumpSpace, geometry } from '../src/d2/model.js';

const r1 = (v) => Math.round(v * 10) / 10;

describe('replika rumus tinggi air desain asli', () => {
  // angka dari tabel "Perkiraan tinggi air saat jalan" di desain asli (tab Spesifikasi)
  const TABLE = [
    [500, 36, 4, 4.2, 0.8, true],
    [1000, 36.5, 3.5, 4.8, 2.5, true],
    [1500, 37, 3, 5.3, 5.2, true],
    [2000, 37.4, 2.6, 5.8, 8.9, false],
    [3000, 38.2, 1.8, 6.6, 19.7, false],
  ];
  const lv = levels();
  for (const [Q, tank, rim, iz, oz, outOk] of TABLE)
    it(`${Q} L/jam = tabel asli`, () => {
      const s = lv.at(Q);
      expect(r1(s.tank)).toBe(tank);
      expect(r1(s.fromRim)).toBe(rim);
      expect(r1(s.iz)).toBe(iz);
      expect(r1(s.oz)).toBe(oz);
      expect(s.outOk).toBe(outOk);
      expect(s.free).toBe(true);
    });
  it('baris bawaan = 500/1000/1500/2000/3000 seperti desain asli', () => {
    expect(lv.rows.map((r) => r.Q)).toEqual([500, 1000, 1500, 2000, 3000]);
  });
  it('geometri: 30 celah, dasar celah 35 cm dari dasar tank, dasar celah terbuka 31,5', () => {
    const g = geometry();
    expect(g.n).toBe(30);
    expect(g.yi0 + g.slotBot).toBeCloseTo(35, 6);
    expect(g.yi0 + g.notchZi).toBeCloseTo(FINAL.notchBot, 6);
  });
  it('ruang kosong sump 1000 L/jam = ±5 L (rumus asli)', () => {
    expect(sumpSpace(1000)).toBe(5);
  });
});

describe('peringatan', () => {
  it('kaca 5 mm untuk tinggi 40 cm: serius (SF < 2,5), minimal ±8 mm', () => {
    expect(glassSF(60, 40, 0.5)).toBeLessThan(2.5);
    expect(glassMin(60, 40)).toBeGreaterThan(0.75);
    const w = warnings(1000);
    expect(w.find((x) => /Kaca 5 mm/.test(x.title)).level).toBe('bad');
  });
  it('1000 L/jam: satu peringatan serius (kaca), sisanya desain', () => {
    const w = warnings(1000);
    expect(w.filter((x) => x.level === 'bad')).toHaveLength(1);
    for (const t of ['Celah terbuka', 'Lubang penghubung dekat celah', '4 saluran alas', 'Return tanpa lubang pemutus', 'Ruang kosong sump']) expect(w.some((x) => x.title.startsWith(t))).toBe(true);
  });
  it('2000 L/jam: kotak luar tertahan jadi peringatan serius', () => {
    expect(warnings(2000).some((x) => x.title === 'Kotak luar tertahan' && x.level === 'bad')).toBe(true);
  });
  it('teks tanpa NaN/undefined', () => {
    for (const Q of [200, 1000, 3000]) for (const w of warnings(Q)) expect(w.text).not.toMatch(/NaN|undefined|Infinity/);
  });
});
