/**
 * Solver Navier–Stokes tak-termampatkan generik pada kisi MAC 3D (staggered),
 * dipakai bersama oleh tank dan back filter.
 *
 * - Kecepatan di muka sel (u: muka −x, v: muka −y, w: muka −z), tekanan di pusat sel.
 * - Adveksi semi-Lagrangian MacCormack dengan limiter min/max.
 * - Viskositas eddy model panjang-campur; slip parsial di dinding, free-slip di permukaan.
 * - Hambatan berpori (Darcy) implisit per sel (kapas, media bio).
 * - Permukaan air sebagai tutup kaku per kolom (level bisa berbeda tiap chamber).
 * - Proyeksi tekanan A·φ = h²(s − ∇·u*) diselesaikan PCG + MIC(0): divergensi diskret ≈ sumber.
 */
import { PoissonSolver } from './poisson.js';

export const VMAX = 150; // batas kecepatan (cm/s) untuk stabilitas

export class Mac3D {
  /** @param {{nx,ny,nz,h,NX,NY,NZ,SY,SZ,N,x0,y0,z0}} G */
  constructor(G) {
    this.G = G;
    const { N, NX, NY, NZ, SY, SZ } = G;
    this.STR = [1, SY, SZ];
    this.F = [new Float32Array(N), new Float32Array(N), new Float32Array(N)];
    this.F0 = [new Float32Array(N), new Float32Array(N), new Float32Array(N)];
    this.fwd = new Float32Array(N);
    this.bwd = new Float32Array(N);
    this.flo = new Float32Array(N);
    this.fhi = new Float32Array(N);
    this.tmp = new Float32Array(N);
    this.phi = new Float64Array(N);
    this.rhs = new Float64Array(N);
    this.src = new Float64Array(N);
    this.spd = new Float32Array(N);
    this.avg = new Float32Array(N);
    this.drag = new Float32Array(N);
    this.hasDrag = false;
    this.base = new Uint8Array(N).fill(1);
    this.sol = new Uint8Array(N).fill(1);
    this.isTop = new Uint8Array(N);
    this.open = [new Uint8Array(N), new Uint8Array(N), new Uint8Array(N)];
    this.faces = [new Int32Array(0), new Int32Array(0), new Int32Array(0)];
    this.fluidCells = new Int32Array(0);
    this.top = new Int16Array(NX * NZ).fill(-1);
    this.ci = new Int16Array(N);
    this.cj = new Int16Array(N);
    this.ck = new Int16Array(N);
    for (let k = 0; k < NZ; k++)
      for (let j = 0; j < NY; j++)
        for (let i = 0; i < NX; i++) {
          const c = i + SY * j + SZ * k;
          this.ci[c] = i;
          this.cj[c] = j;
          this.ck[c] = k;
        }
    this.solver = new PoissonSolver(N, this.STR);
    this.maskVer = 0;
    this.jets = []; // [c, u, v, w]
  }

  /** Koordinat pusat sel (i, j, k). */
  xc(i) {
    return this.G.x0 + (i - 0.5) * this.G.h;
  }
  yc(j) {
    return this.G.y0 + (j - 0.5) * this.G.h;
  }
  zc(k) {
    return this.G.z0 + (k - 0.5) * this.G.h;
  }

  cellOf(x, y, z) {
    const G = this.G;
    const i = Math.floor((x - G.x0) / G.h) + 1;
    const j = Math.floor((y - G.y0) / G.h) + 1;
    const k = Math.floor((z - G.z0) / G.h) + 1;
    if (i < 1 || i > G.nx || j < 1 || j > G.ny || k < 1 || k > G.nz) return -1;
    const c = i + G.SY * j + G.SZ * k;
    return this.sol[c] ? -1 : c;
  }

