/**
 * Besaran yang bisa ditampilkan di bidang potong, kabut 3D, dan legenda.
 *
 * Sampel bidang/kabut: [vu, vv, laju, lajuRata, flag, umur(dtk), pewarna(0..1), salinitas(ppt)].
 */
export const QUANTITIES = {
  inst: { label: 'Laju arus', unit: 'cm/s', speed: true },
  avg: { label: 'Laju arus rata-rata 8 dtk', unit: 'cm/s', speed: true },
  age: { label: 'Umur air sejak keluar duckbill', unit: 'menit' },
  dye: { label: 'Air baru dari filter', unit: '%' },
  salt: { label: 'Salinitas', unit: 'ppt' },
};
export const QUANTITY_OPTIONS = [
  ['inst', 'Laju arus sesaat (cm/s)'],
  ['avg', 'Laju arus rata-rata 8 dtk (zona mati)'],
  ['age', 'Umur air (menit) — air tua = ruang mati'],
  ['dye', 'Air baru dari filter (%) — pewarna'],
  ['salt', 'Salinitas lokal (ppt)'],
];

/** Nilai tampilan (dalam satuan legenda) dari sampel o. */
export function displayValue(q, o, emaFallback = 0) {
  switch (q) {
    case 'avg':
      return Number.isNaN(o[3]) ? emaFallback : o[3];
    case 'age':
      return o[5] / 60;
    case 'dye':
      return o[6] * 100;
    case 'salt':
      return o[7];
    default:
      return o[2];
  }
}

/** Persentil dari array (diurutkan salinan). */
export function percentiles(arr, n) {
  if (n < 10) return null;
  const a = arr.subarray(0, n).slice().sort();
  const at = (p) => a[Math.min(n - 1, Math.floor(n * p))];
  return { p02: at(0.02), p95: at(0.95), p98: at(0.98) };
}

/** Pelacak rentang skala warna otomatis (dihaluskan terhadap waktu). */
export class RangeTracker {
  constructor() {
    this.q = '';
    this.min = 0;
    this.max = 6;
  }

  /**
   * @param {string} q besaran
   * @param {Array<{p02, p95, p98}>} stats dari tampilan yang aktif
   * @param {number} manualMax batas manual (cm/s) untuk besaran laju; 0 = otomatis
   * @param {number} real dt nyata (dtk)
   * @param {boolean} snap langsung lompat (bidang dipindah / besaran diganti)
   */
  update(q, stats, manualMax, real, snap = false) {
    const qq = QUANTITIES[q] || QUANTITIES.inst;
    const jump = snap || q !== this.q;
    this.q = q;
    const k = jump ? 1 : Math.min(1, real * 2.5);
    const st = stats.filter(Boolean);
    let lo = 0;
    let hi;
    if (qq.speed) {
      if (manualMax > 0) {
        this.min = 0;
        this.max = manualMax;
        return this;
      }
      hi = st.length ? Math.max(2, Math.max(...st.map((s) => s.p95)) * 1.15) : this.max;
    } else if (q === 'age') {
      hi = st.length ? Math.max(1, Math.max(...st.map((s) => s.p95)) * 1.1) : this.max;
    } else if (q === 'dye') {
      hi = 100;
    } else {
      // salinitas: rentang p2–p98, minimal 0,05 ppt supaya noise numerik tidak dibesar-besarkan
      if (!st.length) return this;
      lo = Math.min(...st.map((s) => s.p02));
      hi = Math.max(...st.map((s) => s.p98));
      if (hi - lo < 0.05) {
        const c = 0.5 * (hi + lo);
        lo = c - 0.025;
        hi = c + 0.025;
      }
    }
    this.min += (lo - this.min) * k;
    this.max += (hi - this.max) * k;
    return this;
  }
}

const fmtNum = (v, d) => v.toFixed(d).replace('.', ',');

/** Tanda legenda: [{v, text}] */
export function legendTicks(q, min, max) {
  const qq = QUANTITIES[q] || QUANTITIES.inst;
  if (qq.speed) {
    const m = Math.max(1, Math.round(max * 2) / 2);
    const vals = [0, 1, 3, 8].filter((v) => v < m * 0.92).map((v) => ({ v, text: String(v) }));
    vals.push({ v: m, text: fmtNum(m, m % 1 ? 1 : 0) + '+' });
    return vals;
  }
  if (q === 'dye') return [0, 50, 100].map((v) => ({ v, text: v + '%' }));
  if (q === 'salt') {
    const mid = 0.5 * (min + max);
    return [min, mid, max].map((v) => ({ v, text: fmtNum(v, 2) }));
  }
  // umur air (menit)
  const d = max < 3 ? 1 : 0;
  return [0, max / 2, max].map((v, i) => ({ v, text: fmtNum(v, d) + (i === 2 ? '+' : '') }));
}
