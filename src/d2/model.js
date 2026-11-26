/**
 * Desain 2: tank 60×40×40 + overflow eksternal bersisir (kotak dalam di dalam tank, kotak luar di
 * luar kaca belakang), disambung lewat LUBANG BOR berbulkhead (tanpa celah di kaca), saluran ke
 * sump susunan Bean Animal (siphon penuh + gate valve, jalur terbuka, jalur darurat kering), dan
 * return lewat bulkhead elbow + duckbill dengan lubang pemutus siphon. Sump menyusul.
 *
 * Murni (tanpa DOM): parameter → geometri → hitungan tunak per debit. Satuan cm, cm³/s, detik.
 *
 * Rumus & sumber angka:
 *  - Celah sisir: weir celah persegi (2/3)·Cd·b·√(2g)·H^1,5, Cd 0,6; tenggelam: koreksi
 *    Villemonte (1947) (1 − (H2/H1)^1,5)^0,385.
 *  - Lubang penghubung & pipa: lubang/tabung pendek Q = Cd·A·√(2g·Δh), Cd 0,7 (bulkhead ±3 D).
 *  - Siphon penuh: energi Z = Σ(K)·v²/2g + f·L/D·v²/2g; gate valve K (terbuka 1 → 0,15; ¾ → 0,26;
 *    ½ → 2,1; ¼ → 17; nilai tabel umum katup gerbang), knee 0,9, masuk 0,5, keluar 1.
 *  - Jalur terbuka/darurat: weir keliling bibir pipa (1,84·πD·H^1,5, SI) dibatasi lubang
 *    Cd·A·√(2gH) — perkiraan; pipa bisa sebagian ikut menyedot sehingga nyata sering lebih besar.
 *  - Tebal kaca: teori pelat 3 sisi dijepit, atas bebas: SF = σ·t² / (β·γ·H³), σ 19,2 MPa
 *    (dipakai kalkulator kaca akuarium umum), β dari rasio panjang/tinggi.
 *  - Jarak lubang: patokan umum tukang kaca — jarak tepi lubang ke tepi kaca / lubang lain ≥
 *    max(2 × tebal kaca, Ø lubang).
 */

export const G = 981;
const R2G = Math.sqrt(2 * G);
export const CD_SLOT = 0.6;
export const CD_HOLE = 0.7;

/**
 * Bulkhead: Ø lubang (= ulir luar) dan Ø dalam (cm). 20 mm = hasil ukur pemilik (Sanking 20 mm);
 * 25 & 32 mm perkiraan — ukur ulir & lubang asli sebelum memotong.
 */
export const BULKHEADS = {
  20: { label: '20 mm', hole: 2.0, bore: 1.48, measured: true },
  25: { label: '25 mm', hole: 2.5, bore: 1.9, measured: false },
  32: { label: '32 mm', hole: 3.2, bore: 2.5, measured: false },
};
/** Perkiraan Ø luar mur/flens bulkhead (cm) = Ø lubang + 1,9 (patokan yang sama dengan desain asal). */
export const flangeOf = (size) => BULKHEADS[size].hole + 1.9;

/** Parameter bawaan (revisi: lubang bor tanpa celah, Bean Animal, kaca lebih tebal). */
export function defaultD2() {
  return {
    // tank
    tankW: 60,
    tankD: 40,
    tankH: 40,
    glassT: 0.8, // kaca depan & samping
    backT: 1.0, // kaca belakang (dibor)
    // kotak dalam bersisir (di dalam tank, menempel kaca belakang)
    L: 20,
    inW: 6,
    inH: 12.2,
    acrT: 0.5, // tebal akrilik
    combTop: 0.5, // jarak awal celah dari tepi atas
    combLen: 4.5, // panjang celah
    slotW: 0.3,
    slotPitch: 0.6,
    combMargin: 1,
    // lubang penghubung (kotak dalam → kaca → kotak luar)
    holeN: 2,
    holeSize: 25,
    holeY: 31, // pusat lubang dari dasar tank (= 3,2 cm dari dasar kotak dalam, seperti desain asal)
    holeSp: 13.4, // jarak antar pusat (±6,7 dari tengah, seperti desain asal)
    // kotak luar (di luar kaca belakang)
    outW: 10,
    outH: 18,
    // Bean Animal di alas kotak luar (tinggi bibir pipa dari permukaan dalam alas)
    mainSize: 20,
    openSize: 25,
    emSize: 25,
    openTop: 4.5,
    emTop: 6,
    mainGap: 1, // mulut siphon utama di atas permukaan alas
    gate: 0.5, // bukaan gate valve siphon utama (0..1)
    sumpDrop: 70, // muka air sump di bawah dasar kotak luar (perkiraan, sump menyusul)
    pipeLen: 95, // panjang pipa siphon utama
    // return
    retSize: 20,
    retTop: 5, // pusat lubang return dari tepi atas kaca
    retGap: 10, // pusat lubang return dari ujung kaca kiri/kanan
    breakHole: true, // lubang pemutus siphon di return
    tipDrop: 3, // ujung duckbill di bawah pusat lubang return
    // debit
    Q: 1000, // L/jam sampai ke tank
  };
}

