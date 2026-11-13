/**
 * Uji pulsa standar (uji tracer): pewarna dilepas 20 dtk dari duckbill setelah arus berkembang,
 * lalu direkam (waktu CFD) kadar rata-rata tank & filter, sebarannya (koefisien variasi), dan
 * kadar di intake siphon. Dari kurva itu dihitung:
 *   - t95: waktu sampai tank homogen 95% (CoV pewarna ≤ 5% dan bertahan)
 *   - waktu tiba & puncak di intake, dan rasio puncak terhadap pencampuran sempurna
 *     (puncak jauh di atas → jalan pintas duckbill → intake; Danckwerts 1953)
 * Semua dibandingkan dengan waktu tinggal nominal τ = V/Q.
 */
export const PULSE = { warmup: 60, dur: 20, cov: 0.05, hold: 30, minT: 40, maxTmin: 600, maxTau: 4 };

export class PulseTest {
  constructor() {
    this.reset();
  }

  reset() {
    this.state = 'idle'; // idle | warmup | running | done | aborted
    this.samples = [];
    this.result = null;
    this.reason = '';
    this.t0 = 0;
    this.lastStats = null;
    this.resets0 = 0;
  }

  /** @param {import('../cfd/client.js').FlowClient} flow */
  start(flow) {
    this.reset();
    flow.clearDye();
    this.state = 'warmup';
    this.resets0 = flow.resetCount;
  }

  abort(reason) {
    if (this.state === 'warmup' || this.state === 'running') {
      this.state = 'aborted';
      this.reason = reason;
    }
  }

  /** Dipanggil berkala dari loop UI. */
  tick(flow, app) {
    if (this.state === 'warmup') {
      if (!app.V.cfd) return this.abort('simulasi arus dimatikan');
      if (flow.resetCount !== this.resets0) this.resets0 = flow.resetCount; // tunggu ulang dari awal
      if (flow.cfdAge >= PULSE.warmup) {
        flow.startDye('pulse', PULSE.dur);
        this.t0 = flow.cfdTime;
        this.resets0 = flow.resetCount;
        this.lastStats = app.flowStats;
        this.state = 'running';
      }
      return;
    }
    if (this.state !== 'running') return;
    if (!app.V.cfd) return this.abort('simulasi arus dimatikan');
    if (flow.resetCount !== this.resets0) return this.abort('simulasi arus diulang (pengaturan berubah)');
    const s = app.flowStats;
    if (s === this.lastStats || s.dyeT === undefined) return;
    this.lastStats = s;
    const t = flow.cfdTime - this.t0;
    this.samples.push({ t, dT: s.dyeT, dF: s.dyeF, sd: s.dyeTsd, out: s.dyeOut, volT: s.volT, volF: s.volF, tau: s.tauN });
    const tau = s.tauN || 300;
    const maxT = Math.max(PULSE.maxTmin, PULSE.maxTau * tau);
    if (t > PULSE.minT && this.mixedSince() !== null && t - this.mixedSince() >= PULSE.hold) this.finish();
    else if (t > maxT) this.finish();
  }

  /** Waktu sejak CoV ≤ batas tanpa putus sampai sekarang (null bila belum). */
  mixedSince() {
    let since = null;
    for (const p of this.samples) {
      if (p.t < PULSE.dur) continue;
      const cov = p.dT > 1e-6 ? p.sd / p.dT : 1;
      if (cov <= PULSE.cov) since ??= p.t;
      else since = null;
    }
    return since;
  }

  /** Progres untuk UI: teks singkat. */
  progress(flow) {
    if (this.state === 'warmup') return `Menunggu arus berkembang: ${Math.min(PULSE.warmup, Math.round(flow.cfdAge))}/${PULSE.warmup} dtk simulasi`;
    if (this.state === 'running') {
      const p = this.samples[this.samples.length - 1];
      if (!p) return 'Pewarna dilepas…';
      const cov = p.dT > 1e-6 ? p.sd / p.dT : 1;
      return `Berjalan ${Math.round(p.t)} dtk · tank ${(p.dT * 100).toFixed(1)}% · filter ${(p.dF * 100).toFixed(1)}% · keseragaman ${Math.max(0, Math.round((1 - cov) * 100))}% (target 95%)`;
    }
    if (this.state === 'aborted') return 'Dibatalkan: ' + this.reason;
    if (this.state === 'done') return 'Selesai.';
    return '';
  }

