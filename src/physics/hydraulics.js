/**
 * Model hidrolik lumped: siphon U-pipe, pompa return, weir antar-chamber, ATO, neraca garam.
 *
 * Numerik modul ini sengaja dibuat identik dengan versi 1 (index.html tunggal) karena
 * model sudah dikalibrasi terhadap uji air tawar. Lihat tests/hydraulics.test.js untuk
 * uji regresi yang membandingkan langsung dengan kode lama.
 *
 * Satuan CGS: cm, cm³/s, cm/s, detik.
 */
import { G, NU, RIM, GEO } from './constants.js';

/** Parameter bawaan (semua yang bisa diubah lewat UI). */
export function defaultParams() {
  return {
    on: true, // listrik
    qmax: 500, // debit maks pompa (L/jam)
    hmax: 0.5, // head maks pompa (m)
    spd: 1, // daya pompa (0..1)
    rv: 1, // bukaan ball valve return (0..1)
    n: 1, // jumlah pipa U
    D: 1.8, // diameter dalam U-pipe (cm)
    zin: 8, // tinggi intake bawah (cm)
    zd: 22, // tinggi ujung buang siphon (cm)
    sv: 0.55, // bukaan ball valve U-pipe
    sk: 1, // surface skimmer: 0 = tidak ada, 1 = mangkuk tetap, 2 = mengapung
    zrim: 26.5, // tinggi bibir mangkuk tipe tetap (cm)
    kb: 1, // bukaan intake bawah
    venturi: true,
    box: false, // overflow box sebagai surface skimmer
    hole: true, // lubang siphon-break di return
    ato: true,
    fsw: true, // saklar pelampung
    clog: 0, // kapas kotor (0..1)
    disp: 4, // batu + pasir (L)
  };
}

/** Volume air total di seluruh sistem (cm³). */
export function totalVolume(S, P) {
  return (
    GEO.AT * S.HT +
    (P.box ? GEO.AB * (S.HB - GEO.ZBOX0) : 0) +
    GEO.A1 * S.H1 +
    GEO.A2 * S.H2 +
    GEO.A3 * S.H3 +
    GEO.AP * S.HP
  );
}

/** Kondisi awal (mendekati tunak pada parameter bawaan). */
export function initialState(P) {
  const S = {
    t: 0,
    HT: P.box ? 27.38 : 27,
    HB: P.box ? 24.2 : 27,
    H1: 23.35,
    H2: 23.13,
    H3: 20.63,
    HP: 18,
    vs: [0, 0], // kecepatan di U-pipe (cm/s)
    air: [0, 0], // fraksi udara di puncak U
    brk: [false, false], // siphon putus
    Hc: [27, 27], // level di dalam mangkuk skimmer
    rim: [P.zrim, P.zrim],
    qb: [0, 0], // debit lewat intake bawah
    qk: [0, 0], // debit lewat mangkuk skimmer
    airIn: [0, 0], // laju udara masuk lewat skimmer
    hj: 27,
    vr: 0, // kecepatan di pipa return
    retP: true, // pipa return masih penuh air (untuk aliran balik saat padam)
    ato: 0, // air tawar yang sudah ditambahkan ATO (cm³)
    atoOn: false,
    spill: 0, // total air tumpah (cm³)
    spr: 0, // laju tumpah (dihaluskan)
    pend: 0, // volume tambahan/kurangan dari slider (cm³)
    cutHi: false,
    cutLo: false,
    run: true,
    q: { s: 0, r: 0, c: 0, q12: 0, q23: 0, q34: 0, a: 0, v: 0, hp: 0, hs: 0, k: 0, b: 0 },
  };
  S.salt = 35 * (totalVolume(S, P) / 1000 - P.disp);
  return S;
}

/** Faktor gesek Darcy: laminar 64/Re, Blasius, interpolasi di zona transisi. */
export function friction(Re) {
  if (Re < 1) return 64;
  if (Re < 2000) return 64 / Re;
  const ft = 0.316 / Math.pow(Re, 0.25);
  if (Re < 4000) {
    const w = (Re - 2000) / 2000;
    return (1 - w) * 0.032 + w * ft;
  }
  return ft;
}

/** Koefisien rugi ball valve sebagai fungsi bukaan (0..1). */
export function valveK(a) {
  a = Math.max(0.03, Math.min(1, a));
  return 0.1 + 1.5 * Math.pow(1 / a - 1, 2);
}

/**
 * Debit weir tajam (cm³/s) dengan koreksi tenggelam Villemonte.
 * @param u level hulu, @param d level hilir, @param c tinggi puncak weir, @param b lebar weir.
 */
