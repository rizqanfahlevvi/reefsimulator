/** Rakit pipa fase 3: rugi jalur (Crane K = f_T·L/D + Darcy–Weisbach), titik kerja, kopling ke simulasi. */
import { describe, it, expect } from 'vitest';
import { newDesign, addRoot, addPart, frames, freePorts } from '../src/plumb/model.js';
import { dims } from '../src/plumb/catalog.js';
import { fT, LD, analyzeLine, tracePath, operatingPoints, applyRetLine, EXITS, NOZZLE_AREA, breakdown } from '../src/plumb/hydro.js';
import * as H from '../src/physics/hydraulics.js';
import { GEO, G, NU } from '../src/physics/constants.js';

const PUMP = [445, 62, -75];

/** Pipa lurus tegak dari keluaran pompa. */
function straight(len = 1000, size = 'i12') {
  const d = newDesign('lurus');
  const id = addRoot(d, { type: 'pipe', size, cls: 'AW', len, anchor: { p: PUMP, dir: 'up' } });
  return { d, id };
}

describe('f_T dan K fitting', () => {
  it('f_T dari rumus turbulen penuh (ε 0,045 mm) dalam ±6% tabel Crane', () => {
    // diameter dalam pipa baja sch 40 (cm) → f_T tabel Crane
    for (const [D, crane] of [
      [1.58, 0.027],
      [2.09, 0.025],
      [2.66, 0.023],
      [4.09, 0.021],
      [5.25, 0.019],
    ])
      expect(Math.abs(fT(D) / crane - 1)).toBeLessThan(0.06);
  });

  it('pipa lurus: hanya gesek Darcy–Weisbach + rugi keluar', () => {
    const { d, id } = straight(1000);
    const r = analyzeLine(d, { inlet: { pid: id, port: 0 }, outlet: { pid: id, port: 1 }, exit: 'open' });
    expect(r.ok).toBe(true);
    expect(r.elems.map((e) => e.kind)).toEqual(['pipe', 'exit']);
    const D = dims('i12', 'AW').id / 10;
    expect(r.line.D).toBeCloseTo(D, 9);
    expect(r.line.L).toBeCloseTo(100, 6);
    expect(r.zout).toBeCloseTo(6.2 + 100, 6);
    const v = 80;
    const P = { ...H.defaultParams(), retLine: r.line };
    const want = (H.friction((v * D) / NU) * 100) / D + 1;
    expect(H.returnK(P, v)).toBeCloseTo(want, 9);
    // tanpa ball valve di jalur → peringatan slider
    expect(r.warnings.some((w) => w.includes('ball valve'))).toBe(true);
  });

  it('knee 90° = 30·f_T, tee lurus 20·f_T, tee cabang 60·f_T', () => {
    const d = newDesign('tee');
    const p0 = addRoot(d, { type: 'pipe', size: 'i12', cls: 'AW', len: 300, anchor: { p: PUMP, dir: 'up' } });
    const el = addPart(d, p0, 1, { type: 'elbow90', slot: 'a' });
    const p1 = addPart(d, el, 1, { type: 'pipe', slot: 'a', len: 200 });
    const tee = addPart(d, p1, 1, { type: 'tee', slot: 'a', cport: 0 });
    const run = addPart(d, tee, 1, { type: 'pipe', slot: 'a', len: 100 });
    const br = addPart(d, tee, 2, { type: 'pipe', slot: 'a', len: 100 });
    const D = dims('i12', 'AW').id / 10;
    const a = analyzeLine(d, { inlet: { pid: p0, port: 0 }, outlet: { pid: run, port: 1 } });
    const kinds = a.elems.map((e) => e.kind);
    expect(kinds).toEqual(['pipe', 'elbow90', 'pipe', 'tee', 'pipe', 'exit']);
    expect(a.elems[1].K).toBeCloseTo(LD.elbow90 * fT(D), 9);
    expect(a.elems[3].K).toBeCloseTo(LD.teeRun * fT(D), 9);
    // cabang tee yang tidak dipakai = ujung terbuka → peringatan
    expect(a.warnings.some((w) => w.includes('masih terbuka'))).toBe(true);
    const b = analyzeLine(d, { inlet: { pid: p0, port: 0 }, outlet: { pid: br, port: 1 } });
    expect(b.elems[3].K).toBeCloseTo(LD.teeBranch * fT(D), 9);
  });

  it('reducer: penyempitan 0,5(1−β²), pelebaran (1−β²)² — tergantung arah aliran', () => {
    const d = newDesign('reducer');
    const big = addRoot(d, { type: 'pipe', size: 'i34', cls: 'AW', len: 300, anchor: { p: PUMP, dir: 'up' } });
    const red = addPart(d, big, 1, { type: 'socketR', slot: 'a', other: 'i12' });
    const small = addPart(d, red, 1, { type: 'pipe', slot: 'a', len: 300 });
    const Db = dims('i34', 'AW').id;
    const Ds = dims('i12', 'AW').id;
    const b2 = (Ds / Db) ** 2;
    const fwd = analyzeLine(d, { inlet: { pid: big, port: 0 }, outlet: { pid: small, port: 1 } });
    const t1 = fwd.elems.find((e) => e.kind === 'contract');
    expect(t1.K).toBeCloseTo(0.5 * (1 - b2), 9);
    expect(t1.D * 10).toBeCloseTo(Ds, 9);
    const rev = analyzeLine(d, { inlet: { pid: small, port: 1 }, outlet: { pid: big, port: 0 } });
    const t2 = rev.elems.find((e) => e.kind === 'expand');
    expect(t2.K).toBeCloseTo((1 - b2) ** 2, 9);
    // jalur dibalik: urutan elemen terbalik, acuan = pipa kecil
    expect(rev.line.D * 10).toBeCloseTo(Ds, 9);
  });

  it('duckbill: energi kinetik jet di mulut nozzle 1,5 cm²', () => {
    const A = 2.5;
    expect(EXITS.duckbill.K(A)).toBeCloseTo(1.05 * (A / NOZZLE_AREA) ** 2, 9);
    expect(EXITS.open.K(A)).toBe(1);
  });

  it('jalur pohon: naik ke leluhur bersama lalu turun', () => {
    const d = newDesign('pohon');
    const p0 = addRoot(d, { type: 'pipe', size: 'i12', cls: 'AW', len: 200, anchor: { p: PUMP, dir: 'up' } });
    const tee = addPart(d, p0, 1, { type: 'tee', slot: 'a', cport: 0 });
    const a = addPart(d, tee, 1, { type: 'pipe', slot: 'a', len: 100 });
    const b = addPart(d, tee, 2, { type: 'pipe', slot: 'a', len: 100 });
    const steps = tracePath(d, { pid: a, port: 1 }, { pid: b, port: 1 });
    expect(steps.map((s) => [s.part.id, s.i, s.o])).toEqual([
      [a, 1, 0],
      [tee, 1, 2],
      [b, 0, 1],
    ]);
    const other = newDesign('x');
    expect(tracePath(d, { pid: a, port: 1 }, { pid: 999, port: 0 })).toBe(null);
    expect(other.parts.length).toBe(0);
  });
});

