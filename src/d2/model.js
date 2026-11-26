/**
 * Desain 2 — kalkulator untuk overflow box sisir PERSIS seperti desain asli pemilik
 * (public/d2/overflow-sisir.js): ukuran final, tidak bisa diubah. Yang bisa diubah hanya debit.
 *
 * Rumus muka air disalin apa adanya dari desain asli (fungsi tinggi air di tab Spesifikasi), supaya
 * angka di tab "Cek & debit" sama dengan tabel "Perkiraan tinggi air saat jalan":
 *  - sisir: weir celah, Cd 0,55 × 2/3 (tanpa koreksi terendam);
 *  - 2 lubang penghubung: lubang bulat diintegrasi per irisan, Cd 0,65; celah terbuka: weir persegi;
 *  - 4 bulkhead alas kotak luar: lubang Cd 0,62 (jatuh bebas).
 * Tambahan kalkulator ini hanya PERINGATAN: tebal kaca (teori pelat), jarak lubang ke celah, saluran
 * alas tanpa pipa tegak, aliran balik return saat padam, dan batas debit.
 *
 * Satuan cm & L/jam kecuali disebut.
 */

/** Ukuran final dari desain asli (Gd). */
export const FINAL = Object.freeze({
  L: 20,
  inW: 6,
  inH: 12.2,
  outW: 10,
  outH: 18,
  combLen: 4.5,
  combTop: 0.5,
  t: 0.3,
  g: 0.5,
  tankW: 60,
  tankD: 40,
  tankH: 40,
  topGap: 0,
  holeD: 2,
  holeZ: 3.2,
  holeSp: 6.7,
  drainD: 2,
  drainSp: 4.8,
  notchW: 8,
  notchBot: 31.5,
  retGap: 10,
  retTop: 5,
  retD: 2,
  slotW: 0.3,
  slotPitch: 0.6,
  combMargin: 1,
  outTopOff: 0,
});
/** Rasio Ø dalam / Ø lubang bulkhead (Sanking 20 mm: 1,48 / 2,0), 4 saluran alas, 2 lubang penghubung. */
export const BORE_RATIO = 0.74;
export const N_DRAIN = 4;
export const N_HOLE = 2;
export const Q_RANGE = [200, 3000, 50];

const G = 9.81;

/** Geometri turunan (sama dengan desain asli). */
export function geometry(x = FINAL) {
  const t = {};
  t.yIt = x.tankH - x.topGap; // bibir kotak dalam dari dasar tank
  t.yi0 = t.yIt - x.inH; // dasar kotak dalam
  t.yOt = t.yIt + x.outTopOff;
  t.yo0 = t.yOt - x.outH; // dasar kotak luar
  t.xc = [-x.holeSp, x.holeSp];
  t.notchZi = x.notchBot - t.yi0;
  t.notchZo = x.notchBot - t.yo0;
  t.holeY = t.yi0 + x.holeZ;
  t.retX = x.L / 2 + x.retGap;
  t.retY = x.tankH - x.retTop;
  t.holeZouter = t.holeY - t.yo0;
  const e = x.L - 2 * x.combMargin;
  t.n = Math.max(0, Math.floor((e - x.slotW) / x.slotPitch + 1e-9) + 1);
  t.slotBot = x.inH - x.combTop - x.combLen; // dari dasar kotak dalam
  t.slotTop = x.inH - x.combTop;
  t.bore = x.holeD * BORE_RATIO;
  return t;
}

