/**
 * Hidrolik desain rakit pipa (fase 3): jalur dari ujung masuk (keluaran pompa) ke ujung keluar,
 * rugi tiap bagian, titik kerja pompa, dan kecepatan di tiap pipa. Hasilnya bisa dipakai sebagai
 * pipa return di simulasi (P.retLine, lihat physics/hydraulics.js returnK).
 *
 * Sumber & status angka:
 *  - Gesek pipa: Darcy–Weisbach, h = f·(L/D)·v²/2g, f dari Re (laminar 64/Re, Blasius untuk
 *    pipa halus seperti uPVC) — sama dengan fungsi friction() model siphon/return.
 *  - Fitting: metode Crane TP-410, K = f_T·(L/D)_eq. L/D: knee 90° standar 30, knee 45° 16,
 *    belokan balik (180°) 50, tee aliran lurus 20, tee lewat cabang 60, gate valve 8, ball valve
 *    full port 3 (tabel yang sama di Machinery's Handbook & Engineers Edge).
 *  - f_T (gesek turbulen penuh) dihitung dari rumus zona turbulen penuh
 *    1/√f = −2·log10(ε/3,7D) dengan ε = 0,045 mm (baja komersial, dasar tabel Crane); hasilnya
 *    ±5% dari tabel Crane (½" ≈ 0,027, 1" ≈ 0,023, 2" ≈ 0,019).
 *  - Perubahan diameter mendadak (bushing, sok/knee/tee reducer), diacu ke kecepatan di pipa
 *    kecil: penyempitan K = 0,5·(1−β²), pelebaran K = (1−β²)² (Borda–Carnot), β = D_kecil/D_besar.
 *  - PERKIRAAN (tidak ada di tabel Crane, dibulatkan dari tabel rugi minor umum): sok 0,05,
 *    adapter drat & nipple 0,05, union 0,08, bulkhead 0,1, flange 0,02.
 *  - Ujung keluar: duckbill = energi kinetik jet di mulut nozzle (luas 1,5 cm², sama dengan
 *    jet di simulasi arus) + rugi nozzle ±5%; ujung pipa terbuka K = 1 (seluruh v²/2g hilang).
 */
import { dims, TYPES, SIZES } from './catalog.js';
import { partPorts, frames, freePorts } from './model.js';
import { G, NU, GEO } from '../physics/constants.js';
import { friction, valveK, returnArea, pumpOperatingPoint } from '../physics/hydraulics.js';

/** L/D ekuivalen (Crane TP-410). */
export const LD = { elbow90: 30, elbow45: 16, bend180: 50, teeRun: 20, teeBranch: 60, gatevalve: 8, ballvalve: 3 };
/** K tetap perkiraan untuk sambungan lurus yang tidak ada di tabel Crane. */
export const K_APPROX = { socket: 0.05, socketF: 0.05, socketM: 0.05, nipple: 0.05, union: 0.08, bulkhead: 0.1, flange: 0.02 };
/** Kekasaran acuan f_T (cm): baja komersial 0,045 mm. */
export const EPS_FT = 0.0045;
/** Luas mulut duckbill (cm²), sama dengan jet di simulasi arus. */
export const NOZZLE_AREA = 1.5;
/** Titik keluaran pompa return dan sendi duckbill di model tank (mm). */
export const PUMP_OUT = [445, 62, -75];
export const NOZZLE_MM = [445, 258, 35];
/** Patokan umum kecepatan di pipa tekan air (m/s): di atas ini rugi & bunyi aliran naik tajam. */
export const V_HIGH = 2.5;

/** Faktor gesek turbulen penuh untuk diameter dalam D (cm). */
export const fT = (D) => 0.25 / Math.log10(EPS_FT / (3.7 * D)) ** 2;

export const EXITS = {
  duckbill: {
    label: 'Duckbill / nozzle (seperti di simulasi)',
    /** K diacu ke kecepatan di pipa keluar (luas A cm²). */
    K(A) {
      const r = A / NOZZLE_AREA;
      // r ≥ 1: aliran dipercepat ke mulut nozzle; r < 1: melebar dulu (Borda–Carnot) lalu keluar
      return r >= 1 ? 1.05 * r * r : (1 - r) ** 2 + r * r;
    },
  },
  open: { label: 'Ujung pipa terbuka', K: () => 1 },
};

