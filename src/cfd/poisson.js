/**
 * Solver Poisson tekanan pada kisi bermasker (sel fluida/padat) dengan
 * Preconditioned Conjugate Gradient + Modified Incomplete Cholesky MIC(0)
 * (Bridson, "Fluid Simulation for Computer Graphics", bab 5).
 *
 * Matriks: (A·x)_c = Σ_{tetangga fluida n} (x_c − x_n)  →  Laplacian −∇²·h², syarat batas
 * Neumann di semua dinding padat. A singular (konstanta per komponen terhubung), jadi
 * ruas kanan dibuat kompatibel dengan mengurangkan rata-ratanya per komponen.
 *
 * Generik untuk 2D maupun 3D: tetangga ditentukan oleh `strides` (mis. [1, SY, SZ]).
 * Array memakai sel hantu (ghost) di tepi sehingga c±s selalu valid untuk sel interior.
 */
export class PoissonSolver {
  /**
   * @param {number} n jumlah sel total (termasuk sel hantu)
   * @param {number[]} strides langkah indeks ke tetangga "plus" tiap sumbu
   */
  constructor(n, strides) {
    this.n = n;
    this.strides = strides;
    this.fluid = new Uint8Array(n);
    this.cells = new Int32Array(0);
    this.diag = new Float32Array(n);
    this.precon = new Float64Array(n);
    this.comp = new Int32Array(n);
    this.compSum = new Float64Array(1);
    this.compCnt = new Int32Array(1);
    this.ncomp = 0;
    this.r = new Float64Array(n);
    this.z = new Float64Array(n);
    this.s = new Float64Array(n);
    this.q = new Float64Array(n);
    this.t = new Float64Array(n);
    this.lastIterations = 0;
    this.lastResidual = 0;
  }

  /**
   * Bangun ulang struktur bila masker berubah.
   * @param {Uint8Array} solid 1 = padat, 0 = fluida (panjang n)
   */
  setMask(solid) {
    const { n, strides, fluid, diag, precon, comp } = this;
    let count = 0;
    for (let c = 0; c < n; c++) {
      fluid[c] = solid[c] ? 0 : 1;
      if (fluid[c]) count++;
    }
    const cells = new Int32Array(count);
    let k = 0;
    for (let c = 0; c < n; c++) if (fluid[c]) cells[k++] = c;
    this.cells = cells;

    for (let m = 0; m < count; m++) {
      const c = cells[m];
      let d = 0;
      for (let a = 0; a < strides.length; a++) {
        const s = strides[a];
        if (fluid[c - s]) d++;
        if (fluid[c + s]) d++;
      }
      diag[c] = d;
    }

    // MIC(0): tau = 0.97, safety sigma = 0.25 (menangani pivot hampir nol pada sistem Neumann)
    const tau = 0.97;
    const sigma = 0.25;
    for (let m = 0; m < count; m++) {
      const c = cells[m];
      const ad = diag[c];
      if (ad === 0) {
        precon[c] = 0;
        continue;
      }
      let e = ad;
      for (let a = 0; a < strides.length; a++) {
        const nb = c - strides[a];
        if (!fluid[nb]) continue;
        const pn = precon[nb];
        // Aplus_a(nb) = −1 karena nb dan c sama-sama fluida
        e -= pn * pn;
        let other = 0;
        for (let b = 0; b < strides.length; b++) {
          if (b === a) continue;
          if (fluid[nb + strides[b]]) other -= 1;
        }
        e -= tau * (-1 * other) * pn * pn;
      }
      if (e < sigma * ad) e = ad;
      precon[c] = 1 / Math.sqrt(e);
    }

    // komponen terhubung (untuk kompatibilitas ruas kanan)
    comp.fill(-1);
    const stack = new Int32Array(count + 1);
    let nc = 0;
    for (let m = 0; m < count; m++) {
      const c0 = cells[m];
      if (comp[c0] >= 0) continue;
      const id = nc++;
      let sp = 0;
      stack[sp++] = c0;
      comp[c0] = id;
      while (sp > 0) {
        const c = stack[--sp];
        for (let a = 0; a < strides.length; a++) {
          const s = strides[a];
          let nb = c - s;
          if (fluid[nb] && comp[nb] < 0) {
            comp[nb] = id;
            stack[sp++] = nb;
          }
          nb = c + s;
          if (fluid[nb] && comp[nb] < 0) {
            comp[nb] = id;
            stack[sp++] = nb;
          }
        }
      }
    }
    this.ncomp = nc;
    if (this.compSum.length < nc) {
      this.compSum = new Float64Array(nc);
      this.compCnt = new Int32Array(nc);
    }
  }

