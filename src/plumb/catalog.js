/**
 * Katalog rakit pipa: ukuran pipa, drat, jenis fitting, dan letak ujung (port) tiap fitting.
 * Semua satuan mm. Bagian geometri 3D memakai angka yang sama (lihat geometry.js), jadi letak
 * port selalu cocok dengan bentuknya.
 *
 * Status data:
 *  - TERVERIFIKASI: diameter luar pipa metrik 20/25/32 mm; panjang sok metrik ISO 727
 *    (L = 0,5·D + 6 mm, min 12 mm); dimensi drat BSP ISO 7-1 (diameter mayor & TPI).
 *  - PERKIRAAN (beda antar merek, bisa disesuaikan nanti): diameter luar pipa seri Indonesia
 *    (ukuran yang umum di pasaran), tebal dinding AW/D, kedalaman sok tipe JIS, panjang badan
 *    fitting, panjang ulir yang masuk.
 */

export const SERIES = { in: 'Indonesia (inci, AW/D)', m: 'Metrik (mm)' };
export const CLASSES = { AW: 'AW · 10 kg/cm²', D: 'D · 5 kg/cm²', M: 'Metrik PN16' };

/** Drat pipa BSP (ISO 7-1): diameter mayor (mm), ulir per inci, panjang ulir masuk (perkiraan). */
export const THREADS = {
  '1/2': { label: '½"', d: 20.955, tpi: 14, eng: 13 },
  '3/4': { label: '¾"', d: 26.441, tpi: 14, eng: 14 },
  1: { label: '1"', d: 33.249, tpi: 11, eng: 16 },
  '1-1/4': { label: '1¼"', d: 41.91, tpi: 11, eng: 18 },
  '1-1/2': { label: '1½"', d: 47.803, tpi: 11, eng: 18 },
  2: { label: '2"', d: 59.614, tpi: 11, eng: 21 },
};

/**
 * Ukuran pipa. od = diameter luar; wall = tebal dinding per kelas; sock = kedalaman sok (pipa
 * masuk sejauh ini ke fitting); thr = drat untuk adapter/fitting drat ukuran ini.
 */
export const SIZES = {
  i12: { label: '½"', series: 'in', od: 22, wall: { AW: 2.0, D: 1.5 }, sock: { AW: 30, D: 22 }, thr: '1/2' },
  i34: { label: '¾"', series: 'in', od: 26, wall: { AW: 2.0, D: 1.5 }, sock: { AW: 35, D: 25 }, thr: '3/4' },
  i1: { label: '1"', series: 'in', od: 32, wall: { AW: 2.2, D: 1.6 }, sock: { AW: 40, D: 28 }, thr: '1' },
  i114: { label: '1¼"', series: 'in', od: 42, wall: { AW: 2.4, D: 1.7 }, sock: { AW: 44, D: 31 }, thr: '1-1/4' },
  i112: { label: '1½"', series: 'in', od: 48, wall: { AW: 2.6, D: 1.8 }, sock: { AW: 55, D: 38 }, thr: '1-1/2' },
  i2: { label: '2"', series: 'in', od: 60, wall: { AW: 3.0, D: 2.0 }, sock: { AW: 63, D: 44 }, thr: '2' },
  // metrik: tebal PN16 (SDR 13,6), sok ISO 727
  m20: { label: '20 mm', series: 'm', od: 20, wall: { M: 1.5 }, sock: { M: 16 }, thr: '1/2' },
  m25: { label: '25 mm', series: 'm', od: 25, wall: { M: 1.9 }, sock: { M: 18.5 }, thr: '3/4' },
  m32: { label: '32 mm', series: 'm', od: 32, wall: { M: 2.4 }, sock: { M: 22 }, thr: '1' },
};
export const SIZE_ORDER = { in: ['i12', 'i34', 'i1', 'i114', 'i112', 'i2'], m: ['m20', 'm25', 'm32'] };

/** Warna/material uPVC (air laut: tanpa logam). */
export const COLORS = {
  abu: { label: 'uPVC abu-abu', hex: 0x6f7579 },
  putih: { label: 'uPVC putih', hex: 0xecece6 },
  bening: { label: 'uPVC bening', hex: 0xdfeef2, clear: true },
};

/** Kelas efektif untuk ukuran (metrik selalu 'M'). */
export const classFor = (size, cls) => (SIZES[size]?.series === 'm' ? 'M' : cls === 'D' ? 'D' : 'AW');

/** Dimensi turunan untuk satu ukuran + kelas. */
export function dims(size, cls = 'AW') {
  const s = SIZES[size];
  if (!s) throw new Error('Ukuran tidak dikenal: ' + size);
  const c = classFor(size, cls);
  const t = THREADS[s.thr];
  const hubT = Math.max(2.6, 0.11 * s.od); // tebal dinding sok
  return {
    key: size,
    label: s.label,
    cls: c,
    od: s.od,
    r: s.od / 2,
    wall: s.wall[c],
    id: s.od - 2 * s.wall[c],
    sock: s.sock[c],
    hubR: s.od / 2 + hubT,
    thr: s.thr,
    thrD: t.d,
    tpi: t.tpi,
    eng: t.eng,
    fhubR: t.d / 2 + Math.max(3, 0.1 * t.d), // badan drat dalam
  };
}