export function weir(u, d, c, b) {
  const hi = Math.max(u, d);
  const lo = Math.min(u, d);
  if (hi <= c) return 0;
  const h1 = hi - c;
  const h2 = Math.max(0, lo - c);
  let q = 18.31 * b * Math.pow(h1, 1.5);
  if (h2 > 0) q *= Math.pow(Math.max(0, 1 - Math.pow(h2 / h1, 1.5)), 0.385);
  return u >= d ? q : -q;
}

/** Pembatas debit supaya satu langkah tidak membalik beda level (stabilitas eksplisit). */
export function limitFlow(q, hu, hd, Au, Ad, dt, c) {
  let m = (0.5 * Math.abs(hu - hd) * ((Au * Ad) / (Au + Ad))) / dt;
  if (c !== undefined) {
    const up = q >= 0 ? hu : hd;
    const Aup = q >= 0 ? Au : Ad;
    m = Math.min(m, (0.5 * Math.max(0, up - c) * Aup) / dt);
  }
  return Math.max(-m, Math.min(m, q));
}

/** Koefisien rugi total jalur return. */
export function returnK(P, v) {
  return 3.0 + valveK(P.rv) + (friction((Math.abs(v) * GEO.DR) / NU) * GEO.LR) / GEO.DR;
}

/** Panjang pipa U (cm). */
export function pipeLength(P) {
  return GEO.YC - (P.box ? GEO.ZBOX : P.zin) + 11 + (GEO.YC - P.zd);
}

const signedSqrt = (x) => (x >= 0 ? Math.sqrt(x) : -Math.sqrt(-x));

/** Tinggi bibir mangkuk surface skimmer saat ini. */
export function rimOf(S, P) {
  const zjt = P.zin + GEO.ZJ + P.D * 0.5;
  return P.sk === 2 ? Math.max(zjt + GEO.CUPD + 1, Math.min(29.5, S.HT - GEO.CUPS)) : P.zrim;
}

/** Apakah cabang surface skimmer aktif (secara geometris mungkin). */
export function skimmerActive(P, rim) {
  return P.sk > 0 && !P.box && rim - GEO.CUPD > P.zin + GEO.ZJ + P.D * 0.5 + 0.5;
}

/**
 * Intake dua cabang: lubang bawah (dalam) + mangkuk surface skimmer.
 * Menulis Hc/qb/qk/airIn ke S dan mengembalikan koefisien rugi masuk efektif.
 */
function intake(S, P, i, v, As) {
  const HT = S.HT;
  const Q = v * As;
  const C2 = 44.294; // √(2g)
  const rim = rimOf(S, P);
  S.rim[i] = rim;
  if (P.box) {
    S.Hc[i] = S.HB;
    S.qb[i] = Q;
    S.qk[i] = 0;
    S.airIn[i] = 0;
    return 1.0;
  }
  const Kb = 1.4 + valveK(P.kb);
  const ab = As / Math.sqrt(Kb);
  const on = skimmerActive(P, rim);
  if (!on) {
    S.Hc[i] = HT;
    S.qb[i] = Q;
    S.qk[i] = 0;
    S.airIn[i] = 0;
    return Kb;
  }
  const as = As / 1.342;
  if (Q <= 0.5) {
    S.Hc[i] = HT;
    S.qb[i] = Q;
    S.qk[i] = 0;
    S.airIn[i] = 0;
    const r = As / (ab + as);
    return r * r;
  }
  let hj = HT;
  // debit lewat mangkuk sebagai fungsi level di dalam mangkuk (bisection tekanan di tee)
  const qkOf = (Hc) => {
    let lo = HT - 300;
    let hi = HT;
    for (let n = 0; n < 22; n++) {
      const m = (lo + hi) * 0.5;
      if (C2 * (ab * Math.sqrt(HT - m) + as * signedSqrt(Hc - m)) > Q) lo = m;
      else hi = m;
    }
    hj = (lo + hi) * 0.5;
    return C2 * as * signedSqrt(Hc - hj);
  };
  const zjt = P.zin + GEO.ZJ + P.D * 0.5;
  const zcb = rim - GEO.CUPD;
  let Hc;
  let qk;
  let air = 0;
  if (weir(HT, zjt, rim, GEO.CUPB) - qkOf(zjt) < 0) {
    // mangkuk kering: cabang skimmer menghisap udara
    Hc = zjt;
    qk = weir(HT, zjt, rim, GEO.CUPB);
    const qb = Q - qk;
    hj = HT - (qb / (C2 * ab)) * (qb / (C2 * ab));
    air = 0.8;
  } else {
    let lo = zjt;
    let hi = HT;
    for (let n = 0; n < 18; n++) {
      const m = (lo + hi) * 0.5;
      if (weir(HT, m, rim, GEO.CUPB) - qkOf(m) > 0) lo = m;
      else hi = m;
    }
    Hc = (lo + hi) * 0.5;
    qk = qkOf(Hc);
    if (Hc < zcb) {
      const vs = qk / As;
      if (vs > 22) air = Math.min(0.5, 0.25 * (vs / 22 - 1));
    }
  }
  S.Hc[i] = Hc;
  S.qk[i] = qk;
  S.qb[i] = Q - qk;
  S.hj = hj;
  S.airIn[i] = air;
  return Math.max(0.2, (HT - hj) / ((v * v) / (2 * G)));
}