  /** Masker statis. solidFn(x, y, z, i, j, k) → true bila padat. Sel hantu selalu padat. */
  setBase(solidFn) {
    const { nx, ny, nz, NX, NY, NZ, SY, SZ } = this.G;
    for (let k = 0; k < NZ; k++)
      for (let j = 0; j < NY; j++)
        for (let i = 0; i < NX; i++) {
          const c = i + SY * j + SZ * k;
          const ghost = i < 1 || i > nx || j < 1 || j > ny || k < 1 || k > nz;
          this.base[c] = ghost || solidFn(this.xc(i), this.yc(j), this.zc(k), i, j, k) ? 1 : 0;
        }
    this.top.fill(-1); // paksa bangun ulang masker
  }

  /** Hambatan berpori per sel (1/s). dragFn(x, y, z) → koefisien (0 = tanpa hambatan). */
  setDrag(dragFn) {
    const { N } = this.G;
    let any = false;
    for (let c = 0; c < N; c++) {
      const d = dragFn(this.xc(this.ci[c]), this.yc(this.cj[c]), this.zc(this.ck[c]));
      this.drag[c] = d;
      if (d > 0) any = true;
    }
    this.hasDrag = any;
  }

  /**
   * Tutup kaku pada permukaan air. levelFn(i, k) → level (cm) kolom tersebut.
   * Sel dengan pusat di atas level dianggap padat. Masker hanya dibangun ulang bila berubah.
   */
  setLevels(levelFn) {
    const { nx, ny, nz, NX, h, y0, N, SY, SZ } = this.G;
    let changed = false;
    for (let k = 1; k <= nz; k++)
      for (let i = 1; i <= nx; i++) {
        const L = levelFn(i, k);
        const jt = Math.max(0, Math.min(ny, Math.ceil((L - y0) / h + 0.5) - 1));
        const q = i + NX * k;
        if (this.top[q] !== jt) {
          this.top[q] = jt;
          changed = true;
        }
      }
    if (!changed) return false;
    this.maskVer++;
    const { sol, base, avg, cj, ci, ck, isTop } = this;
    let nf = 0;
    for (let c = 0; c < N; c++) {
      const jt = this.top[ci[c] + NX * ck[c]];
      const s = base[c] || cj[c] > jt ? 1 : 0;
      sol[c] = s;
      if (s) avg[c] = 0;
      else nf++;
    }
    const fluid = new Int32Array(nf);
    nf = 0;
    for (let c = 0; c < N; c++) {
      isTop[c] = 0;
      if (sol[c]) continue;
      fluid[nf++] = c;
      // sel teratas kolom: di atasnya udara (bukan penghalang) → free-slip
      if (!base[c + SY] && cj[c] === this.top[ci[c] + NX * ck[c]]) isTop[c] = 1;
    }
    this.fluidCells = fluid;
    for (let a = 0; a < 3; a++) {
      const sa = this.STR[a];
      const o = this.open[a];
      const Fa = this.F[a];
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
      this.faces[a] = list;
    }
    this.solver.setMask(sol);
    return true;
  }

  reset() {
    for (let a = 0; a < 3; a++) this.F[a].fill(0);
    this.phi.fill(0);
    this.avg.fill(0);
  }

  /* ---------- masukan per langkah: jet (momentum) dan sumber volume ---------- */
  beginInputs() {
    this.jets.length = 0;
    this.src.fill(0);
  }

  jetAt(x, y, z, u, v, w) {
    const c = this.cellOf(x, y, z);
    if (c >= 0) this.jets.push([c, u, v, w]);
  }

  /** Jet di satu baris sel melintang seluruh lebar (sumbu z), mis. terjunan di weir. */
  jetLine(x, y, u, v, w) {
    const { nz } = this.G;
    for (let k = 1; k <= nz; k++) this.jetAt(x, y, this.zc(k), u, v, w);
  }

  /** Sumber volume titik (cm³/s; negatif = isapan). Mengembalikan false bila jatuh di sel padat. */
  srcAt(x, y, z, Q) {
    const c = this.cellOf(x, y, z);
    if (c < 0) return false;
    this.src[c] += Q;
    return true;
  }

