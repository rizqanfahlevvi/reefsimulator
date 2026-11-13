/** Modul analisis: mesin saran, titik seimbang, uji pulsa, laporan, pustaka. */
import { describe, it, expect } from 'vitest';
import * as H from '../src/physics/hydraulics.js';
import { DEFAULT_VIEW } from '../src/state.js';
import { analyze, applyAction } from '../src/analysis/advisor.js';
import { findBalance, runSync } from '../src/analysis/equilibrium.js';
import { evaluatePulse } from '../src/analysis/pulse.js';
import { buildReport, projectInstructions } from '../src/analysis/report.js';
import { REFERENCES, REF_INDEX } from '../src/analysis/references.js';
import { PROFILES } from '../src/analysis/profiles.js';

function makeApp(over = {}, profile = 'fowlr') {
  const P = { ...H.defaultParams(), ...over };
  const S = H.initialState(P);
  for (let i = 0; i < 3000; i++) H.step(S, P, 0.02);
  return { S, P, V: { ...DEFAULT_VIEW }, NZL: { yaw: 20, pitch: 15 }, WM: { q: 1000, yaw: 0, pitch: 0, y: 16 }, profile };
}
const STATS = { mean: 1.7, bottom: 1.9, dead: 48, weak: 37, rockMean: 4.2, rockDead: 52, rockCells: 878, fdead: 30, fmean: 1.2, tauN: 320, ageMean: 330, ace: 0.49, stagnant: 0, saltTmin: 34.9, saltTmax: 35.1 };
const byId = (r, id) => r.findings.find((f) => f.id === id);

describe('mesin saran', () => {
  it('kondisi bawaan: tidak ada temuan kritis, level padam aman', () => {
    const r = analyze({ app: makeApp(), stats: STATS, cfdAge: 600 });
    expect(r.count.bad).toBe(0);
    expect(byId(r, 'outage').level).toBe('ok');
    // FOWLR tanpa wavemaker: zona mati 48% > 35% → perlu perhatian + aksi wavemaker
    const dead = byId(r, 'dead');
    expect(dead.level).toBe('warn');
    expect(dead.action.set).toEqual([['V.wm', true]]);
    expect(dead.ev).toBe('C');
  });

  it('aturan konsensus praktisi (C) tidak pernah berlabel kritis', () => {
    const r = analyze({ app: makeApp(), stats: { ...STATS, dead: 80 }, cfdAge: 600 });
    expect(byId(r, 'dead').level).toBe('warn');
    for (const f of r.findings) if (f.ev === 'C') expect(f.level).not.toBe('bad');
  });

  it('pelampung belum dipasang → saran + aksi sekali klik', () => {
    const app = makeApp({ fswHi: false });
    const f = byId(analyze({ app, stats: STATS, cfdAge: 600 }), 'fswHi');
    expect(f.level).toBe('warn');
    applyAction(app, f.action);
    expect(app.P.fswHi).toBe(true);
  });

  it('profil SPS menilai arus di sekitar batu dengan pustaka riset (A)', () => {
    const r = analyze({ app: makeApp({}, 'sps'), stats: STATS, cfdAge: 600 });
    const f = byId(r, 'rock');
    expect(f.level).toBe('bad'); // 4,2 cm/s < 10/2
    expect(f.ev).toBe('A');
    expect(f.refs).toContain('schutter2010');
    // profil ikan saja tidak menilai zona batu
    expect(byId(analyze({ app: makeApp(), stats: STATS, cfdAge: 600 }), 'rock')).toBeUndefined();
  });

  it('salinitas rendah pada profil karang → kritis dengan rujukan pemutihan salinitas rendah', () => {
    const app = makeApp({}, 'lps');
    const litres = H.totalVolume(app.S, app.P) / 1000 - app.P.disp;
    app.S.salt = 31 * litres;
    const f = byId(analyze({ app, stats: STATS, cfdAge: 600 }), 'sal');
    expect(f.level).toBe('bad');
    expect(f.refs).toContain('kerswell2003');
  });

  it('duckbill diarahkan ke intake siphon → peringatan jalan pintas', () => {
    const app = makeApp();
    app.NZL = { yaw: 0, pitch: -25 };
    expect(byId(analyze({ app, stats: STATS, cfdAge: 600 }), 'aim').level).toBe('warn');
    app.NZL = { yaw: 20, pitch: 15 };
    expect(byId(analyze({ app, stats: STATS, cfdAge: 600 }), 'aim')).toBeUndefined();
  });

  it('arus belum berkembang → saran arus ditahan', () => {
    const r = analyze({ app: makeApp(), stats: STATS, cfdAge: 10 });
    expect(byId(r, 'warmup').level).toBe('info');
    expect(byId(r, 'dead')).toBeUndefined();
  });
});

