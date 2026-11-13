/**
 * Mesin arus (dijalankan di Web Worker): tank dan back filter, keduanya CFD 3D.
 *
 * Tank  — kisi MAC 32×20×16 @ 1,53 cm: batu (ellipsoid), pasir, overflow box opsional,
 *          tutup kaku pada level tank.
 * Filter — kisi MAC 49×30×10 @ 1 cm: sekat 1 & 3 (celah bawah 3 cm), sekat 2 & 4 (weir),
 *          badan protein skimmer (silinder padat), badan pompa return, kapas & media bio
 *          sebagai media berpori, level air terpisah tiap chamber. Aliran melewati weir
 *          dimodelkan sebagai pasangan sumur (permukaan hulu) + sumber & jet jatuh (hilir).
 *
 * Hasil arus bersifat kualitatif: untuk membandingkan pola, bukan angka mutlak.
 */
import { T3, F3 } from './grid.js';
import { Mac3D } from './mac3d.js';
import { FILTER, filterLevelAt, filterSolid } from '../layout.js';

export function createFlowEngine(post) {
  let ROCKS = [];
  const tank = new Mac3D(T3);
  const filt = new Mac3D(F3);
  const cfg = { sand: true, rock: true, box: false };
  let cfgKey = '';
  let filterBuilt = false;
  let clogPrev = -1;

  function tankSolid(x, y, z) {
    if (cfg.sand && y < 1.6) return true;
    if (cfg.box && x > 1 && x < 9 && z < 6.5 && y > 16) return true;
    if (cfg.rock) {
      for (let r = 0; r < ROCKS.length; r++) {
        const R = ROCKS[r];
        const dx = (x - R[0]) / R[3];
        const dy = (y - R[1]) / R[4];
        const dz = (z - R[2]) / R[5];
        if (dx * dx + dy * dy + dz * dz < 0.96) return true;
      }
    }
    return false;
  }

  function filterDrag(clog) {
    return (x, y) => {
      const { floss, bio } = FILTER;
      if (x < floss.x1 && y > floss.y0 && y < floss.y1) return 3 + 60 * clog * clog;
      if (x > bio.x0 && x < bio.x1 && y > bio.y0 && y < bio.y1) return bio.drag;
      return 0;
    };
  }

  let sentT = -1;
  let sentF = -1;
  function handle(m) {
    if (m.t === 'init') {
      ROCKS = m.rocks;
      cfgKey = '';
      return;
    }
    if (m.t !== 'step') return;
    if (m.reset) {
      tank.reset();
      filt.reset();
    }
    /* masker statis */
    const key = (m.sand ? '1' : '0') + (m.rock ? '1' : '0') + (m.box ? '1' : '0');
    if (key !== cfgKey) {
      cfgKey = key;
      cfg.sand = m.sand;
      cfg.rock = m.rock;
      cfg.box = m.box;
      tank.setBase(tankSolid);
    }
    if (!filterBuilt) {
      filt.setBase(filterSolid(F3.h));
      filterBuilt = true;
    }
    const f = m.filter;
    if (f.clog !== clogPrev) {
      clogPrev = f.clog;
      filt.setDrag(filterDrag(f.clog));
    }
    /* permukaan air */
    tank.setLevels(() => m.HT);
    filt.setLevels((i) => filterLevelAt(filt.xc(i), f.L, F3.h));

    if (m.dt > 0) {
      tank.beginInputs();
      for (const J of m.jets) tank.jetAt(J[0], J[1], J[2], J[3], J[4], J[5]);
      for (const V of m.vols) tank.srcAt(V[0], V[1], V[2], V[3]);
      tank.step(m.dt);

      filt.beginInputs();
      for (const J of f.jets) filt.jetAt(J[0], J[1], J[2], J[3], J[4], J[5]);
      for (const J of f.ljets) filt.jetLine(J[0], J[1], J[2], J[3], J[4]);
      for (const P of f.pts) filt.srcAt(P[0], P[1], P[2], P[3]);
      for (const L of f.lines) filt.srcLine(L[0], L[1], L[2]);
      for (const S of f.strips) filt.srcSurface(S[0], S[1], S[2]);
      filt.step(m.dt);
    }

    // keluaran: kecepatan pusat sel + laju rata-rata, ke buffer yang dipinjam dari klien
    const o = { t: 'f', u: m.bu, v: m.bv, w: m.bw, m: m.bm, fu: m.bfu, fv: m.bfv, fw: m.bfw, fm: m.bfm };
    tank.writeOutput(o.u, o.v, o.w, o.m);
    filt.writeOutput(o.fu, o.fv, o.fw, o.fm);
    if (tank.maskVer !== sentT) {
      sentT = tank.maskVer;
      o.sol = tank.sol.slice();
    }
    if (filt.maskVer !== sentF) {
      sentF = filt.maskVer;
      o.solF = filt.sol.slice();
    }
    if (m.wantStats) {
      const st = tank.stats(cfg.sand ? 2 : 1);
      const sf = filt.stats(1);
      o.stats = { ...st, it3: tank.solver.lastIterations, itF: filt.solver.lastIterations, fdead: sf.dead, fmean: sf.mean };
    }
    post(o, [o.u.buffer, o.v.buffer, o.w.buffer, o.m.buffer, o.fu.buffer, o.fv.buffer, o.fw.buffer, o.fm.buffer]);
  }

  /** Akses internal untuk uji otomatis. */
  handle.debug = { tank, filt };
  return handle;
}
