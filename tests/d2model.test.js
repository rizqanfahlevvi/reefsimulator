/** Desain 2: model overflow bersisir (lubang bor + Bean Animal). */
import { describe, it, expect } from 'vitest';
import * as M from '../src/d2/model.js';

const P = M.defaultD2();

describe('geometri', () => {
  it('30 celah 0,3 × 4,5 cm seperti desain asal; dasar celah 35 cm dari dasar tank', () => {
    const g = M.geometry(P);
    expect(g.nSlots).toBe(30);
    expect(g.slotBot).toBeCloseTo(35, 6);
    expect(g.outBot).toBeCloseTo(22, 6);
  });
  it('bulkhead alas tidak bertabrakan & urutannya siphon → terbuka → darurat', () => {
    const g = M.geometry(P);
    const xs = g.drains.map((d) => d.x);
    expect(xs[0]).toBeLessThan(xs[1]);
    expect(xs[1]).toBeLessThan(xs[2]);
    expect(g.drains[2].top).toBeGreaterThan(g.drains[1].top);
  });
  it('parameter di luar rentang dijepit, ukuran bulkhead asing → 20 mm', () => {
    const p = M.sanitizeD2({ Q: 99999, holeSize: 17, holeN: 2.6 });
    expect(p.Q).toBe(M.RANGES.Q[1]);
    expect(p.holeSize).toBe(20);
    expect(p.holeN).toBe(3);
  });
});

describe('komponen aliran', () => {
  it('weir sisir naik dengan tinggi air dan turun bila tenggelam', () => {
    const g = M.geometry(P);
    const a = M.combFlow(g, 36, 30);
    const b = M.combFlow(g, 37, 30);
    expect(b).toBeGreaterThan(a);
    expect(M.combFlow(g, 36, 35.8)).toBeLessThan(a);
    expect(M.combFlow(g, 34, 30)).toBe(0);
  });
  it('gate valve: K turun monoton dari ¼ ke terbuka penuh; titik tabel tepat', () => {
    expect(M.gateK(0.25)).toBeCloseTo(17, 6);
    expect(M.gateK(0.5)).toBeCloseTo(2.1, 6);
    expect(M.gateK(1)).toBeCloseTo(0.15, 6);
    expect(M.gateK(0.6)).toBeLessThan(M.gateK(0.4));
  });
  it('siphon utama mati bila mulut tidak terendam, naik dengan bukaan gate', () => {
    const g = M.geometry(P);
    expect(M.mainFlow(g, g.mainInlet - 0.1)).toBe(0);
    expect(M.mainFlow(g, 28, 1)).toBeGreaterThan(M.mainFlow(g, 28, 0.3));
  });
});

describe('keadaan tunak', () => {
  it('1000 L/jam: tank ±36,5 cm (sama dengan tabel desain), sisir jatuh bebas, tanpa peringatan', () => {
    const s = M.solve(P, 1000);
    expect(s.hTank).toBeGreaterThan(36.2);
    expect(s.hTank).toBeLessThan(36.8);
    expect(s.combFree).toBe(true);
    expect(s.ok).toBe(true);
    expect(s.flags).toEqual([]);
    // Bean Animal: siphon membawa sebagian besar, jalur terbuka menetes, darurat kering
    expect(s.flows.main).toBeGreaterThan(s.flows.open);
    expect(s.flows.open).toBeGreaterThan(0);
    expect(s.flows.em).toBe(0);
    // kekekalan massa
    expect((s.flows.main + s.flows.open + s.flows.em) * 3.6).toBeCloseTo(1000, 0);
  });
  it('urutan muka air: tank > kotak dalam > kotak luar', () => {
    const s = M.solve(P, 1000);
    expect(s.hTank).toBeGreaterThan(s.hIn);
    expect(s.hIn).toBeGreaterThan(s.hOut);
  });
  it('debit terlalu besar → tank meluap terdeteksi', () => {
    const s = M.solve(P, 3000);
    expect(s.ok).toBe(false);
    expect(s.flags.join(' ')).toMatch(/MELUAP/);
  });
  it('lubang penghubung 1 × 20 mm tidak sanggup 1500 L/jam', () => {
    const s = M.solve({ ...P, holeN: 1, holeSize: 20 }, 1500);
    expect(s.tankOver).toBe(true);
  });
  it('auto gate: jalur terbuka tetap basah, darurat kering', () => {
    for (const Q of [500, 800, 1200]) {
      const a = M.autoGate(P, Q);
      const s = M.solve(P, Q, a);
      expect(s.flows.open).toBeGreaterThan(0);
      expect(s.flows.em).toBe(0);
    }
  });
  it('batas: siphon tersumbat pun jalur terbuka + darurat sanggup debit bawaan', () => {
    const L = M.limits(P);
    expect(L.backupOnly).toBeGreaterThan(P.Q);
    expect(L.design).toBeGreaterThan(P.Q);
    expect(L.emergency).toBeGreaterThan(P.Q);
    expect(L.overflow).toBeGreaterThan(L.emergency);
  });
});