/** Rentang & langkah parameter untuk panel (cm kecuali disebut). */
export const RANGES = {
  tankW: [30, 150, 1],
  tankD: [20, 80, 1],
  tankH: [20, 70, 1],
  glassT: [0.4, 1.9, 0.1],
  backT: [0.4, 1.9, 0.1],
  L: [10, 60, 0.5],
  inW: [3, 15, 0.5],
  inH: [6, 30, 0.1],
  acrT: [0.2, 1, 0.1],
  combTop: [0, 3, 0.1],
  combLen: [1, 8, 0.1],
  slotW: [0.2, 1, 0.05],
  slotPitch: [0.4, 2, 0.05],
  combMargin: [0.5, 5, 0.1],
  holeN: [1, 4, 1],
  holeY: [10, 60, 0.1],
  holeSp: [4, 40, 0.5],
  outW: [5, 20, 0.5],
  outH: [8, 40, 0.5],
  openTop: [1, 30, 0.1],
  mainGap: [0.5, 4, 0.1],
  emTop: [1, 30, 0.1],
  gate: [0.05, 1, 0.01],
  sumpDrop: [20, 150, 1],
  pipeLen: [30, 300, 1],
  retTop: [2, 20, 0.1],
  retGap: [3, 40, 0.5],
  tipDrop: [0, 15, 0.5],
  Q: [200, 4000, 50],
};

const clampP = (p) => {
  const o = { ...defaultD2(), ...p };
  for (const [k, [lo, hi]] of Object.entries(RANGES)) if (Number.isFinite(+o[k])) o[k] = Math.min(hi, Math.max(lo, +o[k]));
  for (const k of ['holeSize', 'mainSize', 'openSize', 'emSize', 'retSize']) if (!BULKHEADS[o[k]]) o[k] = 20;
  o.holeN = Math.round(o.holeN);
  o.breakHole = !!o.breakHole;
  return o;
};
export const sanitizeD2 = clampP;

const area = (d) => (Math.PI * d * d) / 4;

/** Geometri turunan (cm). x sepanjang tank (0..tankW), y dari dasar, z dari muka dalam kaca belakang (+ ke depan). */
export function geometry(p0) {
  const p = clampP(p0);
  const top = p.tankH;
  const inBot = top - p.inH;
  const slotBot = top - p.combTop - p.combLen;
  const slotTop = top - p.combTop;
  // jarak celah pertama diukur dari ujung luar kotak (sama dengan desain asal → 30 celah)
  const usable = p.L - 2 * p.combMargin - p.slotW;
  const nSlots = Math.max(1, Math.floor(usable / p.slotPitch + 1e-9) + 1);
  const slotSpan = (nSlots - 1) * p.slotPitch + p.slotW;
  const x0 = (p.tankW - p.L) / 2;
  const cx = p.tankW / 2;
  const hc = BULKHEADS[p.holeSize];
  const holesX = Array.from({ length: p.holeN }, (_, i) => cx + (i - (p.holeN - 1) / 2) * p.holeSp);
  const outBot = top - p.outH;
  const rb = BULKHEADS[p.retSize];
  const retY = top - p.retTop;
  const retX = [p.retGap, p.tankW - p.retGap];
  const drains = [
    { key: 'main', label: 'Siphon utama (gate valve)', size: p.mainSize, top: null },
    { key: 'open', label: 'Jalur terbuka', size: p.openSize, top: outBot + p.acrT + p.openTop },
    { key: 'em', label: 'Jalur darurat (kering)', size: p.emSize, top: outBot + p.acrT + p.emTop },
  ];
  // bulkhead alas kotak luar: ujung-ujung sejauh ½ flens + 0,5 cm dari dinding dalam, tengah di antaranya
  const xi0 = x0 + p.acrT;
  const xi1 = x0 + p.L - p.acrT;
  drains[0].x = xi0 + flangeOf(p.mainSize) / 2 + 0.5;
  drains[2].x = xi1 - flangeOf(p.emSize) / 2 - 0.5;
  drains[1].x = (drains[0].x + drains[2].x) / 2;
  return {
    p,
    innerW: p.tankW - 2 * p.glassT,
    innerD: p.tankD - p.glassT - p.backT,
    slotSpan,
    slotX0: x0 + (p.L - slotSpan) / 2,
    top,
    inBot,
    slotBot,
    slotTop,
    nSlots,
    slotArea: nSlots * p.slotW,
    x0,
    x1: x0 + p.L,
    holesX,
    holeD: hc.hole,
    holeBore: hc.bore,
    outBot,
    retY,
    retX,
    retHoleD: rb.hole,
    drains,
    floorIn: outBot + p.acrT, // permukaan dalam alas kotak luar
    mainInlet: outBot + p.acrT + p.mainGap, // mulut siphon utama (menghadap bawah) di atas alas
  };
}

