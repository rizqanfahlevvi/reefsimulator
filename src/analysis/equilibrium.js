/**
 * "Cari titik seimbang": model hidrolik aplikasi dijalankan di luar layar untuk setiap bukaan
 * ball valve U-pipe sampai tunak, lalu dipilih bukaan yang
 *   1) stabil: level tetap, siphon penuh (tanpa gluk-gluk / skimmer menghisap udara),
 *      pelampung atas tidak memutus pompa, tidak tumpah, level ≤ 28,3 cm;
 *   2) tetap stabil bila debit pompa naik 20% (cadangan untuk penyumbatan/ perubahan pompa);
 *   3) paling tertutup di antara yang lolos → level tertinggi = surface skimmer paling efektif
 *      (prinsip "full siphon" yang dicekik dengan cadangan aman).
 * Ditulis sebagai generator supaya bisa dicicil per frame di browser (UI tetap responsif).
 */
import { step } from '../physics/hydraulics.js';
import { FSW } from '../physics/constants.js';

export const EQ = { dt: 0.02, maxT: 300, every: 5, tol: 0.003, need: 3, minT: 30, hiSafe: 28.3, stress: 1.2 };
export const SV_STEPS = Array.from({ length: 20 }, (_, i) => +(0.05 * (i + 1)).toFixed(2));

/** Kondisi awal "operasi normal" dari state sekarang: siphon terpancing, listrik nyala. */
function baseline(S0, P0, over) {
  const P = { ...P0, on: true, ...over };
  const S = structuredClone(S0);
  S.brk = S.brk.map(() => false);
  S.air = S.air.map(() => 0);
  S.cutHi = false;
  S.cutLo = false;
  S.pend = 0;
  return { S, P };
}

/** Simulasikan sampai tunak. Generator: yield tiap ±5 dtk simulasi; return hasil penilaian. */
export function* settle(S0, P0, over) {
  const { S, P } = baseline(S0, P0, over);
  const nEvery = Math.round(EQ.every / EQ.dt);
  let t = 0;
  let last = S.HT;
  let calm = 0;
  let cut = false;
  let airMax = 0;
  let skAir = false;
  let stable = false;
  while (t < EQ.maxT) {
    for (let i = 0; i < nEvery; i++) {
      step(S, P, EQ.dt);
      if (S.cutHi) cut = true;
    }
    t += EQ.every;
    if (t >= EQ.minT) {
      // nilai gluk-gluk & udara skimmer hanya dari fase tunak
      for (let k = 0; k < P.n; k++) {
        airMax = Math.max(airMax, S.air[k]);
        if (S.airIn[k] > 0) skAir = true;
      }
    }
    if (Math.abs(S.HT - last) < EQ.tol && !S.cutHi) {
      if (++calm >= EQ.need && t >= EQ.minT) {
        stable = true;
        break;
      }
    } else calm = 0;
    last = S.HT;
    yield t;
  }
  const brk = S.brk.slice(0, P.n).some(Boolean);
  const share = S.q.s > 1 ? S.q.k / S.q.s : 0;
  const why = [];
  if (!stable) why.push(cut ? 'pompa hidup-mati oleh pelampung atas' : 'level tidak stabil');
  if (brk) why.push('siphon putus');
  if (S.spill > 50) why.push('tumpah');
  if (S.HT > EQ.hiSafe) why.push('level > ' + String(EQ.hiSafe).replace('.', ',') + ' cm');
  if (airMax > 0.15) why.push('gluk-gluk');
  if (skAir) why.push('skimmer menghisap udara');
  return {
    sv: P.sv,
    t,
    HT: S.HT,
    qs: S.q.s * 3.6,
    qr: S.q.r * 3.6,
    share,
    air: airMax,
    ok: why.length === 0,
    why,
  };
}

/**
 * Cari bukaan valve U-pipe terbaik. Generator: yield {done, total} untuk progres; return hasil.
 * @param {object} S state hidrolik sekarang (tidak diubah)
 * @param {object} P parameter sekarang (tidak diubah)
 */
export function* findBalance(S, P) {
  const total = SV_STEPS.length * 2;
  let done = 0;
  const rows = [];
  for (const sv of SV_STEPS) {
    const r = yield* settleProgress(S, P, { sv });
    rows.push(r);
    done++;
    yield { done, total };
  }
  const feasible = rows.filter((r) => r.ok);
  // uji cadangan: debit pompa +20% (dari bukaan paling tertutup; berhenti di yang pertama lolos)
  let best = null;
  for (const r of feasible) {
    const s = yield* settleProgress(S, P, { sv: r.sv, qmax: P.qmax * EQ.stress });
    r.robust = s.ok;
    r.stressHT = s.HT;
    done++;
    yield { done, total };
    if (s.ok) {
      best = r;
      break;
    }
  }
  const pct = (v) => Math.round(v * 100) + '%';
  const lvl = (v) => v.toFixed(1).replace('.', ',') + ' cm';
  let note;
  let maxSpd = null;
  if (best) {
    note =
      `Valve U-pipe ${pct(best.sv)}: level stabil ${lvl(best.HT)}, siphon ${Math.round(best.qs)} L/jam, ` +
      `${Math.round(best.share * 100)}% lewat surface skimmer, dan tetap stabil bila debit pompa naik 20% (level ${lvl(best.stressHT)}).`;
  } else if (feasible.length) {
    best = feasible[feasible.length - 1];
    note = `Valve ${pct(best.sv)} stabil, tetapi tidak ada bukaan yang tahan debit +20%: cadangan siphon tipis. Pertimbangkan pipa U lebih besar (¾") atau turunkan daya pompa.`;
  } else {
    // siphon tidak sanggup sama sekali → cari daya pompa maksimum yang masih stabil pada valve 100%
    let lo = 0.3;
    let hi = P.spd;
    for (let i = 0; i < 6; i++) {
      const mid = 0.5 * (lo + hi);
      const s = yield* settleProgress(S, P, { sv: 1, spd: mid });
      if (s.ok) lo = mid;
      else hi = mid;
    }
    maxSpd = lo;
    note = `Siphon tidak sanggup membawa debit pompa bahkan dengan valve 100%. Turunkan daya pompa ke ±${pct(maxSpd)} atau pakai pipa U lebih besar.`;
  }
  const critical = feasible.length ? feasible[0].sv : null;
  return { rows, best, critical, note, maxSpd, hiFloat: FSW.HI_OFF };
}

function* settleProgress(S, P, over) {
  const g = settle(S, P, over);
  for (;;) {
    const r = g.next();
    if (r.done) return r.value;
    yield null; // titik jeda untuk pencicil
  }
}

/** Jalankan generator sampai selesai secara sinkron (uji / Node). */
export function runSync(gen) {
  for (;;) {
    const r = gen.next();
    if (r.done) return r.value;
  }
}

/**
 * Jalankan generator dicicil ±12 ms per giliran supaya UI tetap halus.
 * @returns {Promise<any>} nilai akhir generator
 */
export function runChunked(gen, onProgress, budget = 12) {
  return new Promise((resolve, reject) => {
    const tick = () => {
      const t0 = performance.now();
      try {
        while (performance.now() - t0 < budget) {
          const r = gen.next();
          if (r.done) return resolve(r.value);
          if (r.value && r.value.total) onProgress?.(r.value);
        }
      } catch (err) {
        return reject(err);
      }
      setTimeout(tick, 0);
    };
    tick();
  });
}