describe('kopling ke simulasi', () => {
  it('tanpa desain: returnK & step identik dengan model bawaan; jalur setara bawaan → hasil bit-identik', () => {
    const P0 = H.defaultParams();
    const A = (Math.PI * GEO.DR * GEO.DR) / 4;
    const same = { A, D: GEO.DR, L: GEO.LR, zout: GEO.ZOUT, segs: [{ D: GEO.DR, A, L: GEO.LR, K: 3.0, valve: 1 }] };
    const P1 = { ...P0, retLine: same };
    const S0 = H.initialState(P0);
    const S1 = H.initialState(P1);
    for (let n = 0; n < 3000; n++) {
      H.step(S0, P0, 0.02);
      H.step(S1, P1, 0.02);
    }
    for (const k of ['HT', 'H1', 'H2', 'H3', 'HP', 'vr']) expect(S1[k]).toBe(S0[k]);
    // padam: aliran balik juga identik
    P0.on = false;
    P1.on = false;
    for (let n = 0; n < 1500; n++) {
      H.step(S0, P0, 0.02);
      H.step(S1, P1, 0.02);
    }
    for (const k of ['HT', 'HP', 'vr']) expect(S1[k]).toBe(S0[k]);
  });

  it('simulasi dengan desain mencapai titik kerja hasil perhitungan tunak', () => {
    const d = newDesign('return');
    const p0 = addRoot(d, { type: 'pipe', size: 'i12', cls: 'AW', len: 250, anchor: { p: PUMP, dir: 'up' } });
    const e1 = addPart(d, p0, 1, { type: 'elbow90', slot: 'a' });
    const p1 = addPart(d, e1, 1, { type: 'pipe', slot: 'a', len: 120 });
    const e2 = addPart(d, p1, 1, { type: 'elbow90', slot: 'a' });
    const p2 = addPart(d, e2, 1, { type: 'pipe', slot: 'a', len: 60 });
    const r = analyzeLine(d, { inlet: { pid: p0, port: 0 }, outlet: { pid: p2, port: 1 } });
    expect(r.ok).toBe(true);
    const P = H.defaultParams();
    const S = H.initialState(P);
    applyRetLine(P, S, r.line);
    for (let n = 0; n < 30000; n++) H.step(S, P, 0.02);
    const op = operatingPoints(r, P, S);
    expect(S.q.r).toBeGreaterThan(10);
    expect(Math.abs(S.q.r / op.design.Q - 1)).toBeLessThan(0.01);
    expect(Math.abs(S.q.hp - op.design.head)).toBeLessThan(0.3);
    // rincian: jumlah rugi = head pompa − beda statis
    const sum = op.rows.reduce((s, x) => s + x.h, 0);
    expect(sum).toBeCloseTo(op.design.head - op.hs, 1);
    // kecepatan per ruas mengikuti kontinuitas Q = v·A
    for (const x of breakdown(r, P, op.design.v)) expect(x.v * x.A).toBeCloseTo(op.design.Q, 6);
  });

  it('ganti jalur tanpa lompatan debit (kecepatan dikonversi ke penampang baru)', () => {
    const { d, id } = straight(800, 'i34');
    const r = analyzeLine(d, { inlet: { pid: id, port: 0 }, outlet: { pid: id, port: 1 } });
    const P = H.defaultParams();
    const S = H.initialState(P);
    for (let n = 0; n < 2000; n++) H.step(S, P, 0.02);
    const Q0 = S.vr * H.returnArea(P);
    applyRetLine(P, S, r.line);
    expect(S.vr * H.returnArea(P)).toBeCloseTo(Q0, 9);
    applyRetLine(P, S, null);
    expect(P.retLine).toBe(null);
    expect(S.vr * H.returnArea(P)).toBeCloseTo(Q0, 9);
  });

  it('ujung bawaan: masuk di keluaran pompa, keluar terdekat ke duckbill', () => {
    const { d, id } = straight(1500);
    const fr = frames(d);
    expect(freePorts(d, fr).length).toBe(2);
    const r = analyzeLine(d, {});
    expect(r.inlet).toEqual({ pid: id, port: 0 });
    expect(r.outlet).toEqual({ pid: id, port: 1 });
    expect(r.warnings.some((w) => w.includes('keluaran pompa'))).toBe(false);
  });
});

it('titik kerja pompa: head = statis + rugi (cek manual satu titik)', () => {
  const P = H.defaultParams();
  const op = H.pumpOperatingPoint(P, 7);
  const A = H.returnArea(P);
  const cp = (P.hmax * 100 * A * A) / ((P.qmax / 3.6) ** 2);
  expect(op.head).toBeCloseTo(P.hmax * 100 - cp * op.v * op.v, 9);
  expect(op.head).toBeCloseTo(7 + (H.returnK(P, op.v) * op.v * op.v) / (2 * G), 6);
});
