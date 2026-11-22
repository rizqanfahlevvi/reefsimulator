import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as H from '../src/physics/hydraulics.js';
import { GEO } from '../src/physics/constants.js';

/** Kode fisika versi 1 (index.html tunggal) apa adanya, sebagai acuan regresi. */
function loadLegacy() {
  const src = readFileSync(fileURLToPath(new URL('./fixtures/legacy-physics.js', import.meta.url)), 'utf8');
  // eslint-disable-next-line no-new-func
  return new Function(`${src};return {defP,initS,step,totalVol,GEO};`)();
}

const SCENARIOS = {
  bawaan: () => ({}),
  'pipa 3/4"': () => ({ D: 2.2 }),
  'skimmer mengapung': () => ({ sk: 2 }),
  'tanpa skimmer, intake rendah': () => ({ sk: 0, zin: 3 }),
  'overflow box': () => ({ box: true, sv: 1, zd: 21.5 }),
  'kapas mampet 85%': () => ({ clog: 0.85 }),
  'valve U-pipe 15%': () => ({ sv: 0.15 }),
  'pompa 1500 L/jam 2 m': () => ({ qmax: 1500, hmax: 2 }),
  'tanpa pelampung, tanpa lubang': () => ({ fsw: false, hole: false }),
};

function runBoth(over, steps, events = {}) {
  const L = loadLegacy();
  const P1 = Object.assign(L.defP(), over);
  // versi 1 punya satu saklar `fsw` untuk kedua pelampung; versi 2 memisahkannya
  const over2 = { ...over };
  if ('fsw' in over2) {
    over2.fswHi = over2.fswLo = over2.fsw;
    delete over2.fsw;
  }
  const P2 = Object.assign(H.defaultParams(), over2);
  const S1 = L.initS(P1);
  const S2 = H.initialState(P2);
  for (let n = 0; n < steps; n++) {
    if (events[n]) {
      events[n](S1, P1);
      events[n](S2, P2);
    }
    // dt bervariasi seperti versi lama (simdt/n) untuk menguji semua jalur
    const dt = n % 3 === 0 ? 0.02 : 0.0137;
    L.step(S1, P1, dt);
    H.step(S2, P2, dt);
  }
  return { S1, S2, P1, P2, L };
}

describe('hidrolik: regresi terhadap versi 1', () => {
  for (const [name, over] of Object.entries(SCENARIOS)) {
    it(`identik bit-per-bit: ${name}`, () => {
      const events = {
        // padam 60 dtk lalu nyala lagi, putuskan siphon, tambah air lewat slider
        1500: (S, P) => {
          P.on = false;
        },
        4500: (S, P) => {
          P.on = true;
        },
        6000: (S) => {
          S.brk[0] = true;
          S.air[0] = 1;
          S.vs[0] = 0;
        },
        7000: (S) => {
          S.pend += 1500;
        },
      };
      const { S1, S2 } = runBoth(over(), 9000, events);
      for (const k of ['t', 'HT', 'HB', 'H1', 'H2', 'H3', 'HP', 'vr', 'ato', 'spill', 'salt', 'spr', 'hj']) {
        expect(S2[k], k).toBe(S1[k]);
      }
      expect(S2.vs).toEqual(S1.vs);
      expect(S2.air).toEqual(S1.air);
      expect(S2.brk).toEqual(S1.brk);
      expect(S2.q).toEqual(S1.q);
    });
  }
});