/* ---------------- komponen aliran ---------------- */

/** Weir celah sisir: debit (cm³/s) dari tank ke kotak dalam. */
export function combFlow(g, hTank, hIn) {
  const H1 = hTank - g.slotBot;
  if (H1 <= 0) return 0;
  const L = g.p.combLen;
  const k = (2 / 3) * CD_SLOT * g.slotArea * R2G;
  // celah: weir sampai tingginya habis; di atas itu bagian celah bekerja seperti lubang
  let q = H1 <= L ? k * H1 ** 1.5 : k * (H1 ** 1.5 - (H1 - L) ** 1.5);
  // di atas tepi kotak: meluap sepanjang bibir (1,84·L·h^1,5 SI → 18,31 cm^0,5/s)
  const over = hTank - g.top;
  if (over > 0) q += 18.31 * g.p.L * over ** 1.5;
  const H2 = hIn - g.slotBot;
  if (H2 > 0) q *= Math.max(0, 1 - Math.min(1, H2 / H1) ** 1.5) ** 0.385;
  return q;
}

/** Lubang penghubung: debit dari kotak dalam ke kotak luar. */
export function holeFlow(g, hIn, hOut) {
  const ref = Math.max(hOut, g.p.holeY);
  const dh = hIn - ref;
  if (dh <= 0) return 0;
  return g.p.holeN * CD_HOLE * area(g.holeBore) * R2G * Math.sqrt(dh);
}

/** K gate valve dari bukaan (interpolasi log tabel umum). */
export function gateK(a) {
  const pts = [
    [0.1, 120],
    [0.25, 17],
    [0.5, 2.1],
    [0.75, 0.26],
    [1, 0.15],
  ];
  a = Math.min(1, Math.max(0.1, a));
  for (let i = 1; i < pts.length; i++)
    if (a <= pts[i][0]) {
      const [a0, k0] = pts[i - 1];
      const [a1, k1] = pts[i];
      const t = (a - a0) / (a1 - a0);
      return Math.exp(Math.log(k0) + t * (Math.log(k1) - Math.log(k0)));
    }
  return 0.15;
}

/** Siphon penuh dari kotak luar ke sump (aktif bila mulutnya terendam). */
export function mainFlow(g, hOut, gate = g.p.gate) {
  if (hOut <= g.mainInlet) return 0;
  const d = BULKHEADS[g.p.mainSize].bore;
  const Z = hOut - (g.outBot - g.p.sumpDrop);
  const K = 0.5 + 2 * 0.9 + gateK(gate) + 1 + (0.025 * g.p.pipeLen) / d;
  // bila mulut hampir tidak terendam aliran dibatasi (udara ikut masuk) — dibuat mulus
  const sub = Math.min(1, (hOut - g.mainInlet) / (2 * d));
  return area(d) * Math.sqrt((2 * G * Z) / K) * sub;
}

/** Jalur terbuka / darurat: weir keliling bibir pipa, dibatasi lubang. */
export function standpipeFlow(sizeKey, topY, hOut) {
  const H = hOut - topY;
  if (H <= 0) return 0;
  const d = BULKHEADS[sizeKey].bore;
  const weir = 18.31 * Math.PI * d * H ** 1.5;
  const orifice = 0.6 * area(d) * R2G * Math.sqrt(H);
  return Math.min(weir, orifice);
}