describe('saat pompa mati', () => {
  it('lubang pemutus siphon mencegah tank tersedot balik lewat return', () => {
    const on = M.drainDown(P);
    const off = M.drainDown({ ...P, breakHole: false });
    expect(on.ret).toBe(0);
    expect(off.ret).toBeGreaterThan(3);
    expect(off.total).toBeGreaterThan(on.total);
    expect(on.total).toBeGreaterThan(2);
    expect(on.total).toBeLessThan(10);
  });
});

describe('cek kaca & lubang', () => {
  it('60 × 40 × 40: kaca 5 mm tidak aman (SF < 2,5), 8 mm aman', () => {
    expect(M.glassSF(60, 40, 0.5)).toBeLessThan(2.5);
    expect(M.glassSF(60, 40, 0.8)).toBeGreaterThan(3.8);
    expect(M.glassMin(60, 40)).toBeGreaterThan(0.7);
  });
  it('bawaan lolos semua cek', () => {
    const c = M.checks(P);
    expect(c.filter((x) => x.level !== 'ok')).toEqual([]);
  });
  it('kaca 5 mm & lubang terlalu dekat tepi atas → peringatan', () => {
    const c = M.checks({ ...P, glassT: 0.5, retTop: 1.5 });
    expect(c.some((x) => x.level === 'bad' && /depan/.test(x.text))).toBe(true);
    expect(c.some((x) => x.level === 'bad' && /Lubang terlalu dekat/.test(x.text))).toBe(true);
  });
  it('lubang penghubung di bawah alas kotak dalam → salah', () => {
    const c = M.checks({ ...P, holeY: 28 });
    expect(c.some((x) => /alas kotak dalam/.test(x.text))).toBe(true);
  });
});

describe('daftar potong & diagram', () => {
  it('daftar potong memuat ukuran pelat & lubang utama', async () => {
    const txt = M.cutList(P)
      .flatMap((s) => [s.title, ...s.items])
      .join('\n');
    expect(txt).toMatch(/Dinding depan bersisir: 20,0 × 12,2 — 30 celah 0,3 × 4,5/);
    expect(txt).toMatch(/2 lubang penghubung Ø 2,5: pusat 31,0 dari dasar kaca/);
    expect(txt).toMatch(/lubang pemutus siphon/);
  });
  it('flens bulkhead terlalu dekat alas / terlalu rapat → peringatan', () => {
    expect(M.checks({ ...P, holeY: 30 }).some((c) => /Flens bulkhead penghubung/.test(c.text))).toBe(true);
    expect(M.checks({ ...P, holeSp: 4 }).some((c) => /terlalu rapat/.test(c.text))).toBe(true);
  });
  it('gate terbuka penuh → peringatan kapasitas siphon', () => {
    const s = M.solve(P, 1000, 1);
    expect(s.flags.some((f) => /terbuka penuh/.test(f))).toBe(true);
  });
  it('diagram SVG berisi angka muka air & tanpa NaN', async () => {
    const { diagramSVG } = await import('../src/d2/diagram.js');
    for (const Q of [300, 1000, 3000]) {
      const svg = diagramSVG(M.geometry(P), M.solve(P, Q));
      expect(svg.startsWith('<svg')).toBe(true);
      expect(svg).not.toMatch(/NaN|undefined|Infinity/);
    }
    expect(diagramSVG(M.geometry(P), M.solve(P, 1000))).toMatch(/tank 36,[45]/);
  });
});