describe('hidrolik: hukum kekekalan', () => {
  it('volume air kekal (ATO + slider − tumpahan)', () => {
    const P = H.defaultParams();
    const S = H.initialState(P);
    const v0 = H.totalVolume(S, P);
    S.pend = 800;
    for (let n = 0; n < 20000; n++) {
      if (n === 3000) P.on = false;
      if (n === 9000) P.on = true;
      H.step(S, P, 0.02);
    }
    const added = S.ato + 800 - S.pend;
    expect(H.totalVolume(S, P) + S.spill).toBeCloseTo(v0 + added, 3);
  });

  it('salinitas turun hanya karena ATO (air tawar)', () => {
    const P = H.defaultParams();
    const S = H.initialState(P);
    const salt0 = S.salt;
    // buat penguapan buatan: kurangi air dari chamber pompa sehingga ATO bekerja
    S.HP -= 3;
    for (let n = 0; n < 5000; n++) H.step(S, P, 0.02);
    expect(S.ato).toBeGreaterThan(0);
    expect(S.salt).toBeCloseTo(salt0, 6); // garam tidak bertambah/berkurang
  });

  it('kondisi tunak bawaan: debit siphon ≈ debit return, tidak meluap', () => {
    const P = H.defaultParams();
    const S = H.initialState(P);
    for (let n = 0; n < 15000; n++) H.step(S, P, 0.02);
    expect(Math.abs(S.q.s - S.q.r)).toBeLessThan(1);
    expect(S.HT).toBeLessThan(29);
    expect(S.spill).toBe(0);
    expect(S.q.r * 3.6).toBeGreaterThan(250);
  });

  it('padam listrik: level akhir sesuai keseimbangan & lubang siphon-break menghentikan aliran balik', () => {
    const P = H.defaultParams();
    const S = H.initialState(P);
    for (let n = 0; n < 5000; n++) H.step(S, P, 0.02);
    P.on = false;
    for (let n = 0; n < 30000; n++) H.step(S, P, 0.02);
    expect(S.spill).toBe(0);
    expect(S.HT).toBeLessThanOrEqual(GEO.ZHOLE + 0.05);
    expect(Math.abs(S.q.r)).toBeLessThan(0.01);
  });
});

describe('auto-off pompa (saklar pelampung atas/bawah independen)', () => {
  /** Siphon putus tanpa venturi, lalu jalan 20 menit. */
  function siphonBreak(over) {
    const P = Object.assign(H.defaultParams(), { venturi: false }, over);
    const S = H.initialState(P);
    for (let n = 0; n < 3000; n++) H.step(S, P, 0.02);
    S.brk[0] = true;
    S.air[0] = 1;
    S.vs[0] = 0;
    const r = { dryRun: 0, cutHi: false, cutLo: false, minHP: 99 };
    for (let n = 0; n < 60000; n++) {
      H.step(S, P, 0.02);
      if (S.run && S.HP < 2.3) r.dryRun += 0.02;
      r.cutHi ||= S.cutHi;
      r.cutLo ||= S.cutLo;
      r.minHP = Math.min(r.minHP, S.HP);
    }
    r.spill = S.spill;
    return r;
  }

  it('tanpa pelampung: pompa jalan kering setelah siphon putus', () => {
    const r = siphonBreak({ fswHi: false, fswLo: false, ato: false });
    expect(r.dryRun).toBeGreaterThan(600);
    expect(r.cutHi || r.cutLo).toBe(false);
  });

  it('hanya pelampung bawah: pompa mati di 4 cm, tidak jalan kering', () => {
    const r = siphonBreak({ fswHi: false, fswLo: true, ato: false });
    expect(r.cutLo).toBe(true);
    expect(r.dryRun).toBe(0);
    expect(r.minHP).toBeGreaterThan(3.5);
  });

  it('ATO aktif tanpa pelampung atas: tank meluap', () => {
    const r = siphonBreak({ fswHi: false, fswLo: true, ato: true });
    expect(r.spill).toBeGreaterThan(0);
  });

  it('ATO aktif dengan pelampung atas: pompa mati di 28,5 cm, tidak meluap', () => {
    const r = siphonBreak({ fswHi: true, fswLo: false, ato: true });
    expect(r.cutHi).toBe(true);
    expect(r.spill).toBe(0);
  });

  it('pelampung mati tidak pernah memutus pompa', () => {
    const P = Object.assign(H.defaultParams(), { fswHi: false, fswLo: false });
    const S = H.initialState(P);
    S.HT = 29.5;
    S.HP = 2;
    H.step(S, P, 0.02);
    expect(S.cutHi).toBe(false);
    expect(S.cutLo).toBe(false);
    expect(S.run).toBe(true);
  });
});

