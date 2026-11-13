/**
 * State aplikasi bersama. Satu objek `app` supaya modul lain selalu melihat
 * referensi terbaru (mis. setelah Reset mengganti app.P dan app.S).
 */
import { defaultParams, initialState, totalVolume } from './physics/hydraulics.js';

export const DEFAULT_VIEW = Object.freeze({
  flow: true,
  label: true,
  clear: true,
  fish: true,
  coral: true,
  rock: true,
  sand: true,
  lamp: true,
  room: true,
  cfd: true,
  sliceOn: false,
  wm: false,
});

export const app = {
  P: defaultParams(),
  S: null,
  /** Kecepatan simulasi (×). */
  SPD: 3,
  paused: false,
  /** Waktu simulasi saat listrik nyala lagi (uji padam), 0 = tidak aktif. */
  tOn: 0,
  /** Nilai slider volume (L). */
  volS: 0,
  /** Riwayat untuk grafik (maks 300 titik @ 0,5 dtk simulasi). */
  hist: [],
  /** Visibilitas / tampilan. */
  V: { ...DEFAULT_VIEW },
  /** Arah duckbill (derajat). */
  NZL: { yaw: 20, pitch: 15 },
  /** Wavemaker: debit (L/jam), arah, tinggi. */
  WM: { q: 1000, yaw: 0, pitch: 0, y: 16 },
  /** Tampilan: mode gelap, tipe skimmer, latar, lampu. */
  LOOK: { dark: false, skim: 'air', bg: 'black', bgc: '#1e3a5f', lamp: 'mix', li: 80 },
  sliceY: 4,
  glassTint: 0.5,
  /** Statistik arus dari worker. */
  flowStats: { dead: 0, weak: 0, mean: 0, bottom: 0 },
};
app.S = initialState(app.P);

/** Volume air bersih (L) = volume total − batu dan pasir. */
export const waterLitres = () => totalVolume(app.S, app.P) / 1000 - app.P.disp;
/** Salinitas (ppt). */
export const salinity = () => app.S.salt / Math.max(1, waterLitres());

app.volS = waterLitres();

/* ---------- event bus kecil antar-modul ---------- */
const listeners = new Map();
export function on(evt, fn) {
  if (!listeners.has(evt)) listeners.set(evt, new Set());
  listeners.get(evt).add(fn);
  return () => listeners.get(evt).delete(fn);
}
export function emit(evt, payload) {
  const set = listeners.get(evt);
  if (set) for (const fn of set) fn(payload);
}

/** Ganti parameter + state (Reset / ganti mode overflow box). */
export function resetState(P = defaultParams()) {
  app.P = P;
  app.S = initialState(P);
  app.hist.length = 0;
  app.volS = waterLitres();
}