describe('titik seimbang valve U-pipe', () => {
  it('pompa bawaan: bukaan paling tertutup yang stabil & tahan debit +20%', () => {
    const app = makeApp();
    const r = runSync(findBalance(app.S, app.P));
    expect(r.best.sv).toBeGreaterThanOrEqual(0.45);
    expect(r.best.sv).toBeLessThanOrEqual(0.65);
    expect(r.best.robust).toBe(true);
    expect(r.best.HT).toBeLessThan(28.3);
    // bukaan sangat kecil tidak sanggup membawa debit return
    expect(r.rows[0].ok).toBe(false);
    // state asli tidak berubah
    expect(app.P.sv).toBe(0.55);
  });

  it('pompa terlalu kuat untuk siphon ½": sarankan turunkan daya pompa', () => {
    const app = makeApp({ qmax: 1500, hmax: 2 });
    const r = runSync(findBalance(app.S, app.P));
    expect(r.best).toBeNull();
    expect(r.maxSpd).toBeGreaterThan(0.3);
    expect(r.maxSpd).toBeLessThan(0.9);
    expect(r.note).toMatch(/daya pompa/);
  });
});

describe('uji pulsa', () => {
  const tau = 320;
  const series = (fn) => {
    const s = [];
    for (let t = 0; t <= 900; t += 2) s.push({ t, ...fn(t), volT: 29000, volF: 8000, tau });
    return s;
  };
  it('pencampuran cepat tanpa jalan pintas → baik', () => {
    const r = evaluatePulse(
      series((t) => {
        const c = 0.05 * Math.min(1, t / 20);
        return { dT: c, dF: c * Math.min(1, t / 200), sd: c * Math.exp(-t / 40), out: c * Math.min(1, t / 60) };
      }),
    );
    expect(r.level).toBe('ok');
    expect(r.t95).toBeGreaterThan(20);
    expect(r.t95).toBeLessThan(tau);
    expect(r.samples.length).toBeGreaterThan(50);
  });
  it('puncak ±2× cepat di intake (tank kecil) → catatan, bukan peringatan', () => {
    // massa 0,05·29000 + 0,05·8000 → campur sempurna di tank ±0,064; puncak 0,13 ≈ 2×
    const r = evaluatePulse(series((t) => ({ dT: 0.05, dF: 0.05, sd: t < 60 ? 0.02 : 0.001, out: t < 40 ? 0.13 : 0.05 })));
    expect(r.partial).toBe(true);
    expect(r.shortcut).toBe(false);
    expect(r.level).toBe('info');
  });
  it('puncak tinggi & cepat di intake → jalan pintas', () => {
    const r = evaluatePulse(series((t) => ({ dT: 0.05, dF: 0.01, sd: 0.001, out: t < 40 ? 0.3 : 0.05 })));
    expect(r.shortcut).toBe(true);
    expect(r.level).toBe('warn');
  });
});

describe('laporan & pustaka', () => {
  it('laporan Markdown berisi semua bagian dan JSON yang valid', () => {
    const app = makeApp({}, 'lps');
    const analysis = analyze({ app, stats: STATS, cfdAge: 600 });
    const eq = runSync(findBalance(app.S, app.P));
    const md = buildReport({
      app,
      stats: STATS,
      cfd: { on: true, mode: 'worker', msPerStep: 20, ratio: 0.8, cfdTime: 700, cfdAge: 600 },
      analysis,
      eq,
      pulse: null,
      energy: { avgW: 30, kwhMonth: 21.6, costMonth: 31000, costYear: 377000, tarif: 1444.7, rows: [{ n: 'Pompa return', w: 6, h: 24, off: false, kwhMonth: 4.32 }] },
      version: 'abc1234',
      date: new Date('2026-11-13T10:00:00Z'),
    });
    for (const s of ['## 1. Ringkasan', '## 2. Konfigurasi', '## 3. Hidrolik', '## 4. Arus', '## 5. Pertukaran', '## 6. Uji pulsa', '## 7. Titik seimbang', '## 8. Saran', '## 9. Listrik', '## 10. Asumsi', '## 11. Pustaka', '## 12. Permintaan'])
      expect(md).toContain(s);
    expect(md).toContain('Karang LPS');
    const json = md.split('```json\n')[1].split('\n```')[0];
    const data = JSON.parse(json);
    expect(data.profil).toBe('lps');
    expect(data.titikSeimbang.best.sv).toBeCloseTo(eq.best.sv, 5);
    expect(projectInstructions()).toMatch(/tingkat bukti/);
  });

  it('pustaka: id unik, rujukan di profil & saran ada di daftar', () => {
    const ids = REFERENCES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of REFERENCES) {
      expect(r.cite.length).toBeGreaterThan(40);
      expect(['A', 'B', 'C']).toContain(r.ev);
      if (r.doi) expect(r.doi).toMatch(/^10\.\d{4,5}\//);
    }
    for (const p of Object.values(PROFILES)) for (const id of p.flowRefs) expect(REF_INDEX[id]).toBeTruthy();
    const r = analyze({ app: makeApp({ fswHi: false, clog: 0.9 }, 'sps'), stats: STATS, cfdAge: 600 });
    for (const f of r.findings) for (const id of f.refs) expect(REF_INDEX[id], id).toBeTruthy();
  });
});