  /** Sumber volume dibagi rata melintang seluruh lebar (sumbu z). */
  srcLine(x, y, Q) {
    const { nz } = this.G;
    const cells = [];
    for (let k = 1; k <= nz; k++) {
      const c = this.cellOf(x, y, this.zc(k));
      if (c >= 0) cells.push(c);
    }
    for (const c of cells) this.src[c] += Q / cells.length;
  }

  /** Sumber volume dibagi rata ke sel permukaan dengan x ∈ [x0, x1] (naik/turunnya muka air). */
  srcSurface(x0, x1, Q) {
    const { nx, nz, NX, SY, SZ } = this.G;
    const cells = [];
    for (let i = 1; i <= nx; i++) {
      const x = this.xc(i);
      if (x < x0 || x > x1) continue;
      for (let k = 1; k <= nz; k++) {
        const jt = this.top[i + NX * k];
        if (jt < 1) continue;
        const c = i + SY * jt + SZ * k;
        if (!this.sol[c]) cells.push(c);
      }
    }
    for (const c of cells) this.src[c] += Q / cells.length;
  }

  applyJets() {
    const { F, open, STR } = this;
    for (const [c, u, v, w] of this.jets) {
      const vel = [u, v, w];
      for (let a = 0; a < 3; a++) {
        if (open[a][c]) F[a][c] = vel[a];
        if (open[a][c + STR[a]]) F[a][c + STR[a]] = vel[a];
      }
    }
  }

  /** Semi-Lagrangian satu arah untuk komponen a: dst = src(x − d·vel). */
  advect(a, src, dst, d, mm) {
    const { SY, SZ, NX, NY, NZ } = this.G;
    const [U, V, W] = this.F0;
    const { ci, cj, ck, flo, fhi } = this;
    const list = this.faces[a];
    const XM = NX - 1.0001;
    const YM = NY - 1.0001;
    const ZM = NZ - 1.0001;
    for (let m = 0; m < list.length; m++) {
      const c = list[m];
      let vx;
      let vy;
      let vz;
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

  step(dt) {
    const { h, SY, SZ } = this.G;
    const { F, F0, STR, fwd, bwd, flo, fhi, tmp, spd, isTop, drag } = this;
    this.applyJets();
    for (let a = 0; a < 3; a++) F0[a].set(F[a]);
    const d = dt / h;

    // 1) adveksi MacCormack per komponen (+ hambatan berpori implisit)
    for (let a = 0; a < 3; a++) {
      const sa = STR[a];
      const list = this.faces[a];
      const Fa = F[a];
      const Fs = F0[a];
      this.advect(a, Fs, fwd, d, true);
      this.advect(a, fwd, bwd, -d, false);
      for (let m = 0; m < list.length; m++) {
        const c = list[m];
        let val = fwd[c] + 0.5 * (Fs[c] - bwd[c]);
        if (val < flo[c] || val > fhi[c]) val = fwd[c];
        if (this.hasDrag) val /= 1 + 0.5 * (drag[c] + drag[c - sa]) * dt;
        Fa[c] = val;
      }
    }

    // 2) laju pusat sel (untuk viskositas eddy)
    const [U, V, W] = F;
    const fluid = this.fluidCells;
    for (let m = 0; m < fluid.length; m++) {
      const c = fluid[m];
      const uc = 0.5 * (U[c] + U[c + 1]);
      const vc = 0.5 * (V[c] + V[c + SY]);
      const wc = 0.5 * (W[c] + W[c + SZ]);
      spd[c] = Math.sqrt(uc * uc + vc * vc + wc * wc);
    }

    // 3) viskositas eddy eksplisit, slip parsial di dinding, free-slip di permukaan
    const kd = (0.04 * dt) / h;
    for (let a = 0; a < 3; a++) {
      const sa = STR[a];
      const list = this.faces[a];
      const Fa = F[a];
      const oa = this.open[a];
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
            else if (t === 1 && sg > 0 && isTop[c]) sum += own; // free-slip di permukaan
            else sum += 0.5 * own;
          }
        }
        Fa[c] = own + coef * (sum - 6 * own);
      }
    }