const area = (D) => (Math.PI * D * D) / 4;
const len3 = (p) => Math.hypot(p[0], p[1], p[2]);
const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sizeLabel = (s) => SIZES[s]?.label || s;

/**
 * Langkah jalur antara dua port bebas (pohon: naik ke leluhur bersama lalu turun).
 * @returns {Array<{part: object, i: number, o: number}>|null} null bila beda rangkaian
 */
export function tracePath(design, a, b) {
  const byId = new Map(design.parts.map((p) => [p.id, p]));
  const chain = (id) => {
    const out = [];
    let p = byId.get(id);
    while (p) {
      out.push(p);
      p = p.parent == null ? null : byId.get(p.parent);
    }
    return out;
  };
  const ca = chain(a.pid);
  const cb = chain(b.pid);
  if (!ca.length || !cb.length || ca[ca.length - 1] !== cb[cb.length - 1]) return null;
  const idxB = new Map(cb.map((p, i) => [p.id, i]));
  const ia = ca.findIndex((p) => idxB.has(p.id));
  const ib = idxB.get(ca[ia].id);
  const steps = [];
  let entry = a.port;
  for (let i = 0; i < ia; i++) {
    steps.push({ part: ca[i], i: entry, o: ca[i].cport ?? 0 });
    entry = ca[i].pport;
  }
  steps.push({ part: ca[ia], i: entry, o: ib > 0 ? cb[ib - 1].pport : b.port });
  for (let j = ib - 1; j >= 0; j--) steps.push({ part: cb[j], i: cb[j].cport ?? 0, o: j > 0 ? cb[j - 1].pport : b.port });
  return steps;
}

/** Elemen rugi untuk perubahan diameter Din → Dout (cm), diacu ke pipa kecil. */
function transition(pid, Din, Dout) {
  if (Math.abs(Din - Dout) < 1e-6) return null;
  const Ds = Math.min(Din, Dout);
  const b2 = (Ds / Math.max(Din, Dout)) ** 2;
  const contract = Dout < Din;
  return {
    pid,
    kind: contract ? 'contract' : 'expand',
    label: contract ? 'Penyempitan mendadak' : 'Pelebaran mendadak',
    D: Ds,
    L: 0,
    Lin: 0,
    K: contract ? 0.5 * (1 - b2) : (1 - b2) ** 2,
    src: contract ? 'K = 0,5(1−β²)' : 'K = (1−β²)² Borda–Carnot',
  };
}