function bisect(f, lo, hi, n = 60) {
  let a = lo;
  let b = hi;
  for (let i = 0; i < n; i++) {
    const m = (a + b) / 2;
    if (f(m) > 0) b = m;
    else a = m;
  }
  return (a + b) / 2;
}

/** Total debit keluar kotak luar pada tinggi air hOut. */
function outFlows(g, hOut, gate, mainOff = false) {
  const [, open, em] = g.drains;
  return { main: mainOff ? 0 : mainFlow(g, hOut, gate), open: standpipeFlow(open.size, open.top, hOut), em: standpipeFlow(em.size, em.top, hOut) };
}

/**
 * Keadaan tunak pada debit Q (L/jam).
 * @returns {{Q: number, hTank: number, hIn: number, hOut: number, flows: {main: number, open: number, em: number}, flags: string[], combFree: boolean, outFull: boolean}}
 */
export function solve(p0, QLh, gate, opt = {}) {
  const g = geometry(p0);
  const p = g.p;
  const Q = (QLh ?? p.Q) / 3.6;
  const gv = gate ?? p.gate;
  const flags = [];
  const mainOff = !!opt.mainOff;
  // 1) kotak luar: Σ saluran = Q
  const outTop = g.top;
  const sumOut = (h) => {
    const f = outFlows(g, h, gv, mainOff);
    return f.main + f.open + f.em;
  };
  let hOut;
  let outFull = false;
  if (sumOut(outTop) < Q) {
    hOut = outTop;
    outFull = true;
    flags.push('Kotak luar MELUAP: saluran tidak sanggup membawa debit ini.');
  } else hOut = bisect((h) => sumOut(h) - Q, g.outBot, outTop);
  const flows = outFlows(g, hOut, gv, mainOff);
  // 2) kotak dalam: lubang penghubung (bebas bila air kotak luar di bawah pusat lubang)
  const k = p.holeN * CD_HOLE * area(g.holeBore) * R2G;
  let hIn = Math.max(hOut, p.holeY) + (Q / k) ** 2;
  // 3) tank: sisir (tenggelam bila air kotak dalam di atas dasar celah)
  let hTank;
  let tankOver = false;
  if (hIn >= g.top) {
    // kotak dalam penuh sampai bibir: lubang tak sanggup, air tank naik melewati bibir kaca
    hIn = g.top;
    hTank = g.top;
    tankOver = true;
    flags.push('TANK MELUAP: lubang penghubung tidak sanggup membawa debit ini (tambah jumlah/ukuran lubang).');
  } else {
    hTank = bisect((h) => combFlow(g, h, hIn) - Q, g.slotBot, g.top + 3);
    if (hTank > g.top - 0.2) {
      hTank = g.top;
      tankOver = true;
      flags.push('TANK MELUAP: air naik sampai bibir kaca.');
    }
  }
  const combFree = hIn < g.slotBot - 0.3;
  if (!combFree) flags.push('Sisir tidak jatuh bebas: air kotak dalam mendekati/di atas dasar celah (aliran berisik, tank naik).');
  if (!tankOver && hTank > g.slotTop) flags.push('Air tank di atas ujung celah sisir: meluap lewat bibir kotak, tinggal sedikit sebelum tank meluap.');
  if (!mainOff && flows.em > 0.5)
    flags.push(gv >= 0.97 ? 'Jalur darurat ikut mengalir walau gate terbuka penuh: saluran tidak sanggup — kurangi debit atau perbesar siphon utama.' : 'Jalur darurat ikut mengalir: buka gate valve sedikit.');
  if (!mainOff && flows.open < 0.3 && flows.main > 0) flags.push('Jalur terbuka kering: siphon utama bisa menyedot udara (berdeguk); tutup gate valve sedikit.');
  if (!mainOff && gv >= 0.9 && flows.main > 0) flags.push(`Gate valve hampir terbuka penuh (${Math.round(gv * 100)}%): siphon utama ${p.mainSize} mm mendekati kapasitasnya — tidak ada cadangan, pertimbangkan siphon ukuran lebih besar.`);
  const subMain = hOut - g.mainInlet;
  const dMain = BULKHEADS[p.mainSize].bore;
  if (flows.main > 0 && subMain < 2 * dMain) flags.push('Mulut siphon utama kurang terendam (< 2·D): rawan pusaran & udara.');
  const ok = !tankOver && !outFull;
  return { Q: Q * 3.6, hTank, hIn, hOut, flows, flags, combFree, outFull, tankOver, ok };
}