    this.applyJets();

    // 4) proyeksi: A·φ = h²(s − ∇·u*)
    const { rhs, src, phi } = this;
    for (let m = 0; m < fluid.length; m++) {
      const c = fluid[m];
      rhs[c] = -h * (U[c + 1] - U[c] + V[c + SY] - V[c] + W[c + SZ] - W[c]) + src[c] / h;
    }
    this.solver.solve(rhs, phi, 60, 1e-4);
    const ih = 1 / h;
    for (let a = 0; a < 3; a++) {
      const sa = STR[a];
      const list = this.faces[a];
      const Fa = F[a];
      for (let m = 0; m < list.length; m++) {
        const c = list[m];
        let val = Fa[c] - ih * (phi[c] - phi[c - sa]);
        if (val > VMAX) val = VMAX;
        else if (val < -VMAX) val = -VMAX;
        Fa[c] = val;
      }
    }

    // 5) rata-rata waktu laju arus (τ = 8 dtk) untuk zona mati
    const em = 1 - Math.exp(-dt / 8);
    const { avg } = this;
    for (let m = 0; m < fluid.length; m++) {
      const c = fluid[m];
      const uc = 0.5 * (U[c] + U[c + 1]);
      const vc = 0.5 * (V[c] + V[c + SY]);
      const wc = 0.5 * (W[c] + W[c + SZ]);
      const s = Math.min(VMAX, Math.sqrt(uc * uc + vc * vc + wc * wc));
      avg[c] += (s - avg[c]) * em;
    }
  }

  /** Tulis kecepatan pusat sel + laju rata-rata ke buffer keluaran. */
  writeOutput(ou, ov, ow, om) {
    const { SY, SZ } = this.G;
    const [U, V, W] = this.F;
    ou.fill(0);
    ov.fill(0);
    ow.fill(0);
    om.fill(0);
    const fluid = this.fluidCells;
    for (let n = 0; n < fluid.length; n++) {
      const c = fluid[n];
      ou[c] = 0.5 * (U[c] + U[c + 1]);
      ov[c] = 0.5 * (V[c] + V[c + SY]);
      ow[c] = 0.5 * (W[c] + W[c + SZ]);
      om[c] = this.avg[c];
    }
  }

  /** Statistik laju rata-rata: persen zona mati (<1) & lemah (1–3), rata-rata, rata-rata di baris jb. */
  stats(jb) {
    let n = 0;
    let dead = 0;
    let weak = 0;
    let sum = 0;
    let nb = 0;
    let sb = 0;
    const fluid = this.fluidCells;
    for (let m = 0; m < fluid.length; m++) {
      const c = fluid[m];
      const a = this.avg[c];
      n++;
      sum += a;
      if (a < 1) dead++;
      else if (a < 3) weak++;
      if (this.cj[c] === jb) {
        nb++;
        sb += a;
      }
    }
    n = Math.max(1, n);
    return { dead: (dead / n) * 100, weak: (weak / n) * 100, mean: sum / n, bottom: nb ? sb / nb : 0 };
  }

  /** Divergensi maksimum (1/s) dikurangi sumber — untuk uji. */
  maxDivergence() {
    const { h, SY, SZ } = this.G;
    const [U, V, W] = this.F;
    let mx = 0;
    for (const c of this.fluidCells) {
      const dv = (U[c + 1] - U[c] + V[c + SY] - V[c] + W[c + SZ] - W[c]) / h - this.src[c] / (h * h * h);
      mx = Math.max(mx, Math.abs(dv));
    }
    return mx;
  }
}