/** Elemen rugi satu bagian yang dilewati dari port i ke port o. */
function partElements(part, i, o, ctx) {
  const ports = partPorts(part);
  const pi = ports[i];
  const po = ports[o];
  const Di = dims(pi.size, part.cls).id / 10;
  const Do = dims(po.size, part.cls).id / 10;
  const t = part.type;
  const name = TYPES[t].name;
  const out = [];
  const fit = (K, src, D = Di, extra = {}) => out.push({ pid: part.id, kind: t, label: name, D, L: 0, Lin: ctx.lin, K, src, ...extra });
  const cat = TYPES[t].cat;
  // panjang lintasan (untuk inersia kolom air): lewat titik sudut untuk belokan & percabangan
  ctx.lin = (cat === 'belok' || cat === 'cabang' ? len3(pi.p) + len3(po.p) : dist3(pi.p, po.p)) / 10;
  if (t === 'bend180') ctx.lin *= Math.PI / 2;
  switch (t) {
    case 'pipe':
      out.push({ pid: part.id, kind: 'pipe', label: `Pipa ${sizeLabel(part.size)}`, D: Di, L: part.len / 10, Lin: part.len / 10, K: 0, src: 'Darcy–Weisbach' });
      return out;
    case 'elbow90':
    case 'elbowF':
    case 'elbowMF':
      fit(LD.elbow90 * fT(Di), `f_T·${LD.elbow90}`);
      return out;
    case 'elbow90r': {
      // belok di ukuran besar, lalu perubahan diameter
      const Dbig = Math.max(Di, Do);
      fit(LD.elbow90 * fT(Dbig), `f_T·${LD.elbow90}`, Dbig);
      const tr = transition(part.id, Di, Do);
      if (tr) out.push(tr);
      return out;
    }
    case 'elbow45':
      fit(LD.elbow45 * fT(Di), `f_T·${LD.elbow45}`);
      return out;
    case 'bend180':
      fit(LD.bend180 * fT(Di), `f_T·${LD.bend180}`);
      return out;
    case 'tee':
    case 'teeR':
    case 'teeF':
    case 'cross': {
      const run = dot3(pi.d, po.d) < -0.9;
      const Drun = Math.max(Di, Do);
      const ld = run ? LD.teeRun : LD.teeBranch;
      fit(ld * fT(Drun), `f_T·${ld} (${run ? 'aliran lurus' : 'lewat cabang'})`, Drun, { label: `${name} — ${run ? 'lurus' : 'cabang'}` });
      const tr = transition(part.id, Di, Do);
      if (tr) out.push(tr);
      return out;
    }
    case 'socketR':
    case 'bushing': {
      const tr = transition(part.id, Di, Do);
      if (tr) out.push({ ...tr, label: `${name} (${tr.label.toLowerCase()})`, Lin: ctx.lin });
      return out;
    }
    case 'ballvalve':
      if (!ctx.valveUsed) {
        ctx.valveUsed = true;
        // mengikuti slider "bukaan ball valve return" (valveK di model); terbuka penuh ≈ f_T·3
        fit(0, 'bukaan = slider return', Di, { valve: true });
      } else fit(LD.ballvalve * fT(Di), `f_T·${LD.ballvalve} (terbuka penuh)`);
      return out;
    case 'gatevalve':
      fit(LD.gatevalve * fT(Di), `f_T·${LD.gatevalve} (terbuka penuh)`);
      return out;
    default:
      if (K_APPROX[t] !== undefined) fit(K_APPROX[t], 'perkiraan');
      else fit(0, '—');
      return out;
  }
}

/** Jarak maksimum ujung dari keluaran pompa agar otomatis dianggap ujung masuk (mm). */
export const PUMP_SNAP = 60;

/**
 * Port bebas bawaan: masuk = ujung terbuka di keluaran pompa (≤ 6 cm) atau ujung pilihan;
 * keluar = terdekat ke sendi duckbill di rangkaian yang sama.
 * @returns {{inlet: {pid, port}|null, outlet: {pid, port}|null}}
 */
export function defaultEnds(design, fr = frames(design), inlet = null) {
  const free = freePorts(design, fr);
  const P = (f) => [f.p.x, f.p.y, f.p.z];
  const runOf = rootOf(design);
  const inF = inlet
    ? free.find((f) => sameEnd(f, inlet))
    : free
        .filter((f) => dist3(P(f), PUMP_OUT) <= PUMP_SNAP)
        .sort((a, b) => dist3(P(a), PUMP_OUT) - dist3(P(b), PUMP_OUT))[0];
  if (!inF) return { inlet: null, outlet: null };
  const rest = free.filter((f) => f !== inF && runOf(f.pid) === runOf(inF.pid));
  const out = rest.length ? rest.reduce((a, b) => (dist3(P(b), NOZZLE_MM) < dist3(P(a), NOZZLE_MM) ? b : a)) : null;
  return { inlet: { pid: inF.pid, port: inF.port }, outlet: out && { pid: out.pid, port: out.port } };
}

function rootOf(design) {
  const byId = new Map(design.parts.map((p) => [p.id, p]));
  return (id) => {
    let p = byId.get(id);
    while (p && p.parent != null) p = byId.get(p.parent);
    return p?.id;
  };
}

const sameEnd = (a, b) => a && b && a.pid === b.pid && a.port === b.port;

/**
 * Jalur return dari desain.
 * @param {object} design
 * @param {{inlet?: {pid, port}, outlet?: {pid, port}, exit?: string}} opt
 * @returns {{ok: boolean, error?: string, inlet, outlet, exit, elems: object[], warnings: string[], zout: number, line: object|null, lengthCm: number}}
 */
