/**
 * Jam simulasi di tampilan 3D: waktu simulasi sejak Reset, berjalan mengikuti kecepatan simulasi
 * (jarum berputar satu kali per menit simulasi). Ketuk untuk mengganti kecepatan.
 *
 * Dua hal yang bisa membuat "waktu" di layar tidak sama dengan kecepatan yang dipilih, dan
 * karena itu ditampilkan terus terang di baris kecil:
 *  - perangkat lambat: simulasi hidrolik tidak sanggup mengejar → kecepatan nyata lebih rendah;
 *  - arus (CFD) dihitung terpisah dan pada kecepatan tinggi tertinggal dari waktu simulasi.
 */
import { app } from '../state.js';
import { $ } from '../util/format.js';

export const SPEED_STEPS = [1, 3, 10, 20];

/** Kecepatan berikutnya dalam siklus 1× → 3× → 10× → 20× → 1×. */
export function nextSpeed(v) {
  return SPEED_STEPS.find((s) => s > v + 1e-9) ?? SPEED_STEPS[0];
}

/** Detik simulasi → "MM:SS" atau "J:MM:SS". */
export function formatSimTime(t) {
  const s = Math.max(0, Math.floor(t));
  const p = (v) => String(v).padStart(2, '0');
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${p(m)}:${p(s % 60)}` : `${p(m)}:${p(s % 60)}`;
}

const num = (v, d = 1) => v.toFixed(d).replace('.', ',');

/**
 * @param {{flow: any, onSpeed: (v: number) => void}} ctx
 */
export function buildClock({ flow, onSpeed }) {
  const btn = $('simClock');
  if (!btn) return { frame() {}, update() {} };
  const hand = $('simClockHand');
  const time = $('simClockTime');
  const speed = $('simClockSpeed');
  const note = $('simClockNote');
  btn.addEventListener('click', () => {
    onSpeed(nextSpeed(app.SPD));
    api.update(0); // angka kecepatan langsung berubah, tidak menunggu siklus UI
  });

  const cache = {};
  const set = (node, key, text) => {
    if (cache[key] !== text) {
      cache[key] = text;
      node.textContent = text;
    }
  };
  let lastDeg = -1;
  // kecepatan nyata = detik simulasi per detik jam, diukur per jendela ±2 dtk
  let winWall = 0;
  let winT0 = app.S.t;
  let eff = null;

  const api = {
    /** Tiap frame: jarum jam (1 putaran = 1 menit simulasi). */
    frame() {
      const deg = Math.round(((app.S.t % 60) / 60) * 3600) / 10;
      if (deg !== lastDeg) {
        lastDeg = deg;
        hand.setAttribute('transform', `rotate(${deg} 10 10)`);
      }
    },
    /** Tiap ±0,2 dtk: teks waktu, kecepatan, dan catatan bila tertinggal. */
    update(wallDt) {
      const { S, V } = app;
      set(time, 't', formatSimTime(S.t));
      set(speed, 's', app.paused ? 'jeda' : app.SPD + '×');
      btn.classList.toggle('paused', app.paused);

      if (app.paused || S.t < winT0) {
        // jeda atau simulasi diulang: mulai jendela ukur baru
        winWall = 0;
        winT0 = S.t;
        eff = null;
      } else {
        winWall += wallDt;
        if (winWall >= 2) {
          eff = (S.t - winT0) / winWall;
          winWall = 0;
          winT0 = S.t;
        }
      }
      const parts = [];
      if (!app.paused && eff !== null && eff < app.SPD * 0.85) parts.push(`nyata ±${num(eff, eff < 10 ? 1 : 0)}× (perangkat lambat)`);
      if (!app.paused && V.cfd && flow.perf.ratio < 0.9) parts.push(`arus tertinggal ${formatSimTime(flow.cfdAge)} (${Math.round(flow.perf.ratio * 100)}%)`);
      const text = parts.join(' · ');
      set(note, 'n', text);
      if (note.hidden !== !text) note.hidden = !text;
    },
  };
  return api;
}
