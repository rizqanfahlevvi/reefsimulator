/**
 * Klien mesin arus: menyusun pesan dari state hidrolik, mengirim ke worker,
 * menyimpan medan kecepatan terakhir dan menyediakan sampling untuk jejak partikel.
 */
import { G } from '../physics/constants.js';
import { totalVolume } from '../physics/hydraulics.js';
import { T3, F3, cellIndex, trilinear } from './grid.js';
import { ROCKS, NOZZLE, WAVEMAKER, FILTER, dirOf, siphonX } from '../layout.js';

const norm3 = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  a[0] /= l;
  a[1] /= l;
  a[2] /= l;
  return a;
};

const BUF_KEYS = ['u', 'v', 'w', 'm', 'fu', 'fv', 'fw', 'fm', 'ta', 'td', 'ts', 'fa', 'fd', 'fs'];
const makeBuffers = () => ({
  u: new Float32Array(T3.N),
  v: new Float32Array(T3.N),
  w: new Float32Array(T3.N),
  m: new Float32Array(T3.N),
  fu: new Float32Array(F3.N),
  fv: new Float32Array(F3.N),
  fw: new Float32Array(F3.N),
  fm: new Float32Array(F3.N),
  // skalar: umur air (dtk), pewarna (0..1), salinitas (ppt) — tank (t*) dan filter (f*)
  ta: new Float32Array(T3.N),
  td: new Float32Array(T3.N),
  ts: new Float32Array(T3.N).fill(35),
  fa: new Float32Array(F3.N),
  fd: new Float32Array(F3.N),
  fs: new Float32Array(F3.N).fill(35),
});

/** Cek cepat (setiap elemen ke-3) bahwa medan bebas NaN/Infinity — NaN menyebar ke seluruh medan dalam 1–2 langkah. */
function allFinite(a) {
  for (let i = 0; i < a.length; i += 3) if (!Number.isFinite(a[i])) return false;
  return true;
}

export class FlowClient {
  /**
   * @param {object} app state aplikasi
   * @param {object} [hooks]
   */
  constructor(app, hooks = {}) {
    this.app = app;
    this.hooks = hooks;
    this.fu = new Float32Array(T3.N);
    this.fv = new Float32Array(T3.N);
    this.fw = new Float32Array(T3.N);
    this.favg = new Float32Array(T3.N); // laju rata-rata waktu per sel (tank)
    // filter 3D
    this.ffu = new Float32Array(F3.N);
    this.ffv = new Float32Array(F3.N);
    this.ffw = new Float32Array(F3.N);
    this.ffavg = new Float32Array(F3.N);
    this.ffsol = new Uint8Array(F3.N).fill(1);
    // medan skalar terakhir
    const b0 = makeBuffers();
    this.sc = { ta: b0.ta, td: b0.td, ts: b0.ts, fa: b0.fa, fd: b0.fd, fs: b0.fs };
    /** pewarna "air baru": mode 'off' | 'pulse' | 'cont'; waktu CFD (dtk) */
    this.dye = { mode: 'off', until: 0, clear: false };
    this.cfdTime = 0;
    /** Bertambah setiap ada medan baru dari worker (untuk refresh tekstur bidang potong). */
    this.version = 0;
    this.fsol = new Uint8Array(T3.N).fill(1);
    this.spare = makeBuffers();
    this.busy = false;
    this.pend = 0;
    this.resetNext = true;
    this.burst = 0;
    this.acc = 0;
    this.wantStats = false;
    this.send = null;
    this.mode = 'worker';
    this.worker = null;
    /** Kinerja untuk laporan diagnostik. */
    this.perf = { ms: 0, ratio: 1, resets: 0, errors: 0, restarts: 0 };
    this.win = { sim: 0, cfd: 0, t: 0 };
    this.sentAt = 0;
    this.lastTick = 0;
    this.errRun = 0;
  }

  /** Catat kejadian ke diagnostik (bila disediakan). */
  log(kind, msg) {
    this.hooks.onEvent?.(kind, msg);
  }

  start() {
    try {
      this.spawnWorker();
    } catch (err) {
      this.log('warn', 'Worker tidak tersedia, arus dihitung di thread utama: ' + (err?.message || err));
      this.useMain();
    }
  }