export function analyzeLine(design, opt = {}) {
  const fr = frames(design);
  const free = freePorts(design, fr);
  const isFree = (e) => e && free.some((f) => f.pid === e.pid && f.port === e.port);
  let { inlet, outlet } = opt;
  const exit = EXITS[opt.exit] ? opt.exit : 'duckbill';
  if (!isFree(inlet)) inlet = defaultEnds(design, fr).inlet;
  if (inlet && (!isFree(outlet) || sameEnd(inlet, outlet))) outlet = defaultEnds(design, fr, inlet).outlet;
  if (!inlet) outlet = isFree(outlet) ? outlet : null;
  const res = { ok: false, inlet, outlet, exit, elems: [], warnings: [], zout: 0, line: null, lengthCm: 0 };
  if (!design.parts.length) return { ...res, error: 'Belum ada rakitan.' };
  if (!inlet)
    return {
      ...res,
      error:
        'Belum ada ujung terbuka di keluaran pompa (44,5 · 6,2 · −7,5 cm). Pakai templat return, mulai rangkaian dari preset "Keluaran pompa return", atau pilih ujung masuk secara manual.',
    };
  if (!outlet) return { ...res, error: 'Butuh ujung keluar: ujung terbuka lain di rangkaian yang sama dengan ujung masuk.' };
  const steps = tracePath(design, inlet, outlet);
  if (!steps) return { ...res, error: 'Ujung masuk dan keluar ada di rangkaian yang berbeda — tidak tersambung.' };
  const ctx = { valveUsed: false, lin: 0 };
  for (const s of steps) {
    if (s.i === s.o) return { ...res, error: 'Jalur tidak valid (ujung yang sama dipakai dua kali).' };
    for (const e of partElements(s.part, s.i, s.o, ctx)) res.elems.push(e);
  }
  const outPart = design.parts.find((p) => p.id === outlet.pid);
  const outPort = partPorts(outPart)[outlet.port];
  const Dout = dims(outPort.size, outPart.cls).id / 10;
  const Aout = area(Dout);
  res.elems.push({ pid: outlet.pid, kind: 'exit', label: EXITS[exit].label, D: Dout, L: 0, Lin: 0, K: EXITS[exit].K(Aout), src: exit === 'open' ? 'K = 1' : 'jet di mulut nozzle' });
  for (const e of res.elems) e.A = area(e.D);
  const inPart = design.parts.find((p) => p.id === inlet.pid);
  const inPort = partPorts(inPart)[inlet.port];
  const Dref = dims(inPort.size, inPart.cls).id / 10;
  const Aref = area(Dref);
  const wIn = fr.get(inlet.pid).ports[inlet.port];
  const wOut = fr.get(outlet.pid).ports[outlet.port];
  res.zout = wOut.p.y / 10;
  res.lengthCm = res.elems.reduce((s, e) => s + (e.kind === 'pipe' ? e.L : e.Lin), 0);
  res.line = {
    A: Aref,
    D: Dref,
    L: Math.max(5, res.elems.reduce((s, e) => s + e.Lin * (Aref / e.A), 0)),
    zout: res.zout,
    segs: res.elems.map((e) => ({ D: e.D, A: e.A, L: e.L, K: e.K, valve: e.valve ? 1 : 0 })),
    name: design.name,
  };
  res.ok = true;

  /* peringatan desain */
  const run = rootOf(design);
  const others = free.filter((f) => run(f.pid) === run(inlet.pid) && !sameEnd(f, inlet) && !sameEnd(f, outlet));
  if (others.length)
    res.warnings.push(
      `${others.length} ujung lain di rangkaian ini masih terbuka — air juga akan keluar di sana. Perhitungan menganggapnya ditutup (dop/plug), jadi pasang penutupnya atau jadikan cabang terpisah.`,
    );
  const inMm = [wIn.p.x, wIn.p.y, wIn.p.z];
  if (dist3(inMm, PUMP_OUT) > 30) res.warnings.push('Ujung masuk tidak berada di keluaran pompa (44,5 · 6,2 · −7,5 cm). Head pompa tetap dihitung dari pompa di chamber pompa.');
  const o = [wOut.p.x / 10, wOut.p.y / 10, wOut.p.z / 10];
  const inTank = o[0] > 0.5 && o[0] < 49.5 && o[2] > 0.5 && o[2] < 24.5 && o[1] > 0;
  if (!inTank) res.warnings.push('Ujung keluar tidak berada di dalam tank utama — di simulasi air tetap dianggap masuk ke tank.');
  if (!res.elems.some((e) => e.valve)) res.warnings.push('Tidak ada ball valve di jalur: slider "bukaan ball valve return" tidak berpengaruh selama desain ini dipakai.');
  return res;
}

