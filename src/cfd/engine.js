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
 * Transport skalar (umur air, pewarna "air baru", salinitas) berjalan di kedua domain dan
 * dikopel sebagai satu siklus: intake tank → pancuran siphon di filter; isapan pompa → duckbill.
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
  let scalarInit = true; // isi ulang skalar pada langkah berikutnya
  let ageKick = false; // tambahkan estimasi umur campur sempurna setelah pompa stabil
  let tReset = 0; // waktu CFD sejak reset (dtk)
  let dyeIn = null;

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

  let lastCoupling = { qRet: 0, tankOut: null, pumpIn: null };
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
      scalarInit = true;
    }
    const sc = m.scal || {};
    if (sc.resetDye) {
      tank.sc.dye.fill(0);
      filt.sc.dye.fill(0);
    }
    dyeIn = typeof sc.dyeIn === 'number' ? sc.dyeIn : null;
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
      for (const V of m.vols) tank.srcAt(V[0], V[1], V[2], V[3], V[4]);
      tank.step(m.dt);

      filt.beginInputs();
      for (const J of f.jets) filt.jetAt(J[0], J[1], J[2], J[3], J[4], J[5]);
      for (const J of f.ljets) filt.jetLine(J[0], J[1], J[2], J[3], J[4]);
      for (const P of f.pts) filt.srcAt(P[0], P[1], P[2], P[3], P[4]);
      for (const L of f.lines) filt.srcLine(L[0], L[1], L[2], L[3]);
      for (const S of f.strips) filt.srcSurface(S[0], S[1], S[2], S[3]);
      filt.step(m.dt);

      /* ---------- transport skalar, kopling siklus tank ↔ filter ---------- */
      const qRet = tank.srcList.reduce((acc, e) => acc + (e[2] === 'ret' && e[1] > 0 ? e[1] : 0), 0);
      if (scalarInit) {
        // isi awal: salinitas = neraca garam hidrolik; umur 0 (debit pompa belum stabil saat start)
        tank.initScalars({ age: 0, dye: 0, salt: sc.salt0 ?? 35 });
        filt.initScalars({ age: 0, dye: 0, salt: sc.salt0 ?? 35 });
        scalarInit = false;
        ageKick = true;
        tReset = 0;
      }
      tReset += m.dt;
      if (ageKick && tReset >= 5 && qRet > 1) {
        // setelah pompa stabil: tambahkan estimasi campur sempurna V/Q sekali, supaya medan
        // umur cepat mendekati tunak (hasil tunak tidak bergantung pada nilai awal)
        const tau = Math.min(3600, tank.scalarStats().volume / qRet);
        const tauF = Math.min(3600, filt.scalarStats().volume / qRet);
        for (const c of tank.fluidCells) tank.sc.age[c] += tau;
        for (const c of filt.fluidCells) filt.sc.age[c] += tau + tauF;
        ageKick = false;
      }
      const tankOut = tank.sinkMean(['in']); // air yang tersedot intake tank
      const pumpIn = filt.sinkMean(['pump']); // air yang diisap pompa return
      const w2 = filt.sinkMean(['w2u']);
      const w4 = filt.sinkMean(['w4u']);
      const FRESH = { age: 0, dye: 0, salt: 0 };
      tank.transport(m.dt, (tag) => {
        if (tag !== 'ret') return null;
        // air dari duckbill: umur 0 (baru keluar dari filter); pewarna & salinitas dari isapan pompa
        return { age: 0, dye: dyeIn ?? (pumpIn ? pumpIn.dye : 0), salt: pumpIn ? pumpIn.salt : (sc.salt0 ?? 35) };
      });
      filt.transport(m.dt, (tag) => {
        if (tag === 'sip') return tankOut;
        if (tag === 'w2d') return w2;
        if (tag === 'w4d') return w4;
        if (tag === 'ato') return FRESH; // air tawar ATO: 0 ppt
        return null;
      });
      // Kekekalan garam global: tutup kaku tidak bisa menampung naik-turunnya muka air
      // (volume "di atas tutup" tidak terwakili), jadi rata-rata salinitas dikunci ke neraca
      // garam hidrolik yang eksak; sebaran lokal (plume ATO, stratifikasi) tetap dari CFD.
      if (typeof sc.saltRef === 'number' && sc.saltRef > 0) {
        const vT = tank.scalarStats();
        const vF = filt.scalarStats();
        const mean = (vT.salt * vT.volume + vF.salt * vF.volume) / Math.max(1, vT.volume + vF.volume);
        if (mean > 0) {
          const k = sc.saltRef / mean;
          for (const D of [tank, filt]) {
            const S = D.sc.salt;
            for (const c of D.fluidCells) S[c] *= k;
          }
        }
      }
      lastCoupling = { qRet, tankOut, pumpIn };
    }

    // keluaran: kecepatan pusat sel + laju rata-rata, ke buffer yang dipinjam dari klien
    const o = {
      t: 'f',
      u: m.bu,
      v: m.bv,
      w: m.bw,
      m: m.bm,
      fu: m.bfu,
      fv: m.bfv,
      fw: m.bfw,
      fm: m.bfm,
      ta: m.bta,
      td: m.btd,
      ts: m.bts,
      fa: m.bfa,
      fd: m.bfd,
      fs: m.bfs,
    };
    tank.writeOutput(o.u, o.v, o.w, o.m);
    filt.writeOutput(o.fu, o.fv, o.fw, o.fm);
    o.ta.set(tank.sc.age);
    o.td.set(tank.sc.dye);
    o.ts.set(tank.sc.salt);
    o.fa.set(filt.sc.age);
    o.fd.set(filt.sc.dye);
    o.fs.set(filt.sc.salt);
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
      const tS = tank.scalarStats();
      const fS = filt.scalarStats();
      const { qRet, tankOut } = lastCoupling;
      const tauN = qRet > 1 ? tS.volume / qRet : 0;
      let stag = 0;
      for (const c of tank.fluidCells) if (tauN > 0 && tank.sc.age[c] > 2 * tauN) stag++;
      o.stats = {
        ...st,
        it3: tank.solver.lastIterations,
        itF: filt.solver.lastIterations,
        fdead: sf.dead,
        fmean: sf.mean,
        // umur air & pertukaran (tank)
        tauN, // waktu tinggal nominal V/Q (dtk)
        ageMean: tS.age, // umur air rata-rata volume (dtk)
        ageOut: tankOut ? tankOut.age : 0, // umur air yang tersedot intake (dtk); tunak → τn
        ace: tauN > 0 && tS.age > 0 ? tauN / (2 * tS.age) : 0, // efisiensi pertukaran air (0,5 = campur sempurna)
        stagnant: tank.fluidCells.length ? (stag / tank.fluidCells.length) * 100 : 0, // % volume umur > 2τn
        dyeT: tS.dye,
        dyeF: fS.dye,
        saltT: tS.salt,
        saltTmin: tS.saltMin,
        saltTmax: tS.saltMax,
        saltF: fS.salt,
        saltFmin: fS.saltMin,
        saltFmax: fS.saltMax,
        ageF: fS.age,
        subT: tank.lastSubsteps,
        subF: filt.lastSubsteps,
      };
    }
    post(o, [o.u, o.v, o.w, o.m, o.fu, o.fv, o.fw, o.fm, o.ta, o.td, o.ts, o.fa, o.fd, o.fs].map((x) => x.buffer));
  }

  /** Akses internal untuk uji otomatis. */
  handle.debug = { tank, filt };
  return handle;
}