/** Satu langkah integrasi (dt detik). Memutasi S. */
export function step(S, P, dt) {
  // saklar pelampung dengan histeresis
  if (P.fsw) {
    if (S.HT >= 28.5) S.cutHi = true;
    else if (S.HT < 28) S.cutHi = false;
    if (S.HP < 4) S.cutLo = true;
    else if (S.HP > 8) S.cutLo = false;
  } else {
    S.cutHi = false;
    S.cutLo = false;
  }
  const run = P.on && !S.cutHi && !S.cutLo;
  S.run = run;
  const cs = S.salt / Math.max(1000, totalVolume(S, P) - P.disp * 1000);

  /* --- siphon --- */
  const src = P.box ? S.HB : S.HT;
  const zin = P.box ? GEO.ZBOX : P.zin;
  const D = P.D;
  const As = (Math.PI * D * D) / 4;
  const vT = 0.35 * Math.sqrt(G * D); // kecepatan gelembung Taylor
  const Lp = pipeLength(P);
  const outSub = S.H1 > P.zd;
  const sub = src - zin;
  const dh = src - Math.max(P.zd, S.H1);
  let Qs = 0;
  let Qk = 0;
  let Qb = 0;
  for (let i = 0; i < 2; i++) {
    if (i >= P.n) {
      S.vs[i] = 0;
      S.qb[i] = 0;
      S.qk[i] = 0;
      continue;
    }
    let v = S.vs[i];
    let air = S.air[i];
    if (S.brk[i]) {
      v = 0;
      S.rim[i] = rimOf(S, P);
      S.Hc[i] = S.HT;
      S.qb[i] = 0;
      S.qk[i] = 0;
      S.airIn[i] = 0;
      // venturi menghisap udara dari puncak U sampai siphon tersambung lagi
      if (P.venturi && run && sub > 0 && outSub) {
        air -= 0.05 * dt;
        if (air <= 0.4) {
          air = 0.4;
          S.brk[i] = false;
        }
      } else air = 1;
    } else {
      const Kin = intake(S, P, i, v, As);
      const K =
        Kin +
        3.1 +
        valveK(P.sv) +
        (friction((Math.abs(v) * D) / NU) * Lp) / D +
        4 * (1 / Math.pow(1 - Math.min(air, 0.96), 2) - 1);
      // persamaan momentum kolom air, semi-implisit pada rugi kuadratik
      v = (v + (dt * G * dh) / Lp) / (1 + (dt * K * Math.abs(v)) / (2 * Lp));
      if (v > 0 && sub <= 0) v *= Math.max(0, 1 - 5 * dt);
      if (v < 0 && !outSub) v = 0;
      let da = S.airIn[i];
      const av = Math.abs(v);
      const Sc = 0.3 + (1.5 * v * v) / (2 * G); // submergence kritis (vortex)
      if (sub <= 0) da += 3;
      else if (sub < Sc && v > 0) da += 0.5 * (1 - sub / Sc);
      if (!outSub) {
        if (dh <= 0) da += 2;
        else {
          const vsl = av / Math.max(P.sv, 0.03);
          if (vsl < vT) da += 0.15 * (1 - vsl / vT);
        }
      }
      if (av > vT) da -= 0.2 * (av / vT - 1);
      if (P.venturi && run) da -= 0.05;
      air = Math.min(1, Math.max(0, air + da * dt));
      if (air >= 0.97) {
        S.brk[i] = true;
        air = 1;
        v = 0;
      }
    }
    S.vs[i] = v;
    S.air[i] = air;
    Qs += v * As;
    Qk += S.qk[i];
    Qb += S.qb[i];
  }

  /* --- pompa + jalur return --- */
  const Ar = (Math.PI * GEO.DR * GEO.DR) / 4;
  let v = S.vr;
  let hp = 0;
  let hs = 0;
  const Kr = returnK(P, v);
  if (run) {
    S.retP = true;
    const dry = Math.max(0, Math.min(1, (S.HP - 1) / 1.5));
    const H0 = P.hmax * 100 * P.spd * P.spd * dry; // hukum afinitas
    const qm = P.qmax / 3.6;
    const cp = (P.hmax * 100 * Ar * Ar) / (qm * qm);
    hs = Math.max(S.HT, GEO.ZOUT) - S.HP;
    v = (v + (dt * G * (H0 - hs)) / GEO.LR) / (1 + (dt * (G * cp + Kr / 2) * Math.abs(v)) / GEO.LR);
    if (v < 0 || S.HP <= 1) v = 0;
    hp = Math.max(0, H0 - cp * v * v);
  } else {
    // listrik padam: aliran balik lewat pompa sampai lubang siphon-break / outlet terbuka
    const zstop = P.hole ? GEO.ZHOLE : GEO.ZOUT;
    if (S.retP && S.HT > zstop && S.HT > S.HP) {
      v = (v - (dt * G * (S.HT - S.HP)) / GEO.LR) / (1 + (dt * (Kr + 6) * Math.abs(v)) / (2 * GEO.LR));
    } else {
      if (S.HT <= zstop) S.retP = false;
      v = 0;
    }
  }
  S.vr = v;
  const Qr = v * Ar;

  /* --- weir, kapas, ATO --- */
  let Qc = 0;
  if (P.box) Qc = limitFlow(weir(S.HT, S.HB, GEO.ZC, GEO.BC), S.HT, S.HB, GEO.AT, GEO.AB, dt, GEO.ZC);
  const Gf = 400 * Math.pow(1 - P.clog, 2) + 0.5; // konduktansi kapas (Darcy)
  const Q12 = limitFlow(Gf * (S.H1 - S.H2), S.H1, S.H2, GEO.A1, GEO.A2, dt);
  const Q23 = limitFlow(weir(S.H2, S.H3, GEO.W2, 10), S.H2, S.H3, GEO.A2, GEO.A3, dt, GEO.W2);
  const Q34 = limitFlow(weir(S.H3, S.HP, GEO.W4, 10), S.H3, S.HP, GEO.A3, GEO.AP, dt, GEO.W4);
  let qa = 0;
  if (P.ato && P.on && S.ato < GEO.ATOMAX) {
    if (S.HP < GEO.ATOSET - 0.3) S.atoOn = true;
    if (S.HP >= GEO.ATOSET) S.atoOn = false;
    if (S.atoOn) qa = GEO.ATOQ;
  } else S.atoOn = false;
  let qv = 0;
  if (S.pend !== 0) {
    qv = Math.max(-150, Math.min(150, S.pend / dt));
    if (qv < 0 && S.HP < 0.5) {
      qv = 0;
      S.pend = 0;
    }
    S.pend -= qv * dt;
    if (Math.abs(S.pend) < 1e-6) S.pend = 0;
  }

  /* --- neraca massa --- */
  S.HT += ((Qr - (P.box ? Qc : Qs)) * dt) / GEO.AT;
  if (P.box) {
    S.HB += ((Qc - Qs) * dt) / GEO.AB;
    if (S.HB < GEO.ZBOX0) S.HB = GEO.ZBOX0;
  } else S.HB = S.HT;
  S.H1 += ((Qs - Q12) * dt) / GEO.A1;
  S.H2 += ((Q12 - Q23) * dt) / GEO.A2;
  S.H3 += ((Q23 - Q34) * dt) / GEO.A3;
  S.HP += ((Q34 - Qr + qa + qv) * dt) / GEO.AP;
  S.ato += qa * dt;
  let sp = 0;
  if (S.HT > RIM) {
    sp += (S.HT - RIM) * GEO.AT;
    S.HT = RIM;
  }
  if (S.H1 > RIM) {
    sp += (S.H1 - RIM) * GEO.A1;
    S.H1 = RIM;
  }
  if (S.H2 > RIM) {
    sp += (S.H2 - RIM) * GEO.A2;
    S.H2 = RIM;
  }
  if (S.H3 > RIM) {
    sp += (S.H3 - RIM) * GEO.A3;
    S.H3 = RIM;
  }
  if (S.HP > RIM) {
    sp += (S.HP - RIM) * GEO.AP;
    S.HP = RIM;
  }
  if (S.H1 < 0) S.H1 = 0;
  if (S.H2 < 0) S.H2 = 0;
  if (S.H3 < 0) S.H3 = 0;
  if (S.HP < 0) S.HP = 0;
  if (S.HT < 0) S.HT = 0;
  S.salt += (qv * dt - sp) * cs;
  if (S.salt < 0) S.salt = 0;
  S.spill += sp;
  S.spr += (sp / dt - S.spr) * Math.min(1, dt * 2);
  const q = S.q;
  q.s = Qs;
  q.r = Qr;
  q.c = Qc;
  q.q12 = Q12;
  q.q23 = Q23;
  q.q34 = Q34;
  q.a = qa;
  q.v = qv;
  q.hp = hp;
  q.hs = hs;
  q.k = Qk;
  q.b = Qb;
  S.t += dt;
}

/** Level rata-rata seluruh sistem bila semua aliran berhenti (tanpa overflow box). */
export function equilibriumLevel(S, P) {
  return totalVolume(S, P) / (GEO.AT + GEO.A1 + GEO.A2 + GEO.A3 + GEO.AP);
}