  spawnWorker() {
    const wk = new Worker(new URL('./flow.worker.js', import.meta.url), { type: 'module' });
    wk.onmessage = (e) => this.onResult(e.data);
    wk.onerror = (e) => {
      // kegagalan memuat worker (error di dalam langkah ditangkap worker sendiri, lihat flow.worker.js)
      this.log('error', 'Worker arus gagal: ' + (e.message || 'tidak diketahui') + ' → pindah ke thread utama');
      if (this.worker === wk) this.useMain();
    };
    this.mode = 'worker';
    this.worker = wk;
    this.send = (m, t) => wk.postMessage(m, t);
    wk.postMessage({ t: 'init', rocks: ROCKS });
  }

  async useMain() {
    this.mode = 'main';
    this.worker?.terminate();
    this.worker = null;
    this.send = null; // tahan permintaan sampai engine siap
    const { createFlowEngine } = await import('./engine.js');
    const eng = createFlowEngine((m) => this.onResult(m));
    eng({ t: 'init', rocks: ROCKS });
    this.send = (m) =>
      setTimeout(() => {
        try {
          eng(m);
        } catch (err) {
          this.onResult({ t: 'error', message: err?.message || String(err) });
        }
      }, 0);
    this.recover();
  }

  /** Buang permintaan yang hilang: buffer baru, siap kirim, medan diulang dari awal. */
  recover() {
    this.spare = makeBuffers();
    this.busy = false;
    this.sentAt = 0;
    this.resetNext = true;
  }

  /** Worker tidak menjawab: hentikan dan mulai worker baru. */
  restart(reason) {
    this.perf.restarts++;
    this.log('error', reason + ' → worker arus dimulai ulang');
    if (this.mode === 'worker') {
      this.worker?.terminate();
      try {
        this.spawnWorker();
      } catch {
        this.useMain();
        return;
      }
    }
    this.recover();
  }

  /** Dipanggil tiap frame dari loop utama. */
  tick(real, simdt) {
    const { app } = this;
    const now = performance.now();
    if (!app.V.cfd || app.paused) {
      this.lastTick = now;
      return;
    }
    // penjaga: worker tidak menjawab > 10 dtk (jeda karena tab/HP tidur tidak dihitung)
    if (this.busy && this.sentAt && this.mode === 'worker') {
      if (this.lastTick && now - this.lastTick > 1000) this.sentAt += now - this.lastTick;
      if (now - this.sentAt > 10000) this.restart('CFD tidak merespons 10 dtk');
    }
    this.lastTick = now;
    // seberapa jauh waktu CFD mengikuti waktu simulasi hidrolik (jendela ±3 dtk)
    this.win.sim += simdt;
    this.win.t += real;
    if (this.win.t > 3) {
      this.perf.ratio = this.win.sim > 0.05 ? Math.min(1, this.win.cfd / this.win.sim) : 1;
      this.win = { sim: 0, cfd: 0, t: 0 };
    }
    this.pend = Math.min(0.12, this.pend + simdt);
    this.acc += real;
    if (this.acc > 0.45) {
      this.acc = 0;
      this.wantStats = true;
    }
    if (!this.busy && this.pend >= 0.02) {
      const d = this.pend;
      this.pend = 0;
      this.request(d);
    }
  }

  request(dt) {
    if (!this.spare || !this.send) return;
    const m = this.buildMessage(dt);
    const s = this.spare;
    for (const k of BUF_KEYS) m['b' + k] = s[k];
    this.spare = null;
    this.busy = true;
    this.sentAt = performance.now();
    this.win.cfd += dt;
    this.send(m, this.mode === 'worker' ? BUF_KEYS.map((k) => s[k].buffer) : undefined);
  }

