/**
 * Konstanta fisika dan geometri (satuan CGS: cm, cm³/s, cm/s, detik).
 *
 * Semua angka di sini berasal dari tank yang dimodelkan:
 * tank 50×25×30 cm + back filter 50×11×30 cm di dasar yang sama.
 */

/** Percepatan gravitasi (cm/s²). */
export const G = 981;
/** Viskositas kinematik air laut ±26 °C (cm²/s). */
export const NU = 0.0095;
/** Tinggi bibir kaca (cm). Di atas ini air tumpah. */
export const RIM = 30;

export const GEO = Object.freeze({
  /** Luas permukaan tank utama (cm²). */
  AT: 1176,
  /** Luas overflow box (cm²). */
  AB: 48,
  /** Luas chamber 1 (kapas), 2 (skimmer), 3 (bio), pompa (cm²). */
  A1: 100,
  A2: 100,
  A3: 170,
  AP: 100,
  /** Tinggi puncak sekat 2 dan sekat 4 (weir) (cm). */
  W2: 22.5,
  W4: 20,
  /** Tinggi sisir overflow box dan lebarnya (cm). */
  ZC: 26.5,
  BC: 6,
  /** Tinggi intake siphon di overflow box dan dasar box (cm). */
  ZBOX: 18,
  ZBOX0: 16,
  /** Tinggi ujung duckbill (outlet return) dan lubang siphon-break (cm). */
  ZOUT: 25.5,
  ZHOLE: 26.3,
  /** Panjang ekuivalen jalur return dan diameter dalamnya (cm). */
  LR: 110,
  DR: 1.2,
  /** ATO: setpoint level chamber pompa, kapasitas reservoir (cm³), debit (cm³/s). */
  ATOSET: 18,
  ATOMAX: 2000,
  ATOQ: 16.7,
  /** Tinggi puncak U-pipe (cm). */
  YC: 34,
  /** Surface skimmer: kedalaman mangkuk, lebar bibir efektif, jarak bibir di bawah permukaan (tipe mengapung). */
  CUPD: 3,
  CUPB: 7,
  CUPS: 0.4,
  /** Jarak tee cabang surface skimmer di atas intake bawah (cm). */
  ZJ: 3,
});

/** Langkah waktu tetap integrator hidrolik (detik). */
export const PHYS_DT = 0.02;