/** Angka badan fitting (perkiraan, sebanding diameter luar). */
export const Z = {
  g: 2, // sekat penahan di tengah sok
  z90: (A) => 0.6 * A.od + 2,
  z45: (A) => 0.28 * A.od + 2,
  zT: (A) => 0.6 * A.od + 2,
  rU: (A) => 0.9 * A.od + 6,
  u: (A) => 0.45 * A.od + 8,
  v: (A) => 0.9 * A.od + 12,
  b: (A) => 0.35 * A.od + 6,
  hex: (A) => 0.35 * A.thrD + 4,
  cone: (A, B) => 0.5 * (A.od - B.od) + 6,
  flange: (A) => 0.2 * A.od + 8,
};

/** Kategori untuk daftar katalog. */
export const CATS = { pipa: 'Pipa', belok: 'Belokan', cabang: 'Percabangan', lurus: 'Sambungan lurus', tutup: 'Penutup', kontrol: 'Valve & flange' };

/**
 * Jenis bagian. two: 'smaller' = punya ukuran kedua (lebih kecil) untuk reducer.
 * Jenis ujung port: S = sok polos (lem, betina), P = ujung polos (pipa/bagian luar bushing),
 * F = drat dalam, M = drat luar, FL = muka flange.
 */
export const TYPES = {
  pipe: { name: 'Pipa', cat: 'pipa' },
  elbow90: { name: 'Knee 90°', cat: 'belok' },
  elbow45: { name: 'Knee 45°', cat: 'belok' },
  bend180: { name: 'Belokan 180° (U)', cat: 'belok' },
  elbow90r: { name: 'Knee reducer 90°', cat: 'belok', two: 'smaller' },
  elbowF: { name: 'Knee drat dalam (faucet elbow)', cat: 'belok' },
  elbowMF: { name: 'Knee drat luar–dalam (M&F)', cat: 'belok' },
  tee: { name: 'Tee', cat: 'cabang' },
  teeR: { name: 'Tee reducer', cat: 'cabang', two: 'smaller' },
  teeF: { name: 'Tee drat dalam', cat: 'cabang' },
  cross: { name: 'Cross (palang)', cat: 'cabang' },
  socket: { name: 'Sok (coupling)', cat: 'lurus' },
  socketR: { name: 'Sok reducer', cat: 'lurus', two: 'smaller' },
  bushing: { name: 'Bushing reducer', cat: 'lurus', two: 'smaller' },
  socketF: { name: 'Sok drat dalam (female adapter)', cat: 'lurus' },
  socketM: { name: 'Sok drat luar (male adapter)', cat: 'lurus' },
  nipple: { name: 'Nipple hex (drat luar–luar)', cat: 'lurus' },
  union: { name: 'Union (sambungan lepas)', cat: 'lurus' },
  bulkhead: { name: 'Bulkhead (tembus kaca/akrilik)', cat: 'lurus' },
  cap: { name: 'Dop polos', cat: 'tutup' },
  capF: { name: 'Dop drat dalam', cat: 'tutup' },
  plug: { name: 'Plug drat luar', cat: 'tutup' },
  ballvalve: { name: 'Ball valve', cat: 'kontrol' },
  gatevalve: { name: 'Stop kran', cat: 'kontrol' },
  flange: { name: 'Flange', cat: 'kontrol' },
  blindflange: { name: 'Flange buta', cat: 'kontrol' },
};

const S45 = Math.SQRT1_2;
const port = (p, d, end, slot = 'a') => ({ p, d, end, slot });
const NZ = [0, 0, -1];
const PZ = [0, 0, 1];
const PX = [1, 0, 0];
const NX = [-1, 0, 0];

/**
 * Letak ujung (port) di ruang lokal bagian (mm). Port sok ada di dasar sok (tempat ujung pipa
 * berhenti) dan menghadap keluar; port drat luar di ujung ulir; port drat dalam di dasar ulir;
 * port flange di muka flange. Semua arah port berada di bidang XZ (sumbu "atas" lokal = +Y).
 * @param {string} type
 * @param {object} A dimensi ukuran utama (slot a)
 * @param {object} [B] dimensi ukuran kedua (slot b)
 * @param {number} [len] panjang potong pipa (mm)
 */