  onResult(m) {
    if (m.t === 'error') {
      // langkah gagal di engine: buffer yang dikirim hilang → pulihkan, ulang medan
      this.perf.errors++;
      this.log('error', 'CFD: ' + m.message + (m.where ? ' (' + m.where + ')' : ''));
      this.recover();
      if (++this.errRun >= 5) {
        this.app.V.cfd = false;
        this.errRun = 0;
        this.log('error', 'CFD dimatikan otomatis setelah 5 error berturut-turut');
        this.hooks.onCfdOff?.();
      }
      return;
    }
    this.errRun = 0;
    if (this.sentAt) {
      const ms = performance.now() - this.sentAt;
      this.perf.ms = this.perf.ms ? this.perf.ms * 0.9 + ms * 0.1 : ms;
    }
    // penjaga NaN: medan rusak (mis. perangkat/float aneh) → nolkan dan ulang otomatis
    if (!allFinite(m.u) || !allFinite(m.fu) || !allFinite(m.ta) || !allFinite(m.ts) || !allFinite(m.fa) || !allFinite(m.fs)) {
      this.perf.resets++;
      this.log('error', 'Medan arus tidak stabil (NaN) → diulang otomatis');
      for (const k of ['u', 'v', 'w', 'm', 'fu', 'fv', 'fw', 'fm', 'ta', 'td', 'fa', 'fd']) m[k].fill(0);
      m.ts.fill(35);
      m.fs.fill(35);
      this.resetNext = true;
    }
    // kembalikan buffer lama sebagai cadangan untuk pesan berikutnya (tanpa alokasi)
    const old = { u: this.fu, v: this.fv, w: this.fw, m: this.favg, fu: this.ffu, fv: this.ffv, fw: this.ffw, fm: this.ffavg, ...this.sc };
    this.sc = { ta: m.ta, td: m.td, ts: m.ts, fa: m.fa, fd: m.fd, fs: m.fs };
    this.fu = m.u;
    this.fv = m.v;
    this.fw = m.w;
    this.favg = m.m;
    this.ffu = m.fu;
    this.ffv = m.fv;
    this.ffw = m.fw;
    this.ffavg = m.fm;
    if (m.sol) this.fsol = m.sol;
    if (m.solF) this.ffsol = m.solF;
    if (m.stats) this.app.flowStats = m.stats;
    this.version++;
    this.spare = old;
    this.busy = false;
    if (this.burst > 0) {
      this.burst--;
      this.request(this.burstDt || 0.1); // diagnostik: langkah beruntun tanpa menunggu frame
    }
  }

  /* ---------- sampling medan untuk jejak ---------- */
  cellOf(x, y, z) {
    const h = T3.h;
    const i = Math.floor((x - 0.5) / h) + 1;
    const j = Math.floor(y / h) + 1;
    const k = Math.floor((z - 0.5) / h) + 1;
    if (i < 1 || i > T3.nx || j < 1 || j > T3.ny || k < 1 || k > T3.nz) return -1;
    const c = i + T3.SY * j + T3.SZ * k;
    return this.fsol[c] ? -1 : c;
  }

  sample3(x, y, z, o) {
    const { h, SY, SZ } = T3;
    let gx = (x - 0.5) / h + 0.5;
    let gy = y / h + 0.5;
    let gz = (z - 0.5) / h + 0.5;
    if (gx < 0.5) gx = 0.5;
    else if (gx > T3.nx + 0.5) gx = T3.nx + 0.5;
    if (gy < 0.5) gy = 0.5;
    else if (gy > T3.ny + 0.5) gy = T3.ny + 0.5;
    if (gz < 0.5) gz = 0.5;
    else if (gz > T3.nz + 0.5) gz = T3.nz + 0.5;
    const i0 = gx | 0;
    const j0 = gy | 0;
    const k0 = gz | 0;
    const s1 = gx - i0;
    const s0 = 1 - s1;
    const t1 = gy - j0;
    const t0 = 1 - t1;
    const r1 = gz - k0;
    const r0 = 1 - r1;
    const a = i0 + SY * j0 + SZ * k0;
    const b = a + SZ;
    const tri = (F) =>
      r0 * (t0 * (s0 * F[a] + s1 * F[a + 1]) + t1 * (s0 * F[a + SY] + s1 * F[a + SY + 1])) +
      r1 * (t0 * (s0 * F[b] + s1 * F[b + 1]) + t1 * (s0 * F[b + SY] + s1 * F[b + SY + 1]));
    o[0] = tri(this.fu);
    o[1] = tri(this.fv);
    o[2] = tri(this.fw);
    return o;
  }