  /** Kurangkan rata-rata ruas kanan per komponen terhubung (memutasi b). */
  makeCompatible(b) {
    const { cells, comp, compSum, compCnt, ncomp } = this;
    compSum.fill(0, 0, ncomp);
    compCnt.fill(0, 0, ncomp);
    for (let m = 0; m < cells.length; m++) {
      const c = cells[m];
      compSum[comp[c]] += b[c];
      compCnt[comp[c]]++;
    }
    for (let i = 0; i < ncomp; i++) compSum[i] /= Math.max(1, compCnt[i]);
    for (let m = 0; m < cells.length; m++) {
      const c = cells[m];
      b[c] -= compSum[comp[c]];
    }
  }

  /** out = A·x pada sel fluida. */
  applyA(x, out) {
    const { cells, strides, fluid, diag } = this;
    const ns = strides.length;
    for (let m = 0; m < cells.length; m++) {
      const c = cells[m];
      let v = diag[c] * x[c];
      for (let a = 0; a < ns; a++) {
        const s = strides[a];
        if (fluid[c - s]) v -= x[c - s];
        if (fluid[c + s]) v -= x[c + s];
      }
      out[c] = v;
    }
  }

  /** z = M⁻¹ r (substitusi maju lalu mundur dengan faktor MIC(0)). */
  applyPrecon(r, z) {
    const { cells, strides, fluid, precon } = this;
    const q = this.t;
    const ns = strides.length;
    for (let m = 0; m < cells.length; m++) {
      const c = cells[m];
      let t = r[c];
      for (let a = 0; a < ns; a++) {
        const nb = c - strides[a];
        if (fluid[nb]) t += precon[nb] * q[nb]; // −Aplus·precon·q dengan Aplus = −1
      }
      q[c] = t * precon[c];
    }
    for (let m = cells.length - 1; m >= 0; m--) {
      const c = cells[m];
      let t = q[c];
      const pc = precon[c];
      for (let a = 0; a < ns; a++) {
        const nb = c + strides[a];
        if (fluid[nb]) t += pc * z[nb];
      }
      z[c] = t * pc;
    }
  }

  /**
   * Selesaikan A·x = b (x dipakai sebagai tebakan awal / warm start).
   * @param {Float32Array|Float64Array} b ruas kanan (akan dibuat kompatibel)
   * @param {Float32Array|Float64Array} x solusi (in/out)
   * @param {number} maxIt batas iterasi
   * @param {number} relTol toleransi relatif terhadap max|b|
   */
  solve(b, x, maxIt = 60, relTol = 1e-4) {
    const { cells, r, z, s, q } = this;
    const nc = cells.length;
    if (nc === 0) return 0;
    this.makeCompatible(b);
    let bmax = 0;
    for (let m = 0; m < nc; m++) {
      const v = Math.abs(b[cells[m]]);
      if (v > bmax) bmax = v;
    }
    if (bmax < 1e-12) {
      for (let m = 0; m < nc; m++) x[cells[m]] = 0;
      this.lastIterations = 0;
      this.lastResidual = 0;
      return 0;
    }
    const tol = relTol * bmax;

    this.applyA(x, q);
    let rmax = 0;
    for (let m = 0; m < nc; m++) {
      const c = cells[m];
      r[c] = b[c] - q[c];
      const v = Math.abs(r[c]);
      if (v > rmax) rmax = v;
    }
    if (rmax <= tol) {
      this.lastIterations = 0;
      this.lastResidual = rmax / bmax;
      return 0;
    }
    this.applyPrecon(r, z);
    let rho = 0;
    for (let m = 0; m < nc; m++) {
      const c = cells[m];
      s[c] = z[c];
      rho += r[c] * z[c];
    }
    let it = 0;
    for (; it < maxIt; it++) {
      this.applyA(s, q);
      let sq = 0;
      for (let m = 0; m < nc; m++) {
        const c = cells[m];
        sq += s[c] * q[c];
      }
      if (Math.abs(sq) < 1e-30) break;
      const alpha = rho / sq;
      rmax = 0;
      for (let m = 0; m < nc; m++) {
        const c = cells[m];
        x[c] += alpha * s[c];
        r[c] -= alpha * q[c];
        const v = Math.abs(r[c]);
        if (v > rmax) rmax = v;
      }
      if (rmax <= tol) {
        it++;
        break;
      }
      this.applyPrecon(r, z);
      let rhoNew = 0;
      for (let m = 0; m < nc; m++) {
        const c = cells[m];
        rhoNew += r[c] * z[c];
      }
      const beta = rhoNew / rho;
      rho = rhoNew;
      for (let m = 0; m < nc; m++) {
        const c = cells[m];
        s[c] = z[c] + beta * s[c];
      }
    }
    this.lastIterations = it;
    this.lastResidual = rmax / bmax;
    return it;
  }
}