/** Muka air (replika fungsi asli). Mengembalikan fungsi at(Q) + batas. */
export function levels(x = FINAL) {
  const i = geometry(x);
  const s = (i.n * x.slotW) / 100;
  const r = i.slotBot;
  const a = i.slotTop;
  const o = (w) => (w / 36e5 / (0.55 * (2 / 3) * Math.sqrt(2 * G) * s)) ** (2 / 3) * 100;
  const c = i.bore;
  const l = x.holeZ / 100;
  const h = c / 200;
  const u = (w) => {
    const y = w / 100;
    const E = l - h;
    const N = Math.min(y, l + h);
    if (N <= E) return 0;
    const P = 200;
    const L = (N - E) / P;
    let O = 0;
    for (let z = 0; z < P; z++) {
      const I = E + (z + 0.5) * L;
      O += 2 * Math.sqrt(Math.max(h * h - (I - l) ** 2, 0)) * Math.sqrt(2 * G * (y - I)) * L;
    }
    return 0.65 * O * 36e5;
  };
  const f = x.notchW / 100;
  const p = (w) => {
    const y = (w - i.notchZi) / 100;
    return y > 0 ? 0.55 * (2 / 3) * Math.sqrt(2 * G) * f * y ** 1.5 * 36e5 : 0;
  };
  const d = (w) => N_HOLE * u(w) + p(w);
  const inner = (w) => {
    let y = x.holeZ - c / 2;
    let E = x.inH + 8;
    for (let N = 0; N < 60; N++) {
      const P = (y + E) / 2;
      if (d(P) < w) y = P;
      else E = P;
    }
    return (y + E) / 2;
  };
  const m = Math.PI * ((x.drainD * BORE_RATIO) / 200) ** 2;
  const gO = (w) => (w / 36e5 / N_DRAIN / (0.62 * m)) ** 2 / (2 * G) * 100;
  const v = Math.min(i.holeZouter - c / 2, i.notchZo - 0.2);
  /**
   * @param {number} w debit (L/jam)
   * @returns {{Q:number, tz:number, iz:number, oz:number, fromRim:number, tank:number, over:boolean, free:boolean, outOk:boolean, nShare:number}}
   *  tz/iz/oz = cm dari dasar kotak dalam / kotak dalam / kotak luar; tank = cm dari dasar tank.
   */
  const at = (w) => {
    const y = r + (s > 0 ? o(w) : 0);
    const E = inner(w);
    const N = x.t + gO(w);
    const P = p(E);
    return {
      Q: w,
      tz: y,
      iz: E,
      oz: N,
      tank: i.yi0 + y,
      fromRim: x.tankH - (i.yi0 + y),
      over: y > a,
      free: E <= r + 0.05,
      outOk: N <= v,
      nShare: w > 0 ? Math.min(P / d(E) || 0, 1) : 0,
    };
  };
  return {
    at,
    rows: [500, 1000, 1500, 2000, 3000].map(at),
    geo: i,
    slotBot: r,
    slotTop: a,
    qFree: d(r + 0.05),
    qOuter: N_DRAIN * 0.62 * m * Math.sqrt((2 * G * Math.max(v - x.t, 0)) / 100) * 36e5,
    outLimit: v,
  };
}

/* ---------------- peringatan ---------------- */

const BETA = [
  [0.5, 0.085],
  [0.667, 0.16],
  [1, 0.26],
  [1.5, 0.48],
  [2, 0.62],
  [2.5, 0.74],
  [3, 0.83],
];
export function beta(ratio) {
  if (ratio <= BETA[0][0]) return BETA[0][1];
  for (let k = 1; k < BETA.length; k++)
    if (ratio <= BETA[k][0]) {
      const [r0, b0] = BETA[k - 1];
      const [r1, b1] = BETA[k];
      return b0 + ((ratio - r0) / (r1 - r0)) * (b1 - b0);
    }
  return BETA[BETA.length - 1][1];
}
/** Faktor keamanan kaca (tiga sisi dijepit, atas bebas; σ 19,2 MPa, air laut γ 10.055 N/m³). */
export function glassSF(lenCm, hCm, tCm) {
  return (19.2e6 * (tCm / 100) ** 2) / (beta(lenCm / hCm) * 10055 * (hCm / 100) ** 3);
}
/** Tebal minimum (cm) untuk faktor keamanan sf. */
export function glassMin(lenCm, hCm, sf = 3.8) {
  return Math.sqrt((sf * beta(lenCm / hCm) * 10055 * (hCm / 100) ** 3) / 19.2e6) * 100;
}

const fc = (v, d = 1) => (+v).toFixed(d).replace('.', ',');

/** Luas muka air tank (cm²) seperti rumus ruang kosong sump di desain asli. */
export const tankArea = (x = FINAL) => (x.tankW - 2 * x.g) * (x.tankD - 2 * x.g);

/** Air yang turun ke sump saat padam (L) — rumus yang sama dengan tab Spesifikasi. */
export function sumpSpace(Q, x = FINAL) {
  const lv = levels(x);
  const s = lv.at(Q);
  return Math.ceil((tankArea(x) * (s.tz - lv.slotBot) + 200) / 1e3 + 1);
}

/**
 * Daftar peringatan untuk debit Q (L/jam).
 * @returns {Array<{level:'ok'|'warn'|'bad', title:string, text:string}>}
 */