  /** Laju rata-rata waktu (cm/s) hasil interpolasi trilinear. */
  sampleAvg3(x, y, z) {
    const { h, SY, SZ } = T3;
    let gx = (x - 0.5) / h + 0.5;
    let gy = y / h + 0.5;
    let gz = (z - 0.5) / h + 0.5;
    if (gx < 0.5) gx = 0.5;
    else if (gx > T3.nx + 0.5) gx = T3.nx + 0.5;
    if (gy < 0.5) gy = 0.5;
    else if (gy > T3.ny + 0.5) gy = T3.ny + 0.5;
    if (gz < 0.5) gz = 0.5;
    else if (gz > T3.nz + 0.5) gz = T3.nz + 0.5;
    const i0 = gx | 0;
    const j0 = gy | 0;
    const k0 = gz | 0;
    const s1 = gx - i0;
    const s0 = 1 - s1;
    const t1 = gy - j0;
    const t0 = 1 - t1;
    const r1 = gz - k0;
    const r0 = 1 - r1;
    const a = i0 + SY * j0 + SZ * k0;
    const b = a + SZ;
    const F = this.favg;
    return (
      r0 * (t0 * (s0 * F[a] + s1 * F[a + 1]) + t1 * (s0 * F[a + SY] + s1 * F[a + SY + 1])) +
      r1 * (t0 * (s0 * F[b] + s1 * F[b + 1]) + t1 * (s0 * F[b + SY] + s1 * F[b + SY + 1]))
    );
  }

  /* ---------- filter 3D ---------- */
  cellF(x, y, z) {
    return cellIndex(F3, this.ffsol, x, y, z);
  }

  sampleF(x, y, z, o) {
    o[0] = trilinear(F3, this.ffu, x, y, z);
    o[1] = trilinear(F3, this.ffv, x, y, z);
    o[2] = trilinear(F3, this.ffw, x, y, z);
    return o;
  }

  sampleAvgF(x, y, z) {
    return trilinear(F3, this.ffavg, x, y, z);
  }

  /** Skalar tank: key 'age' | 'dye' | 'salt'. */
  scalarT(key, x, y, z) {
    return trilinear(T3, this.sc[key === 'age' ? 'ta' : key === 'dye' ? 'td' : 'ts'], x, y, z);
  }

  /** Skalar filter: key 'age' | 'dye' | 'salt'. */
  scalarF(key, x, y, z) {
    return trilinear(F3, this.sc[key === 'age' ? 'fa' : key === 'dye' ? 'fd' : 'fs'], x, y, z);
  }

  /* ---------- pewarna "air baru dari filter" ---------- */
  /** Lepas pewarna di air yang keluar dari duckbill: pulsa (detik waktu CFD) atau terus-menerus. */
  startDye(mode, seconds = 20) {
    this.dye.mode = mode;
    this.dye.until = this.cfdTime + seconds;
  }

  clearDye() {
    this.dye.mode = 'off';
    this.dye.clear = true;
  }

  /** Status pewarna untuk UI (+ kadar rata-rata di tank & filter supaya pergerakannya terbaca). */
  dyeStatus() {
    const d = this.dye;
    const fs = this.app.flowStats || {};
    const pct = (v) => (v < 0.1 ? (v * 100).toFixed(1).replace('.', ',') : Math.round(v * 100)) + '%';
    const amount = fs.dyeT > 0.0005 || fs.dyeF > 0.0005 ? ` · rata-rata tank ${pct(fs.dyeT)} · filter ${pct(fs.dyeF)}` : '';
    if (d.mode === 'cont') return 'terus-menerus' + amount;
    if (d.mode === 'pulse' && this.cfdTime < d.until) return `pulsa, sisa ${Math.ceil(d.until - this.cfdTime)} dtk` + amount;
    return (amount ? 'sudah dilepas' : 'tidak dilepas') + amount;
  }

  /* ---------- pesan ke engine ---------- */
  /** Kontrol transport skalar: salinitas dari neraca garam hidrolik, pewarna dari duckbill. */
  scalarMessage(dt) {
    const { S, P } = this.app;
    const litres = totalVolume(S, P) / 1000 - P.disp;
    const salt = S.salt / Math.max(1, litres);
    this.cfdTime += dt;
    const d = this.dye;
    let dyeIn = null; // null = air duckbill membawa pewarna yang kembali dari filter (siklus)
    if (d.mode === 'cont' || (d.mode === 'pulse' && this.cfdTime <= d.until)) dyeIn = 1;
    else if (d.mode === 'pulse') d.mode = 'off';
    const m = { salt0: salt, saltRef: salt, dyeIn, resetDye: d.clear };
    d.clear = false;
    return m;
  }

