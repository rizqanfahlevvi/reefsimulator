/**
 * Mesin arus (dijalankan di Web Worker): tank 3D + filter 2D.
 *
 * Tank 3D — Navier–Stokes tak-termampatkan pada kisi MAC (staggered):
 *   kecepatan disimpan di muka sel, tekanan di pusat sel, sehingga divergensi diskret
 *   setelah proyeksi = nol (hingga toleransi solver) dan tidak ada mode checkerboard.
 *   Adveksi semi-Lagrangian MacCormack dengan limiter min/max, viskositas eddy
 *   model panjang-campur, tutup kaku (rigid lid) di permukaan, slip parsial di dinding.
 *   Tekanan diselesaikan dengan PCG + MIC(0) (lihat poisson.js).
 *
 * Filter 2D — kisi MAC 98×60 pada bidang panjang–tinggi (dirata-rata selebar 10 cm),
 *   kapas dan media bio sebagai hambatan berpori (Darcy, implisit), sumber/sumur
 *   volume untuk naik-turun permukaan tiap chamber.
 *
 * Hasil arus bersifat kualitatif: untuk membandingkan arah nozzle/wavemaker, bukan angka mutlak.
 */
import { T3, F2 } from './grid.js';
import { PoissonSolver } from './poisson.js';

const VMAX = 150; // batas kecepatan (cm/s) untuk stabilitas