  finish() {
    this.state = 'done';
    this.result = evaluatePulse(this.samples);
  }
}

/** Hitung metrik dari sampel (fungsi murni → bisa diuji). */
export function evaluatePulse(samples) {
  const fmt = (v, d = 1) => v.toFixed(d).replace('.', ',');
  if (samples.length < 5) return { level: 'info', summary: 'data kurang', advice: 'Ulangi uji.', samples: [] };
  const last = samples[samples.length - 1];
  const tau = last.tau || samples.find((p) => p.tau)?.tau || 0;
  const mass = last.dT * last.volT + last.dF * last.volF; // volume pewarna (cm³), kekal setelah pulsa
  const cInf = mass / Math.max(1, last.volT + last.volF);
  const cTankIdeal = mass / Math.max(1, last.volT); // seandainya pulsa langsung tercampur rata di tank
  // t95: CoV ≤ 5% dan bertahan sampai akhir
  let t95 = null;
  for (const p of samples) {
    if (p.t < PULSE.dur) continue;
    const cov = p.dT > 1e-6 ? p.sd / p.dT : 1;
    if (cov <= PULSE.cov) t95 ??= p.t;
    else t95 = null;
  }
  // kurva di intake (siklus pertama: sampai τ + durasi pulsa)
  const first = samples.filter((p) => p.t <= (tau || 300) + PULSE.dur);
  let peak = first[0];
  for (const p of first) if (p.out > peak.out) peak = p;
  const arrive = first.find((p) => p.out >= 0.1 * peak.out) || peak;
  const peakRatio = cTankIdeal > 0 ? peak.out / cTankIdeal : 0;
  const early = tau > 0 && peak.t < 0.25 * tau;
  // Kalibrasi dengan model (tank 50 cm, return ±330 L/jam): ke arah duckbill mana pun puncak ±1,9–2,4×
  // dalam ±20–40 dtk; duckbill diarahkan ke intake ±2,7×; dengan wavemaker ±1,5×.
  const shortcut = early && peakRatio > 2.5; // jalan pintas kuat
  const partial = early && !shortcut && peakRatio > 1.5; // sebagian air baru cepat sampai intake
  const slow = t95 === null || (tau > 0 && t95 > 2 * tau);
  const level = shortcut || slow ? 'warn' : partial ? 'info' : 'ok';
  const t95txt = t95 === null ? 'belum homogen' : `t95 ${fmt(t95 / 60)} mnt`;
  const summary = `${t95txt} · τ ${fmt(tau / 60)} mnt · puncak di intake ${Math.round(peak.t)} dtk (${fmt(peakRatio, 2)}× campur sempurna)`;
  const advice = shortcut
    ? 'Jalan pintas kuat: puncak pewarna di intake datang cepat dan jauh di atas campur sempurna, jadi banyak air baru langsung tersedot kembali. Arahkan duckbill menjauhi intake siphon/surface skimmer (ke depan atau ke atas) dan nyalakan wavemaker.'
    : slow
      ? 'Tank lambat homogen (lebih dari 2× waktu tinggal): ada area yang jarang teraduk. Tambah/ubah arah wavemaker.'
      : partial
        ? 'Sebagian air baru cepat sampai ke intake (wajar untuk tank kecil: di model, ke arah duckbill mana pun puncaknya ±2×). Tank tetap homogen jauh sebelum satu waktu tinggal. Wavemaker menurunkan puncak ini (di model ±1,9× → ±1,5×).'
        : 'Pencampuran baik: tank homogen sebelum air sempat berganti sepenuhnya, tanpa tanda jalan pintas.';
  // sampel ringkas untuk laporan (±5 dtk)
  const brief = [];
  let next = 0;
  for (const p of samples) {
    if (p.t >= next) {
      brief.push({ t: Math.round(p.t), tank: p.dT * 100, filter: p.dF * 100, cov: p.dT > 1e-6 ? p.sd / p.dT : 1, intake: p.out * 100 });
      next = p.t + 5;
    }
  }
  return {
    level,
    summary,
    advice,
    t95,
    tau,
    tPeak: peak.t,
    tArrive: arrive.t,
    peakRatio,
    cInf,
    massL: mass / 1000,
    shortcut,
    partial,
    slow,
    samples: brief,
  };
}