  buildMessage(dt) {
    const { S, P, V, NZL, WM } = this.app;
    const h = T3.h;
    const q = S.q;
    const jets = [];
    const vols = [];
    const Q = Math.max(0, q.r);

    /* tank: duckbill sebagai sumber momentum (kipas 3 sel), intake bawah dan mangkuk skimmer sebagai penyedot */
    if (Q > 1) {
      const d = dirOf(NZL.yaw, NZL.pitch);
      const tip = [NOZZLE[0] + d[0] * 4.2, Math.min(NOZZLE[1] + d[1] * 4.2, S.HT - 0.6), NOZZLE[2] + d[2] * 4.2];
      let px = d[2];
      let pz = -d[0];
      const pl = Math.hypot(px, pz);
      if (pl < 0.05) {
        px = 0;
        pz = 1;
      } else {
        px /= pl;
        pz /= pl;
      }
      const U = Math.sqrt((Q * (Q / 1.5)) / 3) / h;
      for (let s = -1; s <= 1; s++) {
        const e = norm3([d[0] + s * 0.34 * px, d[1], d[2] + s * 0.34 * pz]);
        jets.push([tip[0] + s * h * px, tip[1], tip[2] + s * h * pz, e[0] * U, e[1] * U, e[2] * U]);
      }
      const sinks = [];
      if (P.box) {
        for (let n = 0; n < 5; n++) sinks.push([2 + n * 1.5, S.HT - 0.5, 7.3, q.c / 5]);
      } else {
        for (let i = 0; i < P.n; i++) {
          if (S.brk[i]) continue;
          const x = siphonX(P.n, i);
          if (S.qb[i] > 0.2) sinks.push([x, P.zin + 0.8, 3.5, S.qb[i]]);
          if (S.qk[i] > 0.2) {
            const k = S.qk[i] / 3;
            const y = S.HT - 0.5;
            sinks.push([x - 1.7, y, 6.9, k], [x + 1.7, y, 6.9, k], [x, y, 8.7, k]);
          }
        }
      }
      const ok = sinks.filter((s) => this.cellOf(s[0], s[1], s[2]) >= 0);
      let tot = 0;
      for (const s of ok) tot += s[3];
      const Qv = Math.min(Q, tot);
      if (ok.length && Qv > 1 && this.cellOf(tip[0], tip[1], tip[2]) >= 0) {
        vols.push([tip[0], tip[1], tip[2], Qv, 'ret']); // air dari filter lewat duckbill
        for (const s of ok) vols.push([s[0], s[1], s[2], (-Qv * s[3]) / tot, 'in']); // intake siphon / sisir box
      }
    }
    if (V.wm && P.on) {
      const d = dirOf(WM.yaw, WM.pitch);
      const o = [WAVEMAKER.x + d[0] * 3.4, WM.y + d[1] * 3.4, WAVEMAKER.z + d[2] * 3.4];
      const Qw = WM.q / 3.6;
      const U = Math.sqrt((Qw * (Qw / 7)) / 4) / h;
      let px = d[2];
      let pz = -d[0];
      const pl = Math.hypot(px, pz) || 1;
      px /= pl;
      pz /= pl;
      const uy = Math.hypot(d[0], d[2]);
      for (let a = -0.5; a <= 0.5; a += 1)
        for (let b = -0.5; b <= 0.5; b += 1)
          jets.push([o[0] + a * h * px, Math.min(o[1] + b * h * uy, S.HT - 0.6), o[2] + a * h * pz, d[0] * U, d[1] * U, d[2] * U]);
    }

    /*
     * filter 3D (satuan cm): pancuran siphon, aliran melewati weir 2 & 4 (sumur hulu + sumber
     * dan jet jatuh selebar chamber di hilir), naik-turun muka air tiap chamber, isapan pompa, ATO.
     */
    const fz = FILTER.zMid;
    const fjets = [];
    const fljets = [];
    const fpts = [];
    const flines = [];
    const fstrips = [];
    const As = (Math.PI * P.D * P.D) / 4;
    const free = P.zd > S.H1;
    const y0 = free ? S.H1 - 0.3 : P.zd - 0.3;
    let qsP = 0; // debit siphon yang benar-benar dikirim sebagai sumber
    for (let i = 0; i < P.n; i++) {
      const vp = S.vs[i];
      const Qi = vp * As;
      if (Math.abs(Qi) < 0.5) continue;
      const x = siphonX(P.n, i);
      // pancuran pipa Ø ±2 cm → sebar ke 2×2 sel (bukan satu titik)
      for (const dx of [-0.5, 0.5]) for (const dz of [-0.5, 0.5]) fpts.push([x + dx, y0, fz + dz, Qi / 4, 'sip']);
      qsP += Qi;
      if (Qi > 0) {
        const vi = free ? Math.sqrt(vp * vp + 2 * G * (P.zd - S.H1)) : vp;
        const U = Math.min(60, Math.sqrt((Qi * vi) / 4)); // fluks momentum pada 2×2 sel
        for (const dx of [-0.5, 0.5]) for (const dz of [-0.5, 0.5]) fjets.push([x + dx, y0, fz + dz, 0, -U, 0]);
      }
    }
    const weir = (qq, Hu, Hd, crest, w) => {
      if (Math.abs(qq) <= 0.3) return 0;
      const falls = Math.min(Hu, Hd) <= crest + 0.25;
      const U = Math.min(60, Math.sqrt((Math.abs(qq) * Math.sqrt(2 * G * Math.max(0.2, Math.abs(Hu - Hd)))) / 10));
      if (qq > 0) {
        fstrips.push([w.up[0], w.up[1], -qq, w.tag + 'u']);
        flines.push([w.down, Hd - 0.3, qq, w.tag + 'd']);
        if (falls) fljets.push([w.down, Hd - 0.3, 0, -U, 0]);
      } else {
        fstrips.push([w.down - 0.5, w.down + 0.5, qq, w.tag + 'u']);
        flines.push([w.back, Hu - 0.3, -qq, w.tag + 'd']);
        if (falls) fljets.push([w.back, Hu - 0.3, 0, -U, 0]);
      }
      return qq;
    };
    const p23 = weir(q.q23, S.H2, S.H3, 22.5, { ...FILTER.weir2, tag: 'w2' });
    const p34 = weir(q.q34, S.H3, S.HP, 20, { ...FILTER.weir4, tag: 'w4' });
    const pr = Math.abs(q.r) > 0.3 ? q.r : 0;
    const pa = Math.abs(q.a + q.v) > 0.01 ? q.a + q.v : 0;
    if (pr) {
      // isapan pompa lewat grill depan ±11 cm² → sebar ke 3×3 sel
      const [ix, iy, iz] = FILTER.pump.intake;
      for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) fpts.push([ix + dx, iy + dy, iz, -pr / 9, 'pump']);
    }
    if (pa) fpts.push([FILTER.ato[0], S.HP - 0.3, FILTER.ato[2], pa, 'ato']); // air tawar ATO
    // naik-turun muka air tiap chamber = −(masuk − keluar); disusun dari jumlah yang benar-benar
    // dikirim di atas sehingga tiap komponen terhubung (ch1+2, ch3+riser, ch pompa) seimbang tepat
    const st = FILTER.strips;
    fstrips.push(
      [st.c1[0], st.c1[1], -(qsP - q.q12), 'lvl'],
      [st.c2[0], st.c2[1], -(q.q12 - p23), 'lvl'],
      [st.c3[0], st.c3[1], -(p23 - p34), 'lvl'],
      [st.pump[0], st.pump[1], -(p34 - pr + pa), 'lvl'],
    );

    const m = {
      t: 'step',
      dt,
      HT: S.HT,
      sand: V.sand,
      rock: V.rock,
      box: P.box,
      jets,
      vols,
      filter: { L: [S.H1, S.H2, S.H3, S.HP], clog: P.clog, jets: fjets, ljets: fljets, pts: fpts, lines: flines, strips: fstrips },
      wantStats: this.wantStats,
      reset: this.resetNext,
      scal: this.scalarMessage(dt),
    };
    this.wantStats = false;
    this.resetNext = false;
    return m;
  }
}