/** Bukaan gate valve supaya air kotak luar ±0,5 cm di atas bibir jalur terbuka (jalur terbuka menetes). */
export function autoGate(p0, QLh) {
  const g = geometry(p0);
  const Q = (QLh ?? g.p.Q) / 3.6;
  const h = g.drains[1].top + 0.5;
  const open = standpipeFlow(g.p.openSize, g.drains[1].top, h);
  const need = Q - open;
  if (need <= 0) return 0.1;
  if (mainFlow(g, h, 1) < need) return 1; // terbuka penuh pun kurang
  // mainFlow naik monoton terhadap bukaan
  return Math.round(bisect((a) => mainFlow(g, h, a) - need, 0.1, 1) * 100) / 100;
}

/** Debit maksimum sebelum batas tertentu tercapai (L/jam). */
export function limits(p0) {
  const g = geometry(p0);
  const find = (bad) => {
    let lo = 50;
    let hi = 6000;
    if (bad(solve(p0, lo))) return 0;
    if (!bad(solve(p0, hi))) return hi;
    for (let i = 0; i < 40; i++) {
      const m = (lo + hi) / 2;
      if (bad(solve(p0, m))) hi = m;
      else lo = m;
    }
    return Math.round(lo / 10) * 10;
  };
  // debit desain: gate terbuka penuh, air kotak luar tepat di bibir jalur darurat
  const hEm = g.drains[2].top;
  const design = (mainFlow(g, hEm, 1) + standpipeFlow(g.p.openSize, g.drains[1].top, hEm)) * 3.6;
  // siphon utama tersumbat: jalur terbuka + darurat saja sampai ada yang meluap
  const backup = (() => {
    let lo = 0;
    let hi = 6000;
    for (let i = 0; i < 40; i++) {
      const m = (lo + hi) / 2;
      if (solve(p0, m, 1, { mainOff: true }).ok) lo = m;
      else hi = m;
    }
    return Math.round(lo / 10) * 10;
  })();
  return {
    combFree: find((s) => !s.combFree),
    combTop: find((s) => s.hTank > g.slotTop),
    emergency: find((s) => s.flows.em > 0.5),
    overflow: find((s) => !s.ok),
    design: Math.round(design / 10) * 10,
    backupOnly: backup,
  };
}

/**
 * Tinggi lubang pemutus siphon (cm dari dasar tank): ±1 cm di bawah muka air normal supaya tidak
 * menyemprot saat pompa jalan, tapi tidak lebih tinggi dari puncak siku return / lebih rendah dari ujung nozzle.
 */
export function breakHoleY(p0, QLh) {
  const g = geometry(p0);
  const s = solve(p0, QLh);
  const tip = g.retY - g.p.tipDrop;
  return Math.max(tip + 0.5, Math.min(g.retY + g.retHoleD / 2, s.hTank - 1));
}

/** Volume (L) yang turun ke sump saat pompa mati. */
export function drainDown(p0, QLh) {
  const g = geometry(p0);
  const p = g.p;
  const s = solve(p0, QLh);
  const innerA = (p.L - 2 * p.acrT) * (p.inW - 2 * p.acrT);
  const tankA = g.innerW * g.innerD - p.L * p.inW;
  const outerA = (p.L - 2 * p.acrT) * (p.outW - 2 * p.acrT);
  const vTank = Math.max(0, s.hTank - g.slotBot) * tankA;
  const holeBottom = p.holeY - g.holeD / 2;
  const vIn = Math.max(0, Math.min(s.hIn, g.top) - Math.max(holeBottom, g.inBot)) * innerA;
  const vOut = Math.max(0, s.hOut - g.mainInlet) * outerA;
  const dMain = BULKHEADS[p.mainSize].bore;
  const vPipe = area(dMain) * p.pipeLen; // isi pipa siphon utama
  // return: tanpa lubang pemutus, tank tersedot balik sampai ujung nozzle; dengan lubang, sampai lubang itu
  const stop = p.breakHole ? breakHoleY(p0, QLh) : g.retY - p.tipDrop;
  const vRet = Math.max(0, g.slotBot - stop) * tankA;
  const total = (vTank + vIn + vOut + vPipe + vRet) / 1000;
  return { tank: vTank / 1000, inner: vIn / 1000, outer: vOut / 1000, pipe: vPipe / 1000, ret: vRet / 1000, total };
}