export function warnings(Q, x = FINAL) {
  const out = [];
  const lv = levels(x);
  const i = lv.geo;
  const s = lv.at(Q);

  // --- tergantung debit ---
  if (s.over) out.push({ level: 'bad', title: 'Meluap lewat bibir kotak dalam', text: `Pada ${Q} L/jam air tank naik di atas ujung celah sisir (${fc(i.yi0 + lv.slotTop)} cm dari dasar tank). Turunkan debit.` });
  if (!s.outOk) out.push({ level: 'bad', title: 'Kotak luar tertahan', text: `Air kotak luar (${fc(s.oz)} cm dari dasar kotak luar) menutup lubang/celah penghubung — 4 bulkhead alas tidak sanggup. Batas ±${Math.floor(lv.qOuter / 50) * 50} L/jam.` });
  if (!s.free) out.push({ level: 'warn', title: 'Sisir terendam', text: `Air kotak dalam (${fc(s.iz)} cm) di atas dasar celah sisir (${fc(lv.slotBot)} cm): aliran lebih berisik dan muka air tank nyata lebih tinggi dari angka (rumus asli belum menghitung efek terendam). Sisir jatuh bebas sampai ±${Math.floor(lv.qFree / 100) * 100} L/jam.` });
  if (!s.over && s.fromRim < 2.5) out.push({ level: 'warn', title: 'Dekat bibir kaca', text: `Muka air tank tinggal ${fc(s.fromRim)} cm dari bibir kaca.` });

  // --- tebal kaca ---
  const sfLong = glassSF(x.tankW, x.tankH, x.g);
  const sfSide = glassSF(x.tankD, x.tankH, x.g);
  const minLong = glassMin(x.tankW, x.tankH);
  const minSide = glassMin(x.tankD, x.tankH);
  out.push({
    level: sfLong < 2.5 ? 'bad' : sfLong < 3.8 ? 'warn' : 'ok',
    title: `Kaca ${fc(x.g * 10, 0)} mm untuk tinggi ${fc(x.tankH, 0)} cm`,
    text: `Faktor keamanan kaca depan/belakang (${fc(x.tankW, 0)} cm) ±${fc(sfLong)}, kaca samping (${fc(x.tankD, 0)} cm) ±${fc(sfSide)}; anjuran ≥ 3,8 → depan/belakang minimal ±${fc(minLong * 10, 0)} mm, samping ±${fc(minSide * 10, 0)} mm. Kaca belakang juga dilubangi & dicelah, jadi lebih lemah lagi.`,
  });

  // --- celah terbuka & lubang di kaca belakang ---
  const notchDepth = x.tankH - x.notchBot;
  const hr = x.holeD / 2;
  const gap = x.holeSp - hr - x.notchW / 2;
  const need = Math.max(2 * x.g, x.holeD);
  out.push({
    level: 'warn',
    title: 'Celah terbuka di tepi atas kaca belakang',
    text: `Celah ${fc(x.notchW)} × ${fc(notchDepth)} cm memutus tepi atas kaca (bagian yang paling tertarik). Sudut bawah R ${fc(0.5)} masih tajam — anjuran radius ≥ 1 cm, potong dengan bor intan + air (bukan gerinda), tepi dipoles, dan kaca annealed (bukan tempered).`,
  });
  if (gap < need)
    out.push({
      level: 'warn',
      title: 'Lubang penghubung dekat celah',
      text: `Tepi lubang Ø ${fc(x.holeD)} ke tepi celah hanya ${fc(gap)} cm (anjuran ≥ ${fc(need)} cm = max(2 × tebal kaca, Ø lubang)), dan lubang berada setinggi sudut bawah celah (pusat ${fc(i.holeY)} cm, dasar celah ${fc(x.notchBot)} cm) — titik retak paling rawan.`,
    });

  // --- saluran alas ---
  const depth = s.oz - x.t;
  out.push({
    level: 'warn',
    title: '4 saluran alas tanpa pipa tegak',
    text: `Pada ${Q} L/jam air di atas alas kotak luar hanya ±${fc(depth)} cm. Bulkhead alas yang terbuka langsung akan ikut menyedot udara (berpusar, berdeguk, gelembung mikro ke sump) dan bisa menyiphon–putus berulang. Umumnya diberi pipa tegak/Durso, atau susunan Bean Animal (siphon + jalur terbuka + jalur darurat).`,
  });

  // --- return ---
  out.push({
    level: 'warn',
    title: 'Return tanpa lubang pemutus siphon',
    text: `Saat padam, air tank tersedot balik lewat return sampai ujung duckbill terangkat dari air. Tiap 1 cm ujung duckbill di bawah dasar celah sisir (${fc(i.yi0 + lv.slotBot)} cm dari dasar tank) menambah ±${fc(tankArea(x) / 1000)} L ke sump. Lubang Ø 3–4 mm di sisi lurus return, ±1 cm di bawah muka air, memutus siphon itu.`,
  });

  // --- ruang sump ---
  out.push({
    level: 'ok',
    title: 'Ruang kosong sump',
    text: `Saat padam pada ${Q} L/jam, sisakan ruang kosong di sump minimal ±${sumpSpace(Q, x)} L (rumus tab Spesifikasi), ditambah isi pipa saluran & aliran balik return.`,
  });
  return out;
}
