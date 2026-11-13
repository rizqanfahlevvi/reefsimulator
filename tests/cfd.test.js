import { describe, it, expect } from 'vitest';
import { createFlowEngine } from '../src/cfd/engine.js';
import { PoissonSolver } from '../src/cfd/poisson.js';
import { T3, F2 } from '../src/cfd/grid.js';
import { colormap, COLORMAPS, colormapGLSL } from '../src/render/colormaps.js';
import { ROCKS } from '../src/layout.js';

function message(dt, extra = {}) {
  const a = (20 * Math.PI) / 180;
  const b = (15 * Math.PI) / 180;
  const d = [-Math.cos(b) * Math.cos(a), Math.sin(b), Math.cos(b) * Math.sin(a)];
  const tip = [44.5 + d[0] * 4.2, 26.4, 3.5 + d[2] * 4.2];
  const Q = 90;
  const U = Math.sqrt((Q * (Q / 1.5)) / 3) / T3.h;
  return {
    t: 'step',
    dt,
    HT: 27,
    sand: true,
    rock: true,
    box: false,
    jets: [[tip[0], tip[1], tip[2], d[0] * U, d[1] * U, d[2] * U]],
    vols: [
      [tip[0], tip[1], tip[2], Q],
      [5, 8.8, 3.5, -50],
      [5, 26.5, 6.9, -40],
    ],
    L: [23.35, 23.13, 20.63, 18],
    clog: 0,
    jets2: [[5, 21.7, 0, -30]],
    vols2: [
      ['p', 5, 21.7, 90],
      ['p', 44.5, 2.5, -90],
    ],
    wantStats: true,
    reset: false,
    bu: new Float32Array(T3.N),
    bv: new Float32Array(T3.N),
    bw: new Float32Array(T3.N),
    ba: new Float32Array(F2.N),
    bb: new Float32Array(F2.N),
    bm: new Float32Array(T3.N),
    ...extra,
  };
}

describe('PoissonSolver (PCG + MIC0)', () => {
  it('menyelesaikan Laplacian Neumann 2D dengan sumber seimbang', () => {
    const MX = 22;
    const N = MX * 22;
    const solid = new Uint8Array(N).fill(1);
    for (let j = 1; j <= 20; j++) for (let i = 1; i <= 20; i++) solid[i + MX * j] = 0;
    const s = new PoissonSolver(N, [1, MX]);
    s.setMask(solid);
    const b = new Float64Array(N);
    b[3 + MX * 3] = 1;
    b[17 + MX * 15] = -1;
    const x = new Float64Array(N);
    s.solve(b, x, 200, 1e-8);
    const Ax = new Float64Array(N);
    s.applyA(x, Ax);
    let err = 0;
    for (const c of s.cells) err = Math.max(err, Math.abs(Ax[c] - b[c]));
    expect(err).toBeLessThan(1e-7);
    expect(s.lastIterations).toBeLessThan(60);
  });

  it('mendeteksi komponen terpisah dan membuat ruas kanan kompatibel', () => {
    const MX = 12;
    const N = MX * 5;
    const solid = new Uint8Array(N).fill(1);
    for (let i = 1; i <= 10; i++) if (i !== 5) solid[i + MX * 2] = 0;
    const s = new PoissonSolver(N, [1, MX]);
    s.setMask(solid);
    expect(s.ncomp).toBe(2);
    const b = new Float64Array(N);
    b[1 + MX * 2] = 1; // tidak seimbang → harus dikoreksi, bukan divergen
    const x = new Float64Array(N);
    s.solve(b, x, 100, 1e-10);
    expect(Number.isFinite(x[1 + MX * 2])).toBe(true);
  });
});

describe('engine arus', () => {
  it('tank 3D: divergensi setelah proyeksi ≈ sumber (MAC eksak)', () => {
    let out;
    const eng = createFlowEngine((o) => {
      out = o;
    });
    eng({ t: 'init', rocks: ROCKS });
    for (let n = 0; n < 60; n++) eng(message(0.1));
    const m = message(0.1);
    // jet ~28 cm/s pada sel 1,5 cm → skala laju regangan ~18 1/s
    expect(eng.debug.maxDivergence(m.vols)).toBeLessThan(0.02);
    expect(out.stats.mean).toBeGreaterThan(0.1); // rata-rata waktu τ = 8 dtk masih naik
    // laju rata-rata waktu dikirim untuk peta "zona mati" di bidang potong
    let mx = 0;
    for (let c = 0; c < T3.N; c++) mx = Math.max(mx, out.m[c]);
    expect(mx).toBeGreaterThan(1);
    expect(mx).toBeLessThanOrEqual(150);
  });

  it('filter 2D: divergensi kecil, kecepatan berhingga', () => {
    let out;
    const eng = createFlowEngine((o) => {
      out = o;
    });
    eng({ t: 'init', rocks: ROCKS });
    for (let n = 0; n < 40; n++) eng(message(0.1));
    const m = message(0.1);
    expect(eng.debug.max2DDivergence(m.vols2)).toBeLessThan(0.5);
    let maxv = 0;
    for (let c = 0; c < F2.N; c++) maxv = Math.max(maxv, Math.abs(out.a[c]), Math.abs(out.b[c]));
    expect(Number.isFinite(maxv)).toBe(true);
    expect(maxv).toBeGreaterThan(1);
  });

  it('reset mengosongkan medan kecepatan', () => {
    let out;
    const eng = createFlowEngine((o) => {
      out = o;
    });
    eng({ t: 'init', rocks: ROCKS });
    for (let n = 0; n < 10; n++) eng(message(0.1));
    eng(message(0, { reset: true }));
    let s = 0;
    for (let c = 0; c < T3.N; c++) s += Math.abs(out.u[c]);
    expect(s).toBe(0);
  });
});

describe('palet warna peta kecepatan', () => {
  it('ujung palet sesuai acuan matplotlib/turbo (toleransi 8/255)', () => {
    const near = (a, b) => a.every((v, i) => Math.abs(v * 255 - b[i]) <= 8);
    expect(near(colormap('plasma', 0), [13, 8, 135])).toBe(true);
    expect(near(colormap('plasma', 1), [240, 249, 33])).toBe(true);
    expect(near(colormap('viridis', 0), [68, 1, 84])).toBe(true);
    expect(near(colormap('viridis', 1), [253, 231, 37])).toBe(true);
    // turbo (aproksimasi polinomial Google): gelap → hijau di tengah → merah
    const [r0, g0, b0] = colormap('turbo', 0);
    const [r5, g5, b5] = colormap('turbo', 0.5);
    const [r1, g1, b1] = colormap('turbo', 1);
    expect(r0 + g0 + b0).toBeLessThan(0.5);
    expect(g5 > r5 && g5 > b5).toBe(true);
    expect(r1 > g1 && r1 > b1).toBe(true);
  });
  it('nilai selalu dalam 0..1 dan GLSL memuat semua palet', () => {
    for (const n of COLORMAPS)
      for (let t = -0.2; t <= 1.2; t += 0.05) for (const v of colormap(n, t)) expect(v >= 0 && v <= 1).toBe(true);
    const g = colormapGLSL();
    expect(g).toContain('cmTurbo');
    expect(g).toContain('cmPlasma');
    expect(g).toContain('cmViridis');
  });
});
