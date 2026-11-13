/**
 * Simpan/muat pengaturan pengguna (localStorage, per browser/perangkat).
 *
 * Data dari penyimpanan diperlakukan sebagai tidak tepercaya: setiap nilai divalidasi
 * terhadap SPEC (tipe, rentang, pilihan sah). Angka di luar rentang dipotong ke batasnya,
 * nilai bertipe salah atau pilihan tak dikenal diabaikan (tetap memakai bawaan),
 * sehingga data rusak atau dari versi lama tidak bisa membuat simulasi error.
 *
 * Yang sengaja TIDAK disimpan: status listrik, jeda, dan grup menu yang terbuka.
 */

export const STORAGE_KEY = 'reefsim:pengaturan';
export const SCHEMA = 1;

const num = (min, max) => ({ t: 'num', min, max });
const bool = { t: 'bool' };
const oneOf = (...vals) => ({ t: 'enum', vals });
const color = { t: 'color' };

/** Skema pengaturan per grup state aplikasi. */
export const SPEC = {
  P: {
    qmax: num(200, 1500),
    hmax: num(0.3, 2),
    spd: num(0.3, 1),
    rv: num(0.05, 1),
    n: oneOf(1),
    D: oneOf(1.7, 1.8, 2.2),
    zin: num(2, 22),
    zd: num(18, 27),
    sv: num(0.05, 1),
    sk: oneOf(0, 1, 2),
    zrim: num(22, 29.5),
    kb: num(0.05, 1),
    venturi: bool,
    box: bool,
    hole: bool,
    ato: bool,
    fswHi: bool,
    fswLo: bool,
    clog: num(0, 0.95),
    disp: num(0, 10),
  },
  V: {
    flow: bool,
    label: bool,
    clear: bool,
    fish: bool,
    coral: bool,
    rock: bool,
    sand: bool,
    lamp: bool,
    room: bool,
    cfd: bool,
    tr3d: bool,
    planeOn: bool,
    filterPlane: bool,
    fog: bool,
    wm: bool,
  },
  NZL: { yaw: num(-90, 90), pitch: num(-60, 45) },
  WM: { q: num(300, 3000), yaw: num(-80, 80), pitch: num(-45, 45), y: num(5, 25) },
  LOOK: {
    dark: bool,
    skim: oneOf('air', 'ven'),
    bg: oneOf('black', 'white', 'gwhite', 'marine', 'custom', 'none'),
    bgc: color,
    lamp: oneOf('white', 'cool', 'mix', 'blue', 'purple', 'off'),
    li: num(10, 100),
  },
  FV: {
    orient: oneOf('h', 'v'),
    sliceZ: num(1, 24),
    cmap: oneOf('turbo', 'plasma', 'viridis'),
    value: oneOf('inst', 'avg'),
    vmax: num(0, 30),
    mapAlpha: num(0, 1),
    anim: num(0.5, 5),
    fogMode: oneOf('fast', 'dead', 'all'),
    fogDensity: num(0.1, 3),
  },
  /** nilai langsung di objek app */
  top: {
    sliceY: num(1, 28),
    glassTint: num(0, 1),
    SPD: num(1, 20),
    volS: num(28, 44),
    quality: oneOf('a', '0', '2', '3'),
  },
};

const EL_ROW = { w: num(0, 5000), h: num(0, 24) };
const EL_TARIF = num(0, 100000);

function cleanValue(v, s) {
  switch (s.t) {
    case 'num':
      return typeof v === 'number' && Number.isFinite(v) ? Math.min(s.max, Math.max(s.min, v)) : undefined;
    case 'bool':
      return typeof v === 'boolean' ? v : undefined;
    case 'enum':
      return s.vals.includes(v) ? v : undefined;
    case 'color':
      return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : undefined;
    default:
      return undefined;
  }
}

/** Ambil hanya kunci yang dikenal dan nilainya sah. */
export function sanitizeGroup(obj, spec) {
  const out = {};
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return out;
  for (const [k, s] of Object.entries(spec)) {
    if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
    const v = cleanValue(obj[k], s);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** Validasi seluruh dokumen pengaturan. Mengembalikan null bila tidak bisa dipakai. */
export function sanitize(data, elRowIds = []) {
  if (!data || typeof data !== 'object' || data.v !== SCHEMA) return null;
  const out = { v: SCHEMA };
  for (const g of Object.keys(SPEC)) out[g] = sanitizeGroup(data[g], SPEC[g]);
  out.EL = { rows: {} };
  const el = data.EL;
  if (el && typeof el === 'object') {
    const tarif = cleanValue(el.tarif, EL_TARIF);
    if (tarif !== undefined) out.EL.tarif = tarif;
    if (el.rows && typeof el.rows === 'object' && !Array.isArray(el.rows)) {
      for (const id of elRowIds) {
        const r = sanitizeGroup(el.rows[id], EL_ROW);
        if (Object.keys(r).length) out.EL.rows[id] = r;
      }
    }
  }
  return out;
}

/** Potret pengaturan dari state aplikasi saat ini. */
export function snapshot(app, EL) {
  const pick = (src, spec) => Object.fromEntries(Object.keys(spec).map((k) => [k, src[k]]));
  return {
    v: SCHEMA,
    P: pick(app.P, SPEC.P),
    V: pick(app.V, SPEC.V),
    NZL: pick(app.NZL, SPEC.NZL),
    WM: pick(app.WM, SPEC.WM),
    LOOK: pick(app.LOOK, SPEC.LOOK),
    FV: pick(app.FV, SPEC.FV),
    top: pick(app, SPEC.top),
    EL: { tarif: EL.tarif, rows: Object.fromEntries(EL.rows.map((r) => [r.id, { w: r.w, h: r.h }])) },
  };
}

/** Terapkan pengaturan tervalidasi ke state aplikasi dan tabel listrik. */
export function applySettings(app, EL, s) {
  Object.assign(app.P, s.P);
  Object.assign(app.V, s.V);
  Object.assign(app.NZL, s.NZL);
  Object.assign(app.WM, s.WM);
  Object.assign(app.LOOK, s.LOOK);
  Object.assign(app.FV, s.FV);
  Object.assign(app, s.top);
  if (s.EL.tarif !== undefined) EL.tarif = s.EL.tarif;
  for (const r of EL.rows) if (s.EL.rows[r.id]) Object.assign(r, s.EL.rows[r.id]);
}

/** localStorage bisa tidak tersedia (mode privat, kebijakan browser). */
function defaultStorage() {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function loadSettings(EL, storage = defaultStorage()) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return sanitize(JSON.parse(raw), EL.rows.map((r) => r.id));
  } catch (err) {
    console.warn('Pengaturan tersimpan tidak bisa dibaca, memakai bawaan', err);
    return null;
  }
}

export function saveSettings(app, EL, storage = defaultStorage()) {
  if (!storage) return false;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(snapshot(app, EL)));
    return true;
  } catch (err) {
    console.warn('Pengaturan tidak bisa disimpan', err);
    return false;
  }
}

export function clearSettings(storage = defaultStorage()) {
  try {
    storage?.removeItem(STORAGE_KEY);
  } catch {
    /* abaikan */
  }
}