/* ---------------- cek kaca & lubang ---------------- */

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
  for (let i = 1; i < BETA.length; i++)
    if (ratio <= BETA[i][0]) {
      const [r0, b0] = BETA[i - 1];
      const [r1, b1] = BETA[i];
      return b0 + ((ratio - r0) / (r1 - r0)) * (b1 - b0);
    }
  return BETA[BETA.length - 1][1];
}
/** Faktor keamanan panel (air laut γ 10.055 N/m³, σ 19,2 MPa). */
export function glassSF(lenCm, hCm, tCm) {
  const H = hCm / 100;
  const t = tCm / 100;
  return (19.2e6 * t * t) / (beta(lenCm / hCm) * 10055 * H ** 3);
}
/** Tebal minimum (cm) untuk SF tertentu. */
export function glassMin(lenCm, hCm, sf = 3.8) {
  const H = hCm / 100;
  return Math.sqrt((sf * beta(lenCm / hCm) * 10055 * H ** 3) / 19.2e6) * 100;
}

/** Cek tebal kaca & jarak lubang di kaca belakang. @returns {Array<{level: 'ok'|'warn'|'bad', text: string}>} */
export function checks(p0) {
  const g = geometry(p0);
  const p = g.p;
  const out = [];
  const panel = (name, len, t) => {
    const sf = glassSF(len, p.tankH, t);
    const need = glassMin(len, p.tankH);
    out.push({
      level: sf >= 3.8 ? 'ok' : sf >= 2.5 ? 'warn' : 'bad',
      text: `Kaca ${name} ${fmtc(t * 10)} mm: faktor keamanan ±${fmtc(sf, 1)} (anjuran ≥ 3,8 → minimal ±${fmtc(need * 10)} mm).`,
    });
  };
  panel('depan', p.tankW, p.glassT);
  panel('belakang', p.tankW, p.backT);
  panel('samping', p.tankD, p.glassT);
  const minGap = Math.max(2 * p.backT, 0);
  // lubang di kaca belakang: penghubung + return
  const holes = [...g.holesX.map((x) => ({ x, y: p.holeY, d: g.holeD, name: 'penghubung' })), ...g.retX.map((x) => ({ x, y: g.retY, d: g.retHoleD, name: 'return' }))];
  let worst = Infinity;
  let worstText = '';
  for (const h of holes) {
    const r = h.d / 2;
    const edges = [
      ['tepi atas', p.tankH - (h.y + r)],
      ['tepi kiri', h.x - r - p.glassT],
      ['tepi kanan', p.tankW - p.glassT - (h.x + r)],
      ['dasar', h.y - r],
    ];
    for (const [nm, d] of edges) {
      const need = Math.max(minGap, h.d);
      if (d - need < worst) {
        worst = d - need;
        worstText = `lubang ${h.name} ke ${nm}: ${fmtc(d)} cm (anjuran ≥ ${fmtc(need)} cm)`;
      }
    }
  }
  for (let i = 0; i < holes.length; i++)
    for (let j = i + 1; j < holes.length; j++) {
      const a = holes[i];
      const b = holes[j];
      const d = Math.hypot(a.x - b.x, a.y - b.y) - a.d / 2 - b.d / 2;
      const need = Math.max(minGap, a.d, b.d);
      if (d - need < worst) {
        worst = d - need;
        worstText = `antar lubang ${a.name}–${b.name}: ${fmtc(d)} cm (anjuran ≥ ${fmtc(need)} cm)`;
      }
    }
  out.push({ level: worst >= 0 ? 'ok' : 'bad', text: worst >= 0 ? `Jarak semua lubang di kaca belakang aman (terdekat: ${worstText}).` : `Lubang terlalu dekat — ${worstText}.` });
  // lubang penghubung harus di dalam kotak dalam & di atas alas kotak luar; flens/mur tidak menabrak alas & dinding
  const r = g.holeD / 2;
  const fl = flangeOf(p.holeSize) / 2;
  if (p.holeY - r < g.inBot + p.acrT + 0.3) out.push({ level: 'bad', text: 'Lubang penghubung menembus alas kotak dalam: naikkan pusat lubang atau perdalam kotak dalam.' });
  else if (p.holeY - fl < g.inBot + p.acrT + 0.2) out.push({ level: 'bad', text: `Flens bulkhead penghubung (Ø ±${fmtc(2 * fl)}) menabrak alas kotak dalam: pusat lubang minimal ${fmtc(g.inBot + p.acrT + 0.2 + fl - g.inBot)} cm dari dasar kotak dalam.` });
  if (p.holeY + r > g.slotBot - 0.5) out.push({ level: 'warn', text: 'Lubang penghubung terlalu tinggi: mendekati dasar celah sisir, sisir mudah tenggelam.' });
  if (p.holeY - r < g.outBot + p.acrT + 0.3) out.push({ level: 'bad', text: 'Lubang penghubung di bawah alas kotak luar: perdalam kotak luar.' });
  const x0 = Math.min(...g.holesX) - r;
  const x1 = Math.max(...g.holesX) + r;
  if (x0 < g.x0 + p.acrT + 0.5 || x1 > g.x1 - p.acrT - 0.5) out.push({ level: 'bad', text: 'Lubang penghubung keluar dari lebar kotak: perkecil jarak antar lubang.' });
  else if (Math.min(...g.holesX) - fl < g.x0 + p.acrT + 0.2 || Math.max(...g.holesX) + fl > g.x1 - p.acrT - 0.2) out.push({ level: 'bad', text: 'Flens/mur bulkhead penghubung menabrak dinding samping kotak: perkecil jarak antar lubang.' });
  for (let i = 1; i < g.holesX.length; i++)
    if (g.holesX[i] - g.holesX[i - 1] < 2 * fl + 0.3) {
      out.push({ level: 'bad', text: `Bulkhead penghubung terlalu rapat: jarak pusat minimal ±${fmtc(2 * fl + 0.3)} cm supaya mur tidak bertabrakan.` });
      break;
    }
  if (g.drains[2].top <= g.drains[1].top) out.push({ level: 'bad', text: 'Bibir jalur darurat harus lebih tinggi dari jalur terbuka.' });
  for (let i = 1; i < g.drains.length; i++) {
    const a = g.drains[i - 1];
    const b = g.drains[i];
    const need = (flangeOf(a.size) + flangeOf(b.size)) / 2 + 0.3;
    if (b.x - a.x < need) out.push({ level: 'bad', text: `Bulkhead alas kotak luar terlalu rapat (${fmtc(b.x - a.x)} cm, perlu ≥ ${fmtc(need)} cm): mur saling bertabrakan — panjangkan kotak atau kecilkan ukuran.` });
  }
  if (Math.max(...g.drains.map((d) => flangeOf(d.size))) > p.outW - 2 * p.acrT - 0.4) out.push({ level: 'bad', text: 'Kotak luar terlalu sempit untuk mur bulkhead alas: lebarkan kotak luar.' });
  if (g.drains[2].top + 0.5 > p.holeY - r) out.push({ level: 'warn', text: 'Bibir jalur darurat di atas dasar lubang penghubung: rendahkan jalur darurat supaya lubang penghubung tidak terendam saat darurat.' });
  if (!p.breakHole) out.push({ level: 'warn', text: 'Return tanpa lubang pemutus siphon: saat padam air tank tersedot balik ke sump.' });
  else {
    const s = solve(p0);
    const by = breakHoleY(p0);
    if (by > s.hTank - 0.3) out.push({ level: 'warn', text: `Muka air tank (${fmtc(s.hTank)} cm) terlalu dekat/di bawah lubang pemutus siphon: lubang menyemprot saat pompa jalan — turunkan posisi return.` });
    if (by < g.slotBot) out.push({ level: 'warn', text: `Lubang pemutus siphon (${fmtc(by)} cm) di bawah dasar celah sisir: saat padam air tank tetap tersedot sampai lubang itu.` });
  }
  return out;
}