describe('fungsi bantu', () => {
  it('weir: nol di bawah puncak, simetris tanda', () => {
    expect(H.weir(20, 10, 22.5, 10)).toBe(0);
    expect(H.weir(23.5, 10, 22.5, 10)).toBeCloseTo(183.1, 1);
    expect(H.weir(10, 23.5, 22.5, 10)).toBeCloseTo(-183.1, 1);
  });
  it('faktor gesek kontinu di sekitar transisi', () => {
    expect(H.friction(1999)).toBeCloseTo(0.032, 3);
    expect(Math.abs(H.friction(4001) - H.friction(3999))).toBeLessThan(1e-4);
  });
});

/* ============ susunan 2 U-pipe terpisah: pipa bawah + pipa khusus skimmer apung ============ */
describe('susunan terpisah (pipa skimmer khusus)', () => {
  const base = { split: true, n: 2, D: 1.7, sk: 2, sv: 1, sv2: 1 };
  function runSplit(over, secs = 300) {
    const P = { ...H.defaultParams(), ...base, ...over };
    const S = H.initialState(P);
    let brkAt = null;
    for (let n = 0; n < secs / 0.02; n++) {
      H.step(S, P, 0.02);
      if (brkAt === null && S.brk[1]) brkAt = S.t;
    }
    return { P, S, brkAt };
  }

  it('kasus nyata: pipa 20 mm, kepala apung 4 mm, tanpa tambahan → siphon skimmer kelaparan lalu putus; pipa bawah tetap jalan', () => {
    const { S, brkAt } = runSplit({});
    expect(brkAt).not.toBe(null);
    expect(brkAt).toBeLessThan(120);
    expect(S.brk[0]).toBe(false);
    expect(S.q.s * 3.6).toBeGreaterThan(250); // seluruh aliran lewat pipa bawah
  });

  it('lubang cadangan 8 mm atau bibir apung 8 mm → stabil tanpa udara', () => {
    for (const o of [{ bleed: 8 }, { fsub: 8 }]) {
      const { S, brkAt } = runSplit(o);
      expect(brkAt).toBe(null);
      expect(S.air[1]).toBeLessThan(0.05);
      expect((S.qk[1] + S.qb[1]) * 3.6).toBeGreaterThan(120);
    }
    const { S } = runSplit({ bleed: 8 });
    expect(S.qb[1]).toBeGreaterThan(0); // sebagian dari lubang cadangan
  });

  it('dop berlubang 8 mm: aliran pelan → gelembung menumpuk & putus; dengan aqualifter tetap jalan', () => {
    expect(runSplit({ cap: 8 }).brkAt).not.toBe(null);
    const ok = runSplit({ cap: 8, vent2: true });
    expect(ok.brkAt).toBe(null);
    expect(ok.S.air[1]).toBeLessThan(0.05);
  });

  it('air tetap terjaga (tanpa ATO): volume total + tumpahan konstan', () => {
    const P = { ...H.defaultParams(), ...base, bleed: 6, ato: false };
    const S = H.initialState(P);
    const v0 = H.totalVolume(S, P);
    for (let n = 0; n < 300 / 0.02; n++) H.step(S, P, 0.02);
    expect(H.totalVolume(S, P) + S.spill).toBeCloseTo(v0, 0);
  });

  it('pipa bawah susunan terpisah tidak memakai skimmer; mode overflow box mengabaikan susunan terpisah', () => {
    const { S } = runSplit({ bleed: 8 }, 60);
    expect(S.qk[0]).toBe(0);
    expect(H.isSplit({ split: true, box: true })).toBe(false);
  });
});