export function portsOf(type, A, B = A, len = 0) {
  const g = Z.g;
  switch (type) {
    case 'pipe':
      return [port([0, 0, 0], NZ, 'P'), port([0, 0, len], PZ, 'P')];
    case 'elbow90': {
      const z = Z.z90(A);
      return [port([0, 0, -z], NZ, 'S'), port([z, 0, 0], PX, 'S')];
    }
    case 'elbow45': {
      const z = Z.z45(A);
      return [port([0, 0, -z], NZ, 'S'), port([z * S45, 0, z * S45], [S45, 0, S45], 'S')];
    }
    case 'bend180': {
      const R = Z.rU(A);
      return [port([-R, 0, 0], NZ, 'S'), port([R, 0, 0], NZ, 'S')];
    }
    case 'elbow90r': {
      const z = Z.z90(A);
      return [port([0, 0, -z], NZ, 'S'), port([z, 0, 0], PX, 'S', 'b')];
    }
    case 'elbowF': {
      const z = Z.z90(A);
      return [port([0, 0, -z], NZ, 'S'), port([z, 0, 0], PX, 'F')];
    }
    case 'elbowMF': {
      const z = Z.z90(A);
      return [port([0, 0, -(z + A.eng)], NZ, 'M'), port([z, 0, 0], PX, 'F')];
    }
    case 'tee': {
      const z = Z.zT(A);
      return [port([0, 0, -z], NZ, 'S'), port([0, 0, z], PZ, 'S'), port([z, 0, 0], PX, 'S')];
    }
    case 'teeR': {
      const z = Z.zT(A);
      return [port([0, 0, -z], NZ, 'S'), port([0, 0, z], PZ, 'S'), port([z, 0, 0], PX, 'S', 'b')];
    }
    case 'teeF': {
      const z = Z.zT(A);
      return [port([0, 0, -z], NZ, 'S'), port([0, 0, z], PZ, 'S'), port([z, 0, 0], PX, 'F')];
    }
    case 'cross': {
      const z = Z.zT(A);
      return [port([0, 0, -z], NZ, 'S'), port([0, 0, z], PZ, 'S'), port([z, 0, 0], PX, 'S'), port([-z, 0, 0], NX, 'S')];
    }
    case 'socket':
      return [port([0, 0, -g], NZ, 'S'), port([0, 0, g], PZ, 'S')];
    case 'socketR':
      return [port([0, 0, -g], NZ, 'S'), port([0, 0, g + Z.cone(A, B)], PZ, 'S', 'b')];
    case 'bushing':
      // bagian luar (ukuran A) masuk ke sok A; di dalamnya sok ukuran B
      return [port([0, 0, -A.sock], NZ, 'P'), port([0, 0, 3 - B.sock], PZ, 'S', 'b')];
    case 'socketF':
      return [port([0, 0, -g], NZ, 'S'), port([0, 0, g], PZ, 'F')];
    case 'socketM':
      return [port([0, 0, -g], NZ, 'S'), port([0, 0, g + Z.hex(A) + A.eng], PZ, 'M')];
    case 'nipple': {
      const h = Z.hex(A) / 2 + A.eng;
      return [port([0, 0, -h], NZ, 'M'), port([0, 0, h], PZ, 'M')];
    }
    case 'union': {
      const u = Z.u(A);
      return [port([0, 0, -u], NZ, 'S'), port([0, 0, u], PZ, 'S')];
    }
    case 'bulkhead': {
      const b = Z.b(A);
      return [port([0, 0, -b], NZ, 'S'), port([0, 0, b], PZ, 'S')];
    }
    case 'cap':
      return [port([0, 0, 0], NZ, 'S')];
    case 'capF':
      return [port([0, 0, 0], NZ, 'F')];
    case 'plug':
      return [port([0, 0, -A.eng], NZ, 'M')];
    case 'ballvalve':
    case 'gatevalve': {
      const v = Z.v(A);
      return [port([0, 0, -v], NZ, 'S'), port([0, 0, v], PZ, 'S')];
    }
    case 'flange':
      return [port([0, 0, -g], NZ, 'S'), port([0, 0, Z.flange(A)], PZ, 'FL')];
    case 'blindflange':
      return [port([0, 0, 0], NZ, 'FL')];
    default:
      throw new Error('Jenis bagian tidak dikenal: ' + type);
  }
}

/** Dua jenis ujung bisa disambung? (S↔P lem, F↔M drat, FL↔FL baut) */
export function mates(a, b) {
  return (a === 'S' && b === 'P') || (a === 'P' && b === 'S') || (a === 'F' && b === 'M') || (a === 'M' && b === 'F') || (a === 'FL' && b === 'FL');
}

/** Jenis sambungan untuk daftar bahan. */
export const jointKind = (a, b) => (a === 'F' || a === 'M' ? 'thread' : a === 'FL' ? 'flange' : 'solvent');

/** Ukuran cocok: drat dibandingkan per ukuran drat, lainnya per ukuran pipa. */
export function sizesMatch(endA, sizeA, endB, sizeB) {
  if (endA === 'F' || endA === 'M') return SIZES[sizeA].thr === SIZES[sizeB].thr;
  return sizeA === sizeB;
}

/** Ukuran yang lebih kecil dalam seri yang sama (untuk reducer). */
export function smallerSizes(size) {
  const order = SIZE_ORDER[SIZES[size].series];
  return order.slice(0, order.indexOf(size));
}

export const END_LABEL = { S: 'sok polos', P: 'ujung polos', F: 'drat dalam', M: 'drat luar', FL: 'flange' };