export function createFlowEngine(post) {
  let ROCKS = [];

  /* ======================= tank 3D (MAC) ======================= */
  const { nx, ny, nz, h, NX, NY, NZ, SY, SZ, N } = T3;
  const STR = [1, SY, SZ];
  const F = [new Float32Array(N), new Float32Array(N), new Float32Array(N)]; // u, v, w di muka sel
  const F0 = [new Float32Array(N), new Float32Array(N), new Float32Array(N)];
  const fwd = new Float32Array(N);
  const bwd = new Float32Array(N);
  const flo = new Float32Array(N);
  const fhi = new Float32Array(N);
  const tmp = new Float32Array(N);
  const phi = new Float64Array(N);
  const rhs = new Float64Array(N);
  const spd = new Float32Array(N);
  const avg = new Float32Array(N);
  const base = new Uint8Array(N);
  const sol = new Uint8Array(N).fill(1);
  const open = [new Uint8Array(N), new Uint8Array(N), new Uint8Array(N)];
  let faces = [new Int32Array(0), new Int32Array(0), new Int32Array(0)];
  let fluidCells = new Int32Array(0);
  const ci = new Int16Array(N);
  const cj = new Int16Array(N);
  const ck = new Int16Array(N);
  for (let k = 0; k < NZ; k++)
    for (let j = 0; j < NY; j++)
      for (let i = 0; i < NX; i++) {
        const c = i + SY * j + SZ * k;
        ci[c] = i;
        cj[c] = j;
        ck[c] = k;
      }
  const solver3 = new PoissonSolver(N, STR);
  const cfg = { sand: true, rock: true, box: false };
  let jT = 1;
  let lastJ = -1;
  let cfgKey = '';
  let maskVer = 0;

  function cellOf(x, y, z) {
    const i = Math.floor((x - 0.5) / h) + 1;
    const j = Math.floor(y / h) + 1;
    const k = Math.floor((z - 0.5) / h) + 1;
    if (i < 1 || i > nx || j < 1 || j > ny || k < 1 || k > nz) return -1;
    const c = i + SY * j + SZ * k;
    return sol[c] ? -1 : c;
  }

  /** Masker statis: pasir, batu (ellipsoid), overflow box. */
  function rebuildBase() {
    for (let k = 0; k < NZ; k++)
      for (let j = 0; j < NY; j++)
        for (let i = 0; i < NX; i++) {
          const c = i + SY * j + SZ * k;
          let s = 0;
          if (i < 1 || i > nx || j < 1 || j > ny || k < 1 || k > nz) s = 1;
          else {
            const x = 0.5 + (i - 0.5) * h;
            const y = (j - 0.5) * h;
            const z = 0.5 + (k - 0.5) * h;
            if (cfg.sand && y < 1.6) s = 1;
            else if (cfg.box && x > 1 && x < 9 && z < 6.5 && y > 16) s = 1;
            else if (cfg.rock) {
              for (let r = 0; r < ROCKS.length; r++) {
                const R = ROCKS[r];
                const dx = (x - R[0]) / R[3];
                const dy = (y - R[1]) / R[4];
                const dz = (z - R[2]) / R[5];
                if (dx * dx + dy * dy + dz * dz < 0.96) {
                  s = 1;
                  break;
                }
              }
            }
          }
          base[c] = s;
        }
    lastJ = -1;
  }

  /** Tutup kaku pada level air: sel di atas baris jT dianggap padat. */
  function setLid(HT) {
    const jt = Math.max(1, Math.min(ny, Math.ceil(HT / h + 0.5) - 1));
    if (jt === lastJ) return;
    lastJ = jt;
    jT = jt;
    maskVer++;
    let nf = 0;
    for (let c = 0; c < N; c++) {
      const s = base[c] || cj[c] > jt ? 1 : 0;
      sol[c] = s;
      if (s) avg[c] = 0;
      else nf++;
    }
    fluidCells = new Int32Array(nf);
    nf = 0;
    for (let c = 0; c < N; c++) if (!sol[c]) fluidCells[nf++] = c;
    for (let a = 0; a < 3; a++) {
      const sa = STR[a];
      const o = open[a];
      const Fa = F[a];
      let cnt = 0;
      for (let c = SZ; c < N - SZ; c++) {
        const isOpen = !sol[c] && !sol[c - sa] ? 1 : 0;
        o[c] = isOpen;
        if (isOpen) cnt++;
        else Fa[c] = 0;
      }
      const list = new Int32Array(cnt);
      cnt = 0;
      for (let c = SZ; c < N - SZ; c++) if (o[c]) list[cnt++] = c;
      faces[a] = list;
    }
    solver3.setMask(sol);
  }

  function applyJets(jets) {
    for (let n = 0; n < jets.length; n++) {
      const J = jets[n];
      const c = cellOf(J[0], J[1], J[2]);
      if (c < 0) continue;
      for (let a = 0; a < 3; a++) {
        const sa = STR[a];
        const val = J[3 + a];
        if (open[a][c]) F[a][c] = val;
        if (open[a][c + sa]) F[a][c + sa] = val;
      }
    }
  }

  // kecepatan di posisi muka (komponen sendiri + rata-rata 4 muka tetangga komponen lain)
  let vx = 0;
  let vy = 0;
  let vz = 0;
  function faceVel(a, c) {
    const U = F0[0];
    const V = F0[1];
    const W = F0[2];
    if (a === 0) {
      vx = U[c];
      vy = 0.25 * (V[c] + V[c + SY] + V[c - 1] + V[c - 1 + SY]);
      vz = 0.25 * (W[c] + W[c + SZ] + W[c - 1] + W[c - 1 + SZ]);
    } else if (a === 1) {
      vx = 0.25 * (U[c] + U[c + 1] + U[c - SY] + U[c - SY + 1]);
      vy = V[c];
      vz = 0.25 * (W[c] + W[c + SZ] + W[c - SY] + W[c - SY + SZ]);
    } else {
      vx = 0.25 * (U[c] + U[c + 1] + U[c - SZ] + U[c - SZ + 1]);
      vy = 0.25 * (V[c] + V[c + SY] + V[c - SZ] + V[c - SZ + SY]);
      vz = W[c];
    }
  }

  const XM = NX - 1.0001;
  const YM = NY - 1.0001;
  const ZM = NZ - 1.0001;
  /** Semi-Lagrangian satu arah untuk komponen a: dst = src(x − d·vel). Opsional simpan min/max. */
  function advect(a, src, dst, d, mm) {
    const list = faces[a];
    for (let m = 0; m < list.length; m++) {
      const c = list[m];
      faceVel(a, c);
      let x = ci[c] - d * vx;
      let y = cj[c] - d * vy;
      let z = ck[c] - d * vz;
      if (x < 0) x = 0;
      else if (x > XM) x = XM;
      if (y < 0) y = 0;
      else if (y > YM) y = YM;
      if (z < 0) z = 0;
      else if (z > ZM) z = ZM;
      const i0 = x | 0;
      const j0 = y | 0;
      const k0 = z | 0;
      const s1 = x - i0;
      const s0 = 1 - s1;
      const t1 = y - j0;
      const t0 = 1 - t1;
      const r1 = z - k0;
      const r0 = 1 - r1;
      const q = i0 + SY * j0 + SZ * k0;
      const a0 = src[q];
      const a1 = src[q + 1];
      const a2 = src[q + SY];
      const a3 = src[q + SY + 1];
      const b0 = src[q + SZ];
      const b1 = src[q + SZ + 1];
      const b2 = src[q + SZ + SY];
      const b3 = src[q + SZ + SY + 1];
      dst[c] =
        r0 * (t0 * (s0 * a0 + s1 * a1) + t1 * (s0 * a2 + s1 * a3)) +
        r1 * (t0 * (s0 * b0 + s1 * b1) + t1 * (s0 * b2 + s1 * b3));
      if (mm) {
        flo[c] = Math.min(a0, a1, a2, a3, b0, b1, b2, b3);
        fhi[c] = Math.max(a0, a1, a2, a3, b0, b1, b2, b3);
      }
    }
  }

  function step3(dt, jets, vols) {
    applyJets(jets);
    for (let a = 0; a < 3; a++) F0[a].set(F[a]);
    const d = dt / h;

    // 1) adveksi MacCormack per komponen
    for (let a = 0; a < 3; a++) {
      const list = faces[a];
      const Fa = F[a];
      const Fs = F0[a];
      advect(a, Fs, fwd, d, true);
      advect(a, fwd, bwd, -d, false);
      for (let m = 0; m < list.length; m++) {
        const c = list[m];
        let val = fwd[c] + 0.5 * (Fs[c] - bwd[c]);
        if (val < flo[c] || val > fhi[c]) val = fwd[c];
        Fa[c] = val;
      }
    }

    // 2) kecepatan pusat sel (untuk viskositas eddy)
    const U = F[0];
    const V = F[1];
    const W = F[2];
    for (let m = 0; m < fluidCells.length; m++) {
      const c = fluidCells[m];
      const uc = 0.5 * (U[c] + U[c + 1]);
      const vc = 0.5 * (V[c] + V[c + SY]);
      const wc = 0.5 * (W[c] + W[c + SZ]);
      spd[c] = Math.sqrt(uc * uc + vc * vc + wc * wc);
    }

    // 3) viskositas eddy eksplisit (panjang-campur), slip parsial di dinding, free-slip di tutup
    const kd = (0.04 * dt) / h;
    for (let a = 0; a < 3; a++) {
      const sa = STR[a];
      const list = faces[a];
      const Fa = F[a];
      const oa = open[a];
      tmp.set(Fa);
      for (let m = 0; m < list.length; m++) {
        const c = list[m];
        const own = tmp[c];
        let coef = kd * 0.5 * (spd[c] + spd[c - sa]) + 0.004 * dt;
        if (coef > 0.15) coef = 0.15;
        let sum = 0;
        for (let t = 0; t < 3; t++) {
          const st = STR[t];
          for (let sg = -1; sg <= 1; sg += 2) {
            const n = c + sg * st;
            if (oa[n]) sum += tmp[n];
            else if (t === a) sum += 0; // komponen normal di dinding = 0
            else if (t === 1 && sg > 0 && cj[c] === jT) sum += own; // free-slip di permukaan
            else sum += 0.5 * own;
          }
        }
        Fa[c] = own + coef * (sum - 6 * own);
      }
    }

    applyJets(jets);

    // 4) proyeksi: A·φ = h²(s − ∇·u*)
    for (let m = 0; m < fluidCells.length; m++) {
      const c = fluidCells[m];
      rhs[c] = -h * (U[c + 1] - U[c] + V[c + SY] - V[c] + W[c + SZ] - W[c]);
    }
    for (let n = 0; n < vols.length; n++) {
      const c = cellOf(vols[n][0], vols[n][1], vols[n][2]);
      if (c >= 0) rhs[c] += vols[n][3] / h;
    }
    solver3.solve(rhs, phi, 60, 1e-4);
    const ih = 1 / h;
    for (let a = 0; a < 3; a++) {
      const sa = STR[a];
      const list = faces[a];
      const Fa = F[a];
      for (let m = 0; m < list.length; m++) {
        const c = list[m];
        let val = Fa[c] - ih * (phi[c] - phi[c - sa]);
        if (val > VMAX) val = VMAX;
        else if (val < -VMAX) val = -VMAX;
        Fa[c] = val;
      }
    }

    // 5) rata-rata waktu laju arus (τ = 8 dtk) untuk statistik zona mati
    const em = 1 - Math.exp(-dt / 8);
    for (let m = 0; m < fluidCells.length; m++) {
      const c = fluidCells[m];
      const uc = 0.5 * (U[c] + U[c + 1]);
      const vc = 0.5 * (V[c] + V[c + SY]);
      const wc = 0.5 * (W[c] + W[c + SZ]);
      const s = Math.min(VMAX, Math.sqrt(uc * uc + vc * vc + wc * wc));
      avg[c] += (s - avg[c]) * em;
    }
  }

  /** Divergensi maksimum (cm/s per cm) setelah proyeksi — untuk uji. */
  function maxDivergence(vols) {
    const U = F[0];
    const V = F[1];
    const W = F[2];
    const src = new Float64Array(N);
    for (let n = 0; n < (vols || []).length; n++) {
      const c = cellOf(vols[n][0], vols[n][1], vols[n][2]);
      if (c >= 0) src[c] += vols[n][3] / (h * h * h);
    }
    let mx = 0;
    for (let m = 0; m < fluidCells.length; m++) {
      const c = fluidCells[m];
      const dv = (U[c + 1] - U[c] + V[c + SY] - V[c] + W[c + SZ] - W[c]) / h - src[c];
      mx = Math.max(mx, Math.abs(dv));
    }
    return mx;
  }

  function stats3() {
    let n = 0;
    let dead = 0;
    let weak = 0;
    let sum = 0;
    let nb = 0;
    let sb = 0;
    const jb = cfg.sand ? 2 : 1;
    for (let m = 0; m < fluidCells.length; m++) {
      const c = fluidCells[m];
      const a = avg[c];
      n++;
      sum += a;
      if (a < 1) dead++;
      else if (a < 3) weak++;
      if (cj[c] === jb) {
        nb++;
        sb += a;
      }
    }
    n = Math.max(1, n);
    return {
      dead: (dead / n) * 100,
      weak: (weak / n) * 100,
      mean: sum / n,
      bottom: nb ? sb / nb : 0,
      it3: solver3.lastIterations,
      it2: solver2.lastIterations,
    };
  }

  /* ======================= filter 2D (MAC) ======================= */
  const { mx, my, h: g2, MX, N: N2, W: W2 } = F2;
  const U2 = new Float32Array(N2);
  const V2 = new Float32Array(N2);
  const U20 = new Float32Array(N2);
  const V20 = new Float32Array(N2);
  const p2 = new Float64Array(N2);
  const d2 = new Float64Array(N2);
  const dr = new Float32Array(N2);
  const a2 = new Float32Array(N2);
  const b2 = new Float32Array(N2);
  const s2 = new Uint8Array(N2).fill(1);
  const top2 = new Int16Array(MX);
  const solver2 = new PoissonSolver(N2, [1, MX]);
  let key2 = '';
  let mask2Ver = 0;
  let clog2 = -1;

  // sekat: kolom i=21 (sekat 1, celah bawah 3 cm), 42 (sekat 2 puncak 22,5), 73 (sekat 3), 78 (sekat 4 puncak 20)
  const isBaffle = (i, j) => (i === 21 && j >= 7) || (i === 42 && j <= 45) || (i === 73 && j >= 7) || (i === 78 && j <= 40);

  function mask2(L, clog) {
    const k = Math.round(L[0] * 2) + '|' + Math.round(L[1] * 2) + '|' + Math.round(L[2] * 2) + '|' + Math.round(L[3] * 2);
    if (k !== key2) {
      key2 = k;
      mask2Ver++;
      const m12 = Math.min(L[0], L[1]);
      const m23 = Math.min(L[1], L[2]);
      const m3p = Math.min(L[2], L[3]);
      for (let i = 0; i < MX; i++) {
        let lev = 0;
        if (i >= 1 && i <= mx) {
          if (i <= 20) lev = L[0];
          else if (i === 21) lev = m12;
          else if (i <= 41) lev = L[1];
          else if (i === 42) lev = m23 > 22.75 ? m23 : 0;
          else if (i <= 77) lev = L[2];
          else if (i === 78) lev = m3p > 20.25 ? m3p : 0;
          else lev = L[3];
        }
        let tp = 0;
        for (let j = 0; j < my + 2; j++) {
          const c = i + MX * j;
          let s = 1;
          if (i >= 1 && i <= mx && j >= 1 && j <= my && !isBaffle(i, j) && (j - 0.5) * g2 < lev) s = 0;
          s2[c] = s;
          if (!s) tp = j;
        }
        top2[i] = tp;
      }
      solver2.setMask(s2);
    }
    if (clog !== clog2) {
      clog2 = clog;
      dr.fill(0);
      for (let j = 1; j <= my; j++) {
        const y = (j - 0.5) * g2;
        for (let i = 1; i <= mx; i++) {
          const c = i + MX * j;
          if (i <= 20 && y > 12 && y < 19) dr[c] = 3 + 60 * clog * clog; // kapas
          else if (i >= 23 && i <= 40 && y > 0.3 && y < 22) dr[c] = 1.2; // badan skimmer
          else if (i >= 44 && i <= 71 && y > 0.8 && y < 12) dr[c] = 2.5; // media bio
        }
      }
    }
  }

  function cell2(x, y) {
    let i = Math.floor((x - 0.5) / g2) + 1;
    let j = Math.floor(y / g2) + 1;
    if (i < 1) i = 1;
    if (i > mx) i = mx;
    if (j > my) j = my;
    for (let n = 0; n < 8 && j >= 1; n++, j--) {
      const c = i + MX * j;
      if (!s2[c]) return c;
    }
    return -1;
  }

  function walls2() {
    for (let j = 1; j <= my + 1; j++) {
      let c = 1 + MX * j;
      for (let i = 1; i <= mx + 1; i++, c++) {
        if (s2[c] || s2[c - 1]) U2[c] = 0;
        if (s2[c] || s2[c - MX]) V2[c] = 0;
      }
    }
  }

  function force2(jets) {
    for (let n = 0; n < jets.length; n++) {
      const J = jets[n];
      const c = cell2(J[0], J[1]);
      if (c < 0) continue;
      if (!s2[c - MX]) V2[c] = J[3];
    }
  }

  function bil(Fd, fx, fy) {
    if (fx < 0.5) fx = 0.5;
    else if (fx > mx + 1) fx = mx + 1;
    if (fy < 0.5) fy = 0.5;
    else if (fy > my + 1) fy = my + 1;
    const i0 = fx | 0;
    const j0 = fy | 0;
    const s1 = fx - i0;
    const s0 = 1 - s1;
    const t1 = fy - j0;
    const t0 = 1 - t1;
    const q = i0 + MX * j0;
    return t0 * (s0 * Fd[q] + s1 * Fd[q + 1]) + t1 * (s0 * Fd[q + MX] + s1 * Fd[q + MX + 1]);
  }

  function step2(dt, jets, vols) {
    walls2();
    force2(jets);
    U20.set(U2);
    V20.set(V2);
    const d = dt / g2;
    for (let j = 1; j <= my; j++) {
      let c = 1 + MX * j;
      for (let i = 1; i <= mx; i++, c++) {
        if (!s2[c] && !s2[c - 1]) {
          const uu = U20[c];
          const vv = 0.25 * (V20[c] + V20[c + MX] + V20[c - 1] + V20[c - 1 + MX]);
          U2[c] = bil(U20, i - d * uu, j - d * vv) / (1 + 0.5 * (dr[c] + dr[c - 1]) * dt);
        }
        if (!s2[c] && !s2[c - MX]) {
          const vv = V20[c];
          const uu = 0.25 * (U20[c] + U20[c + 1] + U20[c - MX] + U20[c - MX + 1]);
          V2[c] = bil(V20, i - d * uu, j - d * vv) / (1 + 0.5 * (dr[c] + dr[c - MX]) * dt);
        }
      }
    }
    walls2();
    force2(jets);
    // ruas kanan: A·p = h²(s − ∇·u*)
    for (let j = 1; j <= my; j++) {
      let c = 1 + MX * j;
      for (let i = 1; i <= mx; i++, c++) d2[c] = s2[c] ? 0 : -g2 * (U2[c + 1] - U2[c] + V2[c + MX] - V2[c]);
    }
    for (let n = 0; n < vols.length; n++) {
      const Vs = vols[n];
      if (Vs[0] === 's') {
        let cnt = 0;
        for (let i = Vs[1]; i <= Vs[2]; i++) if (top2[i] > 0) cnt++;
        if (cnt) for (let i = Vs[1]; i <= Vs[2]; i++) if (top2[i] > 0) d2[i + MX * top2[i]] += Vs[3] / W2 / cnt;
      } else {
        const c = cell2(Vs[1], Vs[2]);
        if (c >= 0) d2[c] += Vs[3] / W2;
      }
    }
    solver2.solve(d2, p2, 80, 1e-4);
    const ig = 1 / g2;
    for (let j = 1; j <= my; j++) {
      let c = 1 + MX * j;
      for (let i = 1; i <= mx; i++, c++) {
        if (s2[c]) continue;
        if (!s2[c - 1]) U2[c] -= ig * (p2[c] - p2[c - 1]);
        if (!s2[c - MX]) V2[c] -= ig * (p2[c] - p2[c - MX]);
      }
    }
    for (let j = 1; j <= my; j++) {
      let c = 1 + MX * j;
      for (let i = 1; i <= mx; i++, c++) {
        if (s2[c]) {
          a2[c] = 0;
          b2[c] = 0;
          continue;
        }
        let uu = 0.5 * (U2[c] + U2[c + 1]);
        let vv = 0.5 * (V2[c] + V2[c + MX]);
        if (uu > VMAX) uu = VMAX;
        else if (uu < -VMAX) uu = -VMAX;
        if (vv > VMAX) vv = VMAX;
        else if (vv < -VMAX) vv = -VMAX;
        a2[c] = uu;
        b2[c] = vv;
      }
    }
  }

  /* ======================= antarmuka pesan ======================= */
  let sent = -1;
  let sent2 = -1;
  function handle(m) {
    if (m.t === 'init') {
      ROCKS = m.rocks;
      cfgKey = '';
      return;
    }
    if (m.t !== 'step') return;
    if (m.reset) {
      for (let a = 0; a < 3; a++) F[a].fill(0);
      phi.fill(0);
      avg.fill(0);
      U2.fill(0);
      V2.fill(0);
      p2.fill(0);
    }
    const key = (m.sand ? '1' : '0') + (m.rock ? '1' : '0') + (m.box ? '1' : '0');
    if (key !== cfgKey) {
      cfgKey = key;
      cfg.sand = m.sand;
      cfg.rock = m.rock;
      cfg.box = m.box;
      rebuildBase();
    }
    setLid(m.HT);
    mask2(m.L, m.clog);
    if (m.dt > 0) {
      step3(m.dt, m.jets, m.vols);
      step2(m.dt, m.jets2, m.vols2);
    }
    // keluaran: kecepatan pusat sel (tank) dan filter, dalam buffer yang dipinjam dari klien
    const o = { t: 'f', u: m.bu, v: m.bv, w: m.bw, a: m.ba, b: m.bb, m: m.bm };
    const U = F[0];
    const V = F[1];
    const W = F[2];
    o.u.fill(0);
    o.v.fill(0);
    o.w.fill(0);
    o.m.fill(0);
    for (let n = 0; n < fluidCells.length; n++) {
      const c = fluidCells[n];
      o.u[c] = 0.5 * (U[c] + U[c + 1]);
      o.v[c] = 0.5 * (V[c] + V[c + SY]);
      o.w[c] = 0.5 * (W[c] + W[c + SZ]);
      o.m[c] = avg[c]; // laju rata-rata waktu (τ = 8 dtk) untuk peta zona mati
    }
    o.a.set(a2);
    o.b.set(b2);
    if (maskVer !== sent) {
      sent = maskVer;
      o.sol = sol.slice();
    }
    if (mask2Ver !== sent2) {
      sent2 = mask2Ver;
      o.sol2 = s2.slice();
    }
    if (m.wantStats) o.stats = stats3();
    post(o, [o.u.buffer, o.v.buffer, o.w.buffer, o.a.buffer, o.b.buffer, o.m.buffer]);
  }

  /** Akses internal untuk uji otomatis. */
  handle.debug = {
    maxDivergence,
    stats: stats3,
    solver3,
    solver2,
    face: F,
    cellOf,
    avg,
    get jT() {
      return jT;
    },
    max2DDivergence(vols) {
      const src = new Float64Array(N2);
      for (let n = 0; n < (vols || []).length; n++) {
        const Vs = vols[n];
        if (Vs[0] === 's') {
          let cnt = 0;
          for (let i = Vs[1]; i <= Vs[2]; i++) if (top2[i] > 0) cnt++;
          if (cnt) for (let i = Vs[1]; i <= Vs[2]; i++) if (top2[i] > 0) src[i + MX * top2[i]] += Vs[3] / W2 / cnt;
        } else {
          const c = cell2(Vs[1], Vs[2]);
          if (c >= 0) src[c] += Vs[3] / W2;
        }
      }
      let mxd = 0;
      for (let j = 1; j <= my; j++)
        for (let i = 1; i <= mx; i++) {
          const c = i + MX * j;
          if (s2[c]) continue;
          mxd = Math.max(mxd, Math.abs(g2 * (U2[c + 1] - U2[c] + V2[c + MX] - V2[c]) - src[c]));
        }
      return mxd / (g2 * g2);
    },
  };
  return handle;
}