/**
 * Rincian rugi pada kecepatan acuan v (cm/s): kecepatan & rugi head tiap elemen.
 * @returns {Array<object & {v: number, h: number, Kv: number}>}
 */
export function breakdown(res, P, v) {
  const L = res.line;
  return res.elems.map((e) => {
    const vi = Math.abs(v) * (L.A / e.A);
    let K = e.K;
    if (e.valve) K += valveK(P.rv);
    if (e.L > 0) K += (friction((vi * e.D) / NU) * e.L) / e.D;
    return { ...e, v: vi, Kv: K, h: (K * vi * vi) / (2 * G) };
  });
}

/**
 * Titik kerja desain dan pembanding pipa bawaan simulasi pada level air S saat ini.
 * @returns {{design: object, base: object, hs: number, rows: object[], vmax: number}}
 */
export function operatingPoints(res, P, S) {
  const hsOf = (zout) => Math.max(S.HT, zout) - S.HP;
  const Pd = { ...P, on: true, retLine: res.line };
  const Pb = { ...P, on: true, retLine: null };
  const hs = hsOf(res.zout);
  const d = pumpOperatingPoint(Pd, hs);
  const b = pumpOperatingPoint(Pb, hsOf(GEO.ZOUT));
  const rows = breakdown(res, P, d.v);
  const vmax = Math.max(0, ...rows.filter((r) => r.kind !== 'exit').map((r) => r.v));
  return {
    hs,
    design: { ...d, Lph: d.Q * 3.6 },
    base: { ...b, Lph: b.Q * 3.6, A: returnArea(Pb) },
    rows,
    vmax,
  };
}

/** Ganti jalur return simulasi tanpa lompatan debit (kecepatan dikonversi ke penampang baru). */
export function applyRetLine(P, S, line) {
  const A0 = returnArea(P);
  P.retLine = line || null;
  if (S) S.vr *= A0 / returnArea(P);
}

/** Ringkasan Markdown untuk laporan Claude. */
export function hydroMarkdown(res, op, used) {
  if (!res.ok) return `- Hidrolik: ${res.error}`;
  const f = (x, n = 1) => (Number.isFinite(x) ? x.toFixed(n).replace('.', ',') : '–');
  const lines = [
    `- Dipakai sebagai pipa return di simulasi: **${used ? 'ya' : 'tidak'}**`,
    `- Ujung keluar: ${EXITS[res.exit].label}, tinggi ${f(res.zout)} cm; panjang jalur ±${f(res.lengthCm / 100, 2)} m`,
    `- Titik kerja (level air saat ini, beda statis ${f(op.hs)} cm): **${Math.round(op.design.Lph)} L/jam**, head pompa ${f(op.design.head)} cm — pipa bawaan simulasi: ${Math.round(op.base.Lph)} L/jam`,
    `- Kecepatan tertinggi di pipa: ${f(op.vmax / 100, 2)} m/s`,
    '',
    '| Bagian | Ø dalam (mm) | v (m/s) | K | Rugi (cm) | Dasar |',
    '|---|---|---|---|---|---|',
    ...op.rows.map((r) => `| ${r.label} | ${f(r.D * 10)} | ${f(r.v / 100, 2)} | ${f(r.Kv, 2)} | ${f(r.h, 1)} | ${r.src} |`),
  ];
  if (res.warnings.length) lines.push('', ...res.warnings.map((w) => `- ⚠ ${w}`));
  return lines.join('\n');
}