const fmtc = (v, d = 1) => (+v).toFixed(d).replace('.', ',');

/**
 * Daftar potong & bor untuk tukang (cm). Dinding depan/belakang sepanjang L, dinding samping di
 * antaranya, alas di dalam keempat dinding (tepi bawah rata). Posisi lubang dari ujung kiri pelat
 * (dilihat dari depan tank) dan dari tepi bawah pelat.
 * @returns {Array<{title: string, items: string[]}>}
 */
export function cutList(p0) {
  const g = geometry(p0);
  const p = g.p;
  const t = p.acrT;
  const f = (v) => fmtc(v);
  const xs = (arr, off) => arr.map((x) => f(x - off)).join(' & ');
  const margin = (p.L - g.slotSpan) / 2;
  const sumpNote = `perkiraan saat ${fmtc(p.Q, 0)} L/jam`;
  const s = solve(p0);
  return [
    {
      title: `Kotak sisir (akrilik ${fmtc(t * 10, 0)} mm, atas terbuka)`,
      items: [
        `Dinding depan bersisir: ${f(p.L)} × ${f(p.inH)} — ${g.nSlots} celah ${f(p.slotW)} × ${f(p.combLen)}, mulai ${f(p.combTop)} dari tepi atas, jarak pusat ${f(p.slotPitch)}, celah pertama ${f(margin)} dari ujung kiri.`,
        `Dinding belakang (menempel kaca): ${f(p.L)} × ${f(p.inH)} — ${p.holeN} lubang Ø ${f(g.holeD)} (bulkhead ${p.holeSize} mm), pusat ${f(p.holeY - g.inBot)} dari tepi bawah, ${xs(g.holesX, g.x0)} dari ujung kiri.`,
        `Dinding samping × 2: ${f(p.inW - 2 * t)} × ${f(p.inH)}.`,
        `Alas: ${f(p.L - 2 * t)} × ${f(p.inW - 2 * t)} (di antara dinding).`,
      ],
    },
    {
      title: `Kotak luar (akrilik ${fmtc(t * 10, 0)} mm, atas terbuka)`,
      items: [
        `Dinding depan (menempel kaca): ${f(p.L)} × ${f(p.outH)} — ${p.holeN} lubang Ø ${f(g.holeD)}, pusat ${f(p.holeY - g.outBot)} dari tepi bawah, ${xs(g.holesX, g.x0)} dari ujung kiri.`,
        `Dinding belakang: ${f(p.L)} × ${f(p.outH)}.`,
        `Dinding samping × 2: ${f(p.outW - 2 * t)} × ${f(p.outH)}.`,
        `Alas: ${f(p.L - 2 * t)} × ${f(p.outW - 2 * t)} — 3 lubang di garis tengah lebar: ` +
          g.drains.map((d) => `${d.key === 'main' ? 'siphon' : d.key === 'open' ? 'terbuka' : 'darurat'} Ø ${f(BULKHEADS[d.size].hole)} di ${f(d.x - g.x0 - t)}`).join(', ') +
          ' dari ujung kiri alas.',
      ],
    },
    {
      title: `Kaca belakang ${fmtc(p.backT * 10, 0)} mm (bor oleh tukang kaca)`,
      items: [
        `${p.holeN} lubang penghubung Ø ${f(g.holeD)}: pusat ${f(p.holeY)} dari dasar kaca, ${xs(g.holesX, 0)} dari tepi kiri.`,
        `2 lubang return Ø ${f(g.retHoleD)}: pusat ${f(g.retY)} dari dasar kaca (${f(p.retTop)} dari tepi atas), ${xs(g.retX, 0)} dari tepi kiri.`,
        `Posisi kotak: ujung kiri kotak ${f(g.x0)} dari tepi kiri kaca; dasar kotak dalam ${f(g.inBot)}, dasar kotak luar ${f(g.outBot)} dari dasar tank.`,
      ],
    },
    {
      title: 'Pipa Bean Animal & return',
      items: [
        `Siphon utama ${p.mainSize} mm: mulut menghadap bawah ${f(p.mainGap)} di atas permukaan alas; gate valve di bawah kotak.`,
        `Jalur terbuka ${p.openSize} mm: bibir pipa ${f(p.openTop)} di atas permukaan alas.`,
        `Jalur darurat ${p.emSize} mm: bibir pipa ${f(p.emTop)} di atas permukaan alas (harus kering saat normal).`,
        p.breakHole
          ? `Return: lubang pemutus siphon Ø 0,4 di pipa return dalam tank, ±${f(breakHoleY(p0))} dari dasar (±1 di bawah muka air ${f(s.hTank)}, ${sumpNote}).`
          : 'Return: tanpa lubang pemutus siphon (tidak dianjurkan).',
      ],
    },
  ];
}
